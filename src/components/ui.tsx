/**
 * Shared display pieces.
 *
 * Two ideas carry most of the interface:
 *
 *   Evidence is always visible with its source. A claim in Bellwether is never
 *   shown without the collector, URL and timestamp that produced it — that is
 *   the product, not a debugging affordance.
 *
 *   Collector health is shown wherever a claim is shown. A user should never
 *   have to visit a dashboard to find out whether what they are reading is
 *   trustworthy.
 */
import type { HealthState } from '../core/types'

const HEALTH_STYLE: Record<string, { color: string; label: string }> = {
  HEALTHY: { color: 'var(--color-healthy)', label: 'Healthy' },
  HEALED: { color: 'var(--color-healthy)', label: 'Healed' },
  DEGRADED: { color: 'var(--color-degraded)', label: 'Degraded' },
  HEALING: { color: 'var(--color-healing)', label: 'Healing' },
  VERIFYING: { color: 'var(--color-healing)', label: 'Verifying' },
  QUARANTINED: { color: 'var(--color-quarantined)', label: 'Quarantined' },
  UNKNOWN: { color: 'var(--text-dim)', label: 'Unknown' },
}

export function HealthBadge({ state, className = '' }: { state: HealthState | 'UNKNOWN'; className?: string }) {
  const s = HEALTH_STYLE[state] ?? HEALTH_STYLE.UNKNOWN!
  const active = state === 'HEALING' || state === 'VERIFYING'
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${className}`}
      style={{ color: s.color, background: `color-mix(in oklch, ${s.color} 14%, transparent)` }}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${active ? 'pulsing' : ''}`} style={{ background: s.color }} />
      {s.label}
    </span>
  )
}

export function ScorePill({ score, delta }: { score: number; delta: number }) {
  const up = delta > 0
  return (
    <span className="inline-flex items-baseline gap-2">
      <span className="tnum text-2xl font-semibold tabular-nums">{score}</span>
      {delta !== 0 && (
        <span
          className="tnum text-xs font-medium"
          style={{ color: up ? 'var(--color-healthy)' : 'var(--text-dim)' }}
        >
          {up ? '▲' : '▼'} {Math.abs(delta)}
        </span>
      )}
    </span>
  )
}

export interface EvidenceProps {
  sentence: string
  signalName: string
  collectorId: string | null
  sourceUrl: string
  scrapedAt: string
  blocked?: boolean
}

/**
 * One cited fact.
 *
 * The footnote is not decoration. Every claim Bellwether puts in front of a
 * prospect can be traced to the field, the page and the minute it came from,
 * and a reader can check it.
 */
export function Evidence({ sentence, signalName, collectorId, sourceUrl, scrapedAt, blocked }: EvidenceProps) {
  let host = sourceUrl
  try {
    host = new URL(sourceUrl).host + new URL(sourceUrl).pathname
  } catch {}

  return (
    <div className={`evidence ${blocked ? 'evidence-blocked' : ''} py-1`}>
      <p className="text-[13.5px] leading-snug">{sentence}</p>
      <p className="mono mt-1 text-[11px]" style={{ color: 'var(--text-dim)' }}>
        {signalName}
        {' · '}
        {collectorId ? collectorId : 'public feed'}
        {' · '}
        <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted underline-offset-2">
          {host}
        </a>
        {' · '}
        {new Date(scrapedAt).toISOString().replace('T', ' ').slice(0, 16)} UTC
      </p>
    </div>
  )
}

export function Empty({ title, hint }: { title: string; hint?: React.ReactNode }) {
  return (
    <div className="card px-6 py-12 text-center">
      <p className="text-sm font-medium">{title}</p>
      {hint && (
        <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed" style={{ color: 'var(--text-dim)' }}>
          {hint}
        </p>
      )}
    </div>
  )
}

export function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="card px-4 py-3.5">
      <p className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>
        {label}
      </p>
      <p className="tnum mt-1 text-xl font-semibold">{value}</p>
      {sub && (
        <p className="mono mt-0.5 text-[11px]" style={{ color: 'var(--text-dim)' }}>
          {sub}
        </p>
      )}
    </div>
  )
}

/** The plain-language string, presented as the first-class object it is. */
export function WatchString({ watch }: { watch: string }) {
  return (
    <div className="rounded-lg px-3.5 py-3" style={{ background: 'var(--surface-2)' }}>
      <p className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>
        What we watch for
      </p>
      <p className="mt-1.5 text-[13.5px] leading-relaxed italic">“{watch.trim()}”</p>
    </div>
  )
}
