/**
 * Config loading.
 *
 * The single place `signals.yaml`, `targets.yaml` and `icp.yaml` are read and
 * validated. Everything downstream receives typed, checked values — so a
 * malformed signal fails here with a legible message rather than halfway
 * through a scrape.
 *
 * This module is also where the "one string" invariant is enforced: `watch` is
 * read from the SignalSpec and never rewritten. `assertWatchIntegrity` exists
 * so a test can prove it.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { z } from 'zod'
import {
  SignalsConfig,
  TargetsConfig,
  IcpConfig,
  type SignalSpec,
  type Target,
} from '../types.js'

const CONFIG_DIR = process.env.BELLWETHER_CONFIG_DIR ?? join(process.cwd(), 'config')

/**
 * Parse and validate one config file.
 *
 * The generic is over the SCHEMA rather than the value so the return type is
 * zod's OUTPUT type. Fields declared with `.default()` are optional to write in
 * YAML but always present after parsing, and only the output type says so.
 */
function loadYaml<S extends z.ZodTypeAny>(file: string, schema: S): z.infer<S> {
  const path = join(CONFIG_DIR, file)
  let raw: unknown
  try {
    raw = parse(readFileSync(path, 'utf8'))
  } catch (e) {
    throw new Error(`could not read ${path}: ${(e as Error).message}`)
  }

  const result = schema.safeParse(raw)
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n')
    throw new Error(`${file} is not valid:\n${issues}`)
  }
  return result.data as z.infer<S>
}

let signalsCache: SignalSpec[] | null = null
let targetsCache: Target[] | null = null
let icpCache: IcpConfig['icp'] | null = null

export function loadSignals(): SignalSpec[] {
  if (signalsCache) return signalsCache
  const cfg = loadYaml('signals.yaml', SignalsConfig)

  const seen = new Set<string>()
  for (const s of cfg.signals) {
    if (seen.has(s.id)) throw new Error(`signals.yaml: duplicate signal id "${s.id}"`)
    seen.add(s.id)
  }
  return (signalsCache = cfg.signals)
}

export function loadTargets(): Target[] {
  if (targetsCache) return targetsCache
  const cfg = loadYaml('targets.yaml', TargetsConfig)

  const seen = new Set<string>()
  for (const t of cfg.targets) {
    if (seen.has(t.id)) throw new Error(`targets.yaml: duplicate target id "${t.id}"`)
    seen.add(t.id)
  }
  return (targetsCache = cfg.targets)
}

export function loadIcp(): IcpConfig['icp'] {
  if (icpCache) return icpCache
  return (icpCache = loadYaml('icp.yaml', IcpConfig).icp)
}

/** Test seam — drops memoised config so a test can point at fixtures. */
export function resetConfigCache(): void {
  signalsCache = null
  targetsCache = null
  icpCache = null
  sourcesCache = null
}

export const getSignal = (id: string): SignalSpec | undefined =>
  loadSignals().find((s) => s.id === id)

export const getTarget = (id: string): Target | undefined => loadTargets().find((t) => t.id === id)

/**
 * Verified sources, written by `npm run probe`.
 *
 * A signal template carries a DEFAULT path like `/blog/rss.xml`, but real sites
 * file these pages wherever they like — guessing produced 35 404s on the first
 * collection run. This file records the URL that actually returned 200 for each
 * (target, signal) pair, so the engine reads verified URLs rather than hopeful
 * ones. It is committed: it is configuration and evidence at the same time.
 */
interface SourcesFile {
  generated_at: string
  sources: Record<string, Record<string, string>>
}

let sourcesCache: SourcesFile['sources'] | null = null

export function loadVerifiedSources(): SourcesFile['sources'] {
  if (sourcesCache) return sourcesCache
  const path = join(CONFIG_DIR, 'sources.json')
  if (!existsSync(path)) return (sourcesCache = {})
  try {
    return (sourcesCache = (JSON.parse(readFileSync(path, 'utf8')) as SourcesFile).sources ?? {})
  } catch {
    return (sourcesCache = {})
  }
}

/**
 * Resolve the URL a (signal, target) pair reads.
 *
 * Precedence, most trustworthy first:
 *   1. a hand-written override in targets.yaml — a human said so
 *   2. a probed URL in sources.json — a 200 said so
 *   3. the signal template's default path — a guess
 */
export function resolveUrl(signal: SignalSpec, target: Target): string {
  const override = target.paths[signal.id] ?? target.paths[signal.category]
  const verified = loadVerifiedSources()[target.id]?.[signal.id]
  const path = override ?? verified ?? signal.path ?? '/'
  if (path.startsWith('https://')) return path
  return `https://${target.domain}${path.startsWith('/') ? path : `/${path}`}`
}

/**
 * Whether this pair has a source we have actually confirmed exists.
 * The pipeline skips unverified pairs rather than generating 404 noise.
 */
export function hasVerifiedSource(signal: SignalSpec, target: Target): boolean {
  if (target.paths[signal.id] ?? target.paths[signal.category]) return true
  return Boolean(loadVerifiedSources()[target.id]?.[signal.id])
}

/**
 * The invariant that makes "one string, many jobs" true rather than aspirational:
 * whatever reaches Bright Data must be byte-identical to what the YAML declared
 * and what Signal Studio displays. Proven in tests/one-string.test.ts.
 */
export function assertWatchIntegrity(signalId: string, sentToBrightData: string): void {
  const spec = getSignal(signalId)
  if (!spec) throw new Error(`unknown signal "${signalId}"`)
  if (spec.watch !== sentToBrightData) {
    throw new Error(
      `watch string for "${signalId}" was modified in transit.\n` +
        `  declared: ${JSON.stringify(spec.watch)}\n` +
        `  sent:     ${JSON.stringify(sentToBrightData)}`,
    )
  }
}
