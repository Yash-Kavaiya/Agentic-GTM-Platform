/**
 * Bellwether domain types.
 *
 * Every type here is derived from a zod schema so config files and CLI output
 * are validated at the boundary and trusted everywhere after it.
 */
import { z } from 'zod'

// ---------------------------------------------------------------- signals

export const AdapterKind = z.enum(['web', 'sitemap', 'rss', 'jobs', 'docs', 'search'])
export type AdapterKind = z.infer<typeof AdapterKind>

export const MatchOp = z.enum([
  'appears_matching',
  'disappears_matching',
  'value_changed',
  'count_delta_pct',
  'contains',
])
export type MatchOp = z.infer<typeof MatchOp>

export const Condition = z.object({
  /** Field path into the observation, e.g. "tiers[].name". */
  field: z.string().min(1),
  op: MatchOp,
  value: z.union([z.string(), z.number()]).optional(),
  direction: z.enum(['up', 'down', 'any']).default('any'),
  window_days: z.number().int().positive().default(30),
})
export type Condition = z.infer<typeof Condition>

export const FireWhen = z
  .object({
    any: z.array(Condition).optional(),
    all: z.array(Condition).optional(),
  })
  .refine((v) => Boolean(v.any?.length || v.all?.length), {
    message: 'fire_when needs at least one condition under `any` or `all`',
  })
export type FireWhen = z.infer<typeof FireWhen>

export const SignalSpec = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
  adapter: AdapterKind,
  /** Path relative to the target domain. Absent for adapters that derive it. */
  path: z.string().optional(),
  /**
   * THE ONE STRING. Written in plain language by a GTM user, and the only
   * place this description exists. It is displayed in Signal Studio, sent to
   * `scraper create`, composed into `scraper heal`, and cited in campaigns.
   * Nothing may rewrite it in transit.
   */
  watch: z.string().min(20),
  fields: z.object({
    /** The contract Anneal verifies a heal against before approving it. */
    required: z.array(z.string()).min(1),
    optional: z.array(z.string()).default([]),
  }),
  fire_when: FireWhen,
  evidence_template: z.string().min(1),
  weight: z.number().int().min(0).max(100),
  cadence: z.enum(['hourly', 'daily', 'weekly']),
})
export type SignalSpec = z.infer<typeof SignalSpec>

export const SignalsConfig = z.object({
  version: z.literal(1),
  signals: z.array(SignalSpec).min(1),
})
export type SignalsConfig = z.infer<typeof SignalsConfig>

// ---------------------------------------------------------------- targets

export const JobsBinding = z.object({
  provider: z.enum(['greenhouse', 'lever', 'ashby']),
  token: z.string().min(1),
})
export type JobsBinding = z.infer<typeof JobsBinding>

export const Target = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  domain: z.string().min(1),
  paths: z.record(z.string()).default({}),
  jobs: JobsBinding.optional(),
})
export type Target = z.infer<typeof Target>

export const TargetsConfig = z.object({
  version: z.literal(1),
  targets: z.array(Target).min(1),
})
export type TargetsConfig = z.infer<typeof TargetsConfig>

// -------------------------------------------------------------------- ICP

export const IcpConfig = z.object({
  version: z.literal(1),
  icp: z.object({
    name: z.string(),
    description: z.string(),
    fit_criteria: z.array(
      z.object({ id: z.string(), description: z.string(), weight: z.number() }),
    ),
    signal_multipliers: z.record(z.number()),
    freshness: z.object({ half_life_days: z.number().positive(), floor: z.number().min(0).max(1) }),
    brief_threshold: z.number(),
    offering: z.object({
      name: z.string(),
      one_liner: z.string(),
      value_props: z.array(z.string()),
    }),
  }),
})
export type IcpConfig = z.infer<typeof IcpConfig>

// ----------------------------------------------------------- observations

/** One fetch of one source at one moment. The unit the whole engine works in. */
export interface Observation {
  collectorId: string | null
  signalId: string
  targetId: string
  sourceUrl: string
  observedAt: string
  /** Extracted rows, shape defined by the signal's `watch`. */
  rows: Record<string, unknown>[]
  /** Whatever the adapter got back, kept for the heal log's before/after. */
  raw?: unknown
}

export interface CollectorBinding {
  collectorId: string | null
  signalId: string
  targetId: string
  url: string
  usesBrightData: boolean
}

export interface ComplianceVerdict {
  allowed: boolean
  reason: string
  /** Which check decided it — shown in the UI so the refusal is legible. */
  rule: 'denylist' | 'robots' | 'scheme' | 'ok'
}

// --------------------------------------------------------------- signals out

export interface EvidenceRef {
  id: string
  collectorId: string | null
  signalId: string
  targetId: string
  sourceUrl: string
  scrapedAt: string
  /** The rendered evidence sentence, from the signal's evidence_template. */
  sentence: string
  /** The extracted values the sentence was rendered from. */
  fields: Record<string, unknown>
}

export interface SignalEvent {
  id: string
  signalId: string
  targetId: string
  firedAt: string
  weight: number
  evidence: EvidenceRef[]
}

// ---------------------------------------------------------------- anneal

export const HealthState = z.enum([
  'HEALTHY',
  'DEGRADED',
  'HEALING',
  'VERIFYING',
  'HEALED',
  'QUARANTINED',
])
export type HealthState = z.infer<typeof HealthState>

export interface FieldStats {
  field: string
  nullRate: number
}

export interface ObservationStats {
  rowCount: number
  fields: FieldStats[]
}

export interface Baseline {
  collectorId: string
  rowCountMean: number
  fields: Record<string, number>
  samples: number
}

export interface DriftFinding {
  kind: 'null_rate' | 'row_count' | 'missing_field'
  field?: string
  observed: number
  baseline: number
  detail: string
}

export interface HealEvent {
  id: string
  collectorId: string
  signalId: string
  targetId: string
  attempt: number
  symptom: string
  startedAt: string
  endedAt: string | null
  durationMs: number | null
  fromState: HealthState
  toState: HealthState
  verdict: 'approved' | 'rejected' | 'error' | null
  before: ObservationStats | null
  after: ObservationStats | null
  rowsRecovered: number | null
  error?: string
}

export type HealthMap = Record<string, HealthState>
