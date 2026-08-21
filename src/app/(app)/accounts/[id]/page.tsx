import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  getAccount,
  getAccounts,
  getCampaign,
  getBrand,
  getCollectors,
  getProfile,
} from '../../../../lib/data'
import { Page, Pill, Tag, Empty } from '../../../../components/ui'
import { BarList } from '../../../../components/charts'
import type { BrandKit } from '../../../../core/enrich/brandkit'

/**
 * The account page.
 *
 * Written for a salesperson deciding whether to open a conversation, not for an
 * engineer debugging a scraper. What they need first is what this company does,
 * how fast it is growing, where it is investing, who will own the decision, and
 * what just changed.
 *
 * Collector IDs, null rates and field contracts are all still here — behind
 * "How we know this". They are the reason the page can be trusted, and exactly
 * the wrong thing to lead with.
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
  const profile = getProfile(id)
  const gate = campaign?.gate
  const collectors = getCollectors()
  const primary = brand?.primary ?? '#6a4df4'

  return (
    <Page max={1120}>
      <Link href="/" className="mono" style={{ fontSize: 11, color: 'var(--color-mute-3)' }}>
        ← Morning Brief
      </Link>

      {/* ---------------------------------------------------------- who */}
      <header style={{ display: 'flex', gap: 18, alignItems: 'flex-start', margin: '14px 0 8px', flexWrap: 'wrap' }}>
        <span
          className="display"
          style={{
            width: 52, height: 52, borderRadius: 12, background: primary, color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, flex: 'none',
          }}
        >
          {account.name.charAt(0)}
        </span>
        <div style={{ flex: 1, minWidth: 280, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 className="display" style={{ margin: 0, fontSize: 38, lineHeight: 1 }}>
              {account.name}
            </h1>
            {profile?.category && <Tag text={profile.category} tone="rust" />}
          </div>
          <a href={`https://${account.domain}`} target="_blank" rel="noopener noreferrer" className="mono" style={{ fontSize: 11.5 }}>
            {account.domain}
          </a>
          {profile?.positioning && (
            <p style={{ margin: '2px 0 0', fontSize: 14, lineHeight: 1.55, color: 'var(--color-mute)', maxWidth: 620, textWrap: 'pretty' }}>
              {profile.positioning}
            </p>
          )}
        </div>
        <div style={{ flex: 'none', textAlign: 'right' }}>
          <div className="display tnum" style={{ fontSize: 40, lineHeight: 1 }}>{account.score}</div>
          <div className="eyebrow" style={{ letterSpacing: '.1em' }}>
            fit {Math.round(account.fit * 100)}%
          </div>
        </div>
      </header>

      {/* ------------------------------------------------------ why now */}
      {profile && profile.whyNow.length > 0 && (
        <section
          style={{
            margin: '18px 0 12px', padding: '18px 20px',
            background: 'rgba(184,68,42,.05)', border: '1px solid rgba(184,68,42,.2)',
            borderRadius: 11,
          }}
        >
          <h2 className="eyebrow" style={{ margin: '0 0 10px', color: 'var(--color-rust)' }}>why now</h2>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 7 }}>
            {profile.whyNow.map((r, i) => (
              <li key={i} style={{ fontSize: 13.5, lineHeight: 1.55, color: 'var(--color-ink-2)', textWrap: 'pretty' }}>
                {r}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ------------------------------------------------ what changed */}
      <section className="card" style={{ padding: '18px 20px', marginBottom: 12 }}>
        <h2 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>What changed</h2>
        {account.signals.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-mute-2)' }}>Nothing has moved at this account yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {account.signals.flatMap((s) =>
              s.event.evidence.map((e) => {
                const blocked = Boolean(gate && !gate.ok && gate.blockers.some((b) => b.collectorId === e.collectorId))
                return (
                  <div key={e.id} className={`evidence${blocked ? ' evidence-blocked' : ''}`} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--color-ink-2)', textWrap: 'pretty' }}>
                      {e.sentence}
                    </span>
                    <span style={{ fontSize: 11.5, color: 'var(--color-mute-3)' }}>
                      {s.signalName} · seen {e.scrapedAt.slice(0, 10)}
                    </span>
                  </div>
                )
              }),
            )}
          </div>
        )}
      </section>

      {/* ------------------------------------------------ the business */}
      {profile && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 12, marginBottom: 12 }}>
          <div className="card" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>The company</h2>

            {profile.stage && (
              <Row label="Stage" value={profile.stage} />
            )}
            {profile.openRoles !== null && (
              <Row label="Open roles" value={`${profile.openRoles} on their public board`} />
            )}
            {profile.footprint.length > 0 && (
              <Row label="Footprint" value={profile.footprint.join(' · ')} />
            )}
            {profile.compliance.length > 0 && (
              <Row label="Compliance" value={profile.compliance.join(', ')} tone="good" />
            )}
            {profile.techStack.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <span className="eyebrow">Stack they name in their own postings</span>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {profile.techStack.map((t) => <Tag key={t} text={t} />)}
                </div>
              </div>
            )}
          </div>

          <div className="card" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Where they&rsquo;re investing</h2>
            {profile.hiringFocus.length > 0 ? (
              <BarList data={profile.hiringFocus.map((d) => ({ label: d.name, value: d.count }))} unit=" roles" />
            ) : (
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-mute-2)' }}>
                No public job board bound for this account.
              </p>
            )}

            {profile.buyingRoles.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
                <span className="eyebrow">Who will own this decision</span>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {profile.buyingRoles.map((r) => <Tag key={r} text={r} tone="rust" />)}
                </div>
                <span style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--color-mute-3)', textWrap: 'pretty' }}>
                  Inferred from the roles they are hiring. Roles, never people.
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- the pitch */}
      {campaign && brand && (
        <section style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
            <h2 className="display" style={{ margin: 0, fontSize: 26 }}>A pitch that looks like they built it.</h2>
            <span style={{ fontSize: 12.5, color: 'var(--color-mute-2)' }}>
              Colour and type read off {account.domain} itself.
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(330px,1fr))', gap: 16, alignItems: 'start' }}>
            <Browser chrome={account.domain} label="their brand, as scraped" labelColor="var(--color-mute-3)">
              <BrandProof brand={brand} name={account.name} />
            </Browser>
            <Browser chrome={`/m/${account.targetId}`} label="generated microsite" labelColor="var(--color-rust)" accent>
              <MicrositePreview
                primary={primary}
                name={account.name}
                headline={campaign.headline}
                evidence={campaign.evidence.slice(0, 2).map((e) => e.sentence)}
              />
            </Browser>
          </div>
          <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
            <Link href={`/m/${account.targetId}`} className="btn btn-quiet" target="_blank">Open the microsite →</Link>
          </div>
        </section>
      )}

      {/* -------------------------------------------------- the campaign */}
      {campaign ? (
        <section className="card" style={{ overflow: 'hidden', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '16px 20px', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Campaign draft</h2>
              <span style={{ fontSize: 11.5, color: 'var(--color-mute-2)' }}>
                {campaign.assets.length} assets · every claim sourced
              </span>
            </div>
            {gate?.ok ? <Tag text="ready for review" tone="green" /> : <Tag text="approval locked" tone="rust" />}
          </div>

          {campaign.assets.map((asset) => (
            <details key={asset.kind} style={{ borderBottom: '1px solid var(--line)' }}>
              <summary style={{ cursor: 'pointer', padding: '12px 20px', fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 500 }}>{asset.title}</span>
                <span className="mono" style={{ fontSize: 10.5, color: 'var(--color-mute-3)' }}>{asset.kind}</span>
              </summary>
              <pre className="mono" style={{ margin: 0, overflowX: 'auto', padding: '14px 20px', fontSize: 11.5, lineHeight: 1.7, whiteSpace: 'pre-wrap', background: 'var(--color-paper-3)' }}>
                {asset.body}
              </pre>
            </details>
          ))}

          <div style={{ padding: '18px 20px' }}>
            {gate?.ok ? (
              <>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                  <button className="btn btn-primary">Approve &amp; send</button>
                  <button className="btn btn-quiet">Edit</button>
                  <button className="btn btn-quiet" style={{ color: '#901f1f' }}>Reject</button>
                </div>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--color-mute-2)' }}>
                  Every source behind this draft is verified working.
                </p>
              </>
            ) : (
              <>
                <button className="btn" disabled style={{ background: 'rgba(20,18,15,.06)', color: 'var(--color-mute-3)', marginBottom: 10 }}>
                  Approve &amp; send
                </button>
                <p style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 600, color: '#901f1f', textWrap: 'pretty' }}>
                  Locked — one of the sources behind this draft isn&rsquo;t working.
                </p>
                <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, color: 'var(--color-mute-2)', maxWidth: 620, textWrap: 'pretty' }}>
                  Sending a prospect a claim we can no longer stand behind is worse than sending
                  nothing. This unlocks by itself once the source is repaired and verified.
                </p>
              </>
            )}
          </div>
        </section>
      ) : (
        <Empty title="No campaign yet." hint="A campaign is drafted once an account has something worth citing." />
      )}

      {/* ------------------------------------------- provenance, folded */}
      <details className="card" style={{ padding: '14px 20px' }}>
        <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
          How we know this
          <span style={{ fontWeight: 400, color: 'var(--color-mute-3)', marginLeft: 8, fontSize: 12 }}>
            sources, collectors and health
          </span>
        </summary>

        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="eyebrow">ICP fit</span>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 5 }}>
              {account.fitBreakdown.map((f) => (
                <li key={f.criterionId} style={{ display: 'flex', gap: 8, fontSize: 12.5, color: f.met ? 'var(--color-ink-2)' : 'var(--color-mute-3)' }}>
                  <span style={{ color: f.met ? '#2f8259' : 'var(--color-mute-4)' }}>{f.met ? '✓' : '·'}</span>
                  {f.description}
                </li>
              ))}
            </ul>
          </div>

          {campaign && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span className="eyebrow">every claim, and the source behind it</span>
              {campaign.evidence.map((e) => {
                const state = e.collectorId
                  ? (collectors.find((c) => c.collectorId === e.collectorId)?.state ?? 'UNKNOWN')
                  : null
                return (
                  <div key={e.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingBottom: 10, borderBottom: '1px solid var(--line)' }}>
                    <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--color-ink-3)' }}>{e.sentence}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span className="mono" style={{ fontSize: 10.5, color: 'var(--color-mute-3)' }}>
                        {e.collectorId ?? 'public feed'} · {e.sourceUrl}
                      </span>
                      {state ? <Pill state={state} /> : <Tag text="no collector needed" tone="green" />}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </details>
    </Page>
  )
}

/* ------------------------------------------------------------- pieces */

function Row({ label, value, tone }: { label: string; value: string; tone?: 'good' }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="eyebrow">{label}</span>
      <span style={{ fontSize: 13.5, lineHeight: 1.5, color: tone === 'good' ? '#2f8259' : 'var(--color-ink-2)', textWrap: 'pretty' }}>
        {value}
      </span>
    </div>
  )
}

function Browser({ chrome, label, labelColor, accent, children }: {
  chrome: string; label: string; labelColor: string; accent?: boolean; children: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
        <span className="mono" style={{ fontSize: 10, letterSpacing: '.13em', textTransform: 'uppercase', color: labelColor }}>{label}</span>
        <span className="mono" style={{ fontSize: 10, color: 'var(--color-mute-4)' }}>{chrome}</span>
      </div>
      <div style={{
        border: accent ? '2px solid var(--color-rust)' : '1px solid rgba(20,18,15,.12)',
        borderRadius: 11, overflow: 'hidden', background: '#fff',
        boxShadow: accent ? '0 4px 18px rgba(184,68,42,.13)' : undefined,
      }}>
        <div style={{ height: 26, background: '#f0ede8', borderBottom: '1px solid rgba(20,18,15,.08)', display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px' }}>
          <span style={{ display: 'flex', gap: 5 }}>
            {[0, 1, 2].map((i) => <span key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: '#d6d1c8' }} />)}
          </span>
          <span className="mono" style={{ fontSize: 9, color: '#9c968a' }}>{chrome}</span>
        </div>
        {children}
      </div>
    </div>
  )
}

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
    </div>
  )
}

function MicrositePreview({ primary, name, headline, evidence }: {
  primary: string; name: string; headline: string; evidence: string[]
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
          <span key={i}>{s}<sup style={{ color: primary, fontWeight: 700 }}>{i + 1}</sup>{' '}</span>
        ))}
      </span>
      <span style={{ alignSelf: 'flex-start', fontSize: 10.5, padding: '8px 13px', background: primary, color: '#fff', borderRadius: 6 }}>
        Book 15 minutes
      </span>
    </div>
  )
}
