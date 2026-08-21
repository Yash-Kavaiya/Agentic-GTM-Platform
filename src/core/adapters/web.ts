/**
 * Bright Data page adapter.
 *
 * Handles the signals that need real extraction from a rendered marketing page:
 * pricing tiers, compliance badges, integration directories, customer walls.
 * These are the long tail — a B2B SaaS pricing page is not in anyone's
 * pre-built scraper library, and its markup is bespoke, JS-rendered and
 * redesigned without warning. That is exactly what Scraper Studio is for, and
 * exactly why the healing loop has to exist.
 *
 * Two execution paths over the same Collector ID:
 *   CLI   `scraper run`      — developer machines, `make demo`
 *   HTTP  `POST /dca/trigger` — CI, cron, serverless, anywhere with no CLI
 *
 * The Collector ID is the contract, and `scraper heal` preserves it, so a
 * repaired collector keeps working on both paths with nothing downstream
 * touched.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { CollectorBinding, Observation, SignalSpec, Target } from '../types.js'
import { type SourceAdapter, defaultPreflight, makeObservation, AdapterError } from './base.js'
import { scraperRun, isDryRun } from '../brightdata/cli.js'
import { triggerAndWait } from '../brightdata/trigger.js'
import { resolveUrl, hasVerifiedSource } from '../config/load.js'

const COLLECTORS_PATH = join(process.cwd(), 'config', 'collectors.json')

export interface CollectorRecord {
  key: string
  signalId: string
  targetId: string
  collectorId: string
  scraperType: string
  seedUrl: string
  watch: string
  createdAt: string
  viewUrl?: string
}

let cache: Record<string, CollectorRecord> | null = null

export function loadCollectors(): Record<string, CollectorRecord> {
  if (cache) return cache
  cache = existsSync(COLLECTORS_PATH)
    ? (JSON.parse(readFileSync(COLLECTORS_PATH, 'utf8')) as Record<string, CollectorRecord>)
    : {}
  return cache
}

export const resetCollectorCache = () => {
  cache = null
}

/**
 * The collector provisioned for a (signal, account) pair.
 *
 * Keyed by the pair rather than the signal because a PDP collector encodes the
 * DOM of the page it was generated from: one seeded on cal.com/security returns
 * real badges there and an empty array on vanta.com/security. Looking a
 * collector up by signal alone would hand back one bound to a different
 * company's markup, which fails silently rather than loudly.
 * See docs/adr/004-collector-granularity.md.
 */
export function collectorFor(signalId: string, targetId: string): CollectorRecord | null {
  return loadCollectors()[`${signalId}:${targetId}`] ?? null
}

/**
 * Which execution path to use.
 * CI has no interactive login, so it goes over HTTP with an API key.
 */
const useHttpTrigger = (): boolean =>
  process.env.BELLWETHER_EXEC === 'http' ||
  (process.env.CI === 'true' && Boolean(process.env.BRIGHTDATA_API_KEY))

export const webAdapter: SourceAdapter = {
  kind: 'web',
  usesBrightData: true,
  scraperType: 'PDP',

  preflight: defaultPreflight,

  bind(signal: SignalSpec, target: Target): CollectorBinding | null {
    if (!hasVerifiedSource(signal, target)) return null
    const collector = collectorFor(signal.id, target.id)

    return {
      collectorId: collector?.collectorId ?? null,
      signalId: signal.id,
      targetId: target.id,
      url: resolveUrl(signal, target),
      usesBrightData: true,
    }
  },

  async observe(binding: CollectorBinding, _signal: SignalSpec, at: Date): Promise<Observation> {
    if (!binding.collectorId) {
      throw new AdapterError(
        `no collector provisioned for signal "${binding.signalId}" — run \`npm run bw:provision\``,
        binding,
      )
    }

    if (isDryRun()) return makeObservation(binding, [], at, { dryRun: true })

    if (useHttpTrigger()) {
      const res = await triggerAndWait(binding.collectorId, [{ url: binding.url }])
      return makeObservation(binding, res.rows, at, { via: 'dca/trigger', collectionId: res.collectionId })
    }

    const res = await scraperRun(binding.collectorId, [binding.url])
    if (res.code !== 0 && res.rows.length === 0) {
      throw new AdapterError(
        `scraper run failed for ${binding.collectorId}: ${res.stderr.trim().slice(0, 300) || `exit ${res.code}`}`,
        binding,
      )
    }
    return makeObservation(binding, res.rows, at, { via: 'cli', command: res.command })
  },
}
