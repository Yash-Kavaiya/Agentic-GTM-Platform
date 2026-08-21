/** Score the real heal preview against the signal's own field contract. */
import { computeStats, verifyAgainstContract, buildBaseline, rowsRecovered } from '../src/core/anneal/health.js'
import { getSignal } from '../src/core/config/load.js'
import type { Observation } from '../src/core/types.js'

const signal = getSignal('moving_upmarket')!

// Exactly what `bdata scraper heal` returned as preview_result.
const preview = [{
  pricing_tiers: [
    { name: 'Free', price: 'Free', cta_button_text: 'Get started - free' },
    { name: 'Pay-as-you-go', price: 'Pay-as-you-go', cta_button_text: 'Set billing limits' },
    { name: 'Teams', price: '$0/mo', cta_button_text: 'Get started' },
    { name: 'Enterprise', price: 'Custom', cta_button_text: 'Talk to sales' },
    { name: 'Startups', price: 'Free', cta_button_text: 'Apply now' },
  ],
  product_page_url: 'https://cal.com/pricing',
}]

// What the collector returned BEFORE the heal: 200 OK, a row, nothing in it.
const broken = [{ pricing_tiers: [], product_page_url: 'https://cal.com/pricing' }]

const obs = (rows: Record<string, unknown>[], at: string): Observation => ({
  collectorId: 'c_mt2rouon238y52ni4l', signalId: signal.id, targetId: 'cal',
  sourceUrl: 'https://cal.com/pricing', observedAt: at, rows,
})

const baseline = buildBaseline('c_mt2rouon238y52ni4l',
  Array.from({ length: 4 }, (_, i) => obs(preview, `2026-08-2${i}T04:00:00Z`)), signal)

const beforeStats = computeStats(broken, signal)
const afterStats = computeStats(preview, signal)
const verdict = verifyAgainstContract(afterStats, baseline, signal)

console.log('contract:', signal.fields.required.join(', '))
console.log('')
console.log('BEFORE  rows=%d  %s', beforeStats.rowCount,
  beforeStats.fields.map(f => `${f.field}=${Math.round(f.nullRate*100)}%null`).join('  '))
console.log('AFTER   rows=%d  %s', afterStats.rowCount,
  afterStats.fields.map(f => `${f.field}=${Math.round(f.nullRate*100)}%null`).join('  '))
console.log('')
console.log('rows recovered:', rowsRecovered(beforeStats, afterStats))
console.log('VERDICT:', verdict.ok ? 'PASS -> scraper approve' : `FAIL -> scraper approve --reject (${verdict.reasons.join('; ')})`)
process.exit(verdict.ok ? 0 : 1)
