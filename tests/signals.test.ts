import { describe, it, expect } from 'vitest'
import { resolveField, resolveStrings, nullRate, isMissing } from '../src/core/signals/fieldpath.js'
import { diffSet, diffPaired, splitLeaf } from '../src/core/signals/diff.js'
import { evaluate, match, renderTemplate, safeRegex } from '../src/core/signals/match.js'
import type { SignalSpec, Observation } from '../src/core/types.js'

// A collector generated from a `watch` description may return either shape.
// Both are correct readings of the same instruction, so both must resolve.
const NESTED = [
  { tiers: [{ name: 'Free', price: '$0', cta: 'Start free' }, { name: 'Pro', price: '$20', cta: 'Buy' }] },
]
const FLAT = [
  { name: 'Free', price: '$0', cta: 'Start free' },
  { name: 'Pro', price: '$20', cta: 'Buy' },
]

describe('fieldpath', () => {
  it('resolves a nested collection', () => {
    expect(resolveStrings(NESTED, 'tiers[].name')).toEqual(['Free', 'Pro'])
  })

  it('falls back to treating rows as the collection', () => {
    // The same path against the flat shape must still work — this is what lets
    // a healed collector keep working when the AI re-derives extraction.
    expect(resolveStrings(FLAT, 'tiers[].name')).toEqual(['Free', 'Pro'])
  })

  it('counts a bare collection path', () => {
    expect(resolveField(NESTED, 'tiers[]')).toHaveLength(2)
  })

  it('treats a vanished field as fully null, not as absent', () => {
    expect(nullRate(FLAT, 'tiers[].nonexistent')).toBe(1)
    expect(isMissing(FLAT, 'tiers[].nonexistent')).toBe(true)
  })

  it('distinguishes explicit null from missing', () => {
    const withNulls = [{ name: 'Pro', price: null }, { name: 'Free', price: '$0' }]
    expect(nullRate(withNulls, 'tiers[].price')).toBe(0.5)
  })
})

describe('diff', () => {
  const before = [{ name: 'Free' }, { name: 'Pro' }]
  const after = [{ name: 'Free' }, { name: 'Pro' }, { name: 'Enterprise' }]

  it('detects additions and removals', () => {
    const d = diffSet(before, after, 'tiers[].name')
    expect(d.added).toEqual(['Enterprise'])
    expect(d.removed).toEqual([])
    expect(d.deltaPct).toBeCloseTo(50)
  })

  it('splits a leaf path from its collection', () => {
    expect(splitLeaf('tiers[].price')).toEqual({ collection: 'tiers[]', leaf: 'price' })
    expect(splitLeaf('tiers[]')).toBeNull()
  })

  it('pairs items by identity to find value changes', () => {
    const b = [{ name: 'Pro', price: '$20' }, { name: 'Free', price: '$0' }]
    const a = [{ name: 'Pro', price: '$25' }, { name: 'Free', price: '$0' }]
    expect(diffPaired(b, a, 'tiers[].name', 'tiers[].price')).toEqual([
      { identity: 'Pro', before: '$20', after: '$25' },
    ])
  })

  it('does not report a brand new item as a value change', () => {
    const b = [{ name: 'Pro', price: '$20' }]
    const a = [{ name: 'Pro', price: '$20' }, { name: 'Enterprise', price: 'Custom' }]
    expect(diffPaired(b, a, 'tiers[].name', 'tiers[].price')).toEqual([])
  })
})

const upmarket: SignalSpec = {
  id: 'moving_upmarket',
  name: 'Moving Upmarket',
  category: 'pricing',
  adapter: 'web',
  path: '/pricing',
  watch: 'the pricing tiers on this page - name, price and call-to-action text',
  fields: { required: ['tiers[].name'], optional: ['tiers[].price', 'tiers[].cta'] },
  fire_when: {
    any: [
      { field: 'tiers[].name', op: 'appears_matching', value: '(?i)enterprise', direction: 'any', window_days: 30 },
    ],
  },
  evidence_template: 'Added a {{tier.name}} tier on {{observed_at}}',
  weight: 30,
  cadence: 'daily',
}

const obs = (rows: Record<string, unknown>[], at: string): Observation => ({
  collectorId: 'c_test',
  signalId: 'moving_upmarket',
  targetId: 'acme',
  sourceUrl: 'https://acme.com/pricing',
  observedAt: at,
  rows,
})

describe('match', () => {
  it('fires when a matching value appears', () => {
    const r = evaluate(upmarket, [{ name: 'Pro' }], [{ name: 'Pro' }, { name: 'Enterprise' }])
    expect(r.fired).toBe(true)
    expect(r.hits[0]!.sentence).toBe('Enterprise')
  })

  it('does not fire when the value was already there', () => {
    // A state is not news. Only the change is.
    const rows = [{ name: 'Pro' }, { name: 'Enterprise' }]
    expect(evaluate(upmarket, rows, rows).fired).toBe(false)
  })

  it('never fires on the first observation of a source', () => {
    // With no prior snapshot everything looks new; reporting all of it would
    // flood the brief with noise on day one.
    expect(evaluate(upmarket, null, [{ name: 'Enterprise' }]).fired).toBe(false)
  })

  it('produces evidence carrying collector, url and timestamp', () => {
    const ev = match(upmarket, obs([{ name: 'Pro' }], '2026-08-20T04:12:00Z'), obs([{ name: 'Pro' }, { name: 'Enterprise' }], '2026-08-21T04:12:00Z'))
    expect(ev).not.toBeNull()
    expect(ev!.evidence).toHaveLength(1)
    const e = ev!.evidence[0]!
    expect(e.collectorId).toBe('c_test')
    expect(e.sourceUrl).toBe('https://acme.com/pricing')
    expect(e.scrapedAt).toBe('2026-08-21T04:12:00Z')
    expect(e.sentence).toBe('Added a Enterprise tier on 2026-08-21')
  })

  it('requires every condition under `all`', () => {
    const strict: SignalSpec = {
      ...upmarket,
      fire_when: {
        all: [
          { field: 'tiers[].name', op: 'appears_matching', value: '(?i)enterprise', direction: 'any', window_days: 30 },
          { field: 'tiers[].cta', op: 'appears_matching', value: '(?i)contact sales', direction: 'any', window_days: 30 },
        ],
      },
    }
    const before = [{ name: 'Pro', cta: 'Buy' }]
    expect(evaluate(strict, before, [{ name: 'Pro', cta: 'Buy' }, { name: 'Enterprise', cta: 'Buy' }]).fired).toBe(false)
    expect(evaluate(strict, before, [{ name: 'Pro', cta: 'Buy' }, { name: 'Enterprise', cta: 'Contact sales' }]).fired).toBe(true)
  })

  it('applies count_delta_pct with direction', () => {
    const surge: SignalSpec = {
      ...upmarket,
      fire_when: {
        any: [{ field: 'jobs[]', op: 'count_delta_pct', value: 30, direction: 'up', window_days: 30 }],
      },
    }
    const b = [{ title: 'a' }, { title: 'b' }, { title: 'c' }, { title: 'd' }]
    const grown = [...b, { title: 'e' }, { title: 'f' }] // +50%
    expect(evaluate(surge, b, grown).fired).toBe(true)
    expect(evaluate(surge, grown, b).fired).toBe(false) // a drop is not an "up" surge
  })
})

describe('renderTemplate', () => {
  it('fills placeholders and tolerates dotted names', () => {
    expect(renderTemplate('Added {{tier.name}} on {{observed_at}}', { name: 'Enterprise', observed_at: '2026-08-21' }))
      .toBe('Added Enterprise on 2026-08-21')
  })

  it('leaves unknown placeholders visible rather than printing undefined', () => {
    expect(renderTemplate('x {{nope}}', {})).toBe('x {{nope}}')
  })
})

describe('safeRegex', () => {
  // signals.yaml is written by GTM users, not JS developers. `(?i)` is the
  // idiom everywhere except JavaScript, and getting this wrong fails silently:
  // the signal never fires and the platform still looks healthy.
  it('translates inline (?i) into a real flag', () => {
    const re = safeRegex('(?i)enterprise')
    expect(re).not.toBeNull()
    expect(re!.test('Enterprise')).toBe(true)
    expect(re!.flags).toContain('i')
  })

  it('handles multiple inline flags', () => {
    expect(safeRegex('(?im)^pro')!.flags).toBe('im')
  })

  it('leaves ordinary patterns alone', () => {
    expect(safeRegex('^SOC ?2$')!.test('SOC 2')).toBe(true)
  })

  it('returns null for a genuinely invalid pattern', () => {
    expect(safeRegex('([unclosed')).toBeNull()
  })
})

describe('shipped signals.yaml', () => {
  // Every regex in the real config must compile. A silent null here would mean
  // a template in the gallery that can never fire.
  it('compiles every pattern in every shipped signal', async () => {
    const { loadSignals } = await import('../src/core/config/load.js')
    const bad: string[] = []
    for (const s of loadSignals()) {
      const conds = [...(s.fire_when.any ?? []), ...(s.fire_when.all ?? [])]
      for (const c of conds) {
        if (c.op !== 'appears_matching' && c.op !== 'disappears_matching') continue
        if (safeRegex(String(c.value)) === null) bad.push(`${s.id}: ${c.value}`)
      }
    }
    expect(bad).toEqual([])
  })
})
