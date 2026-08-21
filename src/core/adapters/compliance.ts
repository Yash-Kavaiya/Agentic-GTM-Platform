/**
 * Compliance preflight.
 *
 * The hackathon rule is "scrape publicly available data only — no login-walled
 * sites, no paywalled content, no personal data". This module is how Bellwether
 * enforces that in code rather than asserting it in a README.
 *
 * Every adapter calls `preflight()` before it fetches anything. A refusal is a
 * value, not an exception: the UI renders the reason so the block is legible.
 *
 * See tests/compliance.test.ts — the denylist has a test that fails if any of
 * these hosts ever becomes reachable through an adapter.
 */
import type { ComplianceVerdict } from '../types.js'

/**
 * Hosts Bellwether refuses on principle.
 *
 * Each of these is login-walled, dense with personal data, and already covered
 * by Bright Data's pre-built scraper library — so building against them would
 * break the rules AND duplicate the platform. The SourceAdapter interface would
 * happily accept an adapter for any of them; we ship none, by design.
 */
export const DENYLIST = [
  'linkedin.com',
  'x.com',
  'twitter.com',
  'facebook.com',
  'instagram.com',
  'threads.net',
  'tiktok.com',
  'glassdoor.com',
  'crunchbase.com',
  'zoominfo.com',
  'apollo.io',
] as const

/**
 * Field names that carry contact-level personal data. The jobs adapter strips
 * these from every row before anything is persisted — we want role SHAPES
 * ("this company is hiring a VP RevOps"), never people.
 */
export const PERSONAL_FIELDS = [
  'email',
  'phone',
  'recruiter',
  'recruiter_name',
  'hiring_manager',
  'contact',
  'contact_name',
  'first_name',
  'last_name',
  'full_name',
  'linkedin',
  'linkedin_url',
  'profile_url',
] as const

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

/** True if `host` is, or is a subdomain of, a denylisted domain. */
export function isDenied(url: string): boolean {
  const host = hostOf(url)
  if (!host) return true
  return DENYLIST.some((d) => host === d || host.endsWith(`.${d}`))
}

/**
 * Recursively drop personal-data fields from extracted rows.
 * Applied to every observation before it reaches the store.
 */
export function stripPersonalData<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripPersonalData) as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if ((PERSONAL_FIELDS as readonly string[]).includes(k.toLowerCase())) continue
      out[k] = stripPersonalData(v)
    }
    return out as T
  }
  return value
}

const robotsCache = new Map<string, string | null>()

async function fetchRobots(origin: string): Promise<string | null> {
  if (robotsCache.has(origin)) return robotsCache.get(origin)!
  let body: string | null = null
  try {
    const r = await fetch(`${origin}/robots.txt`, {
      signal: AbortSignal.timeout(8000),
      headers: { 'user-agent': USER_AGENT },
    })
    body = r.ok ? await r.text() : null
  } catch {
    body = null
  }
  robotsCache.set(origin, body)
  return body
}

export const USER_AGENT =
  'BellwetherBot/0.1 (+https://github.com/Yash-Kavaiya/Agentic-GTM-Platform)'

/**
 * Minimal robots.txt evaluation against the `*` group.
 *
 * Deliberately conservative and deliberately small: it honours Disallow rules
 * for the wildcard agent using longest-match-wins, which is the rule that
 * actually matters for the pages Bellwether reads. A missing or unreachable
 * robots.txt is treated as permissive, which matches how crawlers behave.
 */
export function robotsAllows(robotsTxt: string, path: string): boolean {
  const lines = robotsTxt.split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim())
  let inStar = false
  const rules: { allow: boolean; path: string }[] = []

  for (const line of lines) {
    const [rawKey, ...rest] = line.split(':')
    if (!rawKey || rest.length === 0) continue
    const key = rawKey.trim().toLowerCase()
    const val = rest.join(':').trim()

    if (key === 'user-agent') {
      inStar = val === '*'
    } else if (inStar && (key === 'allow' || key === 'disallow')) {
      if (val) rules.push({ allow: key === 'allow', path: val })
    }
  }

  let best: { allow: boolean; path: string } | null = null
  for (const r of rules) {
    if (!path.startsWith(r.path)) continue
    if (!best || r.path.length > best.path.length) best = r
  }
  return best ? best.allow : true
}

/**
 * The gate every adapter passes through.
 * Order matters: denylist first, so a refusal there is never masked by a
 * network failure fetching robots.txt.
 */
export async function preflight(url: string): Promise<ComplianceVerdict> {
  const host = hostOf(url)
  if (!host) return { allowed: false, reason: `not a valid URL: ${url}`, rule: 'scheme' }

  if (!url.startsWith('https://')) {
    return { allowed: false, reason: 'only https sources are read', rule: 'scheme' }
  }

  if (isDenied(url)) {
    return {
      allowed: false,
      reason: `${host} is login-walled and carries personal data — Bellwether ships no adapter for it`,
      rule: 'denylist',
    }
  }

  const { origin, pathname } = new URL(url)
  const robots = await fetchRobots(origin)
  if (robots && !robotsAllows(robots, pathname)) {
    return { allowed: false, reason: `robots.txt disallows ${pathname}`, rule: 'robots' }
  }

  return { allowed: true, reason: 'public page, robots.txt permits', rule: 'ok' }
}
