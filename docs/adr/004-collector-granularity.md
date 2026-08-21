# 4. One collector per (signal × account), not per signal

**Status:** accepted — supersedes the provisioning model in ADR 002
**Date:** 2026-08-21

## Context

Bellwether's first provisioning model created **one collector per signal** and
ran it against every account on the watchlist: one `pricing` collector for all
20 companies, one `security` collector for all of them, and so on. Four
collectors covering 65 verified pages. Cheap, tidy, and wrong.

It is wrong because a Scraper Studio PDP collector is generated from a specific
page and encodes that page's DOM. This is not a subtle effect. Measured on live
collectors:

| Collector | Seed page | Run against seed | Run against another site |
|---|---|---|---|
| `security` | `cal.com/security` | ISO 27001, SOC 2, CCPA, GDPR | `certification_badges: []` |
| `customers` | `posthog.com/customers` | Legit Media, Fastr, Qubs | — |
| `pricing-v2` | `unkey.com/pricing` | (rate limited) | `waiting for selector "li.pricing-card" failed` |

That last error is the whole finding stated by the platform itself. The
collector had hardcoded `li.pricing-card` from its seed page. On any other
company's pricing page that selector does not exist, so the run times out.

A second lesson came free: **the seed page determines template quality.** Our
original `pricing` collector was seeded on `posthog.com/pricing`, which uses
usage-based pricing and has no conventional tier cards at all. The template
built from it returned an empty array everywhere — including, after a heal, on
the very page the heal had previewed successfully against. We spent a full heal
cycle repairing a collector that was mis-seeded from birth.

## Decision

The unit of provisioning is **(signal × account)**. Each watched account gets
its own collector per signal, seeded and healed against that account's own page.

`config/collectors.json` is keyed `signalId:targetId`. The provisioner takes an
explicit account list rather than silently seeding from whichever target
happened to sort first.

Coverage becomes a deliberate, costed decision: collectors take 4–8 minutes each
to build and consume credit, so Bellwether watches a curated watchlist deeply
rather than a long list shallowly.

## Consequences

**Good**

- Extraction actually works, because every collector is matched to the markup
  it reads.
- Failures are correctly scoped. One account's redesign degrades one collector
  and blocks campaigns for that account only, instead of silently emptying a
  signal across the whole watchlist.
- The healing story gets stronger, not weaker. Per-account collectors are
  exactly the thing that breaks individually and must heal individually — which
  is what Anneal was built for.
- This is how the product should work anyway. An account-based GTM tool watches
  named accounts; per-account collectors are the honest shape of that.

**Bad**

- Cost and setup time scale with the watchlist. 20 accounts × 4 signals is 80
  collectors and several hours of build time — not something to do casually.
- Adding an account is no longer free. It is a provisioning step with a
  latency measured in minutes.
- Our own demo watchlist is therefore small and deep rather than broad.

## Note on failure modes

The two broken collectors failed differently, and both matter:

- The `pricing` collector returned `200 OK` with rows whose arrays were empty.
  **Silent.** This is the failure `detectDrift()` exists to catch, and the
  reason it watches per-field null rates rather than HTTP status.
- The `pricing-v2` collector returned an explicit `wait_element_timeout`.
  **Loud**, and easy to handle.

A monitoring system that only notices the loud one is not monitoring anything
worth paying for.
