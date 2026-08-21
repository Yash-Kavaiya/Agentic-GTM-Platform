import { getCandidates } from '../../../lib/data'
import { Page, PageHead, Empty, Tag } from '../../../components/ui'
import { BarList } from '../../../components/charts'

/**
 * Prospect discovery.
 *
 * The watchlist answers "what did my accounts just do". This answers the
 * question before it: which companies should be on the list at all.
 *
 * A company hiring the role you sell into IS the buying signal, so discovery
 * searches public job boards for that role and reads the employer out of the
 * result URL. Every candidate is then verified against the board API and their
 * own domain, and anything unconfirmed says so rather than being dropped.
 */
export default function DiscoverPage() {
  const { candidates, role, generatedAt } = getCandidates()
  const strong = candidates.filter((c) => c.score >= 60)
  const weak = candidates.filter((c) => c.score < 60)

  return (
    <Page max={1080}>
      <PageHead
        eyebrow={role ? `Discovery · "${role}"` : 'Discovery'}
        title="Who should be on the list."
        lede="Describe the role a company hires when it is ready to buy what you sell. The company that posted it is the prospect — found on public job boards, then verified against their own site."
        right={<button className="btn btn-primary">New search</button>}
      />

      {candidates.length === 0 ? (
        <Empty
          title="No search run yet."
          hint={<>Run <code className="mono">npm run bw -- discover --role &quot;Revenue Operations Manager&quot;</code> to find companies hiring the role that signals your buying trigger.</>}
        />
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 22, flexWrap: 'wrap' }}>
            <div className="card" style={{ flex: 1, minWidth: 300, padding: '18px 20px' }}>
              <h2 style={{ margin: '0 0 12px', fontSize: 13.5, fontWeight: 600 }}>Candidate confidence</h2>
              <BarList
                data={candidates.slice(0, 8).map((c) => ({
                  label: c.name,
                  value: c.score,
                  note: c.domain ?? 'unverified',
                }))}
                max={100}
              />
            </div>
            <div className="card" style={{ flex: 'none', width: 240, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <span className="eyebrow">found</span>
                <div className="display tnum" style={{ fontSize: 34 }}>{candidates.length}</div>
              </div>
              <div>
                <span className="eyebrow">verified domain</span>
                <div className="display tnum" style={{ fontSize: 34 }}>{candidates.filter((c) => c.domainVerified).length}</div>
              </div>
              <div>
                <span className="eyebrow">worth a look</span>
                <div className="display tnum" style={{ fontSize: 34 }}>{strong.length}</div>
              </div>
              {generatedAt && (
                <span className="mono" style={{ fontSize: 10, color: 'var(--color-mute-4)' }}>
                  {generatedAt.replace('T', ' ').slice(0, 16)} UTC
                </span>
              )}
            </div>
          </div>

          <h2 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600 }}>Worth a look</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 24 }}>
            {strong.map((c) => <CandidateRow key={c.token} c={c} />)}
            {strong.length === 0 && (
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-mute-2)' }}>
                Nothing cleared the bar this run.
              </p>
            )}
          </div>

          {weak.length > 0 && (
            <>
              <h2 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600 }}>Needs a human</h2>
              <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--color-mute-2)', maxWidth: 620, textWrap: 'pretty' }}>
                Real companies, hiring the role — but the domain could not be confirmed
                automatically. Shown rather than dropped, because a silent omission is worse
                than an unfinished row.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {weak.map((c) => <CandidateRow key={c.token} c={c} />)}
              </div>
            </>
          )}
        </>
      )}
    </Page>
  )
}

function CandidateRow({ c }: { c: ReturnType<typeof getCandidates>['candidates'][number] }) {
  return (
    <article className="card card-hover" style={{ padding: '16px 18px', display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div style={{ flex: 'none', width: 60, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="display tnum" style={{ fontSize: 30 }}>{c.score}</span>
        <span className="eyebrow" style={{ letterSpacing: '.1em' }}>signal</span>
      </div>

      <div style={{ flex: 1, minWidth: 260, display: 'flex', flexDirection: 'column', gap: 7 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 15.5, fontWeight: 600 }}>{c.name}</span>
          {c.domain
            ? <a href={`https://${c.domain}`} target="_blank" rel="noopener noreferrer" className="mono" style={{ fontSize: 11 }}>{c.domain}</a>
            : <Tag text="domain unresolved" />}
          <Tag text={c.provider} tone="rust" />
        </div>

        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 3 }}>
          {c.notes.map((n, i) => (
            <li key={i} style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--color-mute)', textWrap: 'pretty' }}>· {n}</li>
          ))}
        </ul>

        <span className="mono" style={{ fontSize: 10.5, color: 'var(--color-mute-3)' }}>
          surfaced by: {c.triggerRole}
        </span>
      </div>

      <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', gap: 6, width: 128 }}>
        <button className="btn btn-primary" style={{ padding: '9px 12px' }}>Add to watchlist</button>
        <a href={c.boardUrl} target="_blank" rel="noopener noreferrer" className="btn btn-quiet" style={{ padding: '7px 12px', fontSize: 11.5, textAlign: 'center' }}>
          See their board
        </a>
      </div>
    </article>
  )
}
