import type { Metadata } from 'next'
import '../globals.css'
import { Sidebar } from '../../components/Sidebar'
import { getCollectors, getMeta } from '../../lib/data'

export const metadata: Metadata = {
  title: 'Bellwether — agentic GTM signals',
  description:
    'Describe a buying signal in plain English and wake up to the companies that just showed it, with the campaign already drafted.',
}

/**
 * App shell.
 *
 * A fixed dark rail against warm paper. The rail carries navigation and, at
 * its foot, live collector health — because the trustworthiness of everything
 * on the right depends on it, and burying that in a dashboard is how a broken
 * source goes unnoticed.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const collectors = getCollectors()
  const meta = getMeta()

  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--color-paper)' }}>
          <Sidebar collectors={collectors} meta={meta} />
          <main style={{ flex: 1, minWidth: 0 }}>{children}</main>
        </div>
      </body>
    </html>
  )
}
