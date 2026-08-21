/**
 * Drift detection.
 *
 * A scraper almost never fails loudly. When a site is redesigned the collector
 * keeps returning 200 and keeps returning rows — the rows are just empty. That
 * silent failure is the thing this module exists to catch, because a campaign
 * built on a silently-broken collector is worse than no campaign at all.
 *
 * Everything here is pure. Statistics in, findings out. The part that talks to
 * Bright Data lives in ./heal.ts.
 */
import type {
  Baseline,
  DriftFinding,
  ObservationStats,
  Observation,
  SignalSpec,
} from '../types.js'
import { nullRate, resolveField } from '../signals/fieldpath.js'

/**
 * Thresholds.
 *
 * Absolute AND relative, because both failure modes are real: a field that was
 * always 90% null and is now 95% null is noise, while a field that was 2% null
 * and is now 40% null is a redesign even though 40% is not "mostly empty".
 */
export const THRESHOLDS = {
  /** Null-rate rise over baseline that counts as drift. */
  nullRateDelta: 0.3,
  /** Null rate that counts as drift regardless of baseline. */
  nullRateAbsolute: 0.5,
  /** Fractional row-count deviation from the baseline mean. */
  rowCountDelta: 0.4,
  /** How many recent observations form a baseline. */
  baselineWindow: 8,
  /** Below this many samples we do not judge — too little history to be sure. */
  minSamples: 2,
  /** After a heal, the null rate must return to within this of baseline. */
  verifyTolerance: 0.1,
} as const

/** Measure one observation against a signal's declared fields. */
export function computeStats(rows: unknown[], signal: SignalSpec): ObservationStats {
  const fields = [...signal.fields.required, ...signal.fields.optional]
  const collectionPath = primaryCollection(signal)
  return {
    rowCount: collectionPath ? resolveField(rows, collectionPath).length : rows.length,
    fields: fields.map((field) => ({ field, nullRate: nullRate(rows, field) })),
  }
}

/**
 * The collection a signal is really about — `tiers[]` for `tiers[].name`.
 * Row count means "how many tiers", not "how many JSON documents".
 */
function primaryCollection(signal: SignalSpec): string | null {
  const first = signal.fields.required[0]
  if (!first) return null
  const idx = first.indexOf('[]')
  return idx === -1 ? null : first.slice(0, idx + 2)
}

/** Roll a set of healthy observations into a baseline to judge against. */
export function buildBaseline(
  collectorId: string,
  observations: Observation[],
  signal: SignalSpec,
): Baseline {
  const window = observations.slice(0, THRESHOLDS.baselineWindow)
  const stats = window.map((o) => computeStats(o.rows, signal))

  const fields: Record<string, number> = {}
  for (const field of [...signal.fields.required, ...signal.fields.optional]) {
    const rates = stats
      .map((s) => s.fields.find((f) => f.field === field)?.nullRate)
      .filter((v): v is number => v !== undefined)
    fields[field] = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0
  }

  return {
    collectorId,
    rowCountMean: stats.length ? stats.reduce((a, s) => a + s.rowCount, 0) / stats.length : 0,
    fields,
    samples: stats.length,
  }
}

/**
 * Compare an observation against its baseline.
 *
 * Returns every finding rather than the first, because the symptom sent to
 * `scraper heal` is more useful the more specific it is: "price is null and
 * there is one row instead of four" tells the repair far more than "something
 * is wrong".
 */
export function detectDrift(
  stats: ObservationStats,
  baseline: Baseline,
  signal: SignalSpec,
): DriftFinding[] {
  const findings: DriftFinding[] = []

  // Not enough history to judge. Staying silent beats crying wolf on day two.
  if (baseline.samples < THRESHOLDS.minSamples) return findings

  for (const { field, nullRate: observed } of stats.fields) {
    const base = baseline.fields[field] ?? 0
    const required = signal.fields.required.includes(field)

    // A required field that resolves to nothing at all is a hard trip.
    if (required && observed >= 1) {
      findings.push({
        kind: 'missing_field',
        field,
        observed,
        baseline: base,
        detail: `required field "${field}" returned no values at all (baseline ${pct(base)} null)`,
      })
      continue
    }

    const rose = observed - base >= THRESHOLDS.nullRateDelta
    const high = observed >= THRESHOLDS.nullRateAbsolute && base < THRESHOLDS.nullRateAbsolute
    if (rose || high) {
      findings.push({
        kind: 'null_rate',
        field,
        observed,
        baseline: base,
        detail: `field "${field}" is null in ${pct(observed)} of rows (baseline ${pct(base)})`,
      })
    }
  }

  if (baseline.rowCountMean > 0) {
    const deviation = Math.abs(stats.rowCount - baseline.rowCountMean) / baseline.rowCountMean
    if (deviation >= THRESHOLDS.rowCountDelta) {
      findings.push({
        kind: 'row_count',
        observed: stats.rowCount,
        baseline: baseline.rowCountMean,
        detail: `row count ${stats.rowCount} against a baseline of ${baseline.rowCountMean.toFixed(1)}`,
      })
    }
  }

  return findings
}

const pct = (n: number) => `${Math.round(n * 100)}%`

/**
 * Compose the repair prompt.
 *
 * This is where the plain-language `watch` string earns its keep. The user
 * wrote it once to describe what they wanted extracted; Bellwether replays it
 * back to Bright Data verbatim, appends what actually went wrong, and lets the
 * AI re-derive the extraction against the original intent. The description is
 * never paraphrased — see assertWatchIntegrity in ../config/load.ts.
 */
export function composeSymptom(signal: SignalSpec, findings: DriftFinding[]): string {
  const observed = findings.map((f) => f.detail).join('; ')
  return `${signal.watch.trim()}. Observed failure: ${observed}.`
}

/**
 * Sharpen the prompt for a retry.
 *
 * A rejected fix means the first description was not specific enough about what
 * the data must look like, so the second attempt states the contract explicitly
 * rather than repeating the same words louder.
 */
export function sharpenSymptom(signal: SignalSpec, findings: DriftFinding[]): string {
  const required = signal.fields.required.join(', ')
  return (
    `${composeSymptom(signal, findings)} ` +
    `The previous fix was rejected because it did not restore the data. ` +
    `Every returned row must populate: ${required}. ` +
    `Look for the values in newly added or renamed containers rather than the previous selectors.`
  )
}

/**
 * Does a healed result actually work?
 *
 * Run against `preview_result` BEFORE approving a fix. This is the check that
 * makes Bellwether's use of the CLI a control loop rather than a wrapper: the
 * platform decides whether the repair is good, and rejects it if not.
 */
export function verifyAgainstContract(
  stats: ObservationStats,
  baseline: Baseline,
  signal: SignalSpec,
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = []

  if (stats.rowCount === 0) reasons.push('the fix returned no rows')

  for (const field of signal.fields.required) {
    const observed = stats.fields.find((f) => f.field === field)?.nullRate ?? 1
    const base = baseline.fields[field] ?? 0
    if (observed >= 1) {
      reasons.push(`required field "${field}" is still empty`)
    } else if (observed > base + THRESHOLDS.verifyTolerance) {
      reasons.push(
        `required field "${field}" is null in ${pct(observed)} of rows, worse than the ${pct(base)} baseline`,
      )
    }
  }

  return { ok: reasons.length === 0, reasons }
}

/** Rows recovered by a heal — the number the Heal Log reports. */
export const rowsRecovered = (before: ObservationStats, after: ObservationStats): number =>
  Math.max(0, after.rowCount - before.rowCount)
