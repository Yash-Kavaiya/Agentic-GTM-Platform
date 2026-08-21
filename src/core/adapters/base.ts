/**
 * The SourceAdapter boundary.
 *
 * Everything upstream of this interface speaks Observations. Nothing upstream
 * knows whether a signal came from a Bright Data collector, a public JSON API,
 * or an XML feed — which is what makes the engine testable without a network
 * and extensible without touching the engine.
 *
 * Six adapters ship. Four route through Bright Data, two do not:
 *
 *   web      Bright Data, PDP type       pricing / security / integrations pages
 *   docs     Bright Data, Sitemap type   documentation page content
 *   search   Bright Data, Search type    keyword discovery, no URL required
 *   careers  Bright Data, Discovery type careers pages with no public board API
 *   jobs     public JSON board APIs      Greenhouse / Lever / Ashby
 *   rss      direct HTTP                 changelog and blog feeds
 *   sitemap  direct HTTP                 documentation URL counts
 *
 * The last three deliberately skip Bright Data. A Greenhouse board API already
 * returns clean structured JSON, an RSS feed is already structured, and counting
 * <loc> elements in a sitemap is not scraping. Routing them through a scraper
 * would inflate the "use of Scraper Studio" story while making the system worse.
 * Scraper Studio is used where scraping is the honest tool for the job.
 *
 * The interface itself is source-agnostic: an adapter could be written for any
 * site. We ship public-web adapters only, by design — see ./compliance.ts.
 */
import type {
  AdapterKind,
  CollectorBinding,
  ComplianceVerdict,
  Observation,
  SignalSpec,
  Target,
} from '../types.js'
import { preflight, stripPersonalData, USER_AGENT } from './compliance.js'

export interface SourceAdapter {
  readonly kind: AdapterKind
  /** True if this adapter provisions and runs a Bright Data collector. */
  readonly usesBrightData: boolean
  /** Which Bright Data scraper type it uses, for the README and the dashboard. */
  readonly scraperType: 'PDP' | 'Sitemap' | 'Search' | 'Discovery' | null

  /** robots.txt + denylist gate. Returns a verdict; a refusal is not an error. */
  preflight(url: string): Promise<ComplianceVerdict>

  /** Resolve the source this (signal, target) pair reads. */
  bind(signal: SignalSpec, target: Target): CollectorBinding | null

  /** Fetch one observation. Throws only on genuine failure, never on "no data". */
  observe(binding: CollectorBinding, signal: SignalSpec, at: Date): Promise<Observation>
}

export class AdapterError extends Error {
  constructor(
    message: string,
    readonly binding: CollectorBinding,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'AdapterError'
  }
}

/** Shared HTTP GET with the project user-agent and a sane timeout. */
export async function httpGet(url: string, timeoutMs = 15_000): Promise<string> {
  const res = await fetch(url, {
    headers: { 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.text()
}

/**
 * Build an Observation, stripping personal data on the way in.
 *
 * Every adapter funnels through here, so the personal-data guarantee holds for
 * all six rather than depending on each one remembering.
 */
export function makeObservation(
  binding: CollectorBinding,
  rows: Record<string, unknown>[],
  at: Date,
  raw?: unknown,
): Observation {
  return {
    collectorId: binding.collectorId,
    signalId: binding.signalId,
    targetId: binding.targetId,
    sourceUrl: binding.url,
    observedAt: at.toISOString(),
    rows: stripPersonalData(rows),
    raw,
  }
}

/** Default preflight — adapters override only if they need something extra. */
export const defaultPreflight = (url: string) => preflight(url)

// ------------------------------------------------------------- registry

const registry = new Map<AdapterKind, SourceAdapter>()

export function register(adapter: SourceAdapter): void {
  registry.set(adapter.kind, adapter)
}

export function getAdapter(kind: AdapterKind): SourceAdapter {
  const a = registry.get(kind)
  if (!a) throw new Error(`no adapter registered for "${kind}"`)
  return a
}

export const registeredKinds = (): AdapterKind[] => [...registry.keys()]

export const allAdapters = (): SourceAdapter[] => [...registry.values()]
