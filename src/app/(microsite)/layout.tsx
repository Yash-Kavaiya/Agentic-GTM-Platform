import type { Metadata } from 'next'
import '../globals.css'

/**
 * Bare layout for generated microsites.
 *
 * A microsite is rendered in the prospect's own colours and typeface so it
 * reads as though someone at their company built it. Bellwether's navigation
 * would break that entirely, so this root layout carries none of it.
 */
export const metadata: Metadata = {
  title: 'A note for you',
  robots: { index: false, follow: false },
}

export default function MicrositeLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  )
}
