import { getHeals, getCollectors } from '../../../lib/data'
import { Page, Figure, Empty, Pill } from '../../../components/ui'
import type { HealEvent, ObservationStats } from '../../../core/types'

/**
 * The Heal Log.
 *
 * Annealing is repeated heat-and-cool cycling that drives defects out of a
 * material. A collector goes through the same thing, and this page is the
 * record: what broke, what was said to Bright Data about it, what came back,
 * and whether production ever agreed.
 *
 * The last part is the one that matters. A repair that passes its preview and
 * is approved has not been proven — only proposed. Nothing here is counted as
 * healed until a production run says so.
 */

/** The path a collector walks. The design draws it as dots and connectors. */
const TRACK = ['HEALTHY', 'DEGRADED', 'HEALING', 'VERIFYING', 'HEALED', 'HEALTHY'] as const

export default function HealPage() {
  const { heals, stats } = getHeals()
  const collectors = getCollectors()
  const quarantined = collectors.filter((c) => c.state === 'QUARANTINED')

  return (
    <Page max={1060}>
      <header
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 24,
          marginBottom: 24,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <span className="eyebrow" style={{ fontSize: 10, letterSpacing: '.16em' }}>
            Anneal · heal log
          </span>
          <h1 className="display" style={{ margin: 0, fontSize: 40 }}>
            Heat, cool, and the defect is gone.
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 22, flex: 'none' }}>
          <Figure
            value={stats.attempts === 0 ? '—' : `${stats.approved}/${stats.attempts}`}
            sub="confirmed"
          />
          <Figure value={stats.medianMs ? `${(stats.medianMs / 1000).toFixed(0)}s` : '—'} sub="median" />
          <Figure value={stats.rowsRecovered || '—'} sub="rows recovered" />
        </div>
      </header>

      {stats.ineffective > 0 && (
        <div
          style={{
            marginBottom: 14,
            padding: '14px 16px',
            background: 'rgba(163,44,44,.06)',
            border: '1px solid rgba(163,44,44,.22)',
            borderRadius: 10,
            display: 'flex',
            gap: 12,
            alignItems: 'flex-start',
          }}
        >
          <span
            className="mono"
            style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: '#a32c2c', paddingTop: 2, flex: 'none' }}
          >
            note
          </span>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: '#5a3a34', textWrap: 'pretty' }}>
            {stats.ineffective} repair{stats.ineffective === 1 ? '' : 's'} passed the field contract
            in preview, were approved, and left the next production run returning the same broken
            output. They are recorded as <span className="mono">approved_ineffective</span> and their
            collectors are quarantined — a preview is a promise, not a result.
          </p>
        </div>
      )}

      {heals.length === 0 ? (
        <Empty
          title="No repairs yet."
          hint={
            <>
              A heal is recorded when a collector drifts — its fields go null or its row count
              collapses — and Bellwether repairs it. Nothing has drifted yet.
            </>
          }
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {heals.map((h) => (
            <HealCard key={h.id} heal={h} />
          ))}
        </div>
      )}

      {quarantined.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <h2 style={{ margin: '0 0 10px', fontSize: 13.5, fontWeight: 600 }}>Quarantined sources</h2>
          <div className="card" style={{ overflow: 'hidden' }}>
            {quarantined.map((c, i) => (
              <div
                key={c.collectorId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 18px',
                  borderTop: i === 0 ? 'none' : '1px solid var(--line)',
                  flexWrap: 'wrap',
                }}
              >
                <span className="mono" style={{ fontSize: 11.5, width: 210, flex: 'none' }}>
                  {c.key}
                </span>
                <span className="mono" style={{ flex: 1, minWidth: 180, fontSize: 10.5, color: 'var(--color-mute-3)' }}>
                  {c.collectorId} · {c.seedUrl}
                </span>
                <Pill state={c.state} />
              </div>
            ))}
          </div>
          <p style={{ margin: '10px 0 0', fontSize: 12, lineHeight: 1.5, color: 'var(--color-mute-2)', textWrap: 'pretty' }}>
            A quarantined collector blocks campaign approval for every account that cites it. It
            leaves quarantine only when a production run passes the signal&rsquo;s own field contract.
          </p>
        </section>
      )}
    </Page>
  )
}

function HealCard({ heal }: { heal: HealEvent }) {
  const confirmed = heal.verdict === 'approved'
  const ineffective = heal.verdict === 'approved_ineffective'

  // Where the collector actually stopped.
  const reachedIndex = ineffective
    ? TRACK.indexOf('HEALED')
    : confirmed
      ? TRACK.length - 1
      : TRACK.indexOf(heal.toState as (typeof TRACK)[number]) >= 0
        ? TRACK.indexOf(heal.toState as (typeof TRACK)[number])
        : TRACK.indexOf('HEALING')

  const endColor = confirmed ? '#2f6b4f' : ineffective ? '#a32c2c' : '#c2872a'

  return (
    <article style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* The dark timeline block — the state machine, drawn. */}
      <div
        style={{
          background: 'var(--color-ink)',
          borderRadius: 12,
          padding: '20px 22px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <span
            className="mono"
            style={{ fontSize: 10, letterSpacing: '.13em', textTransform: 'uppercase', color: 'var(--on-dark-dim)' }}
          >
            {heal.collectorId} · {heal.signalId} · {heal.targetId}
          </span>
          <span className="mono tnum" style={{ fontSize: 11, color: 'var(--on-dark)' }}>
            {heal.durationMs !== null ? `${(heal.durationMs / 1000).toFixed(1)}s` : '—'}
            {heal.rowsRecovered ? ` · +${heal.rowsRecovered} rows` : ''}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center' }}>
          {TRACK.map((state, i) => {
            const reached = i <= reachedIndex
            const isEnd = i === reachedIndex
            return (
              <div key={`${state}-${i}`} style={{ display: 'flex', alignItems: 'center', flex: i === TRACK.length - 1 ? 'none' : 1 }}>
                <span
                  style={{
                    width: isEnd ? 11 : 8,
                    height: isEnd ? 11 : 8,
                    borderRadius: '50%',
                    flex: 'none',
                    background: reached ? (isEnd ? endColor : 'var(--color-paper)') : 'rgba(244,241,236,.2)',
                    boxShadow: isEnd ? `0 0 0 4px ${endColor}33` : undefined,
                  }}
                />
                {i < TRACK.length - 1 && (
                  <span
                    style={{
                      flex: 1,
                      height: 1.5,
                      background: i < reachedIndex ? 'rgba(244,241,236,.55)' : 'rgba(244,241,236,.15)',
                    }}
                  />
                )}
              </div>
            )
          })}
        </div>

        <div style={{ display: 'flex' }}>
          {TRACK.map((state, i) => (
            <span
              key={`${state}-label-${i}`}
              className="mono"
              style={{
                flex: i === TRACK.length - 1 ? 'none' : 1,
                fontSize: 9,
                letterSpacing: '.08em',
                textTransform: 'uppercase',
                color: i === reachedIndex ? endColor : i < reachedIndex ? 'var(--on-dark-dim)' : 'rgba(244,241,236,.2)',
              }}
            >
              {i === TRACK.length - 1 && !confirmed ? '' : state.toLowerCase()}
            </span>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 12 }}>
        {/* Before / after, per field. */}
        <div className="card" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 11 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0, fontSize: 13.5, fontWeight: 600 }}>Extraction diff</h2>
            <span className="mono" style={{ fontSize: 10, color: 'var(--color-mute-3)' }}>
              before → after
            </span>
          </div>
          <div
            className="mono"
            style={{
              fontSize: 11.5,
              lineHeight: 1.75,
              background: 'var(--color-paper-3)',
              border: '1px solid rgba(20,18,15,.08)',
              borderRadius: 8,
              padding: '13px 14px',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <DiffLine label="rows" before={heal.before?.rowCount} after={heal.after?.rowCount} />
            {(heal.before?.fields ?? []).map((f) => {
              const a = heal.after?.fields.find((x) => x.field === f.field)
              return (
                <DiffLine
                  key={f.field}
                  label={f.field}
                  before={`${Math.round(f.nullRate * 100)}% null`}
                  after={a ? `${Math.round(a.nullRate * 100)}% null` : undefined}
                  bad={f.nullRate >= 0.5}
                  good={a ? a.nullRate < 0.5 : false}
                />
              )
            })}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* The user's own words, doing the repair. */}
          <div className="card" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 11 }}>
            <h2 style={{ margin: 0, fontSize: 13.5, fontWeight: 600 }}>Symptom composed for healing</h2>
            <div
              style={{
                background: 'var(--color-paper-3)',
                border: '1px solid rgba(20,18,15,.08)',
                borderRadius: 8,
                padding: '13px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <span className="eyebrow" style={{ letterSpacing: '.1em' }}>
                the user&rsquo;s original words
              </span>
              <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--color-ink-2)', textWrap: 'pretty' }}>
                &ldquo;{watchOf(heal.symptom)}&rdquo;
              </span>
              <span className="eyebrow" style={{ letterSpacing: '.1em', paddingTop: 4 }}>
                + observed failure
              </span>
              <span className="mono" style={{ fontSize: 11.5, lineHeight: 1.6, color: '#a32c2c', textWrap: 'pretty' }}>
                {failureOf(heal.symptom)}
              </span>
            </div>
          </div>

          <div className="card" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: 13.5, fontWeight: 600 }}>Outcome</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Pill state={confirmed ? 'HEALED' : 'QUARANTINED'} />
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--color-mute-3)' }}>
                attempt {heal.attempt} · verdict {heal.verdict ?? 'pending'}
              </span>
            </div>
            <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, color: 'var(--color-mute-2)', textWrap: 'pretty' }}>
              {confirmed
                ? 'The preview met the field contract, the fix was approved, and a production run afterwards confirmed it.'
                : ineffective
                  ? 'The preview met the field contract and the fix was approved — then a production run returned the same broken output. Recorded as ineffective and quarantined.'
                  : (heal.error ?? 'The proposed fix did not restore the data, so it was rejected rather than left pending.')}
            </p>
          </div>
        </div>
      </div>
    </article>
  )
}

function DiffLine({
  label,
  before,
  after,
  bad,
  good,
}: {
  label: string
  before?: string | number
  after?: string | number
  bad?: boolean
  good?: boolean
}) {
  return (
    <span style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
      <span style={{ flex: 1, minWidth: 0, color: 'var(--color-mute-3)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {label}
      </span>
      <span className="tnum" style={{ width: 78, textAlign: 'right', color: bad ? '#a32c2c' : 'var(--color-mute)' }}>
        {before ?? '—'}
      </span>
      <span style={{ color: 'var(--color-mute-4)' }}>→</span>
      <span className="tnum" style={{ width: 78, textAlign: 'right', color: good ? '#2f6b4f' : 'var(--color-ink)' }}>
        {after ?? '—'}
      </span>
    </span>
  )
}

/**
 * The symptom is `<watch>. Observed failure: <detail>.` — split it back apart so
 * the page can show that the repair instruction opens with the user's own
 * sentence rather than a machine-generated one.
 */
function watchOf(symptom: string): string {
  const i = symptom.indexOf('. Observed failure:')
  return (i > 0 ? symptom.slice(0, i) : symptom).trim()
}

function failureOf(symptom: string): string {
  const marker = '. Observed failure:'
  const i = symptom.indexOf(marker)
  return i > 0 ? symptom.slice(i + marker.length).trim() : '—'
}
