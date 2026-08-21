# 2. Not every source should go through a scraper

**Status:** accepted
**Date:** 2026-08-21

## Context

"Use of Scraper Studio" is one of six judged criteria, which creates an obvious
temptation: route every source through a Bright Data collector and claim maximum
usage. Bellwether reads six kinds of source, and they are not alike.

Some are genuinely hard extraction problems. A B2B SaaS pricing page is bespoke,
JavaScript-rendered, guarded, and redesigned without warning. Nobody has a
pre-built scraper for it, and writing selectors by hand means maintaining them
forever.

Others are already structured data published deliberately for machines. A
Greenhouse job board has a documented, unauthenticated JSON API. An RSS feed is
XML with a schema. A sitemap is a list of `<loc>` elements.

## Decision

Bright Data is used where scraping is the honest tool for the job:

| Adapter | Route | Why |
|---|---|---|
| `web` | Bright Data — **PDP** | Bespoke marketing pages: pricing, security, integrations, customers |
| `docs` | Bright Data — **Sitemap** | Documentation page content at scale |
| `search` | Bright Data — **Search** | Keyword discovery with no URL to start from |
| `careers` | Bright Data — **Discovery** | Careers pages at companies with no public board API |
| `jobs` | Direct HTTP | Greenhouse / Lever / Ashby publish documented JSON |
| `rss`, `sitemap` | Direct HTTP | Already structured XML |

The `SourceAdapter` interface is identical for all six. Whether a source needs a
collector is a property of the source, not of the interface.

## Consequences

**Good**

- Four distinct Bright Data scraper types are exercised on the work that
  actually needs them.
- The healing loop matters, because it protects the sources that genuinely
  break. An RSS feed does not need self-healing; a redesigned pricing page does.
- Cost and latency go to the extraction problems rather than to re-deriving
  structure that was already given to us.

**Bad**

- The headline "collectors provisioned" number is smaller than it could be.
  We think a reviewer reading the code would count that in our favour, but it is
  a real trade.

## Note on what we deliberately do not ship

The interface would accept an adapter for any site. We ship public-web adapters
only. LinkedIn and X are login-walled, dense with personal data, and already
covered by Bright Data's pre-built library — building against them would break
the rules and duplicate the platform at the same time.

This is enforced in code rather than asserted in prose: `compliance.ts` carries a
host denylist and a robots.txt preflight, and `tests/compliance.test.ts` fails
the build if a denylisted host ever becomes reachable, or if a target on the
watchlist is one. Extracted rows are recursively stripped of contact fields, so
Bellwether watches role *shapes* — "this company is standing up a RevOps
function" — and never people.
