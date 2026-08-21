'use client'

import { useMemo, useState } from 'react'

/**
 * The custom signal builder.
 *
 * Four fields, no code. What the user types into "what am I watching for"
 * becomes the signal's `watch` string, and that one string is what gets sent
 * to `bdata scraper create`, replayed into `bdata scraper heal` when the page
 * changes, and cited beside the claim in the campaign.
 *
 * The command preview is not decoration — it is the actual argv the
 * provisioner runs. Showing it is how a non-technical user can see that
 * nothing paraphrased their words on the way to the scraper.
 */

const OPS = [
  { value: 'appears_matching', label: 'something new appears matching' },
  { value: 'disappears_matching', label: 'something disappears matching' },
  { value: 'value_changed', label: 'a value changes' },
  { value: 'count_delta_pct', label: 'the count moves by more than' },
] as const

const EXAMPLES = [
  {
    name: 'Moving Upmarket',
    url: 'https://acme.com/pricing',
    watch: 'the pricing tiers on this page - for each tier, its name, its price, and the exact text of its call-to-action button',
    field: 'tiers[].name',
    op: 'appears_matching',
    value: '(?i)enterprise|custom',
  },
  {
    name: 'Enterprise Readiness',
    url: 'https://acme.com/security',
    watch: 'the compliance and certification badges listed on this page - the name of each standard, and any status text shown next to it',
    field: 'badges[].name',
    op: 'appears_matching',
    value: '(?i)soc ?2|iso ?27001',
  },
]

const shellQuote = (s: string) => `"${s.replace(/"/g, '\\"')}"`

export function SignalBuilder() {
  const [name, setName] = useState(EXAMPLES[0]!.name)
  const [url, setUrl] = useState(EXAMPLES[0]!.url)
  const [watch, setWatch] = useState(EXAMPLES[0]!.watch)
  const [field, setField] = useState(EXAMPLES[0]!.field)
  const [op, setOp] = useState<string>(EXAMPLES[0]!.op)
  const [value, setValue] = useState(EXAMPLES[0]!.value)
  const [cadence, setCadence] = useState('daily')

  const id = useMemo(
    () => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'my_signal',
    [name],
  )

  const collapsed = watch.trim().replace(/\s+/g, ' ')

  const createCmd = `bdata scraper create ${url} ${shellQuote(collapsed)} --name bellwether-${id}`
  const healCmd = `bdata scraper heal <COLLECTOR_ID> ${shellQuote(
    `${collapsed}. Observed failure: field "${field}" is null in 94% of rows (baseline 2%).`,
  )}`

  const yaml = [
    `  - id: ${id}`,
    `    name: ${name}`,
    `    adapter: web`,
    `    path: ${safePath(url)}`,
    `    watch: >`,
    ...wrap(collapsed, 62).map((l) => `      ${l}`),
    `    fields:`,
    `      required: ["${field}"]`,
    `    fire_when:`,
    `      any:`,
    `        - { field: "${field}", op: ${op}${value ? `, value: "${value}"` : ''} }`,
    `    evidence_template: "Detected {{match}} on {{observed_at}}"`,
    `    weight: 25`,
    `    cadence: ${cadence}`,
  ].join('\n')

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="card space-y-4 p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-semibold">Define a signal</h3>
          <div className="flex gap-1.5">
            {EXAMPLES.map((e) => (
              <button
                key={e.name}
                type="button"
                onClick={() => {
                  setName(e.name); setUrl(e.url); setWatch(e.watch)
                  setField(e.field); setOp(e.op); setValue(e.value)
                }}
                className="rounded border px-2 py-1 text-[11px] hairline transition-colors hover:bg-[var(--surface-2)]"
                style={{ color: 'var(--text-dim)' }}
              >
                {e.name}
              </button>
            ))}
          </div>
        </div>

        <Field label="Signal name">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </Field>

        <Field label="What page?">
          <input value={url} onChange={(e) => setUrl(e.target.value)} className={inputCls} />
        </Field>

        <Field
          label="What am I watching for?"
          hint="Plain English. This exact sentence provisions the scraper, repairs it when the page changes, and appears beside the claim in your campaign."
        >
          <textarea
            value={watch}
            onChange={(e) => setWatch(e.target.value)}
            rows={4}
            className={`${inputCls} resize-y leading-relaxed`}
          />
        </Field>

        <Field label="Fire when">
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
            <input value={field} onChange={(e) => setField(e.target.value)} placeholder="tiers[].name" className={inputCls} />
            <select value={op} onChange={(e) => setOp(e.target.value)} className={inputCls}>
              {OPS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          {op !== 'value_changed' && (
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={op === 'count_delta_pct' ? '30' : '(?i)enterprise'}
              className={`${inputCls} mt-2`}
            />
          )}
        </Field>

        <Field label="How often?">
          <select value={cadence} onChange={(e) => setCadence(e.target.value)} className={inputCls}>
            <option value="hourly">Hourly</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
        </Field>
      </div>

      <div className="space-y-4">
        <Panel
          title="1 · Provisions the collector"
          note="Your words, passed through verbatim. Nothing rewrites them."
          body={createCmd}
        />
        <Panel
          title="2 · Repairs it when the page changes"
          note="The same sentence, plus what actually broke."
          body={healCmd}
        />
        <Panel title="3 · Becomes config" note="Appended to config/signals.yaml." body={yaml} />
      </div>
    </div>
  )
}

function Panel({ title, note, body }: { title: string; note: string; body: string }) {
  return (
    <div className="card overflow-hidden">
      <div className="border-b hairline px-4 py-2.5">
        <p className="text-[12px] font-semibold">{title}</p>
        <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-dim)' }}>{note}</p>
      </div>
      <pre
        className="mono overflow-x-auto px-4 py-3 text-[11.5px] leading-relaxed"
        style={{ background: 'var(--surface-2)' }}
      >
        {body}
      </pre>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[12px] font-medium">{label}</span>
      {hint && (
        <span className="mt-0.5 block text-[11px] leading-relaxed" style={{ color: 'var(--text-dim)' }}>
          {hint}
        </span>
      )}
      <div className="mt-1.5">{children}</div>
    </label>
  )
}

const inputCls =
  'w-full rounded-md border px-2.5 py-1.5 text-[13px] outline-none transition-colors focus:border-[var(--accent)] hairline bg-[var(--bg)] text-[var(--text)]'

const safePath = (url: string) => {
  try {
    return new URL(url).pathname
  } catch {
    return '/pricing'
  }
}

function wrap(text: string, width: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    if ((line + ' ' + w).trim().length > width) {
      lines.push(line.trim())
      line = w
    } else {
      line += ' ' + w
    }
  }
  if (line.trim()) lines.push(line.trim())
  return lines
}
