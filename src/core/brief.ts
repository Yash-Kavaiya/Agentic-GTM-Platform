/**
 * The Morning Brief.
 *
 * "Four accounts moved overnight." Ranked, evidence-cited, one click to a
 * campaign. This is the surface a GTM user actually opens every day, and the
 * only thing they need to see before deciding who to contact.
 *
 * It is generated for a DATE, not for "now". Every input — events, scores,
 * evidence — is filtered relative to the supplied instant, so any past morning
 * can be regenerated exactly. That is what makes the demo reproducible instead
 * of dependent on a live site changing on cue.
 */
import type { SignalEvent, Target, SignalSpec, IcpConfig, HealthMap } from './types.js'
import { scoreAll, type ScoredAccount } from './signals/score.js'
import { dayOf } from './clock.js'
import { isSafeToCite } from './anneal/machine.js'

type Icp = IcpConfig['icp']

export interface BriefEntry {
  account: ScoredAccount
  /** Only the signals that fired inside the brief window. */
  overnight: ScoredAccount['signals']
  /** True when any cited collector is currently unsafe to quote. */
  hasBlockedEvidence: boolean
}

export interface Brief {
  date: string
  generatedAt: string
  headline: string
  entries: BriefEntry[]
  /** Accounts that moved but sit below the ICP threshold. */
  belowThreshold: number
  totals: { accountsMoved: number; signalsFired: number; evidenceItems: number }
}

export interface BriefOptions {
  date: string
  targets: Target[]
  events: SignalEvent[]
  signals: SignalSpec[]
  icp: Icp
  health?: HealthMap
  /** How far back "overnight" reaches. A Monday brief should cover the weekend. */
  windowHours?: number
}

export function buildBrief(opts: BriefOptions): Brief {
  const { date, targets, events, signals, icp, health = {} } = opts
  const windowHours = opts.windowHours ?? 24

  // The instant the brief is "as of": end of the named day.
  const at = `${dayOf(date)}T23:59:59.999Z`
  const since = new Date(Date.parse(at) - windowHours * 3_600_000).toISOString()

  const scored = scoreAll(targets, events, signals, icp, at)

  const entries: BriefEntry[] = []
  let belowThreshold = 0

  for (const account of scored) {
    const overnight = account.signals.filter((s) => s.firedAt > since && s.firedAt <= at)
    if (overnight.length === 0) continue

    if (account.score < icp.brief_threshold) {
      belowThreshold++
      continue
    }

    const hasBlockedEvidence = overnight.some((s) =>
      s.event.evidence.some(
        (e) => e.collectorId !== null && !isSafeToCite(health[e.collectorId] ?? 'QUARANTINED'),
      ),
    )

    entries.push({ account, overnight, hasBlockedEvidence })
  }

  const signalsFired = entries.reduce((a, e) => a + e.overnight.length, 0)
  const evidenceItems = entries.reduce(
    (a, e) => a + e.overnight.reduce((b, s) => b + s.event.evidence.length, 0),
    0,
  )

  return {
    date: dayOf(date),
    generatedAt: new Date().toISOString(),
    headline: headlineFor(entries.length, dayOf(date)),
    entries,
    belowThreshold,
    totals: { accountsMoved: entries.length, signalsFired, evidenceItems },
  }
}

function headlineFor(count: number, date: string): string {
  const pretty = new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  })
  if (count === 0) return `${pretty} — nothing moved overnight`
  if (count === 1) return `${pretty} — 1 account moved overnight`
  return `${pretty} — ${count} accounts moved overnight`
}

/** Plain-text rendering, for the terminal and the email/Slack digest. */
export function renderBriefText(brief: Brief): string {
  const lines: string[] = ['', brief.headline, '']

  if (brief.entries.length === 0) {
    lines.push('  No accounts crossed the threshold.')
    if (brief.belowThreshold > 0) {
      lines.push(`  ${brief.belowThreshold} moved but scored below the ICP threshold.`)
    }
    return lines.join('\n')
  }

  for (const entry of brief.entries) {
    const a = entry.account
    const arrow = a.delta > 0 ? `up from ${a.previousScore}` : a.delta < 0 ? `down from ${a.previousScore}` : 'unchanged'
    lines.push(`  ${a.name} · score ${a.score} · ${arrow}`)

    for (const s of entry.overnight) {
      for (const e of s.event.evidence.slice(0, 2)) {
        const cid = e.collectorId ? ` · collector ${e.collectorId}` : ' · public feed'
        lines.push(`    ${e.sentence}`)
        lines.push(`      signal: ${s.signalName}${cid}`)
      }
    }

    if (entry.hasBlockedEvidence) {
      lines.push(`    [blocked] a cited collector is unhealthy — campaign approval is locked`)
    }
    lines.push('')
  }

  const t = brief.totals
  lines.push(`  ${t.accountsMoved} accounts · ${t.signalsFired} signals · ${t.evidenceItems} cited facts`)
  return lines.join('\n')
}
