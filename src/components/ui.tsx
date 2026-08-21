import type { HealthState } from '../core/types'

/**
 * Shared display pieces, in the Bellwether design language.
 *
 * Two rules carry the interface:
 *
 *   Evidence is never shown without its source. A claim carries the collector,
 *   the URL and the minute it came from — that is the product, not a debugging
 *   affordance.
 *
 *   Collector health appears wherever a claim appears, so nobody has to visit a
 *   dashboard to find out whether what they are reading can be trusted.
 */

const HEALTH: Record<string, { fg: string; bg: string; label: string }> = {
  HEALTHY: { fg: '#2f6b4f', bg: 'rgba(47,107,79,.1)', label: 'healthy' },
  HEALED: { fg: '#2f6b4f', bg: 'rgba(47,107,79,.1)', label: 'healed' },
  DEGRADED: { fg: '#8a5d16', bg: 'rgba(194,135,42,.14)', label: 'degraded' },
  HEALING: { fg: '#b8442a', bg: 'rgba(184,68,42,.11)', label: 'healing' },
  VERIFYING: { fg: '#b8442a', bg: 'rgba(184,68,42,.11)', label: 'verifying' },
  QUARANTINED: { fg: '#a32c2c', bg: 'rgba(163,44,44,.1)', label: 'quarantined' },
  UNKNOWN: { fg: '#8b8478', bg: 'rgba(20,18,15,.06)', label: 'unknown' },
}

export function Pill({ state }: { state: HealthState | 'UNKNOWN' }) {
  const s = HEALTH[state] ?? HEALTH.UNKNOWN!
  const busy = state === 'HEALING' || state === 'VERIFYING'
  return (
    <span
      className="mono"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: 10,
        letterSpacing: '.06em',
        textTransform: 'uppercase',
        padding: '3px 7px',
        borderRadius: 4,
        color: s.fg,
        background: s.bg,
        whiteSpace: 'nowrap',
      }}
    >
      <span
        className={busy ? 'pulsing' : undefined}
        style={{ width: 5, height: 5, borderRadius: '50%', background: s.fg, flex: 'none' }}
      />
      {s.label}
    </span>
  )
}

export function Tag({ text, tone = 'neutral' }: { text: string; tone?: 'neutral' | 'rust' | 'green' }) {
  const tones = {
    neutral: { fg: '#6f6a60', bg: 'rgba(20,18,15,.06)' },
    rust: { fg: '#b8442a', bg: 'rgba(184,68,42,.1)' },
    green: { fg: '#2f6b4f', bg: 'rgba(47,107,79,.1)' },
  }[tone]
  return (
    <span
      className="mono"
      style={{
        fontSize: 10,
        letterSpacing: '.06em',
        textTransform: 'uppercase',
        padding: '3px 7px',
        borderRadius: 4,
        color: tones.fg,
        background: tones.bg,
        whiteSpace: 'nowrap',
      }}
    >
      {text}
    </span>
  )
}

/** The big serif number the design uses for every headline figure. */
export function Figure({ value, sub }: { value: React.ReactNode; sub?: string }) {
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span className="display tnum" style={{ fontSize: 28 }}>
        {value}
      </span>
      {sub && (
        <span className="eyebrow" style={{ letterSpacing: '.1em' }}>
          {sub}
        </span>
      )}
    </span>
  )
}

export function Stat({
  label,
  value,
  sub,
  subTone,
}: {
  label: string
  value: React.ReactNode
  sub?: string
  subTone?: 'green' | 'rust' | 'mute'
}) {
  const color =
    subTone === 'green' ? '#2f6b4f' : subTone === 'rust' ? '#b8442a' : 'var(--color-mute-2)'
  return (
    <div
      className="card"
      style={{ flex: 1, minWidth: 168, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 5 }}
    >
      <span className="eyebrow">{label}</span>
      <span className="display tnum" style={{ fontSize: 30 }}>
        {value}
      </span>
      {sub && <span style={{ fontSize: 11, color }}>{sub}</span>}
    </div>
  )
}

export interface EvidenceProps {
  sentence: string
  signalName: string
  collectorId: string | null
  sourceUrl: string
  scrapedAt: string
  blocked?: boolean
}

export function Evidence({ sentence, signalName, collectorId, sourceUrl, scrapedAt, blocked }: EvidenceProps) {
  let host = sourceUrl
  try {
    const u = new URL(sourceUrl)
    host = u.host + (u.pathname === '/' ? '' : u.pathname)
  } catch {}

  return (
    <div className={`evidence${blocked ? ' evidence-blocked' : ''}`} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--color-ink-2)', textWrap: 'pretty' }}>
        {sentence}
      </span>
      <span className="mono" style={{ fontSize: 10.5, color: 'var(--color-mute-3)' }}>
        {signalName} · {collectorId ?? 'public feed'} ·{' '}
        <a href={sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline', textDecorationStyle: 'dotted' }}>
          {host}
        </a>{' '}
        · {scrapedAt.replace('T', ' ').slice(0, 16)} UTC
      </span>
    </div>
  )
}

export function Empty({ title, hint }: { title: string; hint?: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: '44px 32px', textAlign: 'center' }}>
      <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{title}</p>
      {hint && (
        <p
          style={{
            margin: '8px auto 0',
            maxWidth: 460,
            fontSize: 12.5,
            lineHeight: 1.6,
            color: 'var(--color-mute-2)',
            textWrap: 'pretty',
          }}
        >
          {hint}
        </p>
      )}
    </div>
  )
}

/** Page masthead: mono eyebrow over an editorial serif headline. */
export function PageHead({
  eyebrow,
  title,
  lede,
  right,
}: {
  eyebrow: string
  title: React.ReactNode
  lede?: React.ReactNode
  right?: React.ReactNode
}) {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: 24,
        marginBottom: 26,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0 }}>
        <span className="eyebrow" style={{ fontSize: 10, letterSpacing: '.16em' }}>
          {eyebrow}
        </span>
        <h1 className="display" style={{ margin: 0, fontSize: 42 }}>
          {title}
        </h1>
        {lede && (
          <p
            style={{
              margin: '4px 0 0',
              fontSize: 14,
              lineHeight: 1.55,
              color: 'var(--color-mute)',
              maxWidth: 540,
              textWrap: 'pretty',
            }}
          >
            {lede}
          </p>
        )}
      </div>
      {right && <div style={{ flex: 'none', display: 'flex', gap: 8 }}>{right}</div>}
    </header>
  )
}

/** Standard page padding from the design. */
export function Page({ children, max = 1080 }: { children: React.ReactNode; max?: number }) {
  return <div style={{ padding: '44px 52px 60px', maxWidth: max }}>{children}</div>
}

/** The plain-language string, presented as the first-class object it is. */
export function WatchString({ watch }: { watch: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="mono" style={{ fontSize: 10.5, color: 'var(--color-rust)', lineHeight: 1.5 }}>
        {watch.trim()}
      </span>
    </div>
  )
}
