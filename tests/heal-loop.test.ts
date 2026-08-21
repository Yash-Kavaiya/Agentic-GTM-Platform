/**
 * The heal loop, end to end, against a fake CLI.
 *
 * This exercises the real control flow — drift, symptom composition, the
 * verification gate, approve vs reject, retry, quarantine — without a network,
 * an API key, or a cent of credit. The live CLI is swapped for a stub that
 * returns whatever preview the scenario needs.
 */
import { describe, it, expect, vi } from 'vitest'
import { healCollector, type HealDeps } from '../src/core/anneal/heal.js'
import { buildBaseline, computeStats } from '../src/core/anneal/health.js'
import type { SignalSpec, Observation } from '../src/core/types.js'
import type { BdResult } from '../src/core/brightdata/cli.js'

const signal: SignalSpec = {
  id: 'moving_upmarket',
  name: 'Moving Upmarket',
  category: 'pricing',
  adapter: 'web',
  path: '/pricing',
  watch: 'the pricing tiers on this page - for each tier, its name, its price, and the exact text of its call-to-action button',
  fields: { required: ['tiers[].name'], optional: ['tiers[].price', 'tiers[].cta'] },
  fire_when: { any: [{ field: 'tiers[].name', op: 'appears_matching', value: '(?i)enterprise', direction: 'any', window_days: 30 }] },
  evidence_template: 'Added a {{tier.name}} tier',
  weight: 30,
  cadence: 'daily',
}

const GOOD = [{ tiers: [
  { name: 'Free', price: '$0', cta: 'Start' },
  { name: 'Pro', price: '$20', cta: 'Buy' },
  { name: 'Team', price: '$50', cta: 'Buy' },
  { name: 'Enterprise', price: 'Custom', cta: 'Contact sales' },
] }]

/** What a redesigned page yields: still 200, still rows, all empty. */
const BROKEN = [{ tiers: [{ name: null, price: null, cta: null }] }]

const obs = (rows: Record<string, unknown>[], at: string): Observation => ({
  collectorId: 'c_8f2a91', signalId: signal.id, targetId: 'acme',
  sourceUrl: 'https://acme.com/pricing', observedAt: at, rows,
})

const baseline = buildBaseline(
  'c_8f2a91',
  Array.from({ length: 4 }, (_, i) => obs(GOOD, `2026-08-1${i}T04:00:00Z`)),
  signal,
)

const envelope = (status: string, preview: unknown): BdResult => ({
  envelope: { status, preview_result: preview },
  rows: [], stdout: '', stderr: '', code: 0, command: 'brightdata scraper heal', durationMs: 10,
})

function makeDeps(previews: unknown[]): HealDeps & {
  healCalls: { symptom: string }[]
  approveCalls: { reject?: boolean }[]
} {
  const healCalls: { symptom: string }[] = []
  const approveCalls: { reject?: boolean }[] = []
  let i = 0
  return {
    healCalls,
    approveCalls,
    heal: async (_c, symptom) => {
      healCalls.push({ symptom })
      return envelope('awaiting_approval', previews[Math.min(i++, previews.length - 1)])
    },
    approve: async (_c, o) => {
      approveCalls.push({ reject: o.reject })
      return envelope('done', null)
    },
    run: async () => envelope('done', GOOD),
    now: () => new Date('2026-08-21T04:12:00Z'),
  }
}

const args = {
  collectorId: 'c_8f2a91',
  signal,
  targetId: 'acme',
  url: 'https://acme.com/pricing',
  baseline,
  currentStats: computeStats(BROKEN, signal),
}

describe('heal loop', () => {
  it('heals, verifies, and approves a good fix', async () => {
    const deps = makeDeps([GOOD])
    const out = await healCollector(args, deps)

    expect(out.finalState).toBe('HEALTHY')
    expect(deps.healCalls).toHaveLength(1)
    expect(deps.approveCalls).toEqual([{ reject: undefined }]) // approved, not rejected
    expect(out.events).toHaveLength(1)
    expect(out.events[0]!.verdict).toBe('approved')
    expect(out.events[0]!.toState).toBe('HEALED')
  })

  it('reports rows recovered', async () => {
    const out = await healCollector(args, makeDeps([GOOD]))
    // 1 broken row -> 4 tiers restored
    expect(out.events[0]!.rowsRecovered).toBe(3)
    expect(out.events[0]!.before!.rowCount).toBe(1)
    expect(out.events[0]!.after!.rowCount).toBe(4)
  })

  it('sends the user\'s own words as the repair prompt, verbatim', async () => {
    const deps = makeDeps([GOOD])
    await healCollector(args, deps)
    const symptom = deps.healCalls[0]!.symptom
    expect(symptom.startsWith(signal.watch.trim())).toBe(true)
    expect(symptom).toMatch(/Observed failure:/)
  })

  it('rejects a fix that does not restore the data, then retries with a sharper prompt', async () => {
    // First fix is still broken; second works.
    const deps = makeDeps([BROKEN, GOOD])
    const out = await healCollector(args, deps)

    expect(out.finalState).toBe('HEALTHY')
    expect(deps.approveCalls).toEqual([{ reject: true }, { reject: undefined }])
    expect(deps.healCalls).toHaveLength(2)
    expect(deps.healCalls[1]!.symptom).toMatch(/previous fix was rejected/)
    expect(out.events.map((e) => e.verdict)).toEqual(['rejected', 'approved'])
  })

  it('never silently accepts a broken fix — quarantines after the attempt budget', async () => {
    const deps = makeDeps([BROKEN, BROKEN, BROKEN, BROKEN])
    const out = await healCollector(args, deps)

    expect(out.finalState).toBe('QUARANTINED')
    // Every single fix was actively rejected, never left pending.
    expect(deps.approveCalls.every((c) => c.reject === true)).toBe(true)
    expect(out.events.at(-1)!.toState).toBe('QUARANTINED')
  })

  it('quarantines when the CLI itself errors', async () => {
    const deps = makeDeps([GOOD])
    deps.heal = async () => { throw new Error('network unreachable') }
    const out = await healCollector(args, deps)

    expect(out.finalState).toBe('QUARANTINED')
    expect(out.events[0]!.verdict).toBe('error')
    expect(out.events[0]!.error).toMatch(/network unreachable/)
  })

  it('does nothing when there is no drift to heal', async () => {
    const deps = makeDeps([GOOD])
    const out = await healCollector({ ...args, currentStats: computeStats(GOOD, signal) }, deps)

    expect(out.finalState).toBe('HEALTHY')
    expect(deps.healCalls).toHaveLength(0)
    expect(out.events).toHaveLength(0)
  })

  it('treats a heal that returns no preview as a failure', async () => {
    const deps = makeDeps([GOOD])
    deps.heal = async () => envelope('error', null)
    const out = await healCollector(args, deps)
    expect(out.finalState).toBe('QUARANTINED')
  })

  it('rebaselines to the healed shape so the next run is judged fairly', async () => {
    const out = await healCollector(args, makeDeps([GOOD]))
    expect(out.baseline).not.toBeNull()
    expect(out.baseline!.rowCountMean).toBe(4)
    expect(out.baseline!.fields['tiers[].name']).toBe(0)
  })
})
