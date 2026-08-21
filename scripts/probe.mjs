/**
 * Target probe.
 *
 * Checks which public pages actually exist before any Bright Data credit is
 * spent provisioning a collector against them. A `scraper create` against a
 * 404 costs 5-25 minutes and real money, so nothing reaches the CLI until it
 * has returned 200 here.
 *
 *   node scripts/probe.mjs            # probe everything
 *   node scripts/probe.mjs posthog    # probe one target
 *
 * Writes data/probe.json, which the provisioner reads to decide what is
 * actually collectable.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { parse } from 'yaml'

const UA = 'BellwetherBot/0.1 (+https://github.com/Yash-Kavaiya/Agentic-GTM-Platform)'
const TIMEOUT_MS = 8_000
const TARGET_CONCURRENCY = 6

const PAGE_PATHS = {
  pricing: ['/pricing', '/plans'],
  security: ['/security', '/trust', '/security-and-compliance'],
  integrations: ['/integrations', '/partners', '/marketplace'],
  customers: ['/customers', '/case-studies'],
  about: ['/about', '/team', '/company'],
}

const FEED_PATHS = {
  changelog: ['/changelog/rss.xml', '/changelog.xml', '/changelog/feed.xml', '/changelog/rss'],
  blog: ['/blog/rss.xml', '/rss.xml', '/feed.xml', '/blog/feed.xml'],
}

const jobsUrl = (j) =>
  ({
    greenhouse: `https://boards-api.greenhouse.io/v1/boards/${j.token}/jobs?content=true`,
    lever: `https://api.lever.co/v0/postings/${j.token}?mode=json`,
    ashby: `https://api.ashbyhq.com/posting-api/job-board/${j.token}`,
  })[j.provider]

async function get(url) {
  try {
    const r = await fetch(url, {
      headers: { 'user-agent': UA },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'follow',
    })
    const body = await r.text()
    return { ok: r.status === 200, status: r.status, bytes: body.length, finalUrl: r.url, body }
  } catch (e) {
    return { ok: false, status: 0, bytes: 0, finalUrl: url, body: '', error: e.name }
  }
}

/** Probe all candidates at once and take the first that qualifies, in priority order. */
async function firstLive(urls, qualifies) {
  const results = await Promise.all(urls.map(get))
  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    if (qualifies(r)) return { url: urls[i], status: r.status, bytes: r.bytes, finalUrl: r.finalUrl }
  }
  return null
}

const isPage = (r) => r.ok && r.bytes > 800
const isFeed = (r) => r.ok && /<rss|<feed|<\?xml/i.test(r.body.slice(0, 500))
const isSitemap = (r) => r.ok && /<urlset|<sitemapindex/i.test(r.body.slice(0, 800))

async function probeTarget(t) {
  const out = { id: t.id, name: t.name, domain: t.domain, pages: {}, feeds: {}, sitemap: null, jobs: null }

  const pageWork = Object.entries(PAGE_PATHS).map(async ([kind, paths]) => {
    out.pages[kind] = await firstLive(paths.map((p) => `https://${t.domain}${p}`), isPage)
  })

  const feedWork = Object.entries(FEED_PATHS).map(async ([kind, paths]) => {
    out.feeds[kind] = await firstLive(paths.map((p) => `https://${t.domain}${p}`), isFeed)
  })

  const sitemapWork = (async () => {
    const candidates = [
      `https://docs.${t.domain}/sitemap.xml`,
      `https://${t.domain}/docs/sitemap.xml`,
      `https://${t.domain}/sitemap.xml`,
    ]
    const results = await Promise.all(candidates.map(get))
    for (let i = 0; i < results.length; i++) {
      if (isSitemap(results[i])) {
        out.sitemap = {
          url: candidates[i],
          locs: (results[i].body.match(/<loc>/g) || []).length,
          isIndex: /<sitemapindex/i.test(results[i].body.slice(0, 800)),
        }
        return
      }
    }
  })()

  const jobsWork = (async () => {
    if (!t.jobs) return
    const url = jobsUrl(t.jobs)
    const r = await get(url)
    let count = null
    if (r.ok) {
      try {
        const j = JSON.parse(r.body)
        count = Array.isArray(j) ? j.length : (j.jobs?.length ?? null)
      } catch {}
    }
    out.jobs = { provider: t.jobs.provider, token: t.jobs.token, url, ok: r.ok && count !== null, status: r.status, count }
  })()

  await Promise.all([...pageWork, ...feedWork, sitemapWork, jobsWork])
  return out
}

/** Run `worker` over `items` with a bounded number in flight. */
async function pool(items, limit, worker) {
  const out = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await worker(items[i])
      }
    }),
  )
  return out
}

const cfg = parse(readFileSync('config/targets.yaml', 'utf8'))
const only = process.argv[2]
const targets = only ? cfg.targets.filter((t) => t.id === only) : cfg.targets
if (targets.length === 0) {
  console.error(`no target matching "${only}"`)
  process.exit(1)
}

const started = Date.now()
const results = await pool(targets, TARGET_CONCURRENCY, async (t) => {
  const r = await probeTarget(t)
  const pages = Object.entries(r.pages).filter(([, v]) => v).map(([k]) => k)
  const feeds = Object.entries(r.feeds).filter(([, v]) => v).map(([k]) => k)
  const bits = [
    pages.length ? `pages:${pages.join(',')}` : null,
    feeds.length ? `feeds:${feeds.join(',')}` : null,
    r.sitemap ? `sitemap:${r.sitemap.locs}${r.sitemap.isIndex ? '(index)' : ''}` : null,
    r.jobs?.ok ? `jobs:${r.jobs.count}` : r.jobs ? `jobs:FAIL(${r.jobs.status})` : null,
  ].filter(Boolean)
  process.stdout.write(`${r.id.padEnd(12)} ${bits.join('  ') || '(nothing found)'}\n`)
  return r
})

mkdirSync('data', { recursive: true })
writeFileSync('data/probe.json', JSON.stringify({ probed_at: new Date().toISOString(), results }, null, 2))

/**
 * Emit config/sources.json — the verified URL for each (target, signal).
 *
 * Signal templates carry a DEFAULT path like `/blog/rss.xml`, but real sites
 * file these pages wherever they like. Guessing produced 35 404s on the first
 * run. This writes what actually returned 200, so the engine reads verified
 * URLs instead of hopeful ones. It is committed: it is both configuration and
 * evidence that every source was checked before it was used.
 */
const PICK = {
  moving_upmarket:      (r) => r.pages.pricing?.url,
  price_change:         (r) => r.pages.pricing?.url,
  enterprise_readiness: (r) => r.pages.security?.url,
  ecosystem_expansion:  (r) => r.pages.integrations?.url,
  segment_shift:        (r) => r.pages.customers?.url,
  leadership_change:    (r) => r.pages.about?.url,
  announcement:         (r) => r.feeds.blog?.url,
  shipping_velocity:    (r) => r.feeds.changelog?.url,
  surface_growth:       (r) => r.sitemap?.url,
}

const sources = {}
for (const r of results) {
  const entry = {}
  for (const [signalId, pick] of Object.entries(PICK)) {
    const url = pick(r)
    if (url) entry[signalId] = url
  }
  if (Object.keys(entry).length) sources[r.id] = entry
}
writeFileSync(
  'config/sources.json',
  JSON.stringify({ generated_at: new Date().toISOString(), note: 'Generated by scripts/probe.mjs. Every URL here returned 200.', sources }, null, 2) + '\n',
)
const pairs = Object.values(sources).reduce((a, v) => a + Object.keys(v).length, 0)
console.log(`wrote config/sources.json — ${pairs} verified (target, signal) sources`)

const n = (f) => results.filter(f).length
console.log(
  `\n${results.length} targets in ${((Date.now() - started) / 1000).toFixed(1)}s` +
    `\n  pricing:${n((r) => r.pages.pricing)}  security:${n((r) => r.pages.security)}` +
    `  integrations:${n((r) => r.pages.integrations)}  customers:${n((r) => r.pages.customers)}` +
    `\n  changelog-feed:${n((r) => r.feeds.changelog)}  blog-feed:${n((r) => r.feeds.blog)}` +
    `  sitemap:${n((r) => r.sitemap)}  jobs:${n((r) => r.jobs?.ok)}` +
    `\n\nwrote data/probe.json`,
)
