import Link from 'next/link'
import { getAccounts, getMeta } from '../../lib/data'
import { ScorePill, Empty } from '../../components/ui'

/** The watchlist, ranked. */
export default function AccountsPage() {
  const accounts = getAccounts()
  const meta = getMeta()

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-[26px] font-semibold tracking-tight">Accounts</h1>
        <p className="mt-1.5 text-[13px]" style={{ color: 'var(--text-dim)' }}>
          {accounts.length} on the watchlist · ICP threshold {meta.icp.threshold}
        </p>
      </header>

      {accounts.length === 0 ? (
        <Empty title="No accounts loaded." hint="Run the engine and export to populate this view." />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {accounts.map((a) => (
            <li key={a.targetId}>
              <Link href={`/accounts/${a.targetId}`} className="card block p-4 transition-colors hover:bg-[var(--surface-2)]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-[15px] font-semibold">{a.name}</h2>
                    <p className="mono mt-0.5 text-[11px]" style={{ color: 'var(--text-dim)' }}>{a.domain}</p>
                  </div>
                  <ScorePill score={a.score} delta={a.delta} />
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <div className="h-1 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--surface-2)' }}>
                    <div className="h-full rounded-full" style={{ width: `${a.fit * 100}%`, background: 'var(--accent)' }} />
                  </div>
                  <span className="tnum text-[11px]" style={{ color: 'var(--text-dim)' }}>
                    fit {Math.round(a.fit * 100)}%
                  </span>
                </div>
                <p className="mt-2 text-[12px]" style={{ color: 'var(--text-dim)' }}>
                  {a.eventCount} signal{a.eventCount === 1 ? '' : 's'} on file
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
