// Job-board token finder. Tries all three providers for a company slug.
// Public, documented, unauthenticated endpoints only.
const UA = 'BellwetherBot/0.1 (+https://github.com/Yash-Kavaiya/Agentic-GTM-Platform)'
const urls = (tok) => [
  ['greenhouse', `https://boards-api.greenhouse.io/v1/boards/${tok}/jobs?content=true`],
  ['lever',      `https://api.lever.co/v0/postings/${tok}?mode=json`],
  ['ashby',      `https://api.ashbyhq.com/posting-api/job-board/${tok}`],
]
async function tryOne(provider, url) {
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(8000) })
    if (!r.ok) return null
    const j = await r.json()
    const count = Array.isArray(j) ? j.length : (j.jobs?.length ?? null)
    return count === null ? null : { provider, count, sample: (Array.isArray(j)?j[0]?.text:j.jobs?.[0]?.title) ?? '?', loc: (Array.isArray(j)?j[0]?.categories?.location:j.jobs?.[0]?.location) ?? '?' }
  } catch { return null }
}
const candidates = {
  supabase: ['supabase'], dub: ['dub','dubinc'], cal: ['cal','calcom','Cal.com'],
  retool: ['retool'], airbyte: ['airbyte','airbytehq'], vanta: ['vanta'],
  metabase: ['metabase'], neon: ['neon','neondatabase','neontech'],
}
const out = []
await Promise.all(Object.entries(candidates).map(async ([id, toks]) => {
  for (const tok of toks) {
    const hits = (await Promise.all(urls(tok).map(([p, u]) => tryOne(p, u)))).filter(Boolean)
    const best = hits.sort((a,b) => b.count - a.count)[0]
    if (best) { out.push(`${id.padEnd(10)} -> ${best.provider}/${tok} (${best.count} roles) e.g. "${String(best.sample).slice(0,44)}" [${best.loc}]`); return }
  }
  out.push(`${id.padEnd(10)} -> none found`)
}))
out.sort().forEach(l => console.log(l))
