/**
 * Public job-board adapter.
 *
 * Greenhouse, Lever and Ashby all publish documented, unauthenticated JSON
 * endpoints for a company's own job board. No login, no scraping, no personal
 * data — and richer than anything a social site would give us, because the full
 * job description text comes with it.
 *
 * This is the compliant replacement for LinkedIn jobs, and it is genuinely
 * better for account-based GTM: open roles describe the SHAPE of a company's
 * org ("they are standing up a RevOps function") without touching a single
 * person's data. Names, recruiters and contact fields are stripped in
 * makeObservation before anything is persisted.
 */
import type { CollectorBinding, Observation, SignalSpec, Target } from '../types.js'
import { type SourceAdapter, defaultPreflight, httpGet, makeObservation } from './base.js'

type Provider = 'greenhouse' | 'lever' | 'ashby'

export const boardUrl = (provider: Provider, token: string): string =>
  ({
    greenhouse: `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`,
    lever: `https://api.lever.co/v0/postings/${token}?mode=json`,
    ashby: `https://api.ashbyhq.com/posting-api/job-board/${token}`,
  })[provider]

/** One normalised role. Deliberately contains no person. */
export interface JobRow extends Record<string, unknown> {
  title: string
  department: string | null
  location: string | null
  description: string | null
  posted_at: string | null
  url: string | null
}

const text = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  // Board APIs return HTML in description fields; signals match on prose.
  const stripped = v
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return stripped || null
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Each provider shapes its payload differently. Normalising here means the
 * signal rules — and therefore the `watch` strings — are written once and work
 * across all three.
 */
export function normalise(provider: Provider, payload: unknown): JobRow[] {
  const rows: JobRow[] = []

  if (provider === 'greenhouse') {
    const jobs = isRecord(payload) && Array.isArray(payload.jobs) ? payload.jobs : []
    for (const j of jobs) {
      if (!isRecord(j)) continue
      rows.push({
        title: String(j.title ?? ''),
        department: isRecord(j.departments) ? null : depName(j.departments),
        location: isRecord(j.location) ? text(j.location.name) : null,
        description: text(j.content),
        posted_at: typeof j.updated_at === 'string' ? j.updated_at : null,
        url: typeof j.absolute_url === 'string' ? j.absolute_url : null,
      })
    }
  }

  if (provider === 'lever') {
    const jobs = Array.isArray(payload) ? payload : []
    for (const j of jobs) {
      if (!isRecord(j)) continue
      const cat = isRecord(j.categories) ? j.categories : {}
      rows.push({
        title: String(j.text ?? ''),
        department: typeof cat.team === 'string' ? cat.team : null,
        location: typeof cat.location === 'string' ? cat.location : null,
        description: text(j.descriptionPlain ?? j.description),
        posted_at:
          typeof j.createdAt === 'number' ? new Date(j.createdAt).toISOString() : null,
        url: typeof j.hostedUrl === 'string' ? j.hostedUrl : null,
      })
    }
  }

  if (provider === 'ashby') {
    const jobs = isRecord(payload) && Array.isArray(payload.jobs) ? payload.jobs : []
    for (const j of jobs) {
      if (!isRecord(j)) continue
      rows.push({
        title: String(j.title ?? ''),
        department: typeof j.department === 'string' ? j.department : null,
        location: typeof j.location === 'string' ? j.location : null,
        description: text(j.descriptionPlain ?? j.descriptionHtml),
        posted_at: typeof j.publishedAt === 'string' ? j.publishedAt : null,
        url: typeof j.jobUrl === 'string' ? j.jobUrl : null,
      })
    }
  }

  return rows.filter((r) => r.title)
}

function depName(v: unknown): string | null {
  if (Array.isArray(v) && v.length > 0 && isRecord(v[0])) {
    const n = v[0].name
    return typeof n === 'string' ? n : null
  }
  return null
}

export const jobsAdapter: SourceAdapter = {
  kind: 'jobs',
  // A documented public JSON API already returns clean structured data.
  // Putting a scraper in front of it would be theatre, not engineering.
  usesBrightData: false,
  scraperType: null,

  preflight: defaultPreflight,

  bind(signal: SignalSpec, target: Target): CollectorBinding | null {
    if (!target.jobs) return null
    return {
      collectorId: null,
      signalId: signal.id,
      targetId: target.id,
      url: boardUrl(target.jobs.provider, target.jobs.token),
      usesBrightData: false,
    }
  },

  async observe(binding: CollectorBinding, signal: SignalSpec, at: Date): Promise<Observation> {
    const provider = detectProvider(binding.url)
    const body = await httpGet(binding.url)
    const rows = normalise(provider, JSON.parse(body))
    return makeObservation(binding, [{ jobs: rows }], at)
  },
}

function detectProvider(url: string): Provider {
  if (url.includes('greenhouse.io')) return 'greenhouse'
  if (url.includes('lever.co')) return 'lever'
  return 'ashby'
}
