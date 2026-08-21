/**
 * The heal driver.
 *
 * Connects the pure state machine to the real Bright Data CLI. This is the
 * control loop the whole platform is built around:
 *
 *   observe -> measure -> detect drift -> heal -> VERIFY -> approve or reject
 *
 * The verify step is the point. `bdata scraper heal` deliberately stops at an
 * approval gate and hands back a `preview_result`; Bellwether never passes
 * `--auto-approve`. It scores the preview against the signal's own field
 * contract and calls `scraper approve` only if the data actually came back —
 * otherwise `scraper approve --reject`, sharpen the prompt, and try again.
 *
 * A heal keeps the same Collector ID, so nothing downstream is touched: the
 * schedules, the `/dca/trigger` callers and the evidence already in the ledger
 * all keep pointing at the same source.
 */
import type {
  HealEvent,
  HealthState,
  ObservationStats,
  SignalSpec,
  Baseline,
  Observation,
} from '../types.js'
import { transition, MAX_ATTEMPTS, type AnnealContext } from './machine.js'
import {
  computeStats,
  buildBaseline,
  detectDrift,
  composeSymptom,
  sharpenSymptom,
  verifyAgainstContract,
  rowsRecovered,
} from './health.js'
import { scraperHeal, scraperApprove, scraperRun, rowsFrom, type BdResult } from '../brightdata/cli.js'
import type { Store } from '../store/db.js'

export interface HealDeps {
  heal: (collectorId: string, symptom: string, url: string) => Promise<BdResult>
  approve: (collectorId: string, o: { url?: string; reject?: boolean }) => Promise<BdResult>
  run: (collectorId: string, urls: string[]) => Promise<BdResult>
  now: () => Date
  log?: (line: string) => void
}

/** Real dependencies. Tests substitute a fake to exercise the loop offline. */
export const liveDeps: HealDeps = {
  heal: (c, s, u) => scraperHeal(c, s, u),
  approve: (c, o) => scraperApprove(c, o),
  run: (c, urls) => scraperRun(c, urls),
  now: () => new Date(),
}

export interface HealOutcome {
  finalState: HealthState
  events: HealEvent[]
  baseline: Baseline | null
}

let seq = 0
const healId = () => `heal_${Date.now().toString(36)}_${(seq++).toString(36)}`

/**
 * Run the repair loop for one collector until it is HEALTHY or QUARANTINED.
 *
 * `currentStats` is what the failing run actually produced — passed in rather
 * than re-fetched so the numbers in the heal log are the ones that triggered it.
 */
export async function healCollector(
  args: {
    collectorId: string
    signal: SignalSpec
    targetId: string
    url: string
    baseline: Baseline
    currentStats: ObservationStats
    startState?: HealthState
    startAttempts?: number
  },
  deps: HealDeps = liveDeps,
): Promise<HealOutcome> {
  const { collectorId, signal, targetId, url, baseline, currentStats } = args
  const log = deps.log ?? (() => {})
  const events: HealEvent[] = []

  let ctx: AnnealContext = {
    state: args.startState ?? 'HEALTHY',
    attempts: args.startAttempts ?? 0,
  }

  // 1. Confirm the drift that brought us here.
  const findings = detectDrift(currentStats, baseline, signal)
  if (findings.length === 0) {
    log(`${collectorId}: no drift — nothing to heal`)
    return { finalState: 'HEALTHY', events, baseline }
  }

  let t = transition(ctx, { type: 'DRIFT_DETECTED' })
  ctx = { state: t.next, attempts: t.attempts }
  log(`${collectorId}: HEALTHY -> DEGRADED (${findings.length} finding(s))`)

  let newBaseline: Baseline | null = null

  // 2. Heal / verify / decide, until healthy or out of attempts.
  while (ctx.state === 'DEGRADED') {
    const attemptNo = ctx.attempts + 1
    const symptom =
      attemptNo === 1 ? composeSymptom(signal, findings) : sharpenSymptom(signal, findings)

    const startedAt = deps.now().toISOString()
    const t0 = Date.now()

    const event: HealEvent = {
      id: healId(),
      collectorId,
      signalId: signal.id,
      targetId,
      attempt: attemptNo,
      symptom,
      startedAt,
      endedAt: null,
      durationMs: null,
      fromState: 'DEGRADED',
      toState: 'HEALING',
      verdict: null,
      before: currentStats,
      after: null,
      rowsRecovered: null,
    }

    t = transition(ctx, { type: 'HEAL_STARTED' })
    ctx = { state: t.next, attempts: t.attempts }
    log(`${collectorId}: DEGRADED -> HEALING (attempt ${attemptNo}/${MAX_ATTEMPTS + 1})`)

    let healResult: BdResult
    try {
      healResult = await deps.heal(collectorId, symptom, url)
    } catch (e) {
      finish(event, deps, t0, 'QUARANTINED', 'error', null, (e as Error).message)
      events.push(event)
      return { finalState: 'QUARANTINED', events, baseline: newBaseline }
    }

    const status = String(healResult.envelope?.status ?? '')
    const preview = rowsFrom(
      healResult.envelope?.preview_result !== undefined
        ? ({ data: healResult.envelope.preview_result } as never)
        : healResult.envelope,
    )

    // The CLI reports a fix waiting at its approval gate. Anything else is a failure.
    if (!/awaiting_approval|preview|ready/i.test(status) && preview.length === 0) {
      t = transition(ctx, { type: 'HEAL_FAILED', reason: status || 'no preview returned' })
      ctx = { state: t.next, attempts: t.attempts }
      finish(event, deps, t0, ctx.state, 'error', null, `heal returned status "${status}"`)
      events.push(event)
      log(`${collectorId}: heal produced no preview -> ${ctx.state}`)
      if (ctx.state === 'QUARANTINED') return { finalState: 'QUARANTINED', events, baseline: newBaseline }
      continue
    }

    t = transition(ctx, { type: 'HEAL_AWAITING_APPROVAL' })
    ctx = { state: t.next, attempts: t.attempts }
    log(`${collectorId}: HEALING -> VERIFYING (${preview.length} preview row(s))`)

    // 3. THE GATE. Score the preview before committing to it.
    const afterStats = computeStats(preview, signal)
    const verdict = verifyAgainstContract(afterStats, baseline, signal)
    event.after = afterStats
    event.rowsRecovered = rowsRecovered(currentStats, afterStats)

    if (verdict.ok) {
      t = transition(ctx, { type: 'VERIFY_PASSED' })
      ctx = { state: t.next, attempts: t.attempts }
      log(`${collectorId}: VERIFYING -> HEALED, approving`)

      try {
        await deps.approve(collectorId, { url })
      } catch (e) {
        finish(event, deps, t0, 'QUARANTINED', 'error', afterStats, (e as Error).message)
        events.push(event)
        return { finalState: 'QUARANTINED', events, baseline: newBaseline }
      }

      t = transition(ctx, { type: 'APPROVED' })
      ctx = { state: t.next, attempts: t.attempts }

      // A preview is a promise, not a result. Confirm it in production before
      // letting this collector back into service. Measured on live collectors:
      // a correct preview plus a successful approve still left the very next
      // production run returning the broken output it had before.
      log(`${collectorId}: approved — confirming against a production run`)
      let confirmStats: ObservationStats | null = null
      try {
        const confirm = await deps.run(collectorId, [url])
        confirmStats = computeStats(confirm.rows, signal)
      } catch (e) {
        log(`${collectorId}: confirmation run failed — ${(e as Error).message}`)
      }

      const confirmVerdict = confirmStats
        ? verifyAgainstContract(confirmStats, baseline, signal)
        : { ok: false, reasons: ['the confirmation run did not complete'] }

      if (!confirmVerdict.ok) {
        t = transition(ctx, { type: 'PRODUCTION_UNCHANGED', reasons: confirmVerdict.reasons })
        ctx = { state: t.next, attempts: t.attempts }
        finish(event, deps, t0, ctx.state, 'approved_ineffective', confirmStats ?? afterStats,
          `preview passed but production still fails: ${confirmVerdict.reasons.join('; ')}`)
        event.rowsRecovered = confirmStats ? rowsRecovered(currentStats, confirmStats) : 0
        events.push(event)
        log(`${collectorId}: QUARANTINED — approved, but production is unchanged`)
        return { finalState: 'QUARANTINED', events, baseline: null }
      }

      t = transition(ctx, { type: 'PRODUCTION_CONFIRMED' })
      ctx = { state: t.next, attempts: t.attempts }
      event.after = confirmStats
      event.rowsRecovered = rowsRecovered(currentStats, confirmStats!)
      newBaseline = { ...baseline, rowCountMean: confirmStats!.rowCount, samples: 1, fields: fieldsOf(confirmStats!) }

      finish(event, deps, t0, 'HEALED', 'approved', confirmStats)
      events.push(event)
      log(`${collectorId}: HEALED — confirmed in production, ${event.rowsRecovered} row(s) recovered in ${event.durationMs}ms`)
      return { finalState: 'HEALTHY', events, baseline: newBaseline }
    }

    // 4. The fix did not restore the data. Reject it explicitly.
    t = transition(ctx, { type: 'VERIFY_FAILED', reasons: verdict.reasons })
    ctx = { state: t.next, attempts: t.attempts }
    log(`${collectorId}: VERIFYING -> ${ctx.state}, rejecting (${verdict.reasons.join('; ')})`)

    try {
      await deps.approve(collectorId, { url, reject: true })
    } catch (e) {
      log(`${collectorId}: reject call failed — ${(e as Error).message}`)
    }

    finish(event, deps, t0, ctx.state, 'rejected', afterStats, verdict.reasons.join('; '))
    events.push(event)

    if (ctx.state === 'QUARANTINED') {
      return { finalState: 'QUARANTINED', events, baseline: newBaseline }
    }
  }

  return { finalState: ctx.state, events, baseline: newBaseline }
}

function finish(
  event: HealEvent,
  deps: HealDeps,
  t0: number,
  toState: HealthState,
  verdict: HealEvent['verdict'],
  after: ObservationStats | null,
  error?: string,
): void {
  event.endedAt = deps.now().toISOString()
  event.durationMs = Date.now() - t0
  event.toState = toState
  event.verdict = verdict
  if (after) event.after = after
  if (error) event.error = error
}

const fieldsOf = (s: ObservationStats): Record<string, number> =>
  Object.fromEntries(s.fields.map((f) => [f.field, f.nullRate]))

/**
 * Persist an outcome. Kept separate from the loop so the loop stays testable
 * without a database.
 */
export function recordOutcome(
  store: Store,
  collectorId: string,
  signal: SignalSpec,
  targetId: string,
  outcome: HealOutcome,
): void {
  for (const e of outcome.events) store.putHeal(e)
  const attempts = outcome.events.length
  store.setHealth(collectorId, signal.id, targetId, outcome.finalState, attempts, outcome.baseline)
}

/**
 * Check one collector and heal it if needed.
 * The entry point a scheduled run calls per collector.
 */
export async function checkAndHeal(
  store: Store,
  collectorId: string,
  signal: SignalSpec,
  targetId: string,
  url: string,
  latest: Observation,
  deps: HealDeps = liveDeps,
): Promise<HealOutcome> {
  const history = store.recentForCollector(collectorId).filter((o) => o.observedAt !== latest.observedAt)
  const existing = store.getHealth(collectorId)
  const baseline = existing?.baseline ?? buildBaseline(collectorId, history, signal)
  const stats = computeStats(latest.rows, signal)

  const outcome = await healCollector(
    {
      collectorId,
      signal,
      targetId,
      url,
      baseline,
      currentStats: stats,
      startState: existing?.state ?? 'HEALTHY',
      startAttempts: existing?.attempts ?? 0,
    },
    deps,
  )

  recordOutcome(store, collectorId, signal, targetId, outcome)
  return outcome
}
