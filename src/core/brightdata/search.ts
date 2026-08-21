/**
 * Bright Data SERP and Discovery.
 *
 * The second half of the product. Signals tell you what a company you already
 * watch just did; this tells you which companies you should be watching at all.
 *
 * WHAT WORKS AND WHAT DOES NOT — measured, not assumed:
 *
 * `discover` is an excellent CONTENT finder and a poor COMPANY finder. Asked
 * for "B2B SaaS companies with enterprise pricing tiers", with an explicit
 * intent filter of "the company's own pricing page, not an article", it
 * returned RevOps consulting blogs, a YouTube video and a Reddit thread. It
 * ranks pages about a topic, which is not the same question.
 *
 * `search` against public job boards does work, precisely, because the company
 * identity is in the URL:
 *
 *   site:job-boards.greenhouse.io OR site:jobs.lever.co "Revenue Operations Manager"
 *     -> whatnot, singlestore, chownow, bestow, sardine, brex, ...
 *
 * A company hiring the role IS the signal. So prospect discovery searches for
 * the artifact of the buying trigger rather than for descriptions of it, and
 * reads the company out of the result URL.
 */
import { bdata, type BdResult } from './cli.js'

/** SERP needs an explicit zone; the account's is set in .env. */
const serpZone = () => process.env.BRIGHTDATA_SERP_ZONE ?? 'serp_api1'

export interface SerpResult {
  link: string
  title: string
  description?: string
}

export interface DiscoverResult extends SerpResult {
  relevanceScore: number
}

/** Public job boards whose URLs carry the employer's identity. */
const BOARD_HOSTS = [
  'job-boards.greenhouse.io',
  'boards.greenhouse.io',
  'jobs.lever.co',
  'jobs.ashbyhq.com',
] as const

const BOARD_PROVIDER: Record<string, 'greenhouse' | 'lever' | 'ashby'> = {
  'job-boards.greenhouse.io': 'greenhouse',
  'boards.greenhouse.io': 'greenhouse',
  'jobs.lever.co': 'lever',
  'jobs.ashbyhq.com': 'ashby',
}

export interface ProspectHit {
  /** Board token — feeds straight into the jobs adapter. */
  token: string
  provider: 'greenhouse' | 'lever' | 'ashby'
  /** Best-effort company name from the result title. */
  name: string
  roleTitle: string
  url: string
}

function parseSerp(res: BdResult): SerpResult[] {
  const env = res.envelope as Record<string, unknown> | null
  if (!env) return []
  const organic = (env.organic ?? env.organic_results ?? env.results) as unknown
  if (!Array.isArray(organic)) return []
  return organic
    .map((r) => {
      const o = r as Record<string, unknown>
      return {
        link: String(o.link ?? o.url ?? ''),
        title: String(o.title ?? ''),
        description: typeof o.description === 'string' ? o.description : undefined,
      }
    })
    .filter((r) => r.link)
}

/** Raw web search. */
export async function search(query: string, opts: { country?: string } = {}): Promise<SerpResult[]> {
  const args = ['search', query, '--zone', serpZone(), '--json']
  if (opts.country) args.push('--country', opts.country)
  return parseSerp(await bdata(args, { timeoutMs: 4 * 60_000 }))
}

/**
 * AI intent-ranked discovery.
 *
 * Kept because it is genuinely good at finding CONTENT — competitor changelogs,
 * comparison pages, docs. Do not use it to find companies; see the module note.
 */
export async function discover(
  query: string,
  opts: { intent?: string; numResults?: number } = {},
): Promise<DiscoverResult[]> {
  const args = ['discover', query, '--json']
  if (opts.intent) args.push('--intent', opts.intent)
  if (opts.numResults) args.push('--num-results', String(opts.numResults))

  const res = await bdata(args, { timeoutMs: 6 * 60_000 })
  const env = res.envelope as Record<string, unknown> | null
  const results = env?.results
  if (!Array.isArray(results)) return []
  return results.map((r) => {
    const o = r as Record<string, unknown>
    return {
      link: String(o.link ?? ''),
      title: String(o.title ?? ''),
      description: typeof o.description === 'string' ? o.description : undefined,
      relevanceScore: Number(o.relevance_score ?? 0),
    }
  })
}

/** Strip a board result title down to something like a company name. */
function companyName(title: string, token: string): string {
  // Titles arrive as "Revenue Operations Manager @ Sardine" or "... - ChowNow".
  const at = /(?:@|—|–|\|)\s*([^@—–|]+)$/.exec(title)
  if (at?.[1]) {
    const name = at[1].trim()
    if (name.length > 1 && name.length < 48) return name
  }
  const dash = /\s-\s([^-]+)$/.exec(title)
  if (dash?.[1]) {
    const name = dash[1].trim()
    if (name.length > 1 && name.length < 48) return name
  }
  // Fall back to the URL slug, which is always present.
  return token.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Find companies hiring for a role, by searching public job boards.
 *
 * The company that posted the role is the prospect, and the board token in the
 * URL is exactly what the jobs adapter needs to read their whole board.
 */
export async function findProspectsByRole(
  role: string,
  opts: { extraTerms?: string } = {},
): Promise<ProspectHit[]> {
  const sites = BOARD_HOSTS.map((h) => `site:${h}`).join(' OR ')
  const query = `${sites} "${role}"${opts.extraTerms ? ` ${opts.extraTerms}` : ''}`

  const results = await search(query)
  const seen = new Set<string>()
  const hits: ProspectHit[] = []

  for (const r of results) {
    let host: string
    let path: string
    try {
      const u = new URL(r.link)
      host = u.hostname.toLowerCase()
      path = u.pathname
    } catch {
      continue
    }

    const provider = BOARD_PROVIDER[host]
    if (!provider) continue

    const token = path.split('/').filter(Boolean)[0]
    if (!token || seen.has(`${provider}:${token}`)) continue
    seen.add(`${provider}:${token}`)

    hits.push({
      token,
      provider,
      name: companyName(r.title, token),
      roleTitle: r.title,
      url: r.link,
    })
  }

  return hits
}
