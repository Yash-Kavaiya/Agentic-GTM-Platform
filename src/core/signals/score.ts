/**
 * Account scoring.
 *
 * An account's score answers one question: how much has this company moved
 * recently, weighted by how much that kind of movement matters to our ICP?
 *
 *   score = SUM over recent events of
 *             signal.weight x icp.signal_multipliers[signal] x freshness(age)
 *           scaled by the account's fit
 *
 * Three deliberate properties:
 *
 * Freshness decays. A pricing change from six weeks ago is history, not a
 * signal. Without decay every account ratchets upward forever and the brief
 * stops being about what moved overnight.
 *
 * Fit is computed from observed facts, not guessed. Every criterion in
 * icp.yaml maps to something Bellwether actually verified on the public web.
 *
 * The multipliers are the thing Anneal's second loop learns. Approvals and
 * rejections reweight them per ICP, which is why they live in config rather
 * than in this file.
 */
import type { SignalEvent, SignalSpec, Target, IcpConfig } from '../types.js'
import { daysBetween } from '../clock.js'
import { loadVerifiedSources } from '../config/load.js'

type Icp = IcpConfig['icp']

export interface FitBreakdown {
  criterionId: string
  met: boolean
  weight: number
  description: string
}

export interface ScoredSignal {
  signalId: string
  signalName: string
  firedAt: string
  raw: number
  multiplier: number
  freshness: number
  contribution: number
  event: SignalEvent
}

export interface ScoredAccount {
  targetId: string
  name: string
  domain: string
  score: number
  /** Score as of `previousAt`, so the brief can show movement. */
  previousScore: number
  delta: number
  fit: number
  fitBreakdown: FitBreakdown[]
  signals: ScoredSignal[]
  eventCount: number
}

/**
 * Exponential decay with a floor.
 * The floor keeps an old-but-real signal contributing something, rather than
 * silently vanishing from the evidence trail.
 */
export function freshness(firedAt: string, at: string, icp: Icp): number {
  const age = daysBetween(firedAt, at)
  const decayed = Math.pow(0.5, age / icp.freshness.half_life_days)
  return Math.max(icp.freshness.floor, Math.min(1, decayed))
}

/**
 * How well a target matches the ICP, from what we actually observed.
 * Returns 0-1; every criterion is backed by a verified public page.
 */
export function computeFit(target: Target, icp: Icp): { fit: number; breakdown: FitBreakdown[] } {
  const sources = loadVerifiedSources()[target.id] ?? {}

  const met: Record<string, boolean> = {
    has_public_pricing: Boolean(sources.moving_upmarket),
    has_public_job_board: Boolean(target.jobs),
    has_docs_site: Boolean(sources.surface_growth),
    has_integrations_page: Boolean(sources.ecosystem_expansion),
    has_security_page: Boolean(sources.enterprise_readiness),
  }

  const breakdown: FitBreakdown[] = icp.fit_criteria.map((c) => ({
    criterionId: c.id,
    met: met[c.id] ?? false,
    weight: c.weight,
    description: c.description,
  }))

  const total = breakdown.reduce((a, c) => a + c.weight, 0)
  const earned = breakdown.filter((c) => c.met).reduce((a, c) => a + c.weight, 0)
  return { fit: total > 0 ? earned / total : 0, breakdown }
}

/** Score one account from its events, as of a given instant. */
export function scoreAccount(
  target: Target,
  events: SignalEvent[],
  signals: SignalSpec[],
  icp: Icp,
  at: string,
): ScoredAccount {
  const byId = new Map(signals.map((s) => [s.id, s]))
  const mine = events.filter((e) => e.targetId === target.id && e.firedAt <= at)
  const { fit, breakdown } = computeFit(target, icp)

  const scored: ScoredSignal[] = mine.map((event) => {
    const spec = byId.get(event.signalId)
    const multiplier = icp.signal_multipliers[event.signalId] ?? 1
    const f = freshness(event.firedAt, at, icp)
    const raw = spec?.weight ?? event.weight
    return {
      signalId: event.signalId,
      signalName: spec?.name ?? event.signalId,
      firedAt: event.firedAt,
      raw,
      multiplier,
      freshness: f,
      contribution: raw * multiplier * f,
      event,
    }
  })

  const gross = scored.reduce((a, s) => a + s.contribution, 0)
  const score = Math.round(gross * fit)

  // Yesterday's score, for the "up from 62" line in the brief.
  const dayBefore = new Date(Date.parse(at) - 86_400_000).toISOString()
  const previousGross = mine
    .filter((e) => e.firedAt <= dayBefore)
    .reduce((a, e) => {
      const spec = byId.get(e.signalId)
      const m = icp.signal_multipliers[e.signalId] ?? 1
      return a + (spec?.weight ?? e.weight) * m * freshness(e.firedAt, dayBefore, icp)
    }, 0)
  const previousScore = Math.round(previousGross * fit)

  return {
    targetId: target.id,
    name: target.name,
    domain: target.domain,
    score,
    previousScore,
    delta: score - previousScore,
    fit,
    fitBreakdown: breakdown,
    signals: scored.sort((a, b) => b.contribution - a.contribution),
    eventCount: mine.length,
  }
}

/** Score every account, ranked. */
export function scoreAll(
  targets: Target[],
  events: SignalEvent[],
  signals: SignalSpec[],
  icp: Icp,
  at: string,
): ScoredAccount[] {
  return targets
    .map((t) => scoreAccount(t, events, signals, icp, at))
    .sort((a, b) => b.score - a.score)
}
