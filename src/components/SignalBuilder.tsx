'use client'

import { useMemo, useState } from 'react'

/**
 * The custom signal builder.
 *
 * Four fields, no code. What the user types into "what am I watching for"
 * becomes the signal's `watch` string, and that one sentence provisions the
 * collector, repairs it when the page changes, and is cited beside the claim it
 * produces.
 *
 * The commands shown are the actual argv the provisioner runs. Printing them is
 * how a non-technical user can see that nothing paraphrased their words on the
 * way to the scraper.
 */

const EXAMPLES = [
  {
    name: 'Moving Upmarket',
    url: 'https://acme.com/pricing',
    watch:
      'the pricing tiers on this page - for each tier, its name, its price, and the exact text of its call-to-action button',
    field: 'tiers[].name',
    value: '(?i)enterprise|custom',
  },
  {
    name: 'Enterprise Readiness',
    url: 'https://acme.com/security',
    watch:
      'the compliance and certification badges listed on this page - the name of each standard, and any status text shown next to it',
    field: 'badges[].name',
    value: '(?i)soc ?2|iso ?27001',
  },
]

const JOBS = [
  'Shown in Signal Studio as the definition of the signal',
  'Sent verbatim to `bdata scraper create` to provision the collector',
  'Replayed into `bdata scraper heal` when the page changes',
  'Cited beside the claim it produces in the campaign',
]

const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`

export function SignalBuilder() {
  const [name, setName] = useState(EXAMPLES[0]!.name)
  const [url, setUrl] = useState(EXAMPLES[0]!.url)
  const [watch, setWatch] = useState(EXAMPLES[0]!.watch)
  const [field, setField] = useState(EXAMPLES[0]!.field)
  const [value, setValue] = useState(EXAMPLES[0]!.value)

  const id = useMemo(
    () => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'my_signal',
    [name],
  )
  const spec = watch.trim().replace(/\s+/g, ' ')

  const createCmd = `bdata scraper create ${url} ${q(spec)} --name bellwether-${id}`
  const healCmd = `bdata scraper heal <COLLECTOR_ID> ${q(
    `${spec}. Observed failure: field "${field}" is empty in every row the collector returned.`,
  )}`

  return (
    <div
      className="card"
      style={{
        flex: 'none',
        width: 352,
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        boxShadow: '0 2px 10px rgba(20,18,15,.05)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Custom signal</h2>
          <span style={{ fontSize: 12, color: 'var(--color-mute-2)' }}>Four fields. No code.</span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {EXAMPLES.map((e) => (
            <button
              key={e.name}
              type="button"
              onClick={() => {
                setName(e.name)
                setUrl(e.url)
                setWatch(e.watch)
                setField(e.field)
                setValue(e.value)
              }}
              className="mono"
              style={{
                fontSize: 9.5,
                padding: '4px 7px',
                border: '1px solid var(--line-2)',
                borderRadius: 5,
                background: '#fff',
                cursor: 'pointer',
                color: 'var(--color-mute)',
              }}
            >
              {e.name.split(' ')[0]}
            </button>
          ))}
        </div>
      </div>

      <Field label="What page?">
        <input value={url} onChange={(e) => setUrl(e.target.value)} className="mono" style={input} />
      </Field>

      <Field label="What am I watching for?" hint="Plain English. This exact string is reused three times.">
        <textarea
          value={watch}
          onChange={(e) => setWatch(e.target.value)}
          rows={3}
          style={{
            ...input,
            fontFamily: 'var(--font-sans)',
            fontSize: 13,
            lineHeight: 1.45,
            minHeight: 62,
            resize: 'vertical',
            border: '1px solid var(--color-rust)',
            background: '#fffdfa',
            boxShadow: '0 0 0 3px rgba(184,68,42,.1)',
          }}
        />
      </Field>

      <div style={{ display: 'flex', gap: 10 }}>
        <Field label="Fire when">
          <input value={field} onChange={(e) => setField(e.target.value)} className="mono" style={input} />
        </Field>
        <Field label="Matching">
          <input value={value} onChange={(e) => setValue(e.target.value)} className="mono" style={input} />
        </Field>
      </div>

      {/* The point of the whole design, stated plainly. */}
      <div
        style={{
          background: 'var(--color-ink)',
          borderRadius: 9,
          padding: '13px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 9,
        }}
      >
        <span
          className="mono"
          style={{ fontSize: 9.5, letterSpacing: '.13em', textTransform: 'uppercase', color: 'var(--on-dark-dim)' }}
        >
          one string, three jobs
        </span>
        {JOBS.slice(0, 3).map((text, i) => (
          <span key={i} style={{ display: 'flex', gap: 9, alignItems: 'baseline' }}>
            <span className="mono" style={{ fontSize: 10, color: 'var(--color-rust)', flex: 'none' }}>
              {String(i + 1).padStart(2, '0')}
            </span>
            <span style={{ fontSize: 11.5, lineHeight: 1.4, color: 'rgba(244,241,236,.82)' }}>{text}</span>
          </span>
        ))}
      </div>

      <Panel title="Provisions the collector" body={createCmd} />
      <Panel title="Repairs it when the page changes" body={healCmd} />
    </div>
  )
}

function Panel({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span className="eyebrow">{title}</span>
      <pre
        className="mono"
        style={{
          margin: 0,
          fontSize: 10.5,
          lineHeight: 1.6,
          background: 'var(--color-paper-3)',
          border: '1px solid rgba(20,18,15,.08)',
          borderRadius: 7,
          padding: '10px 11px',
          overflowX: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {body}
      </pre>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="eyebrow">{label}</span>
      {children}
      {hint && <span style={{ fontSize: 11, lineHeight: 1.45, color: 'var(--color-mute-3)' }}>{hint}</span>}
    </label>
  )
}

const input: React.CSSProperties = {
  width: '100%',
  border: '1px solid var(--line-2)',
  borderRadius: 7,
  padding: '9px 11px',
  fontSize: 12,
  background: 'var(--color-paper-2)',
  color: 'var(--color-ink)',
  outline: 'none',
  boxSizing: 'border-box',
}
