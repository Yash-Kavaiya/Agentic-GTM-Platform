/**
 * Compliance is a rule, so it gets a test.
 *
 * The hackathon requires publicly available data only — no login-walled sites,
 * no paywalled content, no personal data. This file turns that from a claim in
 * a README into something that fails the build if it stops being true.
 */
import { describe, it, expect } from 'vitest'
import {
  DENYLIST,
  PERSONAL_FIELDS,
  isDenied,
  stripPersonalData,
  robotsAllows,
  preflight,
} from '../src/core/adapters/compliance.js'
import { loadTargets } from '../src/core/config/load.js'

describe('denylist', () => {
  it.each(DENYLIST)('refuses %s', (host) => {
    expect(isDenied(`https://${host}/anything`)).toBe(true)
  })

  it('refuses subdomains of denied hosts', () => {
    expect(isDenied('https://www.linkedin.com/jobs')).toBe(true)
    expect(isDenied('https://business.facebook.com/x')).toBe(true)
  })

  it('allows ordinary company sites', () => {
    expect(isDenied('https://posthog.com/pricing')).toBe(false)
    expect(isDenied('https://boards-api.greenhouse.io/v1/boards/x/jobs')).toBe(false)
  })

  it('refuses anything it cannot parse', () => {
    expect(isDenied('not a url')).toBe(true)
  })

  it('names LinkedIn and X explicitly', () => {
    // These are the two the brief specifically must not ship an adapter for:
    // login-walled, dense with personal data, and already covered by Bright
    // Data's pre-built library.
    expect(DENYLIST).toContain('linkedin.com')
    expect(DENYLIST).toContain('x.com')
    expect(DENYLIST).toContain('twitter.com')
  })
})

describe('no target is on the denylist', () => {
  // The strongest form of the guarantee: the shipped config cannot contain a
  // prohibited source, and this fails if anyone ever adds one.
  it.each(loadTargets())('$id is a public company site', (target) => {
    expect(isDenied(`https://${target.domain}/`)).toBe(false)
  })
})

describe('personal data', () => {
  it('strips contact fields from extracted rows', () => {
    const row = {
      title: 'Senior RevOps Manager',
      department: 'Revenue',
      recruiter: 'Jane Doe',
      recruiter_name: 'Jane Doe',
      email: 'jane@example.com',
      linkedin_url: 'https://linkedin.com/in/janedoe',
    }
    const clean = stripPersonalData(row) as Record<string, unknown>
    expect(clean).toEqual({ title: 'Senior RevOps Manager', department: 'Revenue' })
  })

  it('strips nested and arrayed personal data', () => {
    const rows = [{ jobs: [{ title: 'VP RevOps', hiring_manager: 'Sam Smith' }] }]
    const clean = stripPersonalData(rows) as { jobs: Record<string, unknown>[] }[]
    expect(clean[0]!.jobs[0]).toEqual({ title: 'VP RevOps' })
  })

  it('is case-insensitive about field names', () => {
    const clean = stripPersonalData({ Email: 'x@y.com', Title: 'CTO' }) as Record<string, unknown>
    expect(clean).toEqual({ Title: 'CTO' })
  })

  it('keeps role shapes, which is what the product actually needs', () => {
    // Bellwether infers "a company this shape puts this decision with the VP
    // RevOps" from open roles. Roles, never people.
    const clean = stripPersonalData({ title: 'VP RevOps', location: 'Remote', full_name: 'A B' })
    expect(clean).toHaveProperty('title')
    expect(clean).not.toHaveProperty('full_name')
  })

  it('covers the obvious contact fields', () => {
    for (const f of ['email', 'phone', 'linkedin_url', 'first_name', 'last_name']) {
      expect(PERSONAL_FIELDS).toContain(f)
    }
  })
})

describe('robots.txt', () => {
  it('honours a wildcard disallow', () => {
    const txt = 'User-agent: *\nDisallow: /private'
    expect(robotsAllows(txt, '/private/thing')).toBe(false)
    expect(robotsAllows(txt, '/pricing')).toBe(true)
  })

  it('lets a longer allow override a shorter disallow', () => {
    const txt = 'User-agent: *\nDisallow: /\nAllow: /pricing'
    expect(robotsAllows(txt, '/pricing')).toBe(true)
    expect(robotsAllows(txt, '/admin')).toBe(false)
  })

  it('ignores groups for other agents', () => {
    const txt = 'User-agent: BadBot\nDisallow: /\n\nUser-agent: *\nAllow: /'
    expect(robotsAllows(txt, '/pricing')).toBe(true)
  })

  it('treats an empty robots.txt as permissive', () => {
    expect(robotsAllows('', '/anything')).toBe(true)
  })

  it('ignores comments', () => {
    expect(robotsAllows('User-agent: *\n# Disallow: /pricing\nAllow: /', '/pricing')).toBe(true)
  })
})

describe('preflight', () => {
  it('refuses a denylisted host without touching the network', async () => {
    const v = await preflight('https://linkedin.com/company/acme')
    expect(v.allowed).toBe(false)
    expect(v.rule).toBe('denylist')
    expect(v.reason).toMatch(/login-walled/)
  })

  it('refuses non-https', async () => {
    const v = await preflight('http://example.com/pricing')
    expect(v.allowed).toBe(false)
    expect(v.rule).toBe('scheme')
  })

  it('refuses a malformed url', async () => {
    expect((await preflight('nonsense')).allowed).toBe(false)
  })

  it('checks the denylist before the network, so a refusal is never masked', async () => {
    // A denylisted host must be refused even if robots.txt is unreachable.
    const v = await preflight('https://not-a-real-host.linkedin.com/x')
    expect(v.rule).toBe('denylist')
  })
})
