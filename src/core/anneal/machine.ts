/**
 * The Anneal state machine.
 *
 * Annealing is repeated heat-and-cool cycling that removes defects from a
 * material. A collector goes through the same thing: it is stressed by a site
 * change, repaired, tested, and either returned to service or set aside.
 *
 *   HEALTHY    ──drift detected──────────────► DEGRADED
 *   DEGRADED   ──scraper heal────────────────► HEALING
 *   HEALING    ──awaiting_approval + preview─► VERIFYING
 *   VERIFYING  ──preview meets contract──────► HEALED ──production run──► HEALTHY
 *   VERIFYING  ──preview fails──────────────► DEGRADED (retry) | QUARANTINED
 *   HEALED     ──production unchanged───────► QUARANTINED
 *
 * The VERIFYING state is the whole argument. The Bright Data CLI stops at an
 * approval gate by design, and Bellwether never passes `--auto-approve`: it
 * reads `preview_result`, checks it against the signal's field contract, and
 * only then calls `scraper approve` — or `scraper approve --reject`. That is
 * the difference between wrapping a CLI and driving one.
 *
 * This module is pure. It decides transitions; ./heal.ts performs them.
 */
import type { HealthState } from '../types.js'

export const MAX_ATTEMPTS = 2

export type AnnealInput =
  | { type: 'DRIFT_DETECTED' }
  | { type: 'NO_DRIFT' }
  | { type: 'HEAL_STARTED' }
  | { type: 'HEAL_AWAITING_APPROVAL' }
  | { type: 'HEAL_FAILED'; reason: string }
  | { type: 'VERIFY_PASSED' }
  | { type: 'VERIFY_FAILED'; reasons: string[] }
  | { type: 'APPROVED' }
  /** A production run after approval confirmed the fix actually took effect. */
  | { type: 'PRODUCTION_CONFIRMED' }
  /** Approved, but production still returns the broken output. */
  | { type: 'PRODUCTION_UNCHANGED'; reasons: string[] }
  | { type: 'REBASELINED' }

export interface AnnealContext {
  state: HealthState
  attempts: number
}

export interface Transition {
  next: HealthState
  attempts: number
  /** What the platform should do as a result. */
  action: 'none' | 'call_heal' | 'call_approve' | 'call_reject' | 'confirm_production' | 'rebaseline'
  reason: string
}

/**
 * Decide the next state.
 *
 * Unknown (state, input) pairs are a no-op rather than an error: a collector
 * observed mid-heal by a scheduled run should not blow up the run.
 */
export function transition(ctx: AnnealContext, input: AnnealInput): Transition {
  const stay = (reason: string): Transition => ({
    next: ctx.state,
    attempts: ctx.attempts,
    action: 'none',
    reason,
  })

  switch (ctx.state) {
    case 'HEALTHY':
      if (input.type === 'DRIFT_DETECTED') {
        return { next: 'DEGRADED', attempts: 0, action: 'call_heal', reason: 'drift detected' }
      }
      return stay('healthy')

    case 'DEGRADED':
      if (input.type === 'HEAL_STARTED') {
        return {
          next: 'HEALING',
          attempts: ctx.attempts + 1,
          action: 'none',
          reason: `heal attempt ${ctx.attempts + 1}`,
        }
      }
      if (input.type === 'NO_DRIFT') {
        // The source recovered on its own — a deploy rolled back, a flaky fetch.
        return { next: 'HEALTHY', attempts: 0, action: 'rebaseline', reason: 'recovered without intervention' }
      }
      return stay('degraded, awaiting heal')

    case 'HEALING':
      if (input.type === 'HEAL_AWAITING_APPROVAL') {
        return {
          next: 'VERIFYING',
          attempts: ctx.attempts,
          action: 'none',
          reason: 'preview returned, verifying against field contract',
        }
      }
      if (input.type === 'HEAL_FAILED') {
        return terminalOrRetry(ctx, `heal failed: ${input.reason}`)
      }
      return stay('healing')

    case 'VERIFYING':
      if (input.type === 'VERIFY_PASSED') {
        return {
          next: 'HEALED',
          attempts: ctx.attempts,
          action: 'call_approve',
          reason: 'preview meets the field contract',
        }
      }
      if (input.type === 'VERIFY_FAILED') {
        // Reject the bad fix before deciding whether to try again. Leaving an
        // unverified fix pending would let it be approved by something else.
        const t = terminalOrRetry(ctx, `verification failed: ${input.reasons.join('; ')}`)
        return { ...t, action: 'call_reject' }
      }
      return stay('verifying')

    case 'HEALED':
      // A preview is a promise, not a result.
      //
      // Measured on live collectors: `scraper heal` returned previews that were
      // genuinely correct — 0 rows and 100% null became 3 rows and 0% null —
      // and `scraper approve` reported done, and the very next production run
      // returned exactly the broken output it had before. Verifying only the
      // preview would mark such a collector HEALTHY and let it feed campaigns.
      //
      // So approval alone does not clear a collector. Production has to say so.
      if (input.type === 'PRODUCTION_CONFIRMED' || input.type === 'REBASELINED') {
        return { next: 'HEALTHY', attempts: 0, action: 'rebaseline', reason: 'fix confirmed in production' }
      }
      if (input.type === 'PRODUCTION_UNCHANGED') {
        return {
          next: 'QUARANTINED',
          attempts: ctx.attempts,
          action: 'none',
          reason: `approved but production is unchanged: ${input.reasons.join('; ')}`,
        }
      }
      if (input.type === 'APPROVED') {
        return { next: 'HEALED', attempts: ctx.attempts, action: 'confirm_production', reason: 'approved, confirming in production' }
      }
      return stay('healed')

    case 'QUARANTINED':
      // Only an explicit operator action leaves quarantine. A quarantined
      // collector must not silently start feeding campaigns again.
      return stay('quarantined — requires manual review')
  }
}

function terminalOrRetry(ctx: AnnealContext, reason: string): Transition {
  if (ctx.attempts >= MAX_ATTEMPTS) {
    return {
      next: 'QUARANTINED',
      attempts: ctx.attempts,
      action: 'none',
      reason: `${reason} — ${ctx.attempts} attempts exhausted`,
    }
  }
  return { next: 'DEGRADED', attempts: ctx.attempts, action: 'call_heal', reason: `${reason} — retrying` }
}

/** States in which a collector must not be cited by an outgoing campaign. */
export const UNSAFE_STATES: readonly HealthState[] = [
  'DEGRADED',
  'HEALING',
  'VERIFYING',
  'QUARANTINED',
]

export const isSafeToCite = (state: HealthState): boolean => !UNSAFE_STATES.includes(state)
