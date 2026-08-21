/**
 * Collector provisioning.
 *
 *   npm run bw:provision            # fire every planned collector
 *   npm run bw:provision -- pricing # fire one
 *   npm run bw:provision -- --list  # show the plan without spending anything
 *
 * `scraper create` takes 5-25 minutes per collector, so this is the first thing
 * that runs and everything else is built while it cooks. Collectors fire
 * concurrently and each writes its Collector ID to config/collectors.json the
 * moment it lands, so a crash halfway through never loses a finished collector.
 *
 * Nothing is provisioned against a URL that data/probe.json has not seen return
 * 200 — a create against a 404 costs real money and 25 minutes.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadSignals, loadTargets, resolveUrl, assertWatchIntegrity } from '../src/core/config/load.js'
import { scraperCreate } from '../src/core/brightdata/cli.js'
import { preflight } from '../src/core/adapters/compliance.js'
import type { SignalSpec, Target } from '../src/core/types.js'

const COLLECTORS_PATH = join(process.cwd(), 'config', 'collectors.json')
const PROBE_PATH = join(process.cwd(), 'data', 'probe.json')

/**
 * The collectors Bellwether provisions, and why each one exists.
 *
 * Four distinct Bright Data scraper types are in play across the platform:
 *   PDP      pricing, security, integrations  (structured extraction per page)
 *   Sitemap  docs surface growth
 *   Search   keyword discovery, no URL required
 *   Discovery careers pages for companies with no public board API
 *
 * Jobs deliberately does NOT get a collector for the 12 targets that publish a
 * documented public JSON board API (Greenhouse / Lever / Ashby). Routing those
 * through a scraper would be theatre: the API already returns clean structured
 * JSON. Scraper Studio is used where scraping is the honest tool for the job.
 */
interface CollectorPlan {
  key: string
  signalId: string
  /** Which probe result must be present for a target to be collectable. */
  probeKey: 'pricing' | 'security' | 'integrations' | 'customers' | 'about'
  scraperType: 'PDP' | 'Sitemap' | 'Search' | 'Discovery'
}

const PLAN: CollectorPlan[] = [
  { key: 'pricing', signalId: 'moving_upmarket', probeKey: 'pricing', scraperType: 'PDP' },
  { key: 'security', signalId: 'enterprise_readiness', probeKey: 'security', scraperType: 'PDP' },
  { key: 'integrations', signalId: 'ecosystem_expansion', probeKey: 'integrations', scraperType: 'PDP' },
  { key: 'customers', signalId: 'segment_shift', probeKey: 'customers', scraperType: 'PDP' },
]

interface ProbeResult {
  id: string
  pages: Record<string, { url: string } | null>
  sitemap: { url: string; locs: number } | null
  jobs: { ok: boolean; count: number | null } | null
}

interface CollectorRecord {
  key: string
  signalId: string
  collectorId: string
  scraperType: string
  seedUrl: string
  /** The exact string sent to `scraper create`. Must equal SignalSpec.watch. */
  watch: string
  createdAt: string
  viewUrl?: string
}

const loadProbe = (): ProbeResult[] => {
  if (!existsSync(PROBE_PATH)) {
    throw new Error('data/probe.json missing — run `npm run probe` first.')
  }
  return JSON.parse(readFileSync(PROBE_PATH, 'utf8')).results as ProbeResult[]
}

const loadCollectors = (): Record<string, CollectorRecord> =>
  existsSync(COLLECTORS_PATH) ? JSON.parse(readFileSync(COLLECTORS_PATH, 'utf8')) : {}

function saveCollector(rec: CollectorRecord): void {
  const all = loadCollectors()
  all[rec.key] = rec
  mkdirSync(join(process.cwd(), 'config'), { recursive: true })
  writeFileSync(COLLECTORS_PATH, JSON.stringify(all, null, 2) + '\n')
}

/** Targets whose page for this plan entry actually returned 200. */
function collectableTargets(plan: CollectorPlan, probe: ProbeResult[], targets: Target[]) {
  const byId = new Map(targets.map((t) => [t.id, t]))
  return probe
    .filter((p) => p.pages[plan.probeKey])
    .map((p) => ({ target: byId.get(p.id)!, url: p.pages[plan.probeKey]!.url }))
    .filter((x) => x.target)
}

async function provisionOne(
  plan: CollectorPlan,
  signal: SignalSpec,
  seedUrl: string,
): Promise<void> {
  const verdict = await preflight(seedUrl)
  if (!verdict.allowed) {
    console.log(`  ${plan.key}: REFUSED — ${verdict.reason}`)
    return
  }

  // The invariant: what reaches Bright Data is byte-identical to the YAML.
  assertWatchIntegrity(signal.id, signal.watch)

  console.log(`  ${plan.key}: creating against ${seedUrl} (5-25 min)...`)
  const started = Date.now()

  try {
    const res = await scraperCreate(seedUrl, signal.watch, `bellwether-${plan.key}`, {
      onProgress: (c) => {
        const line = c.trim().split('\n').pop()
        if (line) process.stdout.write(`  ${plan.key}: ${line}\n`)
      },
    })

    const collectorId = res.envelope?.collector_id
    if (!collectorId) {
      console.log(`  ${plan.key}: FAILED — no collector_id. status=${res.envelope?.status ?? '?'}`)
      if (res.stderr.trim()) console.log(`    ${res.stderr.trim().slice(0, 400)}`)
      return
    }

    saveCollector({
      key: plan.key,
      signalId: signal.id,
      collectorId,
      scraperType: plan.scraperType,
      seedUrl,
      watch: signal.watch,
      createdAt: new Date().toISOString(),
      viewUrl: res.envelope?.view_url,
    })

    const mins = ((Date.now() - started) / 60_000).toFixed(1)
    console.log(`  ${plan.key}: OK ${collectorId} in ${mins} min -> config/collectors.json`)
  } catch (e) {
    console.log(`  ${plan.key}: ERROR — ${(e as Error).message}`)
  }
}

async function main() {
  const args = process.argv.slice(2)
  const listOnly = args.includes('--list')
  const only = args.find((a) => !a.startsWith('--'))

  const signals = loadSignals()
  const targets = loadTargets()
  const probe = loadProbe()
  const existing = loadCollectors()

  const plans = only ? PLAN.filter((p) => p.key === only) : PLAN
  if (plans.length === 0) {
    console.error(`no plan named "${only}". Known: ${PLAN.map((p) => p.key).join(', ')}`)
    process.exit(1)
  }

  console.log('Provisioning plan\n')
  const work: { plan: CollectorPlan; signal: SignalSpec; seedUrl: string }[] = []

  for (const plan of plans) {
    const signal = signals.find((s) => s.id === plan.signalId)
    if (!signal) {
      console.log(`  ${plan.key}: no signal "${plan.signalId}" in signals.yaml — skipped`)
      continue
    }
    const collectable = collectableTargets(plan, probe, targets)
    if (collectable.length === 0) {
      console.log(`  ${plan.key}: no target has a verified ${plan.probeKey} page — skipped`)
      continue
    }

    // Seed against the first verified page; the collector then runs against all of them.
    const seedUrl = collectable[0]!.url
    const have = existing[plan.key]

    console.log(
      `  ${plan.key.padEnd(13)} ${plan.scraperType.padEnd(9)} ${collectable.length} targets  seed=${seedUrl}` +
        (have ? `  [already ${have.collectorId}]` : ''),
    )
    if (!have) work.push({ plan, signal, seedUrl })
  }

  if (listOnly) {
    console.log('\n--list: nothing spent.')
    return
  }
  if (work.length === 0) {
    console.log('\nEverything already provisioned. Delete config/collectors.json to redo.')
    return
  }

  console.log(`\nFiring ${work.length} creates concurrently. Each takes 5-25 minutes.\n`)
  await Promise.all(work.map((w) => provisionOne(w.plan, w.signal, w.seedUrl)))

  const final = loadCollectors()
  console.log(`\nCollectors on file: ${Object.keys(final).length}`)
  for (const [k, v] of Object.entries(final)) console.log(`  ${k.padEnd(13)} ${v.collectorId}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
