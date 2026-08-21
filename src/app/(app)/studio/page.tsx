import { getSignals } from '../../../lib/data'
import { Page, PageHead, Pill, Tag, WatchString } from '../../../components/ui'
import { SignalBuilder } from '../../../components/SignalBuilder'

/**
 * Signal Studio.
 *
 * Twelve templates ship as data, not code. A GTM user picks one or writes their
 * own in plain English, and that sentence becomes the collector.
 */
export default function StudioPage() {
  const signals = getSignals()
  const live = signals.filter((s) => s.collector).length

  return (
    <Page max={1180}>
      <PageHead
        eyebrow="Signal Studio"
        title="Describe a buying signal in plain English."
        lede="That one sentence becomes the collector spec, the healing instruction, and the evidence line quoted in your campaign. Write it once."
      />

      <div style={{ display: 'flex', gap: 22, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 380 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, letterSpacing: '.02em' }}>Templates</h2>
            <span className="mono" style={{ fontSize: 10.5, color: 'var(--color-mute-3)' }}>
              {signals.length} · {live} provisioned
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(230px,1fr))', gap: 10 }}>
            {signals.map((s) => (
              <article
                key={s.id}
                className="card card-hover"
                style={{ padding: '14px 15px', display: 'flex', flexDirection: 'column', gap: 8 }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{s.name}</span>
                  {s.collector ? <Pill state="HEALTHY" /> : <Tag text="not live" />}
                </div>

                <WatchString watch={s.watch} />

                <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, paddingTop: 4 }}>
                  <span style={{ fontSize: 11.5, color: 'var(--color-mute-2)' }}>
                    {s.coverage} verified source{s.coverage === 1 ? '' : 's'}
                  </span>
                  <span className="mono" style={{ fontSize: 9.5, color: 'var(--color-mute-4)' }}>
                    {s.adapter} · {s.cadence}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </div>

        <SignalBuilder />
      </div>
    </Page>
  )
}
