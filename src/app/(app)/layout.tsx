import type { Metadata } from 'next'
import Link from 'next/link'
import '../globals.css'
import { getMeta } from '../../lib/data'

export const metadata: Metadata = {
  title: 'Bellwether — GTM signal platform',
  description:
    'Describe a buying signal in plain English and wake up to the companies that just showed it, with the campaign already drafted.',
}

const NAV = [
  { href: '/', label: 'Brief' },
  { href: '/studio', label: 'Signal Studio' },
  { href: '/accounts', label: 'Accounts' },
  { href: '/dashboard', label: 'Dashboard' },
]

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const meta = getMeta()

  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="sticky top-0 z-20 border-b hairline backdrop-blur-md" style={{ background: 'color-mix(in oklch, var(--bg) 85%, transparent)' }}>
          <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
            <Link href="/" className="flex items-center gap-2.5 shrink-0">
              <Bell />
              <span className="text-[15px] font-semibold tracking-tight">Bellwether</span>
            </Link>

            <nav className="flex items-center gap-1 text-sm">
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className="rounded-md px-2.5 py-1.5 transition-colors hover:bg-[var(--surface-2)]"
                  style={{ color: 'var(--text-dim)' }}
                >
                  {n.label}
                </Link>
              ))}
            </nav>

            <div className="ml-auto hidden items-center gap-4 text-xs sm:flex" style={{ color: 'var(--text-dim)' }}>
              <span className="mono">{meta.signalCount} signals</span>
              <span className="mono">{meta.targetCount} accounts</span>
              <span className="mono">{meta.verifiedSourceCount} verified sources</span>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>

        <footer className="mx-auto max-w-6xl px-6 pb-10 pt-4 text-xs" style={{ color: 'var(--text-dim)' }}>
          <p>
            Public web sources only, by design. The connector interface accepts any source; Bellwether
            ships no adapter for login-walled sites or personal data.
          </p>
        </footer>
      </body>
    </html>
  )
}

/** The bell the lead sheep wears. */
function Bell() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3a5.5 5.5 0 0 0-5.5 5.5c0 3.6-1 5.2-1.8 6.1-.4.5-.1 1.4.6 1.4h13.4c.7 0 1-.9.6-1.4-.8-.9-1.8-2.5-1.8-6.1A5.5 5.5 0 0 0 12 3Z"
        stroke="var(--accent)"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M10 19a2 2 0 0 0 4 0" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
