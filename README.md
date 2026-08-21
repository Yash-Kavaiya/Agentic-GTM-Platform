# Bellwether

**Describe a buying signal in plain English. Wake up to the companies that just showed it, with the campaign already drafted — and every claim footnoted to the field, page and minute it came from.**

A bellwether is the lead sheep that wears the bell: the one whose movement the flock follows.

---

## The idea

GTM teams buy the same intent data as everyone else, from the same three vendors, and act on it a week late. The signals that actually matter are sitting on companies' own public pages — a new Enterprise tier, a SOC 2 badge, the first RevOps job posting — and nobody is watching them, because watching them means maintaining scrapers that break silently every time a site is redesigned.

Bellwether does both halves: it watches the long tail, and it repairs itself when the long tail changes shape.

## One string, three jobs

This is the whole design. A GTM user writes one plain-language sentence, and it lives in exactly one place — `watch` in [`config/signals.yaml`](config/signals.yaml):

```
                    signals.yaml
                         │
                  SignalSpec.watch
                         │
      ┌──────────────────┼──────────────────┐
      ▼                  ▼                  ▼
 Signal Studio    scraper create      scraper heal
 shows it to      provisions the      repairs it when
 the user         collector from it   the page changes
```

```yaml
- id: moving_upmarket
  name: Moving Upmarket
  watch: >
    the pricing tiers on this page - for each tier, its name, its price,
    and the exact text of its call-to-action button
  fields:
    required: ["tiers[].name"]
  fire_when:
    any:
      - { field: "tiers[].name", op: appears_matching, value: "(?i)enterprise|custom" }
  evidence_template: 'New {{tier.name}} tier appeared with "{{tier.cta}}" on {{observed_at}}'
```

The same sentence is displayed in the UI, sent verbatim to `bdata scraper create`, and replayed into `bdata scraper heal` with the observed failure appended. Nothing paraphrases it in transit — [`assertWatchIntegrity()`](src/core/config/load.ts) throws if anything tries, and Signal Studio prints the actual argv so a non-technical user can see their own words reach the scraper.

To be precise about the division of labour: `watch` says **what to extract**, `fire_when` says **when it counts**, `evidence_template` says **how to phrase it**. Only `watch` reaches Bright Data.

## Self-healing is a product requirement, not a demo

`bdata scraper heal` stops at an approval gate by design and hands back a `preview_result`. There is also a `--auto-approve` flag. **We never use it.**

```
HEALTHY   ──drift detected────────────────▶ DEGRADED
DEGRADED  ──scraper heal──────────────────▶ HEALING
HEALING   ──awaiting_approval + preview───▶ VERIFYING
VERIFYING ──preview meets contract────────▶ scraper approve          ──▶ HEALED ──▶ HEALTHY
VERIFYING ──preview fails─────────────────▶ scraper approve --reject ──▶ DEGRADED │ QUARANTINED
```

In `VERIFYING`, Bellwether scores the preview against the signal's own `fields.required` contract and only then approves — or actively rejects, sharpens the prompt to state the contract explicitly, and retries. Two failures quarantine the collector.

And a quarantined collector **blocks campaign approval downstream**:

> 🔒 **Blocked** — source collector `c_8f2a91` is DEGRADED. Healing in progress.

Sending a prospect a claim sourced from a broken scraper is worse than sending nothing at all: it is confidently wrong, in writing, to someone you want to sell to. That is why [`canApprove()`](src/core/campaign/gate.ts) is a hard precondition on the send path rather than a dashboard widget — and why healing is load-bearing.

The catch a scraper platform exists for: **a broken scraper does not return an error.** It returns 200, and rows, and every field inside them is null. [`detectDrift()`](src/core/anneal/health.ts) watches per-field null rates and row counts against a rolling baseline, because that silent failure is the only one that matters.

See [ADR 003](docs/adr/003-verify-before-approve.md).

## Quickstart

Requires **Node 22+**. Nothing else — no database to run, no native modules to compile.

```bash
npm install
npm run demo          # seed the scenario, export, and serve on :3000
```

Then open <http://localhost:3000>.

```bash
npm run check         # typecheck + 126 tests
npm run probe         # verify which public pages each target actually serves
npm run bw -- run     # collect from live sources, diff, fire signals
npm run bw -- brief   # render today's brief in the terminal
npm run bw -- enrich  # read brand kits off each target's homepage
```

`make demo`, `make check`, `make bench` also work where `make` is available.

To provision real collectors, put a key in `.env` (copy `.env.example`) or run `bdata login`, then `npm run bw:provision`.

## What is real and what is seeded

Being explicit, because it matters:

**Real, verified against live sources:**
- 129 `(target, signal)` sources probed live before any credit was spent — recorded in [`config/sources.json`](config/sources.json)
- 20/20 brand kits extracted from real homepages, resolving to genuinely correct brand colours (Supabase `#3ecf8e`, Clerk `#6c47ff`, Vanta `#5230d7`)
- 11 job boards normalising cleanly across Greenhouse, Lever and Ashby with zero null titles
- 60 observations collected from live sources, zero errors
- 126 tests, all passing

**Scripted, and labelled as such:** the demo scenario in [`cli/seed.ts`](cli/seed.ts). A signal fires on a *change*, so a demo needs two snapshots with something different between them, and real change arrives on a company's roadmap timescale rather than a hackathon's. The snapshots are authored. **The events are not** — they run through the same `match()` the pipeline uses, so every evidence sentence, score and gate verdict is computed by real code from real config. Change a threshold in `signals.yaml` and the demo output changes with it. It writes to a separate database so seeded numbers can never be mistaken for observed ones.

## Architecture

```
config/*.yaml ─▶ loader (zod) ─▶ SignalSpec[]
                                     │
   SourceAdapter registry ── 6 adapters ──▶ Observation
        │                                        │
   compliance preflight                    snapshot store
   (denylist + robots)                           │
                                    diff ─▶ fire_when ─▶ SignalEvent
                                                            │
                              evidence ledger ◀── score (icp.yaml)
                                    │                       │
                                    │                 Morning Brief
                                    │                       │
                                    │                 enrich ─▶ brand kit
                                    │                       │
                                    └──────────▶ Campaign Forge
                                                            │
                    collector health ─▶ APPROVAL GATE (blocks on DEGRADED)
                                                            │
                                            microsite · webhook · export
```

Anneal runs alongside all of it, reading snapshot statistics and writing collector health back into the gate.

### Scraper types

Four distinct Bright Data scraper types, used where scraping is the honest tool:

| Adapter | Route | Reason |
|---|---|---|
| `web` | Bright Data — **PDP** | Bespoke, JS-rendered marketing pages |
| `docs` | Bright Data — **Sitemap** | Documentation content at scale |
| `search` | Bright Data — **Search** | Keyword discovery, no URL needed |
| `careers` | Bright Data — **Discovery** | Companies with no public board API |
| `jobs` | Direct HTTP | Greenhouse/Lever/Ashby publish documented JSON |
| `rss`, `sitemap` | Direct HTTP | Already structured XML |

Routing an RSS feed through a scraper would be theatre. See [ADR 002](docs/adr/002-adapter-boundary.md).

Collectors are reachable two ways over the same Collector ID — the CLI (`scraper run`) and the HTTP API (`POST /dca/trigger`, for CI where no CLI exists). Healing preserves the ID, so both paths survive a repair with nothing downstream touched.

## Compliance, enforced in code

The rule is *public data only — no login-walled sites, no paywalled content, no personal data.* Bellwether enforces it rather than asserting it:

- [`compliance.ts`](src/core/adapters/compliance.ts) carries a host denylist (LinkedIn, X, Facebook, Glassdoor, ZoomInfo…) and a robots.txt preflight that every adapter passes through before every fetch.
- [`tests/compliance.test.ts`](tests/compliance.test.ts) fails the build if any denylisted host becomes reachable, or if a target on the watchlist is one.
- Extracted rows are recursively stripped of contact fields, so Bellwether watches role **shapes** — "this company is standing up a RevOps function" — and never people. That is both compliant and better account-based practice.

> The connector interface accepts any source. We ship public-web adapters only, by design.

## Repo layout

```
config/          signals.yaml (12 templates as data) · icp.yaml · targets.yaml · sources.json
src/core/
  adapters/      SourceAdapter interface + 6 implementations + compliance
  brightdata/    cli.ts — the ONLY shell-out · trigger.ts — Collector ID as an API
  signals/       fieldpath · diff · match · score
  anneal/        health (drift detection) · machine (pure FSM) · heal (the driver)
  campaign/      forge · gate — the load-bearing precondition
  enrich/        brandkit
  store/         db (node:sqlite) · export
src/app/         (app) brief · studio · accounts · dashboard
                 (microsite) m/[slug] — generated pitch pages
                 (fixture) drift-injection pages
cli/             bellwether · provision · seed
docs/adr/        three decisions and what they cost
```

## Notable engineering

Six bugs found by running the thing rather than reasoning about it — each one would have surfaced in front of a judge:

| Bug | Consequence if shipped |
|---|---|
| JavaScript has no inline `(?i)` regex flag | **Every case-insensitive signal silently never fires** while the platform looks healthy |
| Diffs weren't scoped to a source URL | "Documentation grew 128650%" — in the exact format a rep pastes into an email |
| `lever/neon` is a Brazilian fintech, not neon.tech | Portuguese job ads in a Postgres company's brief |
| Matches carried only the matched string | Literal `{{tier.cta}}` sent to a prospect |
| `{{match}}` quoted the whole field | A full paragraph cited where "Snowflake" belonged |
| Duplicate `any` conditions | The same claim cited twice in one email |

The probe that caught the third one exists for exactly that reason: **nothing is provisioned against a URL that has not returned 200**, because a `scraper create` against a 404 costs 25 minutes and real money. It found 8 wrong job-board tokens out of 20 before a cent was spent.

## License

MIT
