'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { CollectorView, Meta } from '../lib/data'

/**
 * The rail.
 *
 * Numbered navigation, and beneath it one bar per collector coloured by
 * health. That strip is the most important thing in the sidebar: it answers
 * "can I trust what I am reading" without the user going to look for it.
 */

const NAV = [
  { num: '01', href: '/', label: 'Morning Brief' },
  { num: '02', href: '/studio', label: 'Signal Studio' },
  { num: '03', href: '/accounts', label: 'Accounts' },
  { num: '04', href: '/heal', label: 'Heal Log' },
  { num: '05', href: '/dashboard', label: 'Dashboard' },
] as const

const HEALTH_COLOR: Record<string, string> = {
  HEALTHY: '#2f6b4f',
  HEALED: '#2f6b4f',
  DEGRADED: '#c2872a',
  HEALING: '#b8442a',
  VERIFYING: '#b8442a',
  QUARANTINED: '#a32c2c',
  UNKNOWN: 'rgba(244,241,236,.22)',
}

export function Sidebar({
  collectors,
  meta,
  badges = {},
}: {
  collectors: CollectorView[]
  meta: Meta
  badges?: Record<string, string | number>
}) {
  const pathname = usePathname()
  const healthy = collectors.filter((c) => c.state === 'HEALTHY' || c.state === 'HEALED').length

  return (
    <aside
      style={{
        width: 236,
        flex: 'none',
        background: 'var(--color-ink)',
        color: 'var(--on-dark)',
        display: 'flex',
        flexDirection: 'column',
        padding: '22px 0 14px',
        position: 'sticky',
        top: 0,
        height: '100vh',
      }}
    >
      <Link href="/" style={{ padding: '0 20px 22px', display: 'flex', flexDirection: 'column', gap: 3, color: 'inherit' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span
            style={{
              width: 9,
              height: 9,
              background: 'var(--color-rust)',
              borderRadius: '50%',
              boxShadow: '0 0 0 4px rgba(184,68,42,.22)',
              flex: 'none',
            }}
          />
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 23, letterSpacing: '.2px' }}>
            Bellwether
          </span>
        </span>
        <span
          className="mono"
          style={{
            fontSize: 9.5,
            letterSpacing: '.14em',
            textTransform: 'uppercase',
            color: 'var(--on-dark-dim)',
            paddingLeft: 18,
          }}
        >
          agentic gtm signals
        </span>
      </Link>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: '0 8px' }}>
        {NAV.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 12px',
                borderRadius: 7,
                fontSize: 13,
                color: active ? 'var(--on-dark)' : 'rgba(244,241,236,.62)',
                background: active ? 'rgba(244,241,236,.09)' : 'transparent',
              }}
            >
              <span className="mono" style={{ fontSize: 9.5, opacity: 0.5, width: 14 }}>
                {item.num}
              </span>
              <span style={{ flex: 1 }}>{item.label}</span>
              {badges[item.href] !== undefined && (
                <span
                  className="mono"
                  style={{
                    fontSize: 10,
                    padding: '2px 6px',
                    borderRadius: 20,
                    background: 'var(--color-rust)',
                    color: '#fff',
                  }}
                >
                  {badges[item.href]}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      <div
        style={{
          marginTop: 'auto',
          padding: '16px 20px 0',
          borderTop: '1px solid var(--on-dark-faint)',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span
            className="mono"
            style={{ fontSize: 9.5, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--on-dark-dim)' }}
          >
            collectors
          </span>
          <span className="mono tnum" style={{ fontSize: 11, color: 'var(--on-dark)' }}>
            {collectors.length === 0 ? '—' : `${healthy}/${collectors.length}`}
          </span>
        </div>

        {/* One bar per collector, coloured by state. */}
        <div style={{ display: 'flex', gap: 3 }}>
          {collectors.length === 0 ? (
            <span style={{ fontSize: 10.5, color: 'var(--on-dark-dim)' }}>none provisioned</span>
          ) : (
            collectors.map((c) => (
              <span
                key={c.collectorId}
                title={`${c.key} · ${c.state}`}
                style={{
                  flex: 1,
                  height: 22,
                  borderRadius: 2,
                  background: HEALTH_COLOR[c.state] ?? HEALTH_COLOR.UNKNOWN,
                  opacity: c.state === 'HEALTHY' || c.state === 'HEALED' ? 1 : 0.85,
                }}
              />
            ))
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 4 }}>
          <span
            style={{
              width: 26,
              height: 26,
              borderRadius: '50%',
              background: 'var(--color-ink-4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              fontWeight: 600,
              color: '#e8e2d7',
              flex: 'none',
            }}
          >
            BW
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25, minWidth: 0 }}>
            <span style={{ fontSize: 11.5 }}>{meta.icp.name.split(' ').slice(0, 3).join(' ')}</span>
            <span style={{ fontSize: 10, color: 'var(--on-dark-dim)' }}>
              {meta.targetCount} accounts watched
            </span>
          </span>
        </div>
      </div>
    </aside>
  )
}
