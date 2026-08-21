/**
 * Anneal is the part of Bellwether that must not be wrong, so it gets the
 * closest tests: every state transition, both exits from VERIFYING, and the
 * gate that stops a campaign citing a broken collector.
 */
import { describe, it, expect } from 'vitest'
import { transition, MAX_ATTEMPTS, isSafeToCite, UNSAFE_STATES } from '../src/core/anneal/machine.js'
import {
  computeStats,
  buildBaseline,
  detectDrift,
  detectColdStart,
  composeSymptom,
  sharpenSymptom,
  verifyAgainstContract,
  rowsRecovered,
  THRESHOLDS,
} from '../src/core/anneal/health.js'
import { canApprove, untrustworthyEvidence } from '../src/core/campaign/gate.js'
import type { SignalSpec, Observation, EvidenceRef, HealthState } from '../src/core/types.js'

const signal: SignalSpec = {
  id: 'moving_upmarket',
  name: 'Moving Upmarket',
  category: 'pricing',
  adapter: 'web',
  path: '/pricing',
  watch: 'the pricing tiers on this page - for each tier, its name, its price, and its call-to-action text',
  fields: { required: ['tiers[].name'], optional: ['tiers[].price', 'tiers[].cta'] },
  fire_when: { any: [{ field: 'tiers[].name', op: 'appears_matching', value: '(?i)enterprise', direction: 'any', window_days: 30 }] },
  evidence_template: 'Added a {{tier.name}} tier',
  weight: 30,
  cadence: 'daily',
}

const healthyRows = [
  { tiers: [
    { name: 'Free', price: '$0', cta: 'Start' },
    { name: 'Pro', price: '$20', cta: 'Buy' },
    { name: 'Team', price: '$50', cta: 'Buy' },
    { name: 'Enterprise', price: 'Custom', cta: 'Contact sales' },
  ] },
]

const obs = (rows: Record<string, unknown>[], at: string): Observation => ({
  collectorId: 'c_8f2a91', signalId: signal.id, targetId: 'acme',
  sourceUrl: 'https://acme.com/pricing', observedAt: at, rows,
})

const baselineOf = (n = 4) =>
  buildBaseline('c_8f2a91', Array.from({ length: n }, (_, i) => obs(healthyRows, `2026-08-${10 + i}T04:00:00Z`)), signal)

describe('stats and baseline', () => {
  it('counts the collection, not the JSON documents', () => {
    // One row of JSON containing four tiers is four tiers, not one row.
    expect(computeStats(healthyRows, signal).rowCount).toBe(4)
  })

  it('builds a baseline from recent healthy observations', () => {
    const b = baselineOf()
    expect(b.rowCountMean).toBe(4)
    expect(b.fields['tiers[].name']).toBe(0)
    expect(b.samples).toBe(4)
  })
})

describe('drift detection', () => {
  it('does not cry wolf over a merely unusual observation when history is thin', () => {
    // One sample is not a baseline, so a partial null-rate shift is not
    // actionable. Crying wolf on day two is worse than missing a day.
    const thin = buildBaseline('c_8f2a91', [obs(healthyRows, '2026-08-10T04:00:00Z')], signal)
    const unusual = computeStats([{ tiers: [{ name: 'Pro', price: null, cta: null }] }], signal)
    expect(detectDrift(unusual, thin, signal)).toEqual([])
  })

  it('still catches an absolute failure when history is thin', () => {
    // But "not enough history to compare" must never mean "assume healthy".
    // A required field empty in every row is broken however new the collector is.
    const thin = buildBaseline('c_8f2a91', [obs(healthyRows, '2026-08-10T04:00:00Z')], signal)
    const broken = computeStats([{ tiers: [{ name: null, price: null }] }], signal)
    expect(detectDrift(broken, thin, signal).length).toBeGreaterThan(0)
  })

  it('catches the silent failure: 200 OK, rows returned, all empty', () => {
    const broken = computeStats([{ tiers: [{ name: null, price: null, cta: null }] }], signal)
    const findings = detectDrift(broken, baselineOf(), signal)
    expect(findings.length).toBeGreaterThan(0)
    expect(findings.some((f) => f.kind === 'missing_field' && f.field === 'tiers[].name')).toBe(true)
  })

  it('catches a null-rate rise that is not "mostly empty"', () => {
    // 2% -> 40% is a redesign even though 40% is under the absolute threshold.
    const rows = [{ tiers: [
      { name: 'Free', price: '$0' }, { name: 'Pro', price: null },
      { name: 'Team', price: null }, { name: 'Enterprise', price: null },
    ] }]
    const findings = detectDrift(computeStats(rows, signal), baselineOf(), signal)
    expect(findings.some((f) => f.field === 'tiers[].price' && f.kind === 'null_rate')).toBe(true)
  })

  it('catches a row-count collapse', () => {
    const rows = [{ tiers: [{ name: 'Free', price: '$0', cta: 'Start' }] }]
    const findings = detectDrift(computeStats(rows, signal), baselineOf(), signal)
    expect(findings.some((f) => f.kind === 'row_count')).toBe(true)
  })

  it('reports nothing when the page is fine', () => {
    expect(detectDrift(computeStats(healthyRows, signal), baselineOf(), signal)).toEqual([])
  })

  it('does not flag a field that was always sparse', () => {
    const sparse = Array.from({ length: 4 }, () => obs([{ tiers: [{ name: 'Pro', price: null }] }], '2026-08-10T04:00:00Z'))
    const b = buildBaseline('c_x', sparse, signal)
    const findings = detectDrift(computeStats([{ tiers: [{ name: 'Pro', price: null }] }], signal), b, signal)
    expect(findings.some((f) => f.field === 'tiers[].price')).toBe(false)
  })
})

describe('symptom composition', () => {
  it('replays the watch string verbatim, then appends what broke', () => {
    // The user's words are the repair instruction. Nothing paraphrases them.
    const findings = detectDrift(computeStats([{ tiers: [{ name: null }] }], signal), baselineOf(), signal)
    const symptom = composeSymptom(signal, findings)
    expect(symptom.startsWith(signal.watch.trim())).toBe(true)
    expect(symptom).toMatch(/Observed failure:/)
    expect(symptom).toMatch(/tiers\[\]\.name/)
  })

  it('states the field contract explicitly on a retry', () => {
    const findings = detectDrift(computeStats([{ tiers: [{ name: null }] }], signal), baselineOf(), signal)
    const sharper = sharpenSymptom(signal, findings)
    expect(sharper).toMatch(/previous fix was rejected/)
    expect(sharper).toMatch(/tiers\[\]\.name/)
  })
})

describe('verification against the field contract', () => {
  it('approves a preview that restores the data', () => {
    expect(verifyAgainstContract(computeStats(healthyRows, signal), baselineOf(), signal).ok).toBe(true)
  })

  it('rejects a preview that returns nothing', () => {
    const v = verifyAgainstContract(computeStats([], signal), baselineOf(), signal)
    expect(v.ok).toBe(false)
    expect(v.reasons).toContain('the fix returned no rows')
  })

  it('rejects a preview whose required field is still empty', () => {
    const v = verifyAgainstContract(computeStats([{ tiers: [{ name: null, price: '$1' }] }], signal), baselineOf(), signal)
    expect(v.ok).toBe(false)
    expect(v.reasons.join(' ')).toMatch(/still empty/)
  })

  it('counts rows recovered', () => {
    const before = computeStats([{ tiers: [{ name: 'Free' }] }], signal)
    expect(rowsRecovered(before, computeStats(healthyRows, signal))).toBe(3)
  })
})

describe('state machine', () => {
  it('goes HEALTHY -> DEGRADED on drift and asks for a heal', () => {
    const t = transition({ state: 'HEALTHY', attempts: 0 }, { type: 'DRIFT_DETECTED' })
    expect(t.next).toBe('DEGRADED')
    expect(t.action).toBe('call_heal')
  })

  it('goes DEGRADED -> HEALING and counts the attempt', () => {
    const t = transition({ state: 'DEGRADED', attempts: 0 }, { type: 'HEAL_STARTED' })
    expect(t.next).toBe('HEALING')
    expect(t.attempts).toBe(1)
  })

  it('goes HEALING -> VERIFYING when the CLI stops at its approval gate', () => {
    const t = transition({ state: 'HEALING', attempts: 1 }, { type: 'HEAL_AWAITING_APPROVAL' })
    expect(t.next).toBe('VERIFYING')
  })

  it('approves only after verification passes', () => {
    const t = transition({ state: 'VERIFYING', attempts: 1 }, { type: 'VERIFY_PASSED' })
    expect(t.next).toBe('HEALED')
    expect(t.action).toBe('call_approve')
  })

  it('rejects a bad fix rather than leaving it pending', () => {
    // The fix must be actively discarded — never left for something else to approve.
    const t = transition({ state: 'VERIFYING', attempts: 1 }, { type: 'VERIFY_FAILED', reasons: ['still empty'] })
    expect(t.action).toBe('call_reject')
    expect(t.next).toBe('DEGRADED')
  })

  it('quarantines after the attempt budget is spent', () => {
    const t = transition({ state: 'VERIFYING', attempts: MAX_ATTEMPTS }, { type: 'VERIFY_FAILED', reasons: ['nope'] })
    expect(t.next).toBe('QUARANTINED')
    expect(t.action).toBe('call_reject')
  })

  it('does not clear a collector on approval alone', () => {
    // A preview is a promise, not a result. Approving asks for a production
    // run; it does not by itself put the collector back into service.
    const t = transition({ state: 'HEALED', attempts: 1 }, { type: 'APPROVED' })
    expect(t.next).toBe('HEALED')
    expect(t.action).toBe('confirm_production')
  })

  it('returns to HEALTHY and rebaselines once production confirms', () => {
    const t = transition({ state: 'HEALED', attempts: 1 }, { type: 'PRODUCTION_CONFIRMED' })
    expect(t.next).toBe('HEALTHY')
    expect(t.action).toBe('rebaseline')
    expect(t.attempts).toBe(0)
  })

  it('quarantines an approved fix that production ignores', () => {
    // Observed on live collectors: correct preview, successful approve, and the
    // next production run returned the same broken output as before.
    const t = transition(
      { state: 'HEALED', attempts: 1 },
      { type: 'PRODUCTION_UNCHANGED', reasons: ['the fix returned no rows'] },
    )
    expect(t.next).toBe('QUARANTINED')
    expect(t.reason).toMatch(/production is unchanged/)
  })

  it('recovers without a heal if the source fixes itself', () => {
    const t = transition({ state: 'DEGRADED', attempts: 0 }, { type: 'NO_DRIFT' })
    expect(t.next).toBe('HEALTHY')
  })

  it('never leaves quarantine on its own', () => {
    for (const input of ['DRIFT_DETECTED', 'NO_DRIFT', 'VERIFY_PASSED', 'APPROVED'] as const) {
      expect(transition({ state: 'QUARANTINED', attempts: 3 }, { type: input } as never).next).toBe('QUARANTINED')
    }
  })

  it('is a no-op on inputs that do not apply to the current state', () => {
    const t = transition({ state: 'HEALTHY', attempts: 0 }, { type: 'VERIFY_PASSED' })
    expect(t.next).toBe('HEALTHY')
    expect(t.action).toBe('none')
  })
})

describe('approval gate', () => {
  const ev = (id: string, collectorId: string | null): EvidenceRef => ({
    id, collectorId, signalId: 'moving_upmarket', targetId: 'acme',
    sourceUrl: 'https://acme.com/pricing', scrapedAt: '2026-08-21T04:12:00Z',
    sentence: 'Added an Enterprise tier', fields: {},
  })

  it('allows a campaign whose sources are all healthy', () => {
    const v = canApprove({ evidence: [ev('e1', 'c_1')] }, { c_1: 'HEALTHY' })
    expect(v.ok).toBe(true)
  })

  it.each(UNSAFE_STATES)('blocks when a cited collector is %s', (state) => {
    const v = canApprove({ evidence: [ev('e1', 'c_1')] }, { c_1: state as HealthState })
    expect(v.ok).toBe(false)
    expect(v.reason).toMatch(new RegExp(state))
  })

  it('refuses to assume an unknown collector is healthy', () => {
    // If Bellwether cannot say a source works, it does not get to claim it works.
    const v = canApprove({ evidence: [ev('e1', 'c_unknown')] }, {})
    expect(v.ok).toBe(false)
    expect(v.blockers[0]!.state).toBe('QUARANTINED')
  })

  it('does not block on sources that need no collector', () => {
    // RSS feeds and public job APIs have no collector to break.
    expect(canApprove({ evidence: [ev('e1', null)] }, {}).ok).toBe(true)
  })

  it('reports every distinct broken collector once', () => {
    const v = canApprove(
      { evidence: [ev('e1', 'c_1'), ev('e2', 'c_1'), ev('e3', 'c_2')] },
      { c_1: 'DEGRADED', c_2: 'QUARANTINED' },
    )
    expect(v.blockers).toHaveLength(2)
    expect(v.reason).toMatch(/and 1 more/)
  })

  it('marks individual untrustworthy claims for the UI', () => {
    const bad = untrustworthyEvidence(
      { evidence: [ev('e1', 'c_1'), ev('e2', 'c_2')] },
      { c_1: 'DEGRADED', c_2: 'HEALTHY' },
    )
    expect([...bad]).toEqual(['e1'])
  })

  it('treats HEALED as safe — the fix is committed by then', () => {
    expect(isSafeToCite('HEALED')).toBe(true)
    expect(isSafeToCite('HEALTHY')).toBe(true)
  })
})

describe('born-broken collectors', () => {
  // A collector that never worked cannot drift -- it has no healthy baseline to
  // differ from. Three of our first live collectors were born broken, so
  // "no history" must not mean "assume healthy".
  const noHistory = buildBaseline('c_new', [], signal)

  it('catches a collector that returns no rows at all', () => {
    const findings = detectColdStart(computeStats([], signal), signal)
    expect(findings.some((f) => f.kind === 'row_count')).toBe(true)
  })

  it('catches a required field empty in every row', () => {
    const rows = [{ tiers: [{ name: null, price: '$1' }, { name: null, price: '$2' }] }]
    const findings = detectColdStart(computeStats(rows, signal), signal)
    expect(findings.some((f) => f.kind === 'missing_field' && f.field === 'tiers[].name')).toBe(true)
  })

  it('stays quiet on a healthy first observation', () => {
    expect(detectColdStart(computeStats(healthyRows, signal), signal)).toEqual([])
  })

  it('detectDrift falls back to absolute checks when history is too thin', () => {
    // The regression this guards: with minSamples unmet, detectDrift used to
    // return [] unconditionally, so a collector that had never worked looked
    // healthy indefinitely.
    const broken = computeStats([{ tiers: [] }], signal)
    expect(detectDrift(broken, noHistory, signal).length).toBeGreaterThan(0)
  })

  it('still does not cry wolf over a merely unusual first observation', () => {
    // One row instead of four is not enough to act on without history.
    const thin = computeStats([{ tiers: [{ name: 'Pro', price: '$20', cta: 'Buy' }] }], signal)
    expect(detectDrift(thin, noHistory, signal)).toEqual([])
  })
})
