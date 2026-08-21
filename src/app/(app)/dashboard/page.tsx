import Link from 'next/link'
import { getHeals, getCollectors, getAccounts, getMeta, getAdapters, getSignals } from '../../../lib/data'
import { Page, PageHead, Stat, Pill, Empty } from '../../../components/ui'

/**
 * Dashboard — pipeline, source health, and what it cost.
 *
 * Every number here comes from the committed export, which comes from a real
 * run. Nothing on this page is an estimate.
 */
export default function DashboardPage() {
  const { stats } = getHeals()
  const collectors = getCollectors()
  const accounts = getAccounts()
  const adapters = getAdapters()
  const signals = getSignals()
  const meta = getMeta()

  const scored = accounts.filter((a) => a.score > 0)
  const inBrief = accounts.filter((a) => a.score >= meta.icp.threshold)
  const bd = adapters.filter((a) => a.usesBrightData)
  const types = [...new Set(bd.map((a) => a.scraperType).filter(Boolean))]
  const healthy = collectors.filter((c) => c.state === 'HEALTHY' || c.state === 'HEALED').length

  // The funnel, from real counts.
  const funnel = [
    { label: 'Accounts watched', n: meta.targetCount },
    { label: 'Signals fired', n: meta.eventCount },
    { label: 'Accounts scored', n: scored.length },
    { label: 'Reached the brief', n: inBrief.length },
  ]
  const funnelMax = Math.max(...funnel.map((f) => f.n), 1)

  return (
    <Page>
      <PageHead
        eyebrow={`Dashboard · engine run ${new Date(meta.generatedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC`}
        title="Pipeline, health, and what it cost."
      />

      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <Stat
          label="sources verified"
          value={meta.verifiedSourceCount}
          sub={`${bd.length} via Bright Data · ${adapters.length - bd.length} direct`}
        />
        <Stat
          label="collectors healthy"
          value={collectors.length === 0 ? '—' : `${healthy}/${collectors.length}`}
          sub={types.join(' · ') || 'none provisioned'}
          subTone={healthy === collectors.length && collectors.length > 0 ? 'green' : 'rust'}
        />
        <Stat
          label="repairs confirmed"
          value={stats.attempts === 0 ? '—' : `${stats.approved}/${stats.attempts}`}
          sub={
            stats.ineffective > 0
              ? `${stats.ineffective} approved but ineffective`
              : stats.attempts > 0
                ? `median ${(stats.medianMs / 1000).toFixed(0)}s`
                : 'nothing has drifted'
          }
          subTone={stats.ineffective > 0 ? 'rust' : 'green'}
        />
        <Stat label="signal templates" value={signals.length} sub={`${meta.eventCount} events on file`} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 12, marginBottom: 12 }}>
        {/* Funnel */}
        <div className="card" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2 style={{ margin: 0, fontSize: 13.5, fontWeight: 600 }}>Pipeline funnel</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {funnel.map((f) => (
              <div key={f.label} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: 12.5, color: 'var(--color-ink-3)' }}>{f.label}</span>
                  <span className="mono tnum" style={{ fontSize: 11, color: 'var(--color-mute)' }}>
                    {f.n}
                  </span>
                </div>
                <div style={{ height: 6, background: 'rgba(20,18,15,.07)', borderRadius: 3, overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${(f.n / funnelMax) * 100}%`,
                      height: '100%',
                      background: 'var(--color-rust)',
                      borderRadius: 3,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top accounts */}
        <div className="card" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 13.5, fontWeight: 600 }}>Highest scoring</h2>
          {scored.length === 0 ? (
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-mute-2)' }}>
              Nothing has scored yet.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {scored.slice(0, 8).map((a, i) => (
                <Link
                  key={a.targetId}
                  href={`/accounts/${a.targetId}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 0',
                    borderTop: i === 0 ? 'none' : '1px solid rgba(20,18,15,.06)',
                    color: 'inherit',
                  }}
                >
                  <span style={{ flex: 1, fontSize: 12.5, minWidth: 0 }}>{a.name}</span>
                  <span className="mono tnum" style={{ fontSize: 10.5, color: 'var(--color-mute-3)' }}>
                    fit {Math.round(a.fit * 100)}%
                  </span>
                  <span className="display tnum" style={{ fontSize: 18, width: 32, textAlign: 'right' }}>
                    {a.score}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Source health */}
      <section>
        <h2 style={{ margin: '0 0 10px', fontSize: 13.5, fontWeight: 600 }}>Source health</h2>
        {collectors.length === 0 ? (
          <Empty
            title="No collectors provisioned."
            hint={
              <>
                Feed and job-board sources need none — they already publish structured data. Pages
                that need real extraction get a collector each.
              </>
            }
          />
        ) : (
          <div className="card" style={{ overflow: 'hidden' }}>
            {collectors.map((c, i) => (
              <div
                key={c.collectorId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '13px 18px',
                  borderTop: i === 0 ? 'none' : '1px solid var(--line)',
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ fontSize: 12.5, fontWeight: 500, width: 200, flex: 'none' }}>{c.key}</span>
                <span className="mono" style={{ flex: 1, minWidth: 200, fontSize: 10.5, color: 'var(--color-mute-3)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {c.collectorId} · {c.scraperType} · {c.seedUrl}
                </span>
                <Pill state={c.state} />
              </div>
            ))}
          </div>
        )}
        <p style={{ margin: '10px 0 0', fontSize: 12, lineHeight: 1.55, color: 'var(--color-mute-2)', maxWidth: 620, textWrap: 'pretty' }}>
          A collector is bound to the page it was generated from, so each watched account gets its
          own. That is why one account&rsquo;s redesign degrades one collector rather than silently
          emptying a signal across the whole watchlist.
        </p>
      </section>
    </Page>
  )
}
