import { describe, it, expect, beforeEach } from 'vitest'
import { Store } from '../src/core/store/db.js'
import type { Observation } from '../src/core/types.js'

const obs = (over: Partial<Observation> = {}): Observation => ({
  collectorId: 'c_1',
  signalId: 'surface_growth',
  targetId: 'supabase',
  sourceUrl: 'https://supabase.com/sitemap.xml',
  observedAt: '2026-08-21T04:00:00Z',
  rows: [{ urls: [{ loc: '/a' }] }],
  ...over,
})

let store: Store
beforeEach(() => {
  store = new Store(':memory:')
})

describe('observation series', () => {
  it('returns the previous observation of the same source', () => {
    store.putObservation(obs({ observedAt: '2026-08-20T04:00:00Z' }))
    const prev = store.previousObservation(
      'surface_growth', 'supabase', '2026-08-21T04:00:00Z', 'https://supabase.com/sitemap.xml',
    )
    expect(prev?.observedAt).toBe('2026-08-20T04:00:00Z')
  })

  it('does NOT diff across different source URLs', () => {
    // This is the bug that produced "documentation grew 128650%": a guessed
    // sitemap path was replaced by a verified one, and the engine compared two
    // entirely different documents. A URL change must start a new series.
    store.putObservation(
      obs({ observedAt: '2026-08-20T04:00:00Z', sourceUrl: 'https://supabase.com/sitemap.xml' }),
    )
    const prev = store.previousObservation(
      'surface_growth', 'supabase', '2026-08-21T04:00:00Z', 'https://docs.supabase.com/sitemap.xml',
    )
    expect(prev).toBeNull()
  })

  it('respects the `at` boundary so --date replay is reproducible', () => {
    store.putObservation(obs({ observedAt: '2026-08-19T04:00:00Z' }))
    store.putObservation(obs({ observedAt: '2026-08-22T04:00:00Z' }))
    const prev = store.previousObservation(
      'surface_growth', 'supabase', '2026-08-21T04:00:00Z', 'https://supabase.com/sitemap.xml',
    )
    // The later observation must not leak backwards into a replayed morning.
    expect(prev?.observedAt).toBe('2026-08-19T04:00:00Z')
  })

  it('ignores failed observations when picking a baseline', () => {
    store.putObservation(obs({ observedAt: '2026-08-19T04:00:00Z' }))
    store.putObservation(obs({ observedAt: '2026-08-20T04:00:00Z' }), false, 'timeout')
    const prev = store.previousObservation(
      'surface_growth', 'supabase', '2026-08-21T04:00:00Z', 'https://supabase.com/sitemap.xml',
    )
    expect(prev?.observedAt).toBe('2026-08-19T04:00:00Z')
  })
})

describe('collector health', () => {
  it('round-trips state and baseline', () => {
    store.setHealth('c_1', 'moving_upmarket', 'acme', 'DEGRADED', 1, {
      collectorId: 'c_1', rowCountMean: 4, fields: { 'tiers[].name': 0 }, samples: 4,
    })
    const h = store.getHealth('c_1')
    expect(h?.state).toBe('DEGRADED')
    expect(h?.attempts).toBe(1)
    expect(h?.baseline?.rowCountMean).toBe(4)
  })

  it('keeps the old baseline when a state update omits one', () => {
    // A DEGRADED transition must not erase the baseline it will be judged against.
    store.setHealth('c_1', 'moving_upmarket', 'acme', 'HEALTHY', 0, {
      collectorId: 'c_1', rowCountMean: 4, fields: {}, samples: 4,
    })
    store.setHealth('c_1', 'moving_upmarket', 'acme', 'DEGRADED', 1)
    expect(store.getHealth('c_1')?.baseline?.rowCountMean).toBe(4)
  })

  it('exposes a health map for the approval gate', () => {
    store.setHealth('c_1', 's', 't', 'HEALTHY')
    store.setHealth('c_2', 's', 't', 'QUARANTINED')
    expect(store.healthMap()).toEqual({ c_1: 'HEALTHY', c_2: 'QUARANTINED' })
  })
})

describe('events and evidence', () => {
  it('stores an event with its evidence and reads it back whole', () => {
    store.putEvent({
      id: 'sig_1', signalId: 'moving_upmarket', targetId: 'acme',
      firedAt: '2026-08-21T04:00:00Z', weight: 30,
      evidence: [{
        id: 'ev_1', collectorId: 'c_1', signalId: 'moving_upmarket', targetId: 'acme',
        sourceUrl: 'https://acme.com/pricing', scrapedAt: '2026-08-21T04:00:00Z',
        sentence: 'Added an Enterprise tier', fields: { name: 'Enterprise' },
      }],
    })
    const events = store.eventsUpTo('2026-08-21T23:00:00Z', 30)
    expect(events).toHaveLength(1)
    expect(events[0]!.evidence[0]!.sentence).toBe('Added an Enterprise tier')
    expect(events[0]!.evidence[0]!.fields).toEqual({ name: 'Enterprise' })
  })

  it('excludes events outside the window', () => {
    store.putEvent({
      id: 'sig_old', signalId: 's', targetId: 't',
      firedAt: '2026-01-01T00:00:00Z', weight: 10, evidence: [],
    })
    expect(store.eventsUpTo('2026-08-21T00:00:00Z', 30)).toHaveLength(0)
  })
})
