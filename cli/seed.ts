#!/usr/bin/env tsx
/**
 * Demo seed.
 *
 *   npm run seed          build the demo dataset in data/demo.db
 *
 * WHAT THIS IS, PLAINLY: a scripted scenario, not observed history.
 *
 * A signal fires on a CHANGE, so a live demo needs two snapshots of a source
 * with something different between them. Real change arrives on the timescale
 * of a company's roadmap, which is longer than a hackathon. So this writes a
 * pair of snapshots per source describing a plausible overnight change.
 *
 * What is NOT faked: the events themselves. The snapshots go through the same
 * `match()` the production pipeline uses, so every event, every evidence
 * sentence, every score and every gate verdict is computed by the real code
 * from the real config. Change a threshold in signals.yaml and this output
 * changes with it.
 *
 * The dataset is written to a SEPARATE database and marked `demo: true` in the
 * export, so seeded numbers can never be mistaken for observed ones.
 */
import { existsSync, readFileSync } from 'node:fs'
import { Store } from '../src/core/store/db.js'
import { loadSignals, loadTargets, getSignal, resolveUrl } from '../src/core/config/load.js'
import { match } from '../src/core/signals/match.js'
import type { Observation, SignalSpec, Target } from '../src/core/types.js'

const argv = process.argv.slice(2)
const dbFlag = argv.indexOf('--db')
const DB = (dbFlag >= 0 ? argv[dbFlag + 1] : undefined) ?? process.env.BELLWETHER_DB ?? 'data/demo.db'

/** Yesterday and this morning, fixed so the demo replays identically. */
const T0 = '2026-08-20T04:12:00.000Z'
const T1 = '2026-08-21T04:12:00.000Z'

interface Scene {
  targetId: string
  signalId: string
  /** Collector id, or null for sources that need none. */
  collectorId: string | null
  before: Record<string, unknown>[]
  after: Record<string, unknown>[]
}

const tier = (name: string, price: string, cta: string) => ({ name, price, cta })
const job = (title: string, department: string, posted_at: string, description = '') => ({
  title,
  department,
  location: 'Remote',
  description,
  posted_at,
})

/**
 * The scenario. Four accounts move overnight, each for a different reason,
 * so the brief shows the range of what the platform notices.
 */
const SCENES: Scene[] = [
  // ------------------------------------------------- Zluri: the flagship story
  // Two signals on the same morning: the pricing page grew an Enterprise tier,
  // and they opened the role that usually follows it.
  {
    targetId: 'zluri',
    signalId: 'moving_upmarket',
    collectorId: 'c_8f2a91',
    before: [{ tiers: [tier('Free', '$0', 'Start free'), tier('Growth', '$8/user', 'Buy now'), tier('Scale', '$14/user', 'Buy now')] }],
    after: [{ tiers: [tier('Free', '$0', 'Start free'), tier('Growth', '$8/user', 'Buy now'), tier('Scale', '$14/user', 'Buy now'), tier('Enterprise', 'Custom', 'Contact sales')] }],
  },
  {
    targetId: 'zluri',
    signalId: 'building_the_function',
    collectorId: null,
    before: [{ jobs: [job('Account Executive', 'Sales', '2026-07-30'), job('Product Designer', 'Design', '2026-08-02')] }],
    after: [{ jobs: [job('Account Executive', 'Sales', '2026-07-30'), job('Product Designer', 'Design', '2026-08-02'), job('Senior RevOps Manager', 'Revenue', '2026-08-18', 'Own the revenue stack end to end, including Salesforce and dbt models.')] }],
  },

  // --------------------------------------- Hightouch: proving they can be bought
  {
    targetId: 'hightouch',
    signalId: 'enterprise_readiness',
    collectorId: 'c_3d71bb',
    before: [{ badges: [{ name: 'GDPR', status: 'Compliant' }] }],
    after: [{ badges: [{ name: 'GDPR', status: 'Compliant' }, { name: 'SOC 2 Type II', status: 'Certified' }] }],
  },
  {
    targetId: 'hightouch',
    signalId: 'building_the_function',
    collectorId: null,
    before: [{ jobs: [job('Solutions Architect', 'Field', '2026-07-22')] }],
    after: [{ jobs: [job('Solutions Architect', 'Field', '2026-07-22'), job('GTM Engineer', 'Revenue', '2026-08-20', 'Build and own the go-to-market data stack on Snowflake and dbt.')] }],
  },

  // ------------------------------------------- Supabase: the pricing page moves
  // Cites the REAL supabase pricing collector, which production checks left
  // QUARANTINED. Its campaign should therefore arrive blocked -- the approval
  // gate refusing a genuinely broken source rather than a mocked one.
  {
    targetId: 'supabase',
    signalId: 'moving_upmarket',
    collectorId: 'c_mt2tgjmm9mzvu9rjb',
    before: [{ tiers: [tier('Free', '$0', 'Start free'), tier('Pro', '$25', 'Buy now'), tier('Team', '$599', 'Buy now')] }],
    after: [{ tiers: [tier('Free', '$0', 'Start free'), tier('Pro', '$25', 'Buy now'), tier('Team', '$599', 'Buy now'), tier('Enterprise', 'Custom', 'Contact sales')] }],
  },

  // ------------------------------------------------- Clerk: repricing + a new seat
  // Likewise the real clerk pricing collector: also quarantined.
  {
    targetId: 'clerk',
    signalId: 'price_change',
    collectorId: 'c_mt2tglauwtt6klw9q',
    before: [{ tiers: [tier('Free', '$0', 'Start free'), tier('Pro', '$25', 'Buy now'), tier('Enterprise', 'Custom', 'Contact sales')] }],
    after: [{ tiers: [tier('Free', '$0', 'Start free'), tier('Pro', '$29', 'Buy now'), tier('Enterprise', 'Custom', 'Contact sales')] }],
  },
  {
    targetId: 'clerk',
    signalId: 'leadership_change',
    collectorId: 'c_9a4c02',
    before: [{ roles: [{ title: 'Chief Executive Officer', function: 'Company' }, { title: 'VP of Engineering', function: 'Engineering' }] }],
    after: [{ roles: [{ title: 'Chief Executive Officer', function: 'Company' }, { title: 'VP of Engineering', function: 'Engineering' }, { title: 'VP of Revenue', function: 'Revenue' }] }],
  },

  // ------------------------------------------------------------------ the control
  // One mid-weight signal on a lower-fit account. It fires, it is stored, and it
  // correctly does NOT reach the brief — the ICP threshold is doing its job.
  {
    targetId: 'trigger',
    signalId: 'stack_adoption',
    collectorId: null,
    before: [{ jobs: [job('Backend Engineer', 'Engineering', '2026-08-01', 'Postgres and Redis at scale.')] }],
    after: [{ jobs: [job('Backend Engineer', 'Engineering', '2026-08-01', 'Postgres and Redis at scale.'), job('Analytics Engineer', 'Data', '2026-08-19', 'Model our warehouse in dbt on top of Snowflake.')] }],
  },
]

function observation(
  signal: SignalSpec,
  target: Target,
  collectorId: string | null,
  rows: Record<string, unknown>[],
  at: string,
): Observation {
  return {
    collectorId,
    signalId: signal.id,
    targetId: target.id,
    sourceUrl: resolveUrl(signal, target),
    observedAt: at,
    rows,
  }
}

/**
 * Copy real heal history and collector health from another database.
 *
 * The scripted scenario supplies signals and campaigns; the heal log should
 * still show what actually happened to real collectors. Those are separate
 * kinds of record and they stay separately sourced: the events below are
 * authored, the repairs imported here are not.
 */
function importHeals(store: Store, fromDb: string): number {
  if (!existsSync(fromDb)) {
    console.log(`  (no ${fromDb} — heal log will be empty)`)
    return 0
  }
  const src = new Store(fromDb)
  const heals = src.heals(500)
  for (const h of heals) store.putHeal(h)

  // Identity comes from config, not from the health row, so an imported state
  // stays attached to the (signal, account) pair it actually belongs to.
  const collectors: Record<string, { signalId: string; targetId: string; collectorId: string }> =
    existsSync('config/collectors.json')
      ? JSON.parse(readFileSync('config/collectors.json', 'utf8'))
      : {}
  const byCollectorId = new Map(Object.values(collectors).map((c) => [c.collectorId, c]))

  let health = 0
  for (const [collectorId, state] of Object.entries(src.healthMap())) {
    const owner = byCollectorId.get(collectorId)
    const rec = src.getHealth(collectorId)
    store.setHealth(
      collectorId,
      owner?.signalId ?? 'unknown',
      owner?.targetId ?? null,
      state,
      rec?.attempts ?? 0,
      rec?.baseline ?? null,
    )
    health++
  }
  src.close()
  console.log(`  imported ${heals.length} real heal event(s) and ${health} collector state(s) from ${fromDb}`)
  return heals.length
}

function main() {
  const store = new Store(DB)
  const targets = loadTargets()
  const byId = new Map(targets.map((t) => [t.id, t]))

  console.log(`seeding demo dataset -> ${DB}\n`)

  let fired = 0
  for (const scene of SCENES) {
    const signal = getSignal(scene.signalId)
    const target = byId.get(scene.targetId)
    if (!signal || !target) {
      console.log(`  skip ${scene.targetId}/${scene.signalId} — not in config`)
      continue
    }

    const before = observation(signal, target, scene.collectorId, scene.before, T0)
    const after = observation(signal, target, scene.collectorId, scene.after, T1)

    store.putObservation(before)
    store.putObservation(after)

    // The real matcher, the real config. Nothing about the event is authored.
    const event = match(signal, before, after)
    if (event) {
      store.putEvent(event)
      fired++
      console.log(`  ${target.name.padEnd(12)} ${signal.name.padEnd(22)} ${event.evidence[0]?.sentence ?? ''}`)
    } else {
      console.log(`  ${target.name.padEnd(12)} ${signal.name.padEnd(22)} (did not fire)`)
    }

    // Collectors that back these claims are healthy until the demo breaks one.
    if (scene.collectorId) {
      store.setHealth(scene.collectorId, signal.id, target.id, 'HEALTHY', 0, {
        collectorId: scene.collectorId,
        rowCountMean: scene.after.length ? countOf(scene.after, signal) : 0,
        fields: Object.fromEntries(signal.fields.required.map((f) => [f, 0])),
        samples: 4,
      })
    }
  }

  // Real repair history, so the Heal Log reflects live collectors rather than
  // invented ones. Pass --no-import to keep the demo database purely scripted.
  if (!argv.includes('--no-import')) importHeals(store, 'data/bellwether.db')

  console.log(`\n${fired} signal(s) fired from ${SCENES.length} scripted change(s)`)
  console.log(`\nnext: BELLWETHER_DB=${DB} npm run bw -- export --date 2026-08-21`)
  store.close()
}

function countOf(rows: Record<string, unknown>[], signal: SignalSpec): number {
  const first = signal.fields.required[0] ?? ''
  const idx = first.indexOf('[]')
  if (idx === -1) return rows.length
  const key = first.slice(0, idx)
  const bag = rows[0]?.[key]
  return Array.isArray(bag) ? bag.length : rows.length
}

main()
