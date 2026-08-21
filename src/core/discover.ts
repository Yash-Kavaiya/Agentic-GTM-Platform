/**
 * Prospect discovery.
 *
 * Bellwether's watchlist answers "what did my accounts just do". This answers
 * the question before it: "which companies should be on the list at all".
 *
 * The mechanic is the same plain-English one used everywhere else. A user
 * describes the hiring signal that means a company is ready to buy — "Revenue
 * Operations Manager", "GTM Engineer", "Head of Partnerships" — and Bellwether
 * searches public job boards for it. The company that posted the role is the
 * prospect, and the board token in the result URL is exactly what the jobs
 * adapter needs to read their entire board.
 *
 * Every step is verified rather than assumed:
 *   the board API must answer          (the company is real and hiring)
 *   the domain must serve a pricing page (they sell software, not services)
 *
 * A candidate that fails either check is returned as unverified rather than
 * quietly dropped, because "we found them but could not confirm the domain" is
 * useful information to a salesperson and a silent omission is not.
 */
import { findProspectsByRole, type ProspectHit } from './brightdata/search.js'
import { boardUrl, normalise, type JobRow } from './adapters/jobs.js'
import { httpGet } from './adapters/base.js'
import { isDenied } from './adapters/compliance.js'

export interface Candidate {
  token: string
  provider: 'greenhouse' | 'lever' | 'ashby'
  /** Real company name from the board provider where available. */
  name: string
  /** The role that surfaced them — the buying signal itself. */
  triggerRole: string
  boardUrl: string
  /** Confirmed by the board API. */
  openRoles: number | null
  /** Roles matching the ICP's revenue-function pattern. */
  revenueRoles: string[]
  domain: string | null
  domainVerified: boolean
  hasPricing: boolean
  /** 0-100, from what we could actually confirm. */
  score: number
  notes: string[]
}

/** Roles that indicate a company is standing up a revenue function. */
const REVENUE_ROLE = /(?:revops|revenue operations|gtm engineer|sales engineer|solutions architect|partnerships|customer success|growth engineer|sales operations)/i

const UA = 'BellwetherBot/0.1 (+https://github.com/Yash-Kavaiya/Agentic-GTM-Platform)'

async function boardName(hit: ProspectHit): Promise<string> {
  if (hit.provider !== 'greenhouse') return hit.name
  try {
    const body = await httpGet(`https://boards-api.greenhouse.io/v1/boards/${hit.token}`, 12_000)
    const parsed = JSON.parse(body) as { name?: string }
    return parsed.name?.trim() || hit.name
  } catch {
    return hit.name
  }
}

async function readBoard(hit: ProspectHit): Promise<JobRow[] | null> {
  try {
    const body = await httpGet(boardUrl(hit.provider, hit.token), 15_000)
    return normalise(hit.provider, JSON.parse(body))
  } catch {
    return null
  }
}

/**
 * Guess and verify a company's domain.
 *
 * A guess alone is worthless — plenty of `<name>.com` domains belong to someone
 * else entirely. So the guess is only accepted if the site actually serves a
 * pricing page, which both confirms the domain and tells us they sell software.
 */
async function resolveDomain(name: string): Promise<{ domain: string | null; hasPricing: boolean }> {
  const slug = name
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|technologies|labs|software|the)\b/g, '')
    .replace(/[^a-z0-9]/g, '')

  if (!slug || slug.length < 3) return { domain: null, hasPricing: false }

  for (const tld of ['com', 'io', 'ai', 'co']) {
    const domain = `${slug}.${tld}`
    if (isDenied(`https://${domain}/`)) continue
    try {
      const res = await fetch(`https://${domain}/pricing`, {
        headers: { 'user-agent': UA },
        signal: AbortSignal.timeout(8000),
        redirect: 'follow',
      })
      if (res.status === 200) {
        const body = await res.text()
        if (body.length > 800) return { domain, hasPricing: true }
      }
    } catch {
      /* try the next tld */
    }
  }
  return { domain: null, hasPricing: false }
}

function scoreCandidate(c: Omit<Candidate, 'score' | 'notes'>): { score: number; notes: string[] } {
  const notes: string[] = []
  let score = 0

  if (c.openRoles !== null) {
    score += 25
    notes.push(`${c.openRoles} open role${c.openRoles === 1 ? '' : 's'} on a public board`)
  }
  if (c.revenueRoles.length > 0) {
    score += Math.min(30, 15 * c.revenueRoles.length)
    notes.push(`hiring ${c.revenueRoles.slice(0, 2).join(', ')}`)
  }
  if (c.hasPricing) {
    score += 30
    notes.push('publishes a pricing page — sells software, not services')
  }
  if (c.domainVerified) {
    score += 15
  } else {
    notes.push('domain not confirmed — needs a human to check')
  }

  return { score: Math.min(100, score), notes }
}

export interface DiscoverOptions {
  role: string
  extraTerms?: string
  /** Board tokens already on the watchlist, so known accounts are not re-offered. */
  known?: string[]
  log?: (line: string) => void
}

export async function discoverProspects(opts: DiscoverOptions): Promise<Candidate[]> {
  const log = opts.log ?? (() => {})
  const known = new Set((opts.known ?? []).map((k) => k.toLowerCase()))

  log(`searching public job boards for "${opts.role}"`)
  const hits = await findProspectsByRole(opts.role, { extraTerms: opts.extraTerms })
  log(`${hits.length} company/companies surfaced`)

  const fresh = hits.filter((h) => !known.has(h.token.toLowerCase()))
  if (fresh.length < hits.length) {
    log(`${hits.length - fresh.length} already on the watchlist`)
  }

  const candidates = await Promise.all(
    fresh.map(async (hit): Promise<Candidate> => {
      const [name, jobs] = await Promise.all([boardName(hit), readBoard(hit)])
      const revenueRoles = (jobs ?? [])
        .map((j) => j.title)
        .filter((t) => REVENUE_ROLE.test(t))
        .slice(0, 5)

      const { domain, hasPricing } = await resolveDomain(name)

      const base = {
        token: hit.token,
        provider: hit.provider,
        name,
        triggerRole: hit.roleTitle,
        boardUrl: boardUrl(hit.provider, hit.token),
        openRoles: jobs ? jobs.length : null,
        revenueRoles,
        domain,
        domainVerified: Boolean(domain),
        hasPricing,
      }
      const { score, notes } = scoreCandidate(base)
      log(`  ${name.padEnd(24)} score ${String(score).padStart(3)}  ${domain ?? 'domain unresolved'}`)
      return { ...base, score, notes }
    }),
  )

  return candidates.sort((a, b) => b.score - a.score)
}
