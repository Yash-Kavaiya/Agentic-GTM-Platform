/** Smoke-test the no-auth adapters against real live sources. */
import { jobsAdapter } from '../src/core/adapters/jobs.js'
import { rssAdapter, sitemapAdapter } from '../src/core/adapters/feeds.js'
import { loadSignals, loadTargets } from '../src/core/config/load.js'
import { resolveStrings, resolveCount, nullRate } from '../src/core/signals/fieldpath.js'

const signals = loadSignals()
const targets = loadTargets()
const at = new Date()
const sig = (id: string) => signals.find((s) => s.id === id)!
const tgt = (id: string) => targets.find((t) => t.id === id)!

console.log('--- jobs adapter (3 providers) ---')
for (const id of ['posthog', 'vanta', 'metabase', 'neon']) {
  const s = sig('building_the_function'), t = tgt(id)
  const b = jobsAdapter.bind(s, t)
  if (!b) { console.log(`${id}: no binding`); continue }
  try {
    const o = await jobsAdapter.observe(b, s, at)
    const titles = resolveStrings(o.rows, 'jobs[].title')
    console.log(
      `${id.padEnd(10)} ${String(resolveCount(o.rows,'jobs[]')).padStart(3)} roles  ` +
      `nullRate(title)=${nullRate(o.rows,'jobs[].title').toFixed(2)} ` +
      `desc=${nullRate(o.rows,'jobs[].description').toFixed(2)}  e.g. "${titles[0] ?? '-'}"`
    )
    const leak = JSON.stringify(o.rows).match(/"(email|recruiter|full_name|hiring_manager)"/i)
    if (leak) console.log(`  !! PERSONAL DATA LEAK: ${leak[0]}`)
  } catch (e) { console.log(`${id}: ERROR ${(e as Error).message}`) }
}

console.log('\n--- rss adapter ---')
for (const [id, sid] of [['resend','shipping_velocity'],['railway','shipping_velocity'],['posthog','announcement']] as const) {
  const s = sig(sid), t = tgt(id)
  const b = rssAdapter.bind(s, t)!
  try {
    const o = await rssAdapter.observe(b, s, at)
    const titles = resolveStrings(o.rows, 'entries[].title')
    console.log(`${id.padEnd(10)} ${String(titles.length).padStart(3)} entries  dates=${(1-nullRate(o.rows,'entries[].published_at')).toFixed(2)}  e.g. "${(titles[0]??'-').slice(0,52)}"`)
  } catch (e) { console.log(`${id}: ERROR ${(e as Error).message}`) }
}

console.log('\n--- sitemap adapter ---')
for (const id of ['posthog','vanta','clerk']) {
  const s = sig('surface_growth'), t = tgt(id)
  const b = { ...sitemapAdapter.bind(s, t)!, url: `https://${t.domain}/sitemap.xml` }
  try {
    const o = await sitemapAdapter.observe(b, s, at)
    console.log(`${id.padEnd(10)} ${String(resolveCount(o.rows,'urls[]')).padStart(5)} urls  lastmod=${(1-nullRate(o.rows,'urls[].lastmod')).toFixed(2)}`)
  } catch (e) { console.log(`${id}: ERROR ${(e as Error).message}`) }
}
