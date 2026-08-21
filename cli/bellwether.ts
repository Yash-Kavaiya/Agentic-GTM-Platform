#!/usr/bin/env tsx
/**
 * The Bellwether CLI.
 *
 *   bellwether run     [--signal id] [--target id] [--no-heal]  collect + fire signals
 *   bellwether status                                           collectors, health, counts
 *   bellwether heal    <collectorId>                            force a repair cycle
 *
 * The terminal is the primary interface for the engine; the web app reads what
 * the engine writes. That split is what lets the whole pipeline run in CI.
 */
import { loadEnv } from '../src/core/env.js'
loadEnv()

import { Store } from '../src/core/store/db.js'
import { runCollection } from '../src/core/pipeline.js'
import { systemClock, fixedClock } from '../src/core/clock.js'
import { loadSignals, loadTargets, getSignal } from '../src/core/config/load.js'
import { loadCollectors } from '../src/core/adapters/web.js'
import { allAdapters } from '../src/core/adapters/index.js'
import { checkAndHeal } from '../src/core/anneal/heal.js'
import { buildBrief, renderBriefText } from '../src/core/brief.js'
import { exportAll } from '../src/core/store/export.js'
import { loadIcp } from '../src/core/config/load.js'
import { dayOf } from '../src/core/clock.js'
import { extractBrandKit, type BrandKit } from '../src/core/enrich/brandkit.js'
import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const command = argv[0] ?? 'help'

const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const has = (name: string) => argv.includes(`--${name}`)
const list = (name: string): string[] | undefined => flag(name)?.split(',').filter(Boolean)

/**
 * Which database to use.
 *
 * A `--db` flag rather than an env-var prefix: `BELLWETHER_DB=x npm run ...`
 * is a POSIX-ism that fails in Windows cmd, and `make demo` has to work from a
 * clean clone on any machine.
 */
const dbPath = (): string | undefined => flag('db') ?? process.env.BELLWETHER_DB

async function cmdRun() {
  const store = new Store(dbPath())
  const date = flag('date')
  const clock = date ? fixedClock(date) : systemClock

  console.log(`bellwether run — ${clock.now().toISOString()}\n`)
  const summary = await runCollection({
    store,
    clock,
    signalIds: list('signal'),
    targetIds: list('target'),
    skipHeal: has('no-heal'),
    log: (l) => console.log(l),
  })

  const c = summary.counts
  console.log(
    `\nok:${c.ok}  skipped:${c.skipped}  refused:${c.refused}  error:${c.error}` +
      `  fired:${c.fired}  healed:${c.healed}`,
  )

  if (summary.events.length) {
    console.log(`\nSignals fired:`)
    for (const e of summary.events) {
      console.log(`  ${e.targetId.padEnd(12)} ${e.signalId.padEnd(22)} ${e.evidence[0]?.sentence ?? ''}`)
    }
  }

  const errors = summary.results.filter((r) => r.status === 'error')
  if (errors.length) {
    console.log(`\nErrors (${errors.length}):`)
    for (const e of errors.slice(0, 12)) {
      console.log(`  ${e.targetId.padEnd(12)} ${e.signalId.padEnd(22)} ${e.detail.slice(0, 90)}`)
    }
  }
  store.close()
}

function cmdStatus() {
  const store = new Store(dbPath())
  const signals = loadSignals()
  const targets = loadTargets()
  const collectors = loadCollectors()
  const health = store.healthMap()

  console.log(`Bellwether\n`)
  console.log(`  signals    ${signals.length} templates`)
  console.log(`  targets    ${targets.length} accounts`)
  console.log(`  adapters   ${allAdapters().length} registered`)

  const bd = allAdapters().filter((a) => a.usesBrightData)
  const types = [...new Set(bd.map((a) => a.scraperType).filter(Boolean))]
  console.log(`             ${bd.length} via Bright Data (${types.join(', ')}), ${allAdapters().length - bd.length} direct`)

  console.log(`\n  collectors ${Object.keys(collectors).length}`)
  for (const [key, c] of Object.entries(collectors)) {
    const state = health[c.collectorId] ?? 'UNKNOWN'
    console.log(`    ${key.padEnd(14)} ${c.collectorId.padEnd(24)} ${c.scraperType.padEnd(9)} ${state}`)
  }
  if (Object.keys(collectors).length === 0) {
    console.log(`    none yet — run \`npm run bw:provision\` (needs \`bdata login\`)`)
  }

  const events = store.eventsUpTo(new Date().toISOString(), 3650)
  console.log(`\n  signal events on file: ${events.length}`)
  const heals = store.heals(1000)
  if (heals.length) {
    const approved = heals.filter((h) => h.verdict === 'approved').length
    const durations = heals.filter((h) => h.durationMs).map((h) => h.durationMs!).sort((a, b) => a - b)
    const median = durations.length ? durations[Math.floor(durations.length / 2)]! : 0
    console.log(`  heal events: ${heals.length} (${approved} approved), median ${(median / 1000).toFixed(1)}s`)
  }
  store.close()
}

async function cmdHeal() {
  const collectorId = argv[1]
  if (!collectorId) {
    console.error('usage: bellwether heal <collectorId>')
    process.exit(1)
  }
  const store = new Store(dbPath())
  const record = Object.values(loadCollectors()).find((c) => c.collectorId === collectorId)
  if (!record) {
    console.error(`unknown collector "${collectorId}"`)
    process.exit(1)
  }
  const signal = getSignal(record.signalId)
  if (!signal) {
    console.error(`collector references unknown signal "${record.signalId}"`)
    process.exit(1)
  }

  const latest = store.recentForCollector(collectorId, 1)[0]
  if (!latest) {
    console.error(`no observations for ${collectorId} — run \`bellwether run\` first`)
    process.exit(1)
  }

  const outcome = await checkAndHeal(store, collectorId, signal, latest.targetId, latest.sourceUrl, latest, {
    ...(await import('../src/core/anneal/heal.js')).liveDeps,
    log: (l) => console.log(l),
  })
  console.log(`\nfinal state: ${outcome.finalState}, ${outcome.events.length} heal event(s)`)
  store.close()
}

const BRANDS_PATH = join(process.cwd(), 'data', 'brands.json')

/**
 * Read each target's visual identity off its own homepage.
 *
 * Cached to data/brands.json because a brand kit changes on the timescale of a
 * rebrand, not a cron tick, and re-fetching 20 homepages every run would be
 * rude to the targets for no benefit.
 */
async function cmdEnrich() {
  const targets = loadTargets().filter((t) => !list('target') || list('target')!.includes(t.id))
  const existing: Record<string, BrandKit> = existsSync(BRANDS_PATH)
    ? JSON.parse(readFileSync(BRANDS_PATH, 'utf8'))
    : {}
  const force = has('force')

  console.log(`enriching ${targets.length} target(s)\n`)
  let done = 0
  await Promise.all(
    targets.map(async (t) => {
      if (existing[t.id] && !force) {
        console.log(`  ${t.id.padEnd(12)} cached`)
        return
      }
      try {
        const kit = await extractBrandKit(t.domain)
        existing[t.id] = kit
        done++
        console.log(
          `  ${t.id.padEnd(12)} ${(kit.primary ?? '-').padEnd(8)} ${kit.fonts.slice(0, 2).join(', ') || 'no webfont'}`,
        )
      } catch (e) {
        console.log(`  ${t.id.padEnd(12)} ERROR ${(e as Error).message.slice(0, 70)}`)
      }
    }),
  )

  mkdirSync(join(process.cwd(), 'data'), { recursive: true })
  writeFileSync(BRANDS_PATH, JSON.stringify(existing, null, 2) + '\n')
  console.log(`\n${done} fetched, ${Object.keys(existing).length} on file -> data/brands.json`)
}

/**
 * Check every collector against production, and record what it finds.
 *
 * Deliberately does not heal. A preview is a promise, not a result: a fix can
 * pass its preview, be approved, and leave the very next production run
 * returning exactly the broken output it had before. This is the cheap,
 * repeatable way to ask "is this source actually working right now" without
 * spending a heal to find out.
 *
 * A collector that fails here is QUARANTINED, which blocks any campaign that
 * cites it. That is the intended outcome: an unfixable source must not reach a
 * prospect.
 */
async function cmdVerify() {
  const store = new Store(dbPath())
  const collectors = Object.values(loadCollectors())
  const only = list('collector')
  const targets = new Map(loadTargets().map((t) => [t.id, t]))

  const chosen = only ? collectors.filter((c) => only.includes(c.collectorId)) : collectors
  console.log(`verifying ${chosen.length} collector(s) against production
`)

  const { scraperRun } = await import('../src/core/brightdata/cli.js')
  const { computeStats, verifyAgainstContract, buildBaseline } = await import('../src/core/anneal/health.js')

  let healthy = 0
  for (const c of chosen) {
    const signal = getSignal(c.signalId)
    const target = targets.get(c.targetId)
    if (!signal || !target) {
      console.log(`  ${c.key}: config missing — skipped`)
      continue
    }

    try {
      const res = await scraperRun(c.collectorId, [c.seedUrl])
      const stats = computeStats(res.rows, signal)
      const history = store.recentForCollector(c.collectorId)
      const baseline = store.getHealth(c.collectorId)?.baseline ?? buildBaseline(c.collectorId, history, signal)
      const verdict = verifyAgainstContract(stats, baseline, signal)

      const state = verdict.ok ? 'HEALTHY' : 'QUARANTINED'
      store.setHealth(c.collectorId, signal.id, target.id, state, 0, verdict.ok ? baseline : null)
      if (verdict.ok) healthy++

      // If an earlier heal was recorded as approved but production disagrees,
      // correct that record. Otherwise the heal log reports a repair that never
      // reached the source.
      if (!verdict.ok) {
        const amended = store.downgradeLastHeal(
          c.collectorId,
          'approved_ineffective',
          `production check ${new Date().toISOString().slice(0, 16)}Z: ${verdict.reasons.join('; ')}`,
        )
        if (amended) console.log(`  ${''.padEnd(34)} amended an earlier 'approved' heal to approved_ineffective`)
      }

      const fields = stats.fields.map((f) => `${f.field.split('.').pop()}:${Math.round(f.nullRate * 100)}%`).join(' ')
      console.log(`  ${c.key.padEnd(34)} ${state.padEnd(12)} rows=${String(stats.rowCount).padStart(3)}  ${fields}`)
      if (!verdict.ok) console.log(`  ${''.padEnd(34)} ${verdict.reasons.join('; ')}`)
    } catch (e) {
      store.setHealth(c.collectorId, c.signalId, c.targetId, 'QUARANTINED', 0, null)
      console.log(`  ${c.key.padEnd(34)} QUARANTINED  ${(e as Error).message.slice(0, 60)}`)
    }
  }

  console.log(`
${healthy}/${chosen.length} healthy`)
  store.close()
}

/**
 * Find companies that should be on the watchlist.
 *
 *   npm run bw -- discover --role "Revenue Operations Manager"
 *
 * Searches public job boards for the role that signals a company is building
 * the function you sell into. The company that posted it is the prospect.
 */
async function cmdDiscover() {
  const role = flag('role') ?? 'Revenue Operations Manager'
  const { discoverProspects } = await import('../src/core/discover.js')
  const { writeFileSync: wf, mkdirSync: mk } = await import('node:fs')

  const known = loadTargets().map((t) => t.jobs?.token ?? t.id)
  const candidates = await discoverProspects({ role, known, log: (l) => console.log(l) })

  mk(join(process.cwd(), 'data'), { recursive: true })
  wf(
    join(process.cwd(), 'data', 'candidates.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), role, candidates }, null, 2) + '\n',
  )

  console.log(`\n${candidates.length} candidate(s) -> data/candidates.json`)
  const strong = candidates.filter((c) => c.score >= 60)
  if (strong.length) {
    console.log(`
Worth a look:`)
    for (const c of strong) {
      console.log(`  ${c.name.padEnd(24)} ${String(c.score).padStart(3)}  ${c.domain ?? '-'}`)
      for (const n of c.notes) console.log(`  ${''.padEnd(24)}      ${n}`)
    }
  }
}

function cmdBrief() {
  const store = new Store(dbPath())
  const date = flag('date') ?? dayOf(new Date())
  const at = `${date}T23:59:59.999Z`

  const brief = buildBrief({
    date,
    targets: loadTargets(),
    events: store.eventsUpTo(at, 90),
    signals: loadSignals(),
    icp: loadIcp(),
    health: store.healthMap(),
    windowHours: Number(flag('window') ?? 24),
  })

  console.log(renderBriefText(brief))
  store.close()
}

function cmdExport() {
  const store = new Store(dbPath())
  const at = flag('date') ? `${flag('date')}T23:59:59.999Z` : new Date().toISOString()
  const result = exportAll(store, at)
  console.log(`exported ${result.files.length} files to data/export/`)
  for (const [k, v] of Object.entries(result.counts)) console.log(`  ${k.padEnd(14)} ${v}`)
  store.close()
}

function help() {
  console.log(`bellwether — agentic GTM signal platform

  run     [--signal a,b] [--target a,b] [--date ISO] [--no-heal]
  brief   [--date YYYY-MM-DD] [--window HOURS]
  discover [--role "Revenue Operations Manager"]  find new accounts
  verify  [--collector c_a,c_b]   check collectors against production
  enrich  [--target a,b] [--force]
  export  [--date YYYY-MM-DD]
  status
  heal    <collectorId>
`)
}

const commands: Record<string, () => void | Promise<void>> = {
  run: cmdRun,
  status: cmdStatus,
  brief: cmdBrief,
  verify: cmdVerify,
  discover: cmdDiscover,
  enrich: cmdEnrich,
  export: cmdExport,
  heal: cmdHeal,
  help,
}

const fn = commands[command]
if (!fn) {
  console.error(`unknown command "${command}"`)
  help()
  process.exit(1)
}
await fn()
