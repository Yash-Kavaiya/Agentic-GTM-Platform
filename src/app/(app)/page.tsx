import Link from 'next/link'
import { getBrief, getMeta, getHeals, getAccounts } from '../../lib/data'
import { Evidence, Page, Stat, Empty, Tag } from '../../components/ui'

/**
 * The Morning Brief — the daily surface.
 *
 * Ranked by how much each account moved, every claim cited, one click to a
 * campaign. Generated for a DATE rather than for "now", so any past morning can
 * be reproduced exactly and the demo never depends on a site changing on cue.
 */
export default function BriefPage() {
  const brief = getBrief()
  const meta = getMeta()
  const { stats } = getHeals()
  const accounts = getAccounts()

  const dateLabel = new Date(`${brief.date}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })

  const moved = brief.entries.length
  const blocked = brief.entries.filter((e) => e.hasBlockedEvidence).length
  const topScore = accounts[0]?.score ?? 0

  return (
    <Page>
      <header
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 24,
          marginBottom: 30,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="eyebrow" style={{ fontSize: 10, letterSpacing: '.16em' }}>
            {dateLabel} · 04:12 UTC
          </span>
          <h1 className="display" style={{ margin: 0, fontSize: 46 }}>
            {moved === 0 ? (
              <>Nothing moved
              <br />overnight.</>
            ) : (
              <>
                {spell(moved)} account{moved === 1 ? '' : 's'} moved
                <br />
                overnight.
              </>
            )}
          </h1>
          <p
            style={{
              margin: '6px 0 0',
              fontSize: 14,
              lineHeight: 1.55,
              color: 'var(--color-mute)',
              maxWidth: 520,
              textWrap: 'pretty',
            }}
          >
            Ranked by fit against your ICP. Every line below is cited to the collector that saw it —
            click through to build the campaign while the signal is still warm.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flex: 'none' }}>
          <Link href="/heal" className="btn btn-quiet">
            Heal log
          </Link>
          <Link href="/studio" className="btn btn-ink">
            New signal
          </Link>
        </div>
      </header>

      <div style={{ display: 'flex', gap: 10, marginBottom: 22, flexWrap: 'wrap' }}>
        <Stat label="accounts moved" value={moved} sub={`${brief.totals.signalsFired} signals fired`} />
        <Stat label="cited facts" value={brief.totals.evidenceItems} sub="every claim sourced" />
        <Stat
          label="top score"
          value={topScore || '—'}
          sub={`threshold ${meta.icp.threshold}`}
        />
        <Stat
          label="approval blocked"
          value={blocked}
          sub={blocked > 0 ? 'a cited collector is unhealthy' : 'all sources verify'}
          subTone={blocked > 0 ? 'rust' : 'green'}
        />
      </div>

      {brief.entries.length === 0 ? (
        <Empty
          title="Nothing has moved yet."
          hint={
            <>
              A signal fires on a <em>change</em>, so it needs two snapshots of the same source. The
              first collection run sets the baseline; the next one can fire.
            </>
          }
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {brief.entries.map((entry) => {
            const a = entry.account
            return (
              <article
                key={a.targetId}
                className="card card-hover"
                style={{
                  padding: '20px 22px',
                  display: 'flex',
                  gap: 22,
                  boxShadow: '0 1px 2px rgba(20,18,15,.04)',
                  flexWrap: 'wrap',
                }}
              >
                {/* score */}
                <div style={{ flex: 'none', width: 112, display: 'flex', flexDirection: 'column', gap: 9 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span className="display tnum" style={{ fontSize: 34 }}>
                      {a.score}
                    </span>
                    {a.delta !== 0 && (
                      <span
                        className="mono tnum"
                        style={{ fontSize: 11, color: a.delta > 0 ? '#2f6b4f' : 'var(--color-mute-3)' }}
                      >
                        {a.delta > 0 ? '▲' : '▼'}
                        {Math.abs(a.delta)}
                      </span>
                    )}
                  </div>
                  <div style={{ height: 4, background: 'rgba(20,18,15,.08)', borderRadius: 3, overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${Math.round(a.fit * 100)}%`,
                        height: '100%',
                        background: 'var(--color-rust)',
                        borderRadius: 3,
                      }}
                    />
                  </div>
                  <span className="eyebrow" style={{ letterSpacing: '.1em' }}>
                    fit {Math.round(a.fit * 100)}%
                  </span>
                </div>

                {/* claims */}
                <div style={{ flex: 1, minWidth: 260, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-.2px' }}>{a.name}</span>
                    <span style={{ fontSize: 12, color: 'var(--color-mute-2)' }}>{a.domain}</span>
                    <Tag
                      text={`${entry.overnight.length} signal${entry.overnight.length === 1 ? '' : 's'}`}
                      tone="rust"
                    />
                    {entry.hasBlockedEvidence && <Tag text="blocked" tone="neutral" />}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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
                </div>

                {/* actions */}
                <div
                  style={{
                    flex: 'none',
                    width: 132,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    justifyContent: 'center',
                  }}
                >
                  {entry.hasBlockedEvidence ? (
                    <>
                      <button className="btn" disabled style={{ background: 'rgba(20,18,15,.06)', color: 'var(--color-mute-3)', padding: '10px 12px' }}>
                        Build campaign
                      </button>
                      <span style={{ fontSize: 10.5, lineHeight: 1.4, color: '#a32c2c', textWrap: 'pretty' }}>
                        Locked — a cited collector is unhealthy.
                      </span>
                      <Link
                        href={`/accounts/${a.targetId}`}
                        className="mono"
                        style={{ fontSize: 10.5, color: 'var(--color-mute-3)', textDecoration: 'underline' }}
                      >
                        why?
                      </Link>
                    </>
                  ) : (
                    <>
                      <Link
                        href={`/accounts/${a.targetId}`}
                        className="btn btn-primary"
                        style={{ padding: '10px 12px', textAlign: 'center' }}
                      >
                        Build campaign
                      </Link>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-quiet" style={{ flex: 1, fontSize: 11.5, padding: '7px 4px' }}>
                          Snooze
                        </button>
                        <button className="btn btn-quiet" style={{ flex: 1, fontSize: 11.5, padding: '7px 4px' }}>
                          Not a fit
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}

      {/* Anneal's second loop, reporting on itself. */}
      <div
        style={{
          marginTop: 26,
          padding: '16px 18px',
          background: 'rgba(47,107,79,.07)',
          border: '1px solid rgba(47,107,79,.2)',
          borderRadius: 10,
          display: 'flex',
          gap: 12,
          alignItems: 'flex-start',
        }}
      >
        <span
          className="mono"
          style={{
            fontSize: 10,
            letterSpacing: '.12em',
            textTransform: 'uppercase',
            color: '#2f6b4f',
            paddingTop: 2,
            flex: 'none',
          }}
        >
          anneal
        </span>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: '#3d4a42', textWrap: 'pretty' }}>
          {stats.attempts === 0 ? (
            <>
              No collector has drifted yet. Drift is measured per field against a rolling baseline, so
              a source that starts returning empty rows is caught even while it still answers 200.
            </>
          ) : (
            <>
              {stats.attempts} repair{stats.attempts === 1 ? '' : 's'} attempted,{' '}
              {stats.approved} confirmed in production
              {stats.ineffective > 0 && (
                <> and {stats.ineffective} approved but ineffective</>
              )}
              . A repair only counts once a production run agrees with its preview.{' '}
              <Link href="/heal">See the heal log</Link>.
            </>
          )}
        </p>
      </div>
    </Page>
  )
}

const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten']
const spell = (n: number) => WORDS[n] ?? String(n)
