import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getAccount, getAccounts, getCampaign, getBrand } from '../../../../lib/data'
import { Evidence, ScorePill } from '../../../../components/ui'

/**
 * Account detail and campaign review.
 *
 * The approval gate lives here, and it is the point of the screen. A reviewer
 * sees the draft, the evidence behind every claim, and the health of the
 * collectors that produced it — and cannot approve while any of them is broken.
 */
export function generateStaticParams() {
  return getAccounts().map((a) => ({ id: a.targetId }))
}

export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const account = getAccount(id)
  if (!account) notFound()

  const campaign = getCampaign(id)
  const brand = getBrand(id)
  const gate = campaign?.gate

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-[12px] hover:underline" style={{ color: 'var(--text-dim)' }}>
          ← Brief
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          {brand?.primary && (
            <span
              className="h-9 w-9 shrink-0 rounded-lg"
              style={{ background: brand.primary }}
              aria-hidden="true"
            />
          )}
          <div>
            <h1 className="text-[24px] font-semibold tracking-tight">{account.name}</h1>
            <p className="mono text-[11.5px]" style={{ color: 'var(--text-dim)' }}>
              {account.domain} · ICP fit {Math.round(account.fit * 100)}%
              {brand?.fonts.length ? ` · ${brand.fonts[0]}` : ''}
            </p>
          </div>
        </div>
        <ScorePill score={account.score} delta={account.delta} />
      </header>

      {/* ------------------------------------------------------- evidence */}
      <section className="card p-5">
        <h2 className="mb-3 text-[13px] font-semibold">What we observed</h2>
        {account.signals.length === 0 ? (
          <p className="text-[13px]" style={{ color: 'var(--text-dim)' }}>
            No signals on file for this account yet.
          </p>
        ) : (
          <div className="space-y-3">
            {account.signals.flatMap((s) =>
              s.event.evidence.map((e) => (
                <Evidence
                  key={e.id}
                  sentence={e.sentence}
                  signalName={s.signalName}
                  collectorId={e.collectorId}
                  sourceUrl={e.sourceUrl}
                  scrapedAt={e.scrapedAt}
                  blocked={Boolean(gate && !gate.ok && gate.blockers.some((b) => b.collectorId === e.collectorId))}
                />
              )),
            )}
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------ fit */}
      <section className="card p-5">
        <h2 className="mb-3 text-[13px] font-semibold">ICP fit</h2>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {account.fitBreakdown.map((f) => (
            <li key={f.criterionId} className="flex items-start gap-2 text-[12.5px]">
              <span style={{ color: f.met ? 'var(--color-healthy)' : 'var(--text-dim)' }}>
                {f.met ? '✓' : '·'}
              </span>
              <span style={{ color: f.met ? undefined : 'var(--text-dim)' }}>{f.description}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* ------------------------------------------------------- campaign */}
      {campaign ? (
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b hairline px-5 py-3.5">
            <div>
              <h2 className="text-[13px] font-semibold">Campaign draft</h2>
              <p className="mt-0.5 text-[11.5px]" style={{ color: 'var(--text-dim)' }}>
                {campaign.assets.length} assets · {campaign.evidence.length} cited facts · one ledger
              </p>
            </div>
            <Link
              href={`/m/${campaign.targetId}`}
              className="rounded-md border px-3 py-1.5 text-[12.5px] hairline transition-colors hover:bg-[var(--surface-2)]"
            >
              View microsite →
            </Link>
          </div>

          <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {campaign.assets.map((asset) => (
              <details key={asset.kind} className="group">
                <summary className="flex cursor-pointer items-center justify-between px-5 py-3 text-[13px] transition-colors hover:bg-[var(--surface-2)]">
                  <span className="font-medium">{asset.title}</span>
                  <span className="mono text-[11px]" style={{ color: 'var(--text-dim)' }}>
                    {asset.kind}
                  </span>
                </summary>
                <pre
                  className="mono overflow-x-auto px-5 py-4 text-[11.5px] leading-relaxed whitespace-pre-wrap"
                  style={{ background: 'var(--surface-2)' }}
                >
                  {asset.body}
                </pre>
              </details>
            ))}
          </div>

          {/* ------------------------------------------------- the gate */}
          <div className="border-t hairline px-5 py-4">
            {gate?.ok ? (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="rounded-md px-3.5 py-1.5 text-[13px] font-medium transition-opacity hover:opacity-85"
                  style={{ background: 'var(--accent)', color: 'var(--color-ink-950)' }}
                >
                  Approve &amp; publish
                </button>
                <button
                  type="button"
                  className="rounded-md border px-3 py-1.5 text-[13px] hairline transition-colors hover:bg-[var(--surface-2)]"
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="rounded-md border px-3 py-1.5 text-[13px] hairline transition-colors hover:bg-[var(--surface-2)]"
                  style={{ color: 'var(--text-dim)' }}
                >
                  Reject
                </button>
                <p className="text-[11.5px]" style={{ color: 'var(--text-dim)' }}>
                  {gate.reason}
                </p>
              </div>
            ) : (
              <div
                className="rounded-lg px-4 py-3.5"
                style={{ background: 'color-mix(in oklch, var(--color-quarantined) 10%, transparent)' }}
              >
                <div className="flex items-start gap-2.5">
                  <span aria-hidden="true">🔒</span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold" style={{ color: 'var(--color-quarantined)' }}>
                      {gate?.reason ?? 'Blocked — source health unknown.'}
                    </p>
                    <p className="mt-1 text-[12.5px] leading-relaxed" style={{ color: 'var(--text-dim)' }}>
                      Sending a prospect a claim sourced from a broken scraper is worse than sending
                      nothing at all. Approval unlocks automatically once the collector heals and its
                      output passes the field contract.
                    </p>
                    {gate?.blockers.length ? (
                      <ul className="mono mt-2 space-y-1 text-[11px]">
                        {gate.blockers.map((b) => (
                          <li key={b.collectorId} style={{ color: 'var(--text-dim)' }}>
                            {b.collectorId} · {b.state} · {b.sentence}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </div>
                <button
                  type="button"
                  disabled
                  className="mt-3 cursor-not-allowed rounded-md px-3.5 py-1.5 text-[13px] font-medium opacity-40"
                  style={{ background: 'var(--surface-2)', color: 'var(--text-dim)' }}
                >
                  Approve &amp; publish
                </button>
              </div>
            )}
          </div>
        </section>
      ) : (
        <section className="card px-5 py-8 text-center">
          <p className="text-[13px]" style={{ color: 'var(--text-dim)' }}>
            No campaign yet — a campaign is forged once an account has cited evidence.
          </p>
        </section>
      )}
    </div>
  )
}
