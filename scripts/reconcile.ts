/**
 * Reconcile heal verdicts against recorded collector health.
 *
 * `bellwether verify` already ran every collector against production and stored
 * the result. This applies that evidence to the heal log: any collector left
 * QUARANTINED whose most recent heal still reads `approved` has that verdict
 * corrected, because production disproved it.
 *
 * Uses only what is already in the store -- no collector runs, no credit.
 */
import { loadEnv } from '../src/core/env.js'
loadEnv()
import { Store } from '../src/core/store/db.js'

const store = new Store(process.argv[2] ?? 'data/bellwether.db')
const health = store.healthMap()

let amended = 0
for (const [collectorId, state] of Object.entries(health)) {
  if (state !== 'QUARANTINED') continue
  if (store.downgradeLastHeal(collectorId, 'approved_ineffective',
      'production check disproved this approval: the collector still fails its field contract')) {
    console.log(`  ${collectorId}: approved -> approved_ineffective`)
    amended++
  }
}
console.log(`\n${amended} verdict(s) corrected from recorded production evidence`)
store.close()
