import type { Metadata } from 'next'

/**
 * Bare layout for the drift fixture.
 *
 * Deliberately carries none of Bellwether's chrome or stylesheet. A collector
 * pointed at a fixture page must see an ordinary marketing page and nothing
 * else — if the app's own navigation appeared in the markup, the extraction
 * would be measuring the wrong thing.
 */
export const metadata: Metadata = {
  title: 'Pricing',
  robots: { index: false, follow: false },
}

export default function FixtureLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#fff', color: '#111' }}>{children}</body>
    </html>
  )
}
