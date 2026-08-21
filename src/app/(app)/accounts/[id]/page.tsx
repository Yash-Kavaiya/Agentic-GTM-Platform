import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getAccount, getAccounts, getCampaign, getBrand, getCollectors } from '../../../../lib/data'
import { Evidence, Page, Pill, Tag, Empty } from '../../../../components/ui'
import type { BrandKit } from '../../../../core/enrich/brandkit'

/**
 * Account detail: what we know, what we drafted, and whether it may be sent.
 *
 * The approval gate at the foot is the load-bearing part. A reviewer sees the
 * draft, the evidence behind every claim, and the health of the collectors that
 * produced it — and cannot approve while any of them is broken.
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
  const collectors = getCollectors()
  const primary = brand?.primary ?? '#6a4df4'

  return (
    <Page max={1120}>
      <Link href="/" className="mono" style={{ fontSize: 11, color: 'var(--color-mute-3)' }}>
        ← Morning Brief
      </Link>

      <header
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 24,
          margin: '14px 0 26px',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <span
            className="display"
            style={{
              width: 52,
              height: 52,
              borderRadius: 12,
              background: primary,
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 26,
              flex: 'none',
            }}
          >
            {account.name.charAt(0)}
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h1 className="display" style={{ margin: 0, fontSize: 38, lineHeight: 1 }}>
              {account.name}
            </h1>
            <span style={{ fontSize: 13, color: 'var(--color-mute-2)' }}>
              {account.domain} · score {account.score} · ICP fit {Math.round(account.fit * 100)}%
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-end' }}>
          <span className="eyebrow">enriched from public pages</span>
          <span className="mono" style={{ fontSize: 11.5, color: 'var(--color-mute)' }}>
            {account.eventCount} signal{account.eventCount === 1 ? '' : 's'} ·{' '}
            {campaign?.evidence.length ?? 0} cited facts
          </span>
        </div>
      </header>

      {/* ------------------------------------------------------- observed */}
      <section className="card" style={{ padding: '18px 20px', marginBottom: 12 }}>
        <h2 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>What we observed</h2>
        {account.signals.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-mute-2)' }}>
            No signals on file for this account yet.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
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

      {/* ------------------------------------------------------ enrichment */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 12, marginBottom: 12 }}>
        <EnrichBlock
          title="ICP fit"
          src="verified public pages"
          rows={account.fitBreakdown.map((f) => ({
            k: f.met ? '✓' : '·',
            v: f.description,
            dim: !f.met,
          }))}
        />
        {brand && <BrandBlock brand={brand} />}
      </div>

      {/* ---------------------------------------------------- split screen */}
      {campaign && brand && (
        <section style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
            <h2 className="display" style={{ margin: 0, fontSize: 26 }}>
              A pitch that looks like they built it.
            </h2>
            <span style={{ fontSize: 12.5, color: 'var(--color-mute-2)' }}>
              Colour, typeface and mark read off {account.domain} itself.
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(330px,1fr))', gap: 16, alignItems: 'start' }}>
            <Browser
              chrome={account.domain}
              label="their brand, as scraped"
              labelColor="var(--color-mute-3)"
            >
              <BrandProof brand={brand} name={account.name} />
            </Browser>

            <Browser
              chrome={`/m/${account.targetId}`}
              label="generated microsite"
              labelColor="var(--color-rust)"
              accent
            >
              <MicrositePreview
                primary={primary}
                name={account.name}
                headline={campaign.headline}
                evidence={campaign.evidence.slice(0, 2).map((e) => e.sentence)}
              />
            </Browser>
          </div>

          <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
            <Link href={`/m/${account.targetId}`} className="btn btn-quiet" target="_blank">
              Open the microsite →
            </Link>
          </div>
        </section>
      )}

      {/* ------------------------------------------- campaign + the gate */}
      {campaign ? (
        <section className="card" style={{ overflow: 'hidden' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '16px 20px',
              borderBottom: '1px solid var(--line)',
              flexWrap: 'wrap',
            }}
          >
            <div>
              <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Campaign draft</h2>
              <span style={{ fontSize: 11.5, color: 'var(--color-mute-2)' }}>
                {campaign.assets.length} assets · {campaign.evidence.length} cited facts · one ledger
              </span>
            </div>
            {gate?.ok ? <Tag text="ready for review" tone="green" /> : <Tag text="approval locked" tone="rust" />}
          </div>

          {campaign.assets.map((asset) => (
            <details key={asset.kind} style={{ borderBottom: '1px solid var(--line)' }}>
              <summary
                style={{
                  cursor: 'pointer',
                  padding: '12px 20px',
                  fontSize: 13,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <span style={{ fontWeight: 500 }}>{asset.title}</span>
                <span className="mono" style={{ fontSize: 10.5, color: 'var(--color-mute-3)' }}>
                  {asset.kind}
                </span>
              </summary>
              <pre
                className="mono"
                style={{
                  margin: 0,
                  overflowX: 'auto',
                  padding: '14px 20px',
                  fontSize: 11.5,
                  lineHeight: 1.7,
                  whiteSpace: 'pre-wrap',
                  background: 'var(--color-paper-3)',
                }}
              >
                {asset.body}
              </pre>
            </details>
          ))}

          {/* the evidence chain + gate */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 0 }}>
            <div style={{ padding: '18px 20px', borderRight: '1px solid var(--line)' }}>
              <h3 style={{ margin: '0 0 12px', fontSize: 13.5, fontWeight: 600 }}>Evidence chain</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {campaign.evidence.map((e) => {
                  const state = e.collectorId
                    ? (collectors.find((c) => c.collectorId === e.collectorId)?.state ?? 'UNKNOWN')
                    : null
                  return (
                    <div key={e.id} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span className="mono" style={{ fontSize: 10.5 }}>
                          {e.collectorId ?? 'public feed'}
                        </span>
                        {state ? <Pill state={state} /> : <Tag text="no collector" tone="green" />}
                      </div>
                      <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--color-ink-3)', textWrap: 'pretty' }}>
                        {e.sentence}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>

            <div style={{ padding: '18px 20px' }}>
              <h3 style={{ margin: '0 0 12px', fontSize: 13.5, fontWeight: 600 }}>Approval</h3>
              {gate?.ok ? (
                <>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                    <button className="btn btn-primary">Approve &amp; publish</button>
                    <button className="btn btn-quiet">Edit</button>
                    <button className="btn btn-quiet" style={{ color: '#a32c2c' }}>
                      Reject
                    </button>
                  </div>
                  <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--color-mute-2)' }}>
                    {gate.reason}
                  </p>
                </>
              ) : (
                <>
                  <button className="btn" disabled style={{ background: 'rgba(20,18,15,.06)', color: 'var(--color-mute-3)', marginBottom: 10 }}>
                    Approve &amp; publish
                  </button>
                  <p style={{ margin: '0 0 8px', fontSize: 12.5, fontWeight: 600, color: '#a32c2c', textWrap: 'pretty' }}>
                    {gate?.reason ?? 'Blocked — source health unknown.'}
                  </p>
                  <p style={{ margin: 0, fontSize: 12, lineHeight: 1.55, color: 'var(--color-mute-2)', textWrap: 'pretty' }}>
                    A claim sourced from a broken collector is worse than no claim at all. Approval
                    stays locked until every cited collector passes its field contract in production.
                  </p>
                </>
              )}
            </div>
          </div>
        </section>
      ) : (
        <Empty title="No campaign yet." hint="A campaign is forged once an account has cited evidence." />
      )}
    </Page>
  )
}

/* ------------------------------------------------------------- pieces */

function EnrichBlock({
  title,
  src,
  rows,
}: {
  title: string
  src: string
  rows: { k: string; v: string; dim?: boolean }[]
}) {
  return (
    <div className="card" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{title}</h2>
        <span className="mono" style={{ fontSize: 10, color: 'var(--color-mute-3)' }}>
          {src}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
            <span
              className="mono"
              style={{ flex: 'none', width: 16, color: r.dim ? 'var(--color-mute-4)' : '#2f6b4f' }}
            >
              {r.k}
            </span>
            <span
              style={{
                flex: 1,
                fontSize: 13,
                lineHeight: 1.5,
                color: r.dim ? 'var(--color-mute-3)' : 'var(--color-ink-2)',
                textWrap: 'pretty',
              }}
            >
              {r.v}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function BrandBlock({ brand }: { brand: BrandKit }) {
  return (
    <div className="card" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Brand kit</h2>
        <span className="mono" style={{ fontSize: 10, color: 'var(--color-mute-3)' }}>
          homepage · css
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className="eyebrow">palette</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {brand.palette.slice(0, 6).map((hex) => (
            <span key={hex} style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'center' }}>
              <span
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 7,
                  background: hex,
                  border: '1px solid rgba(20,18,15,.1)',
                }}
              />
              <span className="mono" style={{ fontSize: 9, color: 'var(--color-mute-3)' }}>
                {hex}
              </span>
            </span>
          ))}
        </div>
      </div>

      {brand.fonts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="eyebrow">type</span>
          <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-.2px' }}>
            {brand.fonts[0]} — display
          </span>
          {brand.fonts[1] && (
            <span style={{ fontSize: 12.5, color: 'var(--color-mute)' }}>{brand.fonts[1]} — body</span>
          )}
        </div>
      )}

      {brand.voiceSamples[0] && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="eyebrow">headline voice</span>
          <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--color-mute)', textWrap: 'pretty' }}>
            &ldquo;{brand.voiceSamples[0].slice(0, 130)}&rdquo;
          </span>
        </div>
      )}

      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--color-mute-2)', borderTop: '1px solid var(--line)', paddingTop: 12, textWrap: 'pretty' }}>
        Roles, never people — the buying-role map is inferred from their own open postings.
      </p>
    </div>
  )
}

function Browser({
  chrome,
  label,
  labelColor,
  accent,
  children,
}: {
  chrome: string
  label: string
  labelColor: string
  accent?: boolean
  children: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
        <span className="mono" style={{ fontSize: 10, letterSpacing: '.13em', textTransform: 'uppercase', color: labelColor }}>
          {label}
        </span>
        <span className="mono" style={{ fontSize: 10, color: 'var(--color-mute-4)' }}>
          {chrome}
        </span>
      </div>
      <div
        style={{
          border: accent ? '2px solid var(--color-rust)' : '1px solid rgba(20,18,15,.12)',
          borderRadius: 11,
          overflow: 'hidden',
          background: '#fff',
          boxShadow: accent ? '0 4px 18px rgba(184,68,42,.13)' : undefined,
        }}
      >
        <div
          style={{
            height: 26,
            background: '#f0ede8',
            borderBottom: '1px solid rgba(20,18,15,.08)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 10px',
          }}
        >
          <span style={{ display: 'flex', gap: 5 }}>
            {[0, 1, 2].map((i) => (
              <span key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: '#d6d1c8' }} />
            ))}
          </span>
          <span className="mono" style={{ fontSize: 9, color: '#9c968a' }}>
            {chrome}
          </span>
        </div>
        {children}
      </div>
    </div>
  )
}

/**
 * Their brand, rendered from what we scraped.
 *
 * Deliberately not a screenshot and not a reproduction of their site — it is
 * the extracted palette, typeface and headline shown as themselves, so the
 * comparison beside the microsite is honest about what Bellwether actually
 * knows.
 */
function BrandProof({ brand, name }: { brand: BrandKit; name: string }) {
  const primary = brand.primary ?? '#6a4df4'
  return (
    <div style={{ padding: '24px 26px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 19, height: 19, borderRadius: 5, background: primary, flex: 'none' }} />
        <span style={{ fontSize: 14, fontWeight: 700, color: '#171436' }}>{name}</span>
      </div>

      {brand.headline && (
        <span style={{ fontSize: 21, fontWeight: 700, lineHeight: 1.2, color: '#171436', letterSpacing: '-.4px', textWrap: 'pretty' }}>
          {brand.headline.slice(0, 70)}
        </span>
      )}
      {brand.description && (
        <span style={{ fontSize: 12, lineHeight: 1.6, color: '#5b5878', textWrap: 'pretty' }}>
          {brand.description.slice(0, 150)}
        </span>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {brand.palette.slice(0, 5).map((hex) => (
          <span key={hex} style={{ width: 30, height: 30, borderRadius: 6, background: hex, border: '1px solid rgba(0,0,0,.06)' }} />
        ))}
      </div>
      <span className="mono" style={{ fontSize: 9.5, color: '#8b84a0' }}>
        {[brand.primary, ...brand.fonts.slice(0, 2)].filter(Boolean).join(' · ')}
      </span>
    </div>
  )
}

function MicrositePreview({
  primary,
  name,
  headline,
  evidence,
}: {
  primary: string
  name: string
  headline: string
  evidence: string[]
}) {
  return (
    <div style={{ padding: '24px 26px 26px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ width: 19, height: 19, borderRadius: 5, background: primary, flex: 'none' }} />
          <span style={{ fontSize: 14, fontWeight: 700, color: '#171436' }}>{name}</span>
        </span>
        <span style={{ fontSize: 13, color: '#c3bfd6' }}>×</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-rust)' }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: '#171436' }}>Bellwether</span>
        </span>
      </div>

      <span style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.2, color: '#171436', letterSpacing: '-.4px', textWrap: 'pretty' }}>
        {headline}
      </span>

      <span style={{ fontSize: 12.5, lineHeight: 1.65, color: '#5b5878', textWrap: 'pretty' }}>
        {evidence.map((s, i) => (
          <span key={i}>
            {s}
            <sup style={{ color: primary, fontWeight: 700 }}>{i + 1}</sup>{' '}
          </span>
        ))}
      </span>

      <span
        style={{
          alignSelf: 'flex-start',
          fontSize: 10.5,
          padding: '8px 13px',
          background: primary,
          color: '#fff',
          borderRadius: 6,
        }}
      >
        Book 15 minutes
      </span>
    </div>
  )
}
