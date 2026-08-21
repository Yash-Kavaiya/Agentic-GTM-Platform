/**
 * The repo-as-database export.
 *
 * The engine runs locally and in CI; the web app is a static read of whatever
 * the engine last wrote. This module is the seam between them.
 *
 * Why JSON in the repo rather than a hosted database:
 *
 *   - Vercel has no writable filesystem, so the app cannot own the state.
 *   - A cron job that commits its output gives a real, auditable history for
 *     free. The heal log becomes a git diff: a reviewer can read exactly what
 *     a collector returned before and after a repair, at the commit where it
 *     happened.
 *   - `make demo` works from a clean clone with no services to start.
 *
 * See docs/adr/001-repo-as-database.md.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Store } from './db.js'
import { loadSignals, loadTargets, loadIcp, loadVerifiedSources } from '../config/load.js'
import { loadCollectors } from '../adapters/web.js'
import { allAdapters } from '../adapters/index.js'
import { scoreAll } from '../signals/score.js'
import { buildBrief } from '../brief.js'
import { dayOf } from '../clock.js'
import { forge } from '../campaign/forge.js'
import { canApprove } from '../campaign/gate.js'
import type { BrandKit } from '../enrich/brandkit.js'
import { buildProfile, whyNow } from '../enrich/profile.js'
import { resolveField, resolveStrings } from '../signals/fieldpath.js'
import type { JobRow } from '../adapters/jobs.js'
import { readFileSync, existsSync } from 'node:fs'

const EXPORT_DIR = join(process.cwd(), 'data', 'export')

export interface ExportResult {
  files: string[]
  counts: Record<string, number>
}

export function exportAll(store: Store, at: string = new Date().toISOString()): ExportResult {
  mkdirSync(EXPORT_DIR, { recursive: true })

  const signals = loadSignals()
  const targets = loadTargets()
  const icp = loadIcp()
  const collectors = loadCollectors()
  const health = store.healthMap()
  const sources = loadVerifiedSources()

  const events = store.eventsUpTo(at, 90)
  const accounts = scoreAll(targets, events, signals, icp, at)
  const heals = store.heals(500)

  const brief = buildBrief({ date: dayOf(at), targets, events, signals, icp, health })

  const files: string[] = []
  const write = (name: string, data: unknown) => {
    writeFileSync(join(EXPORT_DIR, name), JSON.stringify(data, null, 2) + '\n')
    files.push(name)
  }

  // Signal templates, for the Studio gallery.
  write('signals.json', {
    generatedAt: at,
    signals: signals.map((s) => ({
      ...s,
      // Which targets this signal has a verified source for.
      coverage: targets.filter((t) => sources[t.id]?.[s.id] || (s.adapter === 'jobs' && t.jobs)).length,
      collector: Object.values(collectors).find((c) => c.signalId === s.id) ?? null,
    })),
  })

  write('accounts.json', { generatedAt: at, accounts })
  write('brief.json', brief)
  write(`brief-${brief.date}.json`, brief)

  write('collectors.json', {
    generatedAt: at,
    collectors: Object.values(collectors).map((c) => ({
      ...c,
      state: health[c.collectorId] ?? 'UNKNOWN',
    })),
    adapters: allAdapters().map((a) => ({
      kind: a.kind,
      usesBrightData: a.usesBrightData,
      scraperType: a.scraperType,
    })),
  })

  write('heals.json', { generatedAt: at, heals, stats: healStats(heals) })

  // Brand kits, read off each company's own homepage by `bellwether enrich`.
  const brands = loadBrands()
  write('brands.json', { generatedAt: at, brands })


  /**
   * Campaigns, forged for every account that has evidence.
   *
   * Each is generated with its approval verdict already computed, so the UI
   * never has to decide whether a draft is safe to send — the gate is part of
   * the artifact. A campaign citing a broken collector arrives blocked.
   */
  const campaigns = accounts
    .filter((a) => a.signals.length > 0)
    .map((a) => {
      const campaign = forge({
        account: a,
        signals: a.signals,
        icp,
        brand: brands[a.targetId] ?? null,
        at,
      })
      return { ...campaign, gate: canApprove(campaign, health) }
    })
  write('campaigns.json', { generatedAt: at, campaigns })

  /**
   * Business profiles — what a salesperson needs, derived from what we observed.
   *
   * Job boards are the richest business signal we hold: department mix, office
   * footprint, the technologies a company names in its own postings, and who
   * will own the decision. All of it is about the SHAPE of the org, never a
   * person.
   */
  const profiles: Record<string, unknown> = {}
  for (const t of targets) {
    // Any jobs-backed signal carries the same board payload.
    const jobsObs =
      store.latestObservation('building_the_function', t.id, at) ??
      store.latestObservation('stack_adoption', t.id, at) ??
      store.latestObservation('headcount_surge', t.id, at)

    const jobs = jobsObs ? (resolveField(jobsObs.rows, 'jobs[]') as JobRow[]) : null

    // Compliance badges, if the security signal ever ran for this account.
    const secObs = store.latestObservation('enterprise_readiness', t.id, at)
    const compliance = secObs ? resolveStrings(secObs.rows, 'badges[].name') : []

    const profile = buildProfile({ jobs, brand: brands[t.id] ?? null, compliance })
    const account = accounts.find((a) => a.targetId === t.id)
    profiles[t.id] = {
      ...profile,
      whyNow: whyNow(account?.signals.map((sig) => sig.signalName) ?? [], profile),
    }
  }
  write('profiles.json', { generatedAt: at, profiles })

  // Prospect candidates from `bellwether discover`, if any have been found.
  const candidatesPath = join(process.cwd(), 'data', 'candidates.json')
  if (existsSync(candidatesPath)) {
    try {
      write('candidates.json', JSON.parse(readFileSync(candidatesPath, 'utf8')))
    } catch {
      /* a malformed candidates file must not fail the whole export */
    }
  }

  write('meta.json', {
    generatedAt: at,
    signalCount: signals.length,
    targetCount: targets.length,
    collectorCount: Object.keys(collectors).length,
    eventCount: events.length,
    verifiedSourceCount: Object.values(sources).reduce((a, v) => a + Object.keys(v).length, 0),
    jobBoardCount: targets.filter((t) => t.jobs).length,
    icp: { name: icp.name, threshold: icp.brief_threshold },
  })

  return {
    files,
    counts: {
      signals: signals.length,
      accounts: accounts.length,
      events: events.length,
      collectors: Object.keys(collectors).length,
      heals: heals.length,
      briefEntries: brief.entries.length,
    },
  }
}

function loadBrands(): Record<string, BrandKit> {
  const path = join(process.cwd(), 'data', 'brands.json')
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, BrandKit>
  } catch {
    return {}
  }
}

/**
 * The numbers the README quotes. They come from this function, computed over
 * real heal events — never from an estimate.
 */
export function healStats(heals: ReturnType<Store['heals']>) {
  // `approved_ineffective` counts as a FAILURE, not as an unfinished attempt.
  // The fix passed its preview and was approved, and production still returned
  // the broken output. Excluding it would let the dashboard report 100% heal
  // success while six of seven collectors sat quarantined.
  const ineffective = heals.filter((h) => h.verdict === 'approved_ineffective')
  const approved = heals.filter((h) => h.verdict === 'approved')
  const rejected = heals.filter((h) => h.verdict === 'rejected')
  const finished = [...approved, ...rejected, ...ineffective]

  // Only repairs confirmed in production contribute to the timing figure.
  const durations = approved
    .map((h) => h.durationMs)
    .filter((d): d is number => typeof d === 'number')
    .sort((a, b) => a - b)

  return {
    attempts: heals.length,
    approved: approved.length,
    rejected: rejected.length,
    ineffective: ineffective.length,
    errored: heals.filter((h) => h.verdict === 'error').length,
    quarantined: heals.filter((h) => h.toState === 'QUARANTINED').length,
    successRate: finished.length ? approved.length / finished.length : 0,
    medianMs: durations.length ? durations[Math.floor(durations.length / 2)]! : 0,
    rowsRecovered: approved.reduce((a, h) => a + (h.rowsRecovered ?? 0), 0),
  }
}
