import { getHeals, getCollectors, getAccounts, getMeta, getAdapters } from '../../lib/data'
import { HealthBadge, Stat, Empty } from '../../components/ui'
import type { HealEvent, ObservationStats } from '../../core/types'

/**
 * Dashboard.
 *
 * The Heal Log is the hero. Every other panel reports what the platform found;
 * this one reports what it repaired, with the before/after data that proves it.
 */
export default function DashboardPage() {
  const { heals, stats } = getHeals()
  const collectors = getCollectors()
  const accounts = getAccounts()
  const adapters = getAdapters()
  const meta = getMeta()

  const scored = accounts.filter((a) => a.score > 0)
  const bd = adapters.filter((a) => a.usesBrightData)

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-[26px] font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1.5 text-[13px]" style={{ color: 'var(--text-dim)' }}>
          Last engine run {new Date(meta.generatedAt).toISOString().replace('T', ' ').slice(0, 16)} UTC
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Heal success"
          value={stats.attempts === 0 ? '—' : `${Math.round(stats.successRate * 100)}%`}
          sub={`${stats.approved} approved · ${stats.rejected} rejected`}
        />
        <Stat
          label="Median time to heal"
          value={stats.medianMs ? `${(stats.medianMs / 1000).toFixed(1)}s` : '—'}
          sub={`${stats.attempts} attempt${stats.attempts === 1 ? '' : 's'}`}
        />
        <Stat label="Rows recovered" value={stats.rowsRecovered || '—'} sub="across all repairs" />
        <Stat
          label="Sources"
          value={meta.verifiedSourceCount}
          sub={`${bd.length} Bright Data · ${adapters.length - bd.length} direct`}
        />
      </section>

      {/* ---------------------------------------------------------- heal log */}
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-[15px] font-semibold">Heal log</h2>
          <p className="text-[11.5px]" style={{ color: 'var(--text-dim)' }}>
            Every repair, with the data before and after
          </p>
        </div>

        {heals.length === 0 ? (
          <Empty
            title="No repairs yet."
            hint={
              <>
                A heal is recorded when a collector drifts — its fields go null or its row count
                collapses — and Bellwether repairs it. Nothing has drifted yet. Run{' '}
                <code className="mono">npm run bench</code> to inject drift into the fixture and
                measure the loop end to end.
              </>
            }
          />
        ) : (
          <ul className="space-y-3">
            {heals.map((h) => (
              <HealCard key={h.id} heal={h} />
            ))}
          </ul>
        )}
      </section>

      {/* ------------------------------------------------------ signal health */}
      <section>
        <h2 className="mb-3 text-[15px] font-semibold">Signal health</h2>
        {collectors.length === 0 ? (
          <Empty
            title="No collectors provisioned."
            hint={
              <>
                Run <code className="mono">bdata login</code> then{' '}
                <code className="mono">npm run bw:provision</code>. Feed and job-board sources need
                no collector — they already publish structured data.
              </>
            }
          />
        ) : (
          <div className="card divide-y" style={{ borderColor: 'var(--border)' }}>
            {collectors.map((c) => (
              <div key={c.collectorId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium">{c.key}</p>
                  <p className="mono truncate text-[11px]" style={{ color: 'var(--text-dim)' }}>
                    {c.collectorId} · {c.scraperType} · {c.seedUrl}
                  </p>
                </div>
                <HealthBadge state={c.state} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------ pipeline */}
      <section>
        <h2 className="mb-3 text-[15px] font-semibold">Pipeline</h2>
        {scored.length === 0 ? (
          <Empty title="No accounts have scored yet." hint="Signals need two snapshots of a source before they can fire." />
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b hairline text-left text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>
                  <th className="px-4 py-2.5 font-medium">Account</th>
                  <th className="px-4 py-2.5 font-medium">Fit</th>
                  <th className="px-4 py-2.5 font-medium">Signals</th>
                  <th className="px-4 py-2.5 text-right font-medium">Score</th>
                </tr>
              </thead>
              <tbody>
                {scored.slice(0, 15).map((a) => (
                  <tr key={a.targetId} className="border-b last:border-0 hairline">
                    <td className="px-4 py-2.5">
                      <span className="font-medium">{a.name}</span>
                      <span className="mono ml-2 text-[11px]" style={{ color: 'var(--text-dim)' }}>
                        {a.domain}
                      </span>
                    </td>
                    <td className="tnum px-4 py-2.5" style={{ color: 'var(--text-dim)' }}>
                      {Math.round(a.fit * 100)}%
                    </td>
                    <td className="tnum px-4 py-2.5" style={{ color: 'var(--text-dim)' }}>
                      {a.eventCount}
                    </td>
                    <td className="tnum px-4 py-2.5 text-right font-semibold">{a.score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

/**
 * One repair, with the evidence that it worked.
 *
 * The symptom is shown in full because it is the interesting part: it opens
 * with the user's own plain-language description of what they wanted, and only
 * then says what broke. That is the string doing double duty.
 */
function HealCard({ heal }: { heal: HealEvent }) {
  const ok = heal.verdict === 'approved'
  const color = ok ? 'var(--color-healthy)' : heal.verdict === 'rejected' ? 'var(--color-degraded)' : 'var(--color-quarantined)'

  return (
    <li className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b hairline px-4 py-3">
        <span className="mono text-[12px]">{heal.collectorId}</span>
        <span className="text-[12px]" style={{ color: 'var(--text-dim)' }}>
          {heal.signalId} · {heal.targetId} · attempt {heal.attempt}
        </span>
        <span className="ml-auto flex items-center gap-2.5">
          {heal.durationMs !== null && (
            <span className="mono tnum text-[11px]" style={{ color: 'var(--text-dim)' }}>
              {(heal.durationMs / 1000).toFixed(1)}s
            </span>
          )}
          {heal.rowsRecovered ? (
            <span className="mono tnum text-[11px]" style={{ color: 'var(--color-healthy)' }}>
              +{heal.rowsRecovered} rows
            </span>
          ) : null}
          <span className="rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ color, background: `color-mix(in oklch, ${color} 14%, transparent)` }}>
            {heal.fromState} → {heal.toState}
          </span>
        </span>
      </div>

      <div className="px-4 py-3">
        <p className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>
          Repair prompt sent to Bright Data
        </p>
        <p className="mono mt-1 text-[11.5px] leading-relaxed">{heal.symptom}</p>
      </div>

      {(heal.before || heal.after) && (
        <div className="grid gap-px sm:grid-cols-2" style={{ background: 'var(--border)' }}>
          <StatsPane label="Before" stats={heal.before} tone="var(--color-quarantined)" />
          <StatsPane label="After" stats={heal.after} tone="var(--color-healthy)" />
        </div>
      )}

      {heal.error && (
        <p className="mono px-4 py-2 text-[11.5px]" style={{ color: 'var(--color-quarantined)' }}>
          {heal.error}
        </p>
      )}
    </li>
  )
}

function StatsPane({ label, stats, tone }: { label: string; stats: ObservationStats | null; tone: string }) {
  return (
    <div className="px-4 py-3" style={{ background: 'var(--surface)' }}>
      <p className="text-[11px] uppercase tracking-wide" style={{ color: tone }}>
        {label}
      </p>
      {!stats ? (
        <p className="mono mt-1 text-[11.5px]" style={{ color: 'var(--text-dim)' }}>—</p>
      ) : (
        <div className="mono mt-1.5 space-y-1 text-[11.5px]">
          <p className="tnum">
            <span style={{ color: 'var(--text-dim)' }}>rows</span> {stats.rowCount}
          </p>
          {stats.fields.map((f) => (
            <p key={f.field} className="tnum flex justify-between gap-3">
              <span className="truncate" style={{ color: 'var(--text-dim)' }}>{f.field}</span>
              <span style={{ color: f.nullRate > 0.5 ? 'var(--color-quarantined)' : undefined }}>
                {Math.round(f.nullRate * 100)}% null
              </span>
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
