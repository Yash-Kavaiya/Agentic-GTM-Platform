/**
 * Charts.
 *
 * Inline SVG, no dependency, server-rendered from the committed export.
 *
 * COLOUR IS VALIDATED, NOT CHOSEN BY EYE. Every palette below was run through
 * the six checks against the paper surface (#f4f1ec):
 *
 *   ACCENT  #b8442a   single-series magnitude — all checks pass
 *   GOOD    #2f8259   diverging pole
 *   BAD     #901f1f   diverging pole — deutan ΔE 11.2, normal ΔE 25.8, >= 3:1
 *
 * The design's own #2f6b4f / #a32c2c did NOT pass: the green read as grey
 * (chroma 0.078, under the floor) and the red sat at ΔE 6.8 from the rust
 * accent in normal vision — two marks a full-colour reader could not tell
 * apart. These are the re-stepped values.
 *
 * Health is encoded as DIVERGING rather than categorical because the states are
 * ordered by severity (healthy → healing → degraded → quarantined). Ordered
 * data in a categorical palette is how a chart ends up implying that
 * "quarantined" and "healthy" are just two different things.
 *
 * Status is never colour alone: every status mark ships with a visible label
 * and a count.
 */

export const CHART = {
  accent: '#b8442a',
  good: '#2f8259',
  bad: '#901f1f',
  /** Diverging midpoint is neutral by rule — never a third hue. */
  mid: '#a8a196',
  grid: 'rgba(20,18,15,.10)',
  axis: '#a09889',
  ink: '#14120f',
} as const

/* ------------------------------------------------------------- columns */

export interface ColumnDatum {
  label: string
  value: number
}

/**
 * Change over time. One series, so no legend — the title names it.
 * Selective labels only: first, last, and the peak.
 */
export function Columns({
  data,
  height = 132,
  caption,
}: {
  data: ColumnDatum[]
  height?: number
  caption?: string
}) {
  if (data.length === 0) return <ChartEmpty note="No history yet." />

  const max = Math.max(...data.map((d) => d.value), 1)
  const peakIndex = data.reduce((best, d, i) => (d.value > data[best]!.value ? i : best), 0)

  return (
    <figure style={{ margin: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height }}>
        {data.map((d, i) => {
          const h = Math.max(d.value === 0 ? 1 : 3, (d.value / max) * height)
          const emphasise = i === peakIndex || i === data.length - 1
          return (
            <div
              key={`${d.label}-${i}`}
              title={`${d.label}: ${d.value}`}
              style={{
                flex: 1,
                minWidth: 3,
                height: h,
                /* 4px rounded data-end, anchored to the baseline. */
                borderRadius: '4px 4px 0 0',
                background: CHART.accent,
                opacity: emphasise ? 1 : 0.5,
              }}
            />
          )
        })}
      </div>
      <div
        className="mono"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 9.5,
          color: CHART.axis,
          paddingTop: 7,
        }}
      >
        <span>{data[0]?.label}</span>
        {caption && <span>{caption}</span>}
        <span>{data[data.length - 1]?.label}</span>
      </div>
    </figure>
  )
}

/* ------------------------------------------------------------ bar list */

export interface BarDatum {
  label: string
  value: number
  /** Optional right-hand annotation, e.g. a percentage. */
  note?: string
}

/** Ranked magnitude. Direct-labelled, so no axis and no legend. */
export function BarList({ data, max, unit = '' }: { data: BarDatum[]; max?: number; unit?: string }) {
  if (data.length === 0) return <ChartEmpty note="Nothing to rank yet." />
  const ceiling = max ?? Math.max(...data.map((d) => d.value), 1)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {data.map((d) => (
        <div key={d.label} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontSize: 12.5, color: 'var(--color-ink-3)', minWidth: 0 }}>{d.label}</span>
            <span className="mono tnum" style={{ fontSize: 11, color: 'var(--color-mute)', flex: 'none' }}>
              {d.value}
              {unit}
              {d.note ? ` · ${d.note}` : ''}
            </span>
          </div>
          <div
            title={`${d.label}: ${d.value}${unit}`}
            style={{ height: 6, background: 'rgba(20,18,15,.07)', borderRadius: 3, overflow: 'hidden' }}
          >
            <div
              style={{
                width: `${Math.max(1.5, (d.value / ceiling) * 100)}%`,
                height: '100%',
                background: CHART.accent,
                borderRadius: 3,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------- health mix */

export interface HealthSlice {
  label: string
  count: number
  tone: 'good' | 'mid' | 'bad'
}

/**
 * Diverging stack: good at one end, bad at the other, neutral between.
 *
 * A 2px surface gap separates the segments so adjacent fills never touch, and
 * every segment carries a legend entry with its label and count — status is
 * never colour alone.
 */
export function HealthMix({ slices }: { slices: HealthSlice[] }) {
  const total = slices.reduce((a, s) => a + s.count, 0)
  if (total === 0) return <ChartEmpty note="No collectors provisioned." />

  const colorOf = (t: HealthSlice['tone']) =>
    t === 'good' ? CHART.good : t === 'bad' ? CHART.bad : CHART.mid

  const shown = slices.filter((s) => s.count > 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 2, height: 26 }}>
        {shown.map((s) => (
          <div
            key={s.label}
            title={`${s.label}: ${s.count} of ${total}`}
            style={{
              flex: s.count,
              background: colorOf(s.tone),
              borderRadius: 4,
              minWidth: 6,
            }}
          />
        ))}
      </div>

      {/* Legend — always present, because identity must never be colour alone. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px' }}>
        {shown.map((s) => (
          <span key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{ width: 9, height: 9, borderRadius: 2, background: colorOf(s.tone), flex: 'none' }}
            />
            <span style={{ fontSize: 11.5, color: 'var(--color-ink-3)' }}>{s.label}</span>
            <span className="mono tnum" style={{ fontSize: 11, color: 'var(--color-mute-3)' }}>
              {s.count}
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- donut */

/**
 * A single proportion, when the headline IS the proportion.
 * Two slices only — anything more belongs in a bar list.
 */
export function Gauge({
  value,
  total,
  label,
  tone = 'accent',
}: {
  value: number
  total: number
  label: string
  tone?: 'accent' | 'good' | 'bad'
}) {
  const pct = total > 0 ? value / total : 0
  const size = 92
  const stroke = 11
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  const color = tone === 'good' ? CHART.good : tone === 'bad' ? CHART.bad : CHART.accent

  return (
    <figure style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 14 }}>
      <svg width={size} height={size} role="img" aria-label={`${label}: ${value} of ${total}`}>
        <title>{`${label}: ${value} of ${total}`}</title>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(20,18,15,.09)" strokeWidth={stroke} />
        {pct > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${circumference * pct} ${circumference}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </svg>
      <figcaption style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span className="display tnum" style={{ fontSize: 26 }}>
          {total > 0 ? `${Math.round(pct * 100)}%` : '—'}
        </span>
        <span className="eyebrow">{label}</span>
        <span className="mono tnum" style={{ fontSize: 10.5, color: 'var(--color-mute-3)' }}>
          {value} of {total}
        </span>
      </figcaption>
    </figure>
  )
}

function ChartEmpty({ note }: { note: string }) {
  return (
    <div
      style={{
        padding: '22px 0',
        fontSize: 12.5,
        color: 'var(--color-mute-3)',
        textAlign: 'center',
      }}
    >
      {note}
    </div>
  )
}
