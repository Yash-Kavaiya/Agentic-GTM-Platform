import { getCollectors, getMeta } from '../../../lib/data'
import { Page, PageHead, Tag } from '../../../components/ui'
import { buildCatalog, STATUS_LABEL, type Integration, type IntegrationStatus } from '../../../core/integrations'

/**
 * Integrations — what Bellwether reads from and writes to.
 *
 * Status is computed from real state: zones on the account, collectors on
 * disk, environment variables present. A row cannot claim a connection that
 * does not exist.
 */
export default function IntegrationsPage() {
  const collectors = getCollectors()
  const meta = getMeta()

  const catalog = buildCatalog({
    hasApiKey: Boolean(process.env.BRIGHTDATA_API_KEY),
    zones: [
      process.env.BRIGHTDATA_SERP_ZONE ?? '',
      process.env.BRIGHTDATA_BROWSER_ZONE ?? '',
      process.env.BRIGHTDATA_UNLOCKER_ZONE ?? '',
    ].filter(Boolean),
    collectorCount: collectors.length,
    verifiedSourceCount: meta.verifiedSourceCount,
    jobBoardCount: meta.jobBoardCount,
    webhookConfigured: Boolean(process.env.BELLWETHER_WEBHOOK_URL),
    slackConfigured: Boolean(process.env.BELLWETHER_SLACK_WEBHOOK_URL),
  })

  const groups: { vendor: Integration['vendor']; blurb: string }[] = [
    { vendor: 'Bright Data', blurb: 'The data plane. Each product is a separate capability with its own setup.' },
    { vendor: 'Direct', blurb: 'Sources that already publish structured data. A scraper in front of these would add cost and a failure mode in exchange for nothing.' },
    { vendor: 'Destination', blurb: 'Where an approved campaign goes.' },
  ]

  const connected = catalog.filter((i) => i.status === 'connected').length

  return (
    <Page max={1080}>
      <PageHead
        eyebrow={`Integrations · ${connected} of ${catalog.length} connected`}
        title="What you track, and where it goes."
        lede="Turn on a source and its signals become available to every template in Signal Studio. Status below is read from live account state, not declared."
      />

      {groups.map((g) => {
        const items = catalog.filter((i) => i.vendor === g.vendor)
        if (items.length === 0) return null
        return (
          <section key={g.vendor} style={{ marginBottom: 26 }}>
            <div style={{ marginBottom: 10 }}>
              <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{g.vendor}</h2>
              <p style={{ margin: '3px 0 0', fontSize: 12, lineHeight: 1.5, color: 'var(--color-mute-2)', maxWidth: 620, textWrap: 'pretty' }}>
                {g.blurb}
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {items.map((i) => <Row key={i.id} item={i} />)}
            </div>
          </section>
        )
      })}
    </Page>
  )
}

const TONE: Record<IntegrationStatus, { fg: string; bg: string }> = {
  connected:     { fg: '#2f8259', bg: 'rgba(47,130,89,.11)' },
  available:     { fg: '#8f5f10', bg: 'rgba(143,95,16,.11)' },
  'needs-setup': { fg: '#901f1f', bg: 'rgba(144,31,31,.09)' },
  'not-shipped': { fg: '#8b8478', bg: 'rgba(20,18,15,.06)' },
}

function Row({ item }: { item: Integration }) {
  const tone = TONE[item.status]
  return (
    <article className="card card-hover" style={{ padding: '16px 18px', display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 280, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14.5, fontWeight: 600 }}>{item.name}</span>
          {item.scraperType && <Tag text={item.scraperType} tone="rust" />}
          <span className="mono" style={{ fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase', padding: '3px 7px', borderRadius: 4, color: tone.fg, background: tone.bg }}>
            {STATUS_LABEL[item.status]}
          </span>
        </div>
        <span style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--color-ink-2)', textWrap: 'pretty' }}>{item.purpose}</span>
        <span style={{ fontSize: 12, lineHeight: 1.55, color: 'var(--color-mute-2)', textWrap: 'pretty' }}>{item.usage}</span>
        {item.detail && (
          <span className="mono" style={{ fontSize: 10.5, color: 'var(--color-mute-3)' }}>{item.detail}</span>
        )}
      </div>
      <div style={{ flex: 'none' }}>
        {item.status === 'needs-setup' && item.docs
          ? <a href={item.docs} target="_blank" rel="noopener noreferrer" className="btn btn-quiet">Set up →</a>
          : item.status === 'connected'
            ? <button className="btn btn-quiet">Configure</button>
            : item.status === 'available'
              ? <button className="btn btn-primary">Enable</button>
              : null}
      </div>
    </article>
  )
}
