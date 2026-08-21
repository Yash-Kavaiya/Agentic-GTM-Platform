import { getSignals } from '../../lib/data'
import { HealthBadge, WatchString } from '../../components/ui'
import { SignalBuilder } from '../../components/SignalBuilder'

/**
 * Signal Studio.
 *
 * Twelve templates ship as data, not code. A GTM user picks one or writes their
 * own in plain English, and that sentence becomes the collector.
 */
export default function StudioPage() {
  const signals = getSignals()
  const byCategory = groupBy(signals, (s) => s.category)

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-[26px] font-semibold tracking-tight">Signal Studio</h1>
        <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed" style={{ color: 'var(--text-dim)' }}>
          Describe what a buying signal looks like in plain English. That one sentence provisions the
          scraper, repairs it when the page changes, and is cited beside the claim it produces.
        </p>
      </header>

      <section>
        <h2 className="mb-3 text-[13px] font-semibold">Custom signal</h2>
        <SignalBuilder />
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-[13px] font-semibold">Templates</h2>
          <p className="mono text-[11px]" style={{ color: 'var(--text-dim)' }}>
            {signals.length} ready to activate
          </p>
        </div>

        <div className="space-y-6">
          {Object.entries(byCategory).map(([category, items]) => (
            <div key={category}>
              <p className="mb-2 text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>
                {category}
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                {items.map((s) => (
                  <article key={s.id} className="card flex flex-col gap-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-[14px] font-semibold">{s.name}</h3>
                        <p className="mono mt-0.5 text-[11px]" style={{ color: 'var(--text-dim)' }}>
                          {s.adapter}
                          {s.path ? ` · ${s.path}` : ''} · {s.cadence} · weight {s.weight}
                        </p>
                      </div>
                      {s.collector ? (
                        <HealthBadge state="HEALTHY" />
                      ) : (
                        <span
                          className="rounded-full px-2 py-0.5 text-[11px]"
                          style={{ background: 'var(--surface-2)', color: 'var(--text-dim)' }}
                        >
                          Not activated
                        </span>
                      )}
                    </div>

                    <WatchString watch={s.watch} />

                    <div className="mt-auto flex items-center justify-between gap-3 pt-1">
                      <p className="text-[11.5px]" style={{ color: 'var(--text-dim)' }}>
                        {s.coverage} of the watchlist{' '}
                        {s.coverage === 1 ? 'has' : 'have'} a verified source
                      </p>
                      {s.collector ? (
                        <span className="mono text-[11px]" style={{ color: 'var(--text-dim)' }}>
                          {s.collector.collectorId}
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="rounded-md border px-2.5 py-1 text-[12px] hairline transition-colors hover:bg-[var(--surface-2)]"
                        >
                          Activate
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function groupBy<T>(items: T[], key: (t: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {}
  for (const item of items) (out[key(item)] ??= []).push(item)
  return out
}
