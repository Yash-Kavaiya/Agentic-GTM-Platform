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

const argv = process.argv.slice(2)
const command = argv[0] ?? 'help'

const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const has = (name: string) => argv.includes(`--${name}`)
const list = (name: string): string[] | undefined => flag(name)?.split(',').filter(Boolean)

async function cmdRun() {
  const store = new Store()
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
  const store = new Store()
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
  const store = new Store()
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

function cmdBrief() {
  const store = new Store()
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
  const store = new Store()
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
  export  [--date YYYY-MM-DD]
  status
  heal    <collectorId>
`)
}

const commands: Record<string, () => void | Promise<void>> = {
  run: cmdRun,
  status: cmdStatus,
  brief: cmdBrief,
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
