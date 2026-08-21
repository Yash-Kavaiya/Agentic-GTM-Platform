/**
 * The collection pipeline.
 *
 * One pass over every (signal, target) pair Bellwether watches:
 *
 *   bind -> preflight -> observe -> store -> diff against previous -> fire
 *
 * and, for Bright Data-backed sources, a health check that can trigger the
 * Anneal loop. This is what the cron runs and what `make demo` replays.
 *
 * Nothing here knows how any particular source is fetched. That is the whole
 * value of the adapter boundary: adding a source never touches this file.
 */
import type { Clock } from './clock.js'
import { systemClock } from './clock.js'
import type { SignalSpec, Target, Observation, SignalEvent } from './types.js'
import { loadSignals, loadTargets } from './config/load.js'
import { getAdapter } from './adapters/index.js'
import { match } from './signals/match.js'
import { computeStats, buildBaseline, detectDrift } from './anneal/health.js'
import { checkAndHeal, type HealDeps, liveDeps } from './anneal/heal.js'
import type { Store } from './store/db.js'

export interface RunOptions {
  store: Store
  clock?: Clock
  /** Restrict the run; omit to sweep everything. */
  signalIds?: string[]
  targetIds?: string[]
  /** Skip the Anneal check — useful when only refreshing data. */
  skipHeal?: boolean
  log?: (line: string) => void
  healDeps?: HealDeps
}

export interface PairResult {
  signalId: string
  targetId: string
  status: 'ok' | 'skipped' | 'refused' | 'error'
  detail: string
  rowCount?: number
  fired?: boolean
  healed?: boolean
}

export interface RunSummary {
  startedAt: string
  finishedAt: string
  results: PairResult[]
  events: SignalEvent[]
  counts: { ok: number; skipped: number; refused: number; error: number; fired: number; healed: number }
}

/** How many sources to fetch at once. Polite to targets, fast enough for a cron. */
const CONCURRENCY = 5

export async function runCollection(opts: RunOptions): Promise<RunSummary> {
  const { store, skipHeal = false } = opts
  const clock = opts.clock ?? systemClock
  const log = opts.log ?? (() => {})
  const healDeps = opts.healDeps ?? liveDeps

  const signals = loadSignals().filter((s) => !opts.signalIds || opts.signalIds.includes(s.id))
  const targets = loadTargets().filter((t) => !opts.targetIds || opts.targetIds.includes(t.id))

  const startedAt = clock.now().toISOString()
  const pairs: { signal: SignalSpec; target: Target }[] = []
  for (const signal of signals) for (const target of targets) pairs.push({ signal, target })

  const results: PairResult[] = []
  const events: SignalEvent[] = []

  await pool(pairs, CONCURRENCY, async ({ signal, target }) => {
    const r = await runPair(signal, target, { store, clock, skipHeal, log, healDeps })
    results.push(r.result)
    if (r.event) events.push(r.event)
  })

  const counts = {
    ok: results.filter((r) => r.status === 'ok').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    refused: results.filter((r) => r.status === 'refused').length,
    error: results.filter((r) => r.status === 'error').length,
    fired: results.filter((r) => r.fired).length,
    healed: results.filter((r) => r.healed).length,
  }

  return { startedAt, finishedAt: clock.now().toISOString(), results, events, counts }
}

async function runPair(
  signal: SignalSpec,
  target: Target,
  ctx: {
    store: Store
    clock: Clock
    skipHeal: boolean
    log: (l: string) => void
    healDeps: HealDeps
  },
): Promise<{ result: PairResult; event: SignalEvent | null }> {
  const base = { signalId: signal.id, targetId: target.id }
  const adapter = getAdapter(signal.adapter)
  const binding = adapter.bind(signal, target)

  if (!binding) {
    return { result: { ...base, status: 'skipped', detail: 'no source for this target' }, event: null }
  }

  // Compliance runs before every fetch, for every adapter, without exception.
  const verdict = await adapter.preflight(binding.url)
  if (!verdict.allowed) {
    ctx.log(`  ${signal.id}/${target.id}: REFUSED (${verdict.rule}) ${verdict.reason}`)
    return { result: { ...base, status: 'refused', detail: verdict.reason }, event: null }
  }

  let observation: Observation
  try {
    observation = await adapter.observe(binding, signal, ctx.clock.now())
  } catch (e) {
    const detail = (e as Error).message
    ctx.log(`  ${signal.id}/${target.id}: ERROR ${detail.slice(0, 120)}`)
    return { result: { ...base, status: 'error', detail }, event: null }
  }

  // Read the previous snapshot BEFORE writing this one, or the diff is empty.
  const previous = ctx.store.previousObservation(
    signal.id,
    target.id,
    observation.observedAt,
    observation.sourceUrl,
  )
  ctx.store.putObservation(observation)

  const stats = computeStats(observation.rows, signal)
  const event = match(signal, previous, observation)
  if (event) {
    ctx.store.putEvent(event)
    ctx.log(`  ${signal.id}/${target.id}: FIRED — ${event.evidence[0]?.sentence ?? ''}`)
  }

  // Anneal only applies where there is a collector that can break.
  let healed = false
  if (!ctx.skipHeal && binding.collectorId) {
    healed = await maybeHeal(signal, target, binding.collectorId, observation, ctx)
  }

  return {
    result: {
      ...base,
      status: 'ok',
      detail: `${stats.rowCount} row(s)`,
      rowCount: stats.rowCount,
      fired: Boolean(event),
      healed,
    },
    event,
  }
}

async function maybeHeal(
  signal: SignalSpec,
  target: Target,
  collectorId: string,
  observation: Observation,
  ctx: { store: Store; log: (l: string) => void; healDeps: HealDeps },
): Promise<boolean> {
  const history = ctx.store
    .recentForCollector(collectorId)
    .filter((o) => o.observedAt !== observation.observedAt)

  const existing = ctx.store.getHealth(collectorId)
  const baseline = existing?.baseline ?? buildBaseline(collectorId, history, signal)
  const stats = computeStats(observation.rows, signal)
  const drift = detectDrift(stats, baseline, signal)

  if (drift.length === 0) {
    // Record health so the approval gate can see this collector is fine.
    ctx.store.setHealth(collectorId, signal.id, target.id, 'HEALTHY', 0, baseline)
    return false
  }

  ctx.log(`  ${signal.id}/${target.id}: DRIFT — ${drift.map((d) => d.detail).join('; ')}`)
  const outcome = await checkAndHeal(
    ctx.store,
    collectorId,
    signal,
    target.id,
    observation.sourceUrl,
    observation,
    { ...ctx.healDeps, log: ctx.log },
  )
  return outcome.events.length > 0
}

/** Bounded-concurrency map. */
async function pool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        await worker(items[i]!)
      }
    }),
  )
}
