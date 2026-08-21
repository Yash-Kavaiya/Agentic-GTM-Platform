#!/usr/bin/env tsx
/**
 * Collector provisioning.
 *
 *   npm run bw:provision -- --list          show the plan, spend nothing
 *   npm run bw:provision                    provision the whole watchlist
 *   npm run bw:provision -- --target cal    provision one account
 *   npm run bw:provision -- --signal moving_upmarket
 *
 * The unit is (signal x account), not signal. A Scraper Studio PDP collector
 * encodes the DOM of the page it was generated from and does not generalise:
 * a collector seeded on cal.com/security returns real badges there and an empty
 * array on vanta.com/security. See docs/adr/004-collector-granularity.md.
 *
 * Two rules follow, and both cost real money when broken:
 *
 *   1. Never provision against a URL data/probe.json has not seen return 200.
 *      A create against a 404 costs 4-8 minutes and credit.
 *   2. Seed from a REPRESENTATIVE page. Our first pricing collector was seeded
 *      on posthog.com/pricing, which is usage-based and has no tier cards; the
 *      template it produced returned empty on every site, and a full heal cycle
 *      was spent repairing a collector that was mis-seeded from birth.
 */
import { loadEnv } from '../src/core/env.js'
loadEnv()

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadSignals, loadTargets, assertWatchIntegrity, loadVerifiedSources } from '../src/core/config/load.js'
import { scraperCreate } from '../src/core/brightdata/cli.js'
import { preflight } from '../src/core/adapters/compliance.js'
import type { SignalSpec, Target } from '../src/core/types.js'

const COLLECTORS_PATH = join(process.cwd(), 'config', 'collectors.json')

/**
 * The watchlist Bellwether covers deeply.
 *
 * Coverage is a costed decision, not a default. Each collector takes 4-8
 * minutes to build and consumes credit, so we watch a few accounts across
 * several signals rather than many accounts shallowly — which is also how an
 * account-based GTM tool actually works.
 */
const WATCHLIST = ['cal', 'posthog', 'clerk', 'supabase'] as const

/** Signals worth a Bright Data collector. Feeds and job APIs need none. */
const PROVISIONED_SIGNALS = [
  'moving_upmarket',
  'enterprise_readiness',
  'ecosystem_expansion',
  'segment_shift',
] as const

export interface CollectorRecord {
  key: string
  signalId: string
  targetId: string
  collectorId: string
  scraperType: string
  seedUrl: string
  /** The exact string sent to `scraper create`. Must equal SignalSpec.watch. */
  watch: string
  createdAt: string
  viewUrl?: string
}

/** Collectors are keyed by the pair they serve, not by signal alone. */
export const collectorKey = (signalId: string, targetId: string) => `${signalId}:${targetId}`

const loadCollectors = (): Record<string, CollectorRecord> =>
  existsSync(COLLECTORS_PATH) ? JSON.parse(readFileSync(COLLECTORS_PATH, 'utf8')) : {}

function saveCollector(rec: CollectorRecord): void {
  const all = loadCollectors()
  all[rec.key] = rec
  mkdirSync(join(process.cwd(), 'config'), { recursive: true })
  writeFileSync(COLLECTORS_PATH, JSON.stringify(all, null, 2) + '\n')
}

async function provisionOne(signal: SignalSpec, target: Target, seedUrl: string): Promise<void> {
  const key = collectorKey(signal.id, target.id)

  const verdict = await preflight(seedUrl)
  if (!verdict.allowed) {
    console.log(`  ${key}: REFUSED — ${verdict.reason}`)
    return
  }

  // The invariant: what reaches Bright Data is byte-identical to the YAML.
  assertWatchIntegrity(signal.id, signal.watch)

  console.log(`  ${key}: creating against ${seedUrl} (4-8 min)...`)
  const started = Date.now()

  try {
    const res = await scraperCreate(seedUrl, signal.watch, `bellwether-${signal.id}-${target.id}`, {
      onProgress: (c) => {
        const line = c.trim().split('\n').pop()
        // Only surface step changes; the poll counter is noise.
        if (line && /Step:|Done|Error/i.test(line) && !/attempt \d+/.test(line)) {
          process.stdout.write(`  ${key}: ${line}\n`)
        }
      },
    })

    const collectorId = res.envelope?.collector_id
    if (!collectorId) {
      console.log(`  ${key}: FAILED — no collector_id (status=${res.envelope?.status ?? '?'})`)
      if (res.stderr.trim()) console.log(`    ${res.stderr.trim().slice(0, 300)}`)
      return
    }

    saveCollector({
      key,
      signalId: signal.id,
      targetId: target.id,
      collectorId,
      scraperType: 'PDP',
      seedUrl,
      watch: signal.watch,
      createdAt: new Date().toISOString(),
      viewUrl: res.envelope?.view_url,
    })

    console.log(
      `  ${key}: OK ${collectorId} in ${((Date.now() - started) / 60_000).toFixed(1)} min`,
    )
  } catch (e) {
    console.log(`  ${key}: ERROR — ${(e as Error).message}`)
  }
}

async function main() {
  const argv = process.argv.slice(2)
  const flag = (n: string) => {
    const i = argv.indexOf(`--${n}`)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const listOnly = argv.includes('--list')
  const onlyTargets = flag('target')?.split(',')
  const onlySignals = flag('signal')?.split(',')

  const signals = loadSignals()
  const targets = loadTargets()
  const sources = loadVerifiedSources()
  const existing = loadCollectors()

  const byTargetId = new Map(targets.map((t) => [t.id, t]))

  const work: { signal: SignalSpec; target: Target; seedUrl: string }[] = []
  console.log('Provisioning plan — one collector per (signal x account)\n')

  for (const targetId of onlyTargets ?? WATCHLIST) {
    const target = byTargetId.get(targetId)
    if (!target) {
      console.log(`  ${targetId}: not in targets.yaml — skipped`)
      continue
    }

    for (const signalId of onlySignals ?? PROVISIONED_SIGNALS) {
      const signal = signals.find((s) => s.id === signalId)
      if (!signal) continue

      // Rule 1: only ever seed from a URL we have watched return 200.
      const seedUrl = sources[target.id]?.[signal.id]
      const key = collectorKey(signal.id, target.id)

      if (!seedUrl) {
        console.log(`  ${key.padEnd(38)} no verified page — skipped`)
        continue
      }
      if (existing[key]) {
        console.log(`  ${key.padEnd(38)} have ${existing[key]!.collectorId}`)
        continue
      }

      console.log(`  ${key.padEnd(38)} ${seedUrl}`)
      work.push({ signal, target, seedUrl })
    }
  }

  if (listOnly) {
    console.log(`\n--list: ${work.length} would be created. Nothing spent.`)
    return
  }
  if (work.length === 0) {
    console.log('\nNothing to provision.')
    return
  }

  console.log(`\nCreating ${work.length} collector(s), 4-8 minutes each.\n`)
  await Promise.all(work.map((w) => provisionOne(w.signal, w.target, w.seedUrl)))

  const final = loadCollectors()
  console.log(`\n${Object.keys(final).length} collector(s) on file:`)
  for (const [k, v] of Object.entries(final)) {
    console.log(`  ${k.padEnd(38)} ${v.collectorId}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
