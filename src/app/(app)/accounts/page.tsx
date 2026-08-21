import Link from 'next/link'
import { getAccounts, getMeta } from '../../../lib/data'
import { Page, PageHead, Empty, Tag } from '../../../components/ui'

/** The watchlist, ranked. */
export default function AccountsPage() {
  const accounts = getAccounts()
  const meta = getMeta()
  const scored = accounts.filter((a) => a.score > 0)

  return (
    <Page>
      <PageHead
        eyebrow={`Watchlist · ${accounts.length} accounts`}
        title="Who is worth a look."
        lede={`Scored against ${meta.icp.name}. Anything under ${meta.icp.threshold} stays out of the brief.`}
      />

      {accounts.length === 0 ? (
        <Empty title="No accounts loaded." hint="Run the engine and export to populate this view." />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 10 }}>
          {accounts.map((a) => (
            <Link key={a.targetId} href={`/accounts/${a.targetId}`} className="card card-hover" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10, color: 'inherit' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{a.name}</div>
                  <div className="mono" style={{ fontSize: 10.5, color: 'var(--color-mute-3)' }}>{a.domain}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
                  <span className="display tnum" style={{ fontSize: 28 }}>{a.score}</span>
                  {a.delta !== 0 && (
                    <span className="mono tnum" style={{ fontSize: 10, color: a.delta > 0 ? '#2f6b4f' : 'var(--color-mute-3)' }}>
                      {a.delta > 0 ? '▲' : '▼'}{Math.abs(a.delta)}
                    </span>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, height: 4, background: 'rgba(20,18,15,.08)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${a.fit * 100}%`, height: '100%', background: 'var(--color-rust)' }} />
                </div>
                <span className="mono tnum" style={{ fontSize: 10, color: 'var(--color-mute-3)' }}>fit {Math.round(a.fit * 100)}%</span>
              </div>

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {a.eventCount > 0
                  ? <Tag text={`${a.eventCount} signal${a.eventCount === 1 ? '' : 's'}`} tone="rust" />
                  : <Tag text="quiet" />}
                {a.score >= meta.icp.threshold && <Tag text="in brief" tone="green" />}
              </div>
            </Link>
          ))}
        </div>
      )}

      {scored.length === 0 && accounts.length > 0 && (
        <p style={{ marginTop: 14, fontSize: 12.5, color: 'var(--color-mute-2)' }}>
          Nothing has scored yet — signals need two snapshots of a source before they can fire.
        </p>
      )}
    </Page>
  )
}
