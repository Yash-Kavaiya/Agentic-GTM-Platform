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
import { readFileSync } from 'node:fs'
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
}

export const getSignal = (id: string): SignalSpec | undefined =>
  loadSignals().find((s) => s.id === id)

export const getTarget = (id: string): Target | undefined => loadTargets().find((t) => t.id === id)

/**
 * Resolve the URL a (signal, target) pair reads.
 * A target may override a signal's default path when it files a page oddly.
 */
export function resolveUrl(signal: SignalSpec, target: Target): string {
  const override = target.paths[signal.id] ?? target.paths[signal.category]
  const path = override ?? signal.path ?? '/'
  if (path.startsWith('https://')) return path
  return `https://${target.domain}${path.startsWith('/') ? path : `/${path}`}`
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
