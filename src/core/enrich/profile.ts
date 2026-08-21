/**
 * Business profile.
 *
 * The account page exists for a salesperson deciding whether to open a
 * conversation, not for an engineer debugging a scraper. Collector IDs and null
 * rates belong behind a "how we know this" disclosure; what belongs in front is
 * what the company does, how fast it is growing, where it is investing, who
 * will own the decision, and what changed.
 *
 * Everything here is DERIVED from what Bellwether already observed — a public
 * job board, a homepage, a compliance page. Nothing is bought from a data
 * vendor and nothing is guessed. Where a fact cannot be derived, the field is
 * absent rather than filled with a plausible number, because a salesperson who
 * catches one invented figure stops trusting the whole page.
 *
 * Roles, never people. Every inference below is about the SHAPE of an
 * organisation — that it is standing up a revenue function, that it has begun
 * hiring in EMEA — which is both compliant and better account-based practice
 * than a contact list.
 */
import type { JobRow } from '../adapters/jobs.js'
import type { BrandKit } from './brandkit.js'

export interface Department {
  name: string
  count: number
}

export interface BusinessProfile {
  /** One line on what they sell, from their own homepage. */
  positioning: string | null
  category: string | null
  /** Confirmed open roles. Null when no public board is bound. */
  openRoles: number | null
  /** Where they are investing, most first. */
  hiringFocus: Department[]
  /** Distinct office/remote locations named in postings. */
  footprint: string[]
  /** Technologies named in their own job descriptions. */
  techStack: string[]
  /** Who will own this decision, inferred from the org they are building. */
  buyingRoles: string[]
  /** Compliance posture, from their security page. */
  compliance: string[]
  /** Plain-language read on company stage. */
  stage: string | null
}

/** Technologies worth noticing in a JD, and what a seller should read into them. */
const TECH = [
  'Snowflake', 'Databricks', 'BigQuery', 'Redshift', 'dbt', 'Airflow', 'Fivetran',
  'Segment', 'Salesforce', 'HubSpot', 'Marketo', 'Outreach', 'Gong', 'Clari',
  'Looker', 'Tableau', 'Metabase', 'ClickHouse', 'Kafka', 'Snowplow',
  'Kubernetes', 'Terraform', 'Postgres', 'MongoDB', 'Redis', 'Stripe',
]

/**
 * Roles that tell you who signs.
 *
 * A company hiring a RevOps lead has decided revenue operations is somebody's
 * job — which means there is now a person to sell that category to, and it is
 * usually not the CEO any more.
 */
const DECISION_ROLE: { pattern: RegExp; owner: string }[] = [
  { pattern: /chief revenue|cro\b/i, owner: 'Chief Revenue Officer' },
  { pattern: /vp.{0,12}(revenue|sales)/i, owner: 'VP Revenue / Sales' },
  { pattern: /revops|revenue operations/i, owner: 'Head of RevOps' },
  { pattern: /vp.{0,12}marketing|cmo\b/i, owner: 'VP Marketing' },
  { pattern: /head of (data|analytics)|vp.{0,12}data/i, owner: 'Head of Data' },
  { pattern: /gtm engineer|growth engineer/i, owner: 'GTM Engineering' },
  { pattern: /vp.{0,12}engineering|cto\b/i, owner: 'VP Engineering / CTO' },
  { pattern: /security|compliance|trust/i, owner: 'Security & Compliance' },
  { pattern: /partnerships|alliances/i, owner: 'Partnerships' },
]

const clean = (s: string) => s.replace(/\s+/g, ' ').trim()

/**
 * Read company stage off hiring volume and mix.
 *
 * Deliberately coarse. "Roughly this size, investing here" is defensible from a
 * job board; a headcount number is not, and precision we cannot support would
 * be worse than the range.
 */
function readStage(openRoles: number | null, focus: Department[]): string | null {
  if (openRoles === null) return null
  if (openRoles === 0) return 'Hiring paused — no open roles on their public board'
  if (openRoles < 5) return 'Hiring selectively — a handful of open roles'
  if (openRoles < 20) {
    const top = focus[0]?.name
    return `Growing steadily${top ? `, weighted toward ${top}` : ''}`
  }
  if (openRoles < 60) return 'Scaling — hiring across several functions at once'
  return 'Scaling hard — a large, broad open-role count'
}

function categoryOf(brand: BrandKit | null): string | null {
  const text = brand?.description ?? brand?.headline ?? ''
  if (!text) return null
  // Their own words, trimmed to a category-ish phrase.
  const m = /(?:is|the)\s+(?:a|an|the)?\s*([A-Za-z0-9 ,&-]{8,60}?(?:platform|tool|solution|infrastructure|database|API|CDP|CRM))/i.exec(text)
  return m?.[1] ? clean(m[1]) : null
}

export function buildProfile(args: {
  jobs: JobRow[] | null
  brand: BrandKit | null
  /** Compliance badge names already extracted by the security signal. */
  compliance?: string[]
}): BusinessProfile {
  const jobs = args.jobs
  const brand = args.brand

  const departments = new Map<string, number>()
  const locations = new Set<string>()
  const tech = new Set<string>()
  const owners = new Set<string>()

  for (const j of jobs ?? []) {
    if (j.department) departments.set(j.department, (departments.get(j.department) ?? 0) + 1)
    if (j.location) locations.add(clean(j.location))

    const haystack = `${j.title} ${j.description ?? ''}`
    for (const t of TECH) {
      // Word-bounded so "Redis" never matches inside another word.
      if (new RegExp(`(^|[^a-z])${t}([^a-z]|$)`, 'i').test(haystack)) tech.add(t)
    }
    for (const d of DECISION_ROLE) {
      if (d.pattern.test(j.title)) owners.add(d.owner)
    }
  }

  const hiringFocus = [...departments.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  return {
    positioning: brand?.description ? clean(brand.description).slice(0, 180) : null,
    category: categoryOf(brand),
    openRoles: jobs ? jobs.length : null,
    hiringFocus,
    footprint: [...locations].slice(0, 6),
    techStack: [...tech].slice(0, 10),
    buyingRoles: [...owners].slice(0, 5),
    compliance: args.compliance ?? [],
    stage: readStage(jobs ? jobs.length : null, hiringFocus),
  }
}

/**
 * Why this account is worth a conversation, in a seller's language.
 *
 * Built from what actually fired rather than from a template, so an account
 * with thin evidence gets a short line instead of a confident paragraph.
 */
export function whyNow(signalNames: string[], profile: BusinessProfile): string[] {
  const reasons: string[] = []

  if (signalNames.some((s) => /upmarket|price/i.test(s))) {
    reasons.push('Their pricing page changed — the clearest public sign a company is repositioning who it sells to.')
  }
  if (signalNames.some((s) => /readiness|security/i.test(s))) {
    reasons.push('They published compliance evidence, which usually means enterprise deals are already in the pipeline.')
  }
  if (signalNames.some((s) => /function|headcount/i.test(s))) {
    reasons.push('They are hiring into the revenue function, so there is now an owner for this decision.')
  }
  if (signalNames.some((s) => /stack/i.test(s)) && profile.techStack.length > 0) {
    reasons.push(`Their job descriptions name ${profile.techStack.slice(0, 3).join(', ')} — a stack they are actively building on.`)
  }
  if (signalNames.some((s) => /leadership/i.test(s))) {
    reasons.push('A new leadership seat appeared, and new leaders re-open closed vendor decisions.')
  }

  return reasons
}
