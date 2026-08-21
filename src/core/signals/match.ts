/**
 * The fire_when evaluator.
 *
 * Turns a pair of observations into zero or more SignalEvents. Pure: no I/O, no
 * clock of its own, no Bright Data. Everything it needs arrives as arguments,
 * which is what makes the whole rule layer cheap to test.
 *
 * A match carries its own evidence. That is deliberate — the evidence ledger is
 * not assembled later from memory, it is produced at the moment the rule fires,
 * from the exact values that made it fire. A claim in a campaign can therefore
 * always be traced to a field, a URL, and a timestamp.
 */
import type { Condition, SignalSpec, Observation, EvidenceRef, SignalEvent } from '../types.js'
import { diffSet, diffPaired, splitLeaf } from './diff.js'
import { resolveStrings } from './fieldpath.js'

export interface MatchHit {
  condition: Condition
  /** Human-readable values that satisfied the condition. */
  values: Record<string, unknown>
  sentence: string
}

export interface MatchResult {
  fired: boolean
  hits: MatchHit[]
}

/** Render `{{a.b}}` placeholders from a flat-ish value bag. */
export function renderTemplate(template: string, values: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (whole, key: string) => {
    const direct = values[key]
    if (direct !== undefined && direct !== null) return String(direct)
    // `tier.name` also matches a stored `name`, so templates stay readable.
    const tail = key.split('.').pop()!
    const fallback = values[tail]
    return fallback === undefined || fallback === null ? whole : String(fallback)
  })
}

/**
 * Compile a pattern from signals.yaml.
 *
 * Signal authors write `(?i)enterprise` for case-insensitivity — the idiom used
 * by Python, Go, and ripgrep, and the one a GTM user is most likely to copy from
 * anywhere else. JavaScript is the odd one out: it rejects inline flag groups
 * outright, so `new RegExp('(?i)x')` throws rather than matching loosely.
 *
 * Silently returning null here would be the worst possible failure: every
 * case-insensitive signal would simply never fire, and the platform would look
 * healthy while reporting nothing. So leading inline flags are translated into
 * real RegExp flags instead.
 */
export function safeRegex(pattern: string): RegExp | null {
  let source = pattern
  let flags = ''

  const inline = /^\(\?([imsux]+)\)/.exec(source)
  if (inline) {
    source = source.slice(inline[0].length)
    // JS has no `x` (extended/whitespace-insensitive) flag; the rest map over.
    flags = inline[1]!.replace(/x/g, '')
  }

  try {
    return new RegExp(source, flags)
  } catch {
    return null
  }
}

/**
 * Evaluate one condition. `before` is null on the first ever observation of a
 * source, in which case nothing fires: with no prior snapshot there is no
 * change, and reporting the entire initial state as "new" would flood the brief
 * with noise on day one.
 */
export function evaluateCondition(
  condition: Condition,
  before: unknown[] | null,
  after: unknown[],
  signal: SignalSpec,
): MatchHit[] {
  if (before === null) return []

  switch (condition.op) {
    case 'appears_matching': {
      const re = safeRegex(String(condition.value ?? ''))
      if (!re) return []
      const { added } = diffSet(before, after, condition.field)
      return added
        .filter((v) => re.test(v))
        .map((v) => ({
          condition,
          values: { match: v, value: v, name: v, title: v, observed_at: null },
          sentence: v,
        }))
    }

    case 'disappears_matching': {
      const re = safeRegex(String(condition.value ?? ''))
      if (!re) return []
      const { removed } = diffSet(before, after, condition.field)
      return removed
        .filter((v) => re.test(v))
        .map((v) => ({ condition, values: { match: v, value: v, name: v }, sentence: v }))
    }

    case 'value_changed': {
      const identityPath = signal.fields.required[0]
      if (!identityPath) return []
      const parts = splitLeaf(condition.field)
      if (!parts) return []
      return diffPaired(before, after, identityPath, condition.field).map((c) => ({
        condition,
        values: {
          name: c.identity,
          [`${parts.leaf}_before`]: c.before,
          [parts.leaf]: c.after,
          price_before: c.before,
          price: c.after,
        },
        sentence: `${c.identity}: ${c.before} -> ${c.after}`,
      }))
    }

    case 'count_delta_pct': {
      const threshold = Number(condition.value ?? 0)
      const d = diffSet(before, after, condition.field)
      const passes =
        condition.direction === 'up'
          ? d.deltaPct >= threshold
          : condition.direction === 'down'
            ? d.deltaPct <= -threshold
            : Math.abs(d.deltaPct) >= threshold
      if (!passes) return []
      return [
        {
          condition,
          values: {
            delta_pct: Math.round(d.deltaPct),
            count: d.countAfter,
            count_before: d.countBefore,
            window_days: condition.window_days,
          },
          sentence: `${d.countBefore} -> ${d.countAfter} (${Math.round(d.deltaPct)}%)`,
        },
      ]
    }

    case 'contains': {
      const needle = String(condition.value ?? '').toLowerCase()
      const present = resolveStrings(after, condition.field).filter((v) =>
        v.toLowerCase().includes(needle),
      )
      const previously = new Set(
        resolveStrings(before, condition.field).filter((v) => v.toLowerCase().includes(needle)),
      )
      return present
        .filter((v) => !previously.has(v))
        .map((v) => ({ condition, values: { match: v, value: v }, sentence: v }))
    }
  }
}

/** Evaluate a whole fire_when block. `all` requires every condition to hit. */
export function evaluate(
  signal: SignalSpec,
  before: unknown[] | null,
  after: unknown[],
): MatchResult {
  const run = (conds: Condition[]) => conds.map((c) => evaluateCondition(c, before, after, signal))

  if (signal.fire_when.all?.length) {
    const perCondition = run(signal.fire_when.all)
    if (perCondition.some((hits) => hits.length === 0)) return { fired: false, hits: [] }
    return { fired: true, hits: perCondition.flat() }
  }

  const hits = run(signal.fire_when.any ?? []).flat()
  return { fired: hits.length > 0, hits }
}

let evidenceSeq = 0
const nextId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${(evidenceSeq++).toString(36)}`

/**
 * Evaluate a signal against two observations and, if it fires, produce the
 * event together with the evidence that justifies it.
 */
export function match(
  signal: SignalSpec,
  previous: Observation | null,
  current: Observation,
): SignalEvent | null {
  const result = evaluate(signal, previous ? previous.rows : null, current.rows)
  if (!result.fired) return null

  const evidence: EvidenceRef[] = result.hits.map((hit) => {
    const values = { ...hit.values, observed_at: current.observedAt.slice(0, 10) }
    return {
      id: nextId('ev'),
      collectorId: current.collectorId,
      signalId: signal.id,
      targetId: current.targetId,
      sourceUrl: current.sourceUrl,
      scrapedAt: current.observedAt,
      sentence: renderTemplate(signal.evidence_template, values),
      fields: values,
    }
  })

  return {
    id: nextId('sig'),
    signalId: signal.id,
    targetId: current.targetId,
    firedAt: current.observedAt,
    weight: signal.weight,
    evidence,
  }
}
