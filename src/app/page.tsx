import Link from 'next/link'
import { getBrief, getMeta, getCollectors, getAdapters } from '../lib/data'
import { Evidence, ScorePill, Empty, HealthBadge } from '../components/ui'

/**
 * The Morning Brief — the daily surface.
 *
 * Ranked by how much each account moved, every claim cited, one click to a
 * campaign. Generated for a DATE rather than for "now", so any past morning
 * can be reproduced exactly.
 */
export default function BriefPage() {
  const brief = getBrief()
  const meta = getMeta()

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight">{brief.headline}</h1>
          <p className="mt-1.5 text-[13px]" style={{ color: 'var(--text-dim)' }}>
            {brief.totals.signalsFired} signal{brief.totals.signalsFired === 1 ? '' : 's'} ·{' '}
            {brief.totals.evidenceItems} cited fact{brief.totals.evidenceItems === 1 ? '' : 's'}
            {brief.belowThreshold > 0 && ` · ${brief.belowThreshold} below the ICP threshold`}
          </p>
        </div>
        <p className="mono text-[11px]" style={{ color: 'var(--text-dim)' }}>
          {brief.date} · ICP: {meta.icp.name}
        </p>
      </header>

      {brief.entries.length === 0 ? (
        <Empty
          title="Nothing has moved yet."
          hint={
            <>
              A signal fires on a <em>change</em>, so it needs two snapshots of the same source. The
              first collection run establishes the baseline; the next one can fire. Run{' '}
              <code className="mono">npm run bw -- run</code> again after the sources have had time to
              change.
            </>
          }
        />
      ) : (
        <ul className="space-y-4">
          {brief.entries.map((entry) => (
            <li key={entry.account.targetId} className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5">
                    <h2 className="text-[17px] font-semibold tracking-tight">{entry.account.name}</h2>
                    <span className="mono text-[11px]" style={{ color: 'var(--text-dim)' }}>
                      {entry.account.domain}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[12px]" style={{ color: 'var(--text-dim)' }}>
                    fit {Math.round(entry.account.fit * 100)}% ·{' '}
                    {entry.overnight.length} signal{entry.overnight.length === 1 ? '' : 's'} overnight
                  </p>
                </div>
                <ScorePill score={entry.account.score} delta={entry.account.delta} />
              </div>

              <div className="mt-4 space-y-3">
                {entry.overnight.flatMap((s) =>
                  s.event.evidence.map((e) => (
                    <Evidence
                      key={e.id}
                      sentence={e.sentence}
                      signalName={s.signalName}
                      collectorId={e.collectorId}
                      sourceUrl={e.sourceUrl}
                      scrapedAt={e.scrapedAt}
                      blocked={entry.hasBlockedEvidence && e.collectorId !== null}
                    />
                  )),
                )}
              </div>

              {entry.hasBlockedEvidence ? (
                <div
                  className="mt-4 flex items-start gap-2.5 rounded-lg px-3.5 py-3"
                  style={{ background: 'color-mix(in oklch, var(--color-quarantined) 10%, transparent)' }}
                >
                  <span aria-hidden="true">🔒</span>
                  <div>
                    <p className="text-[13px] font-medium" style={{ color: 'var(--color-quarantined)' }}>
                      Campaign approval is locked for this account.
                    </p>
                    <p className="mt-0.5 text-[12.5px] leading-relaxed" style={{ color: 'var(--text-dim)' }}>
                      A collector behind one of these claims is unhealthy. Sending a prospect a claim
                      sourced from a broken scraper is worse than sending nothing, so the send path
                      stays closed until it heals.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Link
                    href={`/accounts/${entry.account.targetId}`}
                    className="rounded-md px-3 py-1.5 text-[13px] font-medium transition-opacity hover:opacity-85"
                    style={{ background: 'var(--accent)', color: 'var(--color-ink-950)' }}
                  >
                    Build campaign
                  </Link>
                  <button
                    className="rounded-md border px-3 py-1.5 text-[13px] hairline transition-colors hover:bg-[var(--surface-2)]"
                    style={{ color: 'var(--text-dim)' }}
                    type="button"
                  >
                    Snooze
                  </button>
                  <button
                    className="rounded-md border px-3 py-1.5 text-[13px] hairline transition-colors hover:bg-[var(--surface-2)]"
                    style={{ color: 'var(--text-dim)' }}
                    type="button"
                  >
                    Not a fit
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <SignalHealthStrip />
    </div>
  )
}

/**
 * Collector health, on the daily surface rather than buried in a dashboard.
 * If a source is broken, the person reading the brief should know immediately.
 */
function SignalHealthStrip() {
  const collectors = getCollectors()
  const adapters = getAdapters()
  const bd = adapters.filter((a) => a.usesBrightData)
  const types = [...new Set(bd.map((a) => a.scraperType).filter(Boolean))]

  return (
    <section className="card px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[13px] font-semibold">Source health</h2>
        <p className="mono text-[11px]" style={{ color: 'var(--text-dim)' }}>
          {bd.length} via Bright Data ({types.join(' · ')}) · {adapters.length - bd.length} direct
        </p>
      </div>

      {collectors.length === 0 ? (
        <p className="mt-2.5 text-[12.5px]" style={{ color: 'var(--text-dim)' }}>
          No collectors provisioned yet. Feed and job-board sources need none — they publish
          structured data already.
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {collectors.map((c) => (
            <li key={c.collectorId} className="flex items-center justify-between gap-3">
              <span className="mono text-[12px]">{c.key}</span>
              <span className="mono flex-1 truncate text-[11px]" style={{ color: 'var(--text-dim)' }}>
                {c.collectorId} · {c.scraperType}
              </span>
              <HealthBadge state={c.state} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
