/**
 * The approval gate.
 *
 * Nothing leaves Bellwether without a human approving it, and a human cannot
 * approve a campaign whose evidence rests on a collector that is currently
 * broken.
 *
 * That second rule is the one that matters. Emailing a prospect a claim sourced
 * from a silently-broken scraper is worse than not emailing at all: it is
 * confidently wrong, in writing, to someone you want to sell to. So collector
 * health is not a dashboard widget here — it is a hard precondition on the
 * send path, and self-healing is what clears it.
 *
 * This is deliberately a pure function over a health map so it can be tested
 * exhaustively and called from both the server and the UI.
 */
import type { EvidenceRef, HealthMap, HealthState } from '../types.js'
import { isSafeToCite } from '../anneal/machine.js'

export interface GateBlocker {
  collectorId: string
  state: HealthState
  /** The claim that can no longer be trusted. */
  sentence: string
  sourceUrl: string
}

export interface GateVerdict {
  ok: boolean
  blockers: GateBlocker[]
  /** One-line explanation, rendered next to the disabled button. */
  reason: string
}

export interface GatedCampaign {
  evidence: EvidenceRef[]
}

/**
 * Can this campaign be approved right now?
 *
 * Evidence with a null collectorId came from a source that needs no collector
 * (an RSS feed, a public job-board API). There is nothing to be broken, so it
 * never blocks.
 */
export function canApprove(campaign: GatedCampaign, health: HealthMap): GateVerdict {
  const blockers: GateBlocker[] = []
  const seen = new Set<string>()

  for (const e of campaign.evidence) {
    if (!e.collectorId) continue

    const state = health[e.collectorId]
    // An unknown collector is not assumed healthy. If Bellwether cannot say a
    // source is working, it does not get to claim the source is working.
    const effective: HealthState = state ?? 'QUARANTINED'
    if (isSafeToCite(effective)) continue

    if (seen.has(e.collectorId)) continue
    seen.add(e.collectorId)

    blockers.push({
      collectorId: e.collectorId,
      state: effective,
      sentence: e.sentence,
      sourceUrl: e.sourceUrl,
    })
  }

  if (blockers.length === 0) {
    return { ok: true, blockers: [], reason: 'All cited sources are healthy.' }
  }

  const first = blockers[0]!
  const more = blockers.length > 1 ? ` (and ${blockers.length - 1} more)` : ''
  return {
    ok: false,
    blockers,
    reason:
      `Blocked — source collector ${first.collectorId} is ${first.state}${more}. ` +
      (first.state === 'QUARANTINED'
        ? 'This source needs manual review before it can be cited.'
        : 'Healing in progress.'),
  }
}

/** Which evidence items are currently untrustworthy, for per-claim UI marking. */
export function untrustworthyEvidence(
  campaign: GatedCampaign,
  health: HealthMap,
): Set<string> {
  const out = new Set<string>()
  for (const e of campaign.evidence) {
    if (!e.collectorId) continue
    if (!isSafeToCite(health[e.collectorId] ?? 'QUARANTINED')) out.add(e.id)
  }
  return out
}
