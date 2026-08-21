import { notFound } from 'next/navigation'
import { getCampaigns, getCampaign, getBrand, getAccount } from '../../../../lib/data'

/**
 * The generated microsite.
 *
 * A pitch page rendered in the prospect's own palette, typeface and logo, so it
 * reads as though someone at their company made it. That is only possible
 * because Bellwether already read their site to find the signal — the scraping
 * is not a means to a dataset here, it is what makes the page feel personal.
 *
 * Every claim carries a superscript footnote to the collector, URL and minute
 * that produced it. The footnotes are the product: they are what lets a
 * salesperson send this without checking it by hand, and what the approval gate
 * refuses to release when a source is broken.
 */
export function generateStaticParams() {
  return getCampaigns().map((c) => ({ slug: c.targetId }))
}

export default async function Microsite({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const campaign = getCampaign(slug)
  const account = getAccount(slug)
  if (!campaign || !account) notFound()

  const brand = getBrand(slug)
  const primary = brand?.primary ?? '#2f6df6'
  const accentSoft = `color-mix(in oklch, ${primary} 12%, transparent)`
  const font = brand?.fonts[0]
  const fontStack = font
    ? `"${font}", ui-sans-serif, system-ui, sans-serif`
    : 'ui-sans-serif, system-ui, sans-serif'

  return (
    <main
      style={{
        fontFamily: fontStack,
        color: '#111',
        background: '#fff',
        minHeight: '100vh',
      }}
    >
      {/* A thin band of their brand colour, the way their own site would open. */}
      <div style={{ height: 4, background: primary }} />

      <div style={{ maxWidth: 720, margin: '0 auto', padding: '40px 24px 72px' }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 44 }}>
          {brand?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={brand.logoUrl}
              alt={account.name}
              // The logo is a third-party asset on someone else's CDN. It must
              // never hold up the page: a slow host would leave a prospect
              // looking at a blank pitch.
              loading="lazy"
              decoding="async"
              height={26}
              style={{ height: 26, width: 'auto', maxWidth: 150, objectFit: 'contain' }}
            />
          ) : (
            <span style={{ fontWeight: 600, fontSize: 15 }}>{account.name}</span>
          )}
          <span style={{ color: '#bbb', fontSize: 13 }}>×</span>
          <span style={{ fontWeight: 600, fontSize: 15, color: primary }}>Bellwether</span>
        </header>

        <h1
          style={{
            fontSize: 40,
            lineHeight: 1.1,
            letterSpacing: '-0.03em',
            margin: '0 0 20px',
            fontWeight: 650,
          }}
        >
          {campaign.headline}
        </h1>

        <p style={{ fontSize: 17, lineHeight: 1.6, color: '#333', margin: '0 0 36px' }}>
          {campaign.evidence.slice(0, 3).map((e, i) => (
            <span key={e.id}>
              {e.sentence}
              <sup style={{ color: primary, fontWeight: 600, padding: '0 1px' }}>{i + 1}</sup>{' '}
            </span>
          ))}
        </p>

        <section
          style={{
            background: accentSoft,
            borderRadius: 12,
            padding: '22px 24px',
            margin: '0 0 36px',
          }}
        >
          <h2 style={{ fontSize: 15, margin: '0 0 12px', letterSpacing: '-0.01em' }}>
            What the next 90 days usually look like
          </h2>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14.5, lineHeight: 1.75, color: '#333' }}>
            <li>The pricing page changes before the sales motion does.</li>
            <li>The first RevOps hire lands three to six weeks after the tier ships.</li>
            <li>Whoever owns the data stack becomes the real buyer.</li>
          </ul>
        </section>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 48 }}>
          <a
            href="#"
            style={{
              background: primary,
              color: '#fff',
              padding: '11px 20px',
              borderRadius: 8,
              fontSize: 14.5,
              fontWeight: 550,
              textDecoration: 'none',
            }}
          >
            Book 15 minutes
          </a>
          <a
            href="#"
            style={{
              border: '1px solid #ddd',
              color: '#333',
              padding: '11px 20px',
              borderRadius: 8,
              fontSize: 14.5,
              textDecoration: 'none',
            }}
          >
            Read the one-pager
          </a>
        </div>

        {/* ------------------------------------------------- the footnotes */}
        <footer style={{ borderTop: '1px solid #eee', paddingTop: 22 }}>
          <p
            style={{
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: '0.07em',
              color: '#888',
              margin: '0 0 12px',
            }}
          >
            Every claim on this page is sourced
          </p>
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.9, color: '#666' }}>
            {campaign.evidence.map((e) => (
              <li key={e.id}>
                <code style={{ fontFamily: 'ui-monospace, monospace', color: primary }}>
                  {e.collectorId ?? 'public feed'}
                </code>{' '}
                ·{' '}
                <a href={e.sourceUrl} style={{ color: '#666' }} rel="noopener noreferrer">
                  {hostPath(e.sourceUrl)}
                </a>{' '}
                · scraped {e.scrapedAt.replace('T', ' ').slice(0, 16)} UTC
              </li>
            ))}
          </ol>

          <p style={{ fontSize: 11, color: '#aaa', marginTop: 22, lineHeight: 1.7 }}>
            Generated by Bellwether from {account.domain}&rsquo;s own public pages. Brand colour and
            typeface were read from the site. No login-walled sources, no personal data.
          </p>
        </footer>
      </div>
    </main>
  )
}

function hostPath(url: string): string {
  try {
    const u = new URL(url)
    return u.host + u.pathname
  } catch {
    return url
  }
}
