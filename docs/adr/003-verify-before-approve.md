# 3. Verify the fix before approving it

**Status:** accepted
**Date:** 2026-08-21

## Context

`bdata scraper heal` stops at an approval gate by design. It proposes a repair,
returns `status: "awaiting_approval"` with a `preview_result`, and waits. The CLI
also offers `--auto-approve`, which skips the gate and polls straight through to
done.

`--auto-approve` is one flag and makes the demo shorter. We do not use it.

## Decision

Bellwether treats the approval gate as the point of the loop, not an obstacle in
it. On drift:

```
HEALTHY  --drift detected-----------------> DEGRADED
DEGRADED --scraper heal--------------------> HEALING
HEALING  --awaiting_approval + preview-----> VERIFYING
VERIFYING --preview meets field contract---> scraper approve          --> HEALED --> HEALTHY
VERIFYING --preview fails------------------> scraper approve --reject --> DEGRADED | QUARANTINED
```

In `VERIFYING`, the platform scores `preview_result` against the signal's own
`fields.required` contract: every required field populated, null rates back
within tolerance of the rolling baseline, row count restored. Only then does it
call `scraper approve`. A preview that fails is **actively rejected** rather than
left pending, the symptom is sharpened to state the contract explicitly, and the
loop retries. Two failures quarantine the collector.

A quarantined collector blocks campaign approval downstream.

## Amendment, 21 August: a preview is a promise, not a result

The decision above was necessary and not sufficient. Running it against live
collectors produced this, three times over:

```
c_mt2tgjmm9mzvu9rjb  HEALING -> VERIFYING (1 preview row)
c_mt2tgjmm9mzvu9rjb  VERIFYING -> HEALED, approving
c_mt2tgjmm9mzvu9rjb  HEALED - 3 rows recovered in 68.3s
```

The previews were genuinely good — `0 rows / 100% null` became
`3 rows / 0% null` — and the verifier was right to approve them. `scraper
approve` returned `status: "done"`. And the very next production `scraper run`
returned exactly the broken output it had before, on all three.

So verifying the preview proves the repair was *proposed* correctly. It does
not prove the source works. A platform that stops there marks a collector
HEALTHY, clears the approval gate, and lets a campaign go out citing a source
that is still broken — which is the precise failure this whole design exists
to prevent, arrived at by a longer route.

`HEALED` is therefore no longer terminal. After `scraper approve`, Bellwether
runs the collector against production and scores that run against the same
contract:

```
HEALED --production run confirms------> HEALTHY
HEALED --production still fails-------> QUARANTINED  (verdict: approved_ineffective)
```

`rowsRecovered` is now measured from the confirming production run rather than
from the preview, so the number in the heal log reflects what the source
actually returns.

`bellwether verify` runs the same check on demand without spending a heal.

## Consequences

**Good**

- This is the difference between wrapping a CLI and driving one. The platform
  decides whether a repair worked, using a definition of "worked" that comes
  from the same YAML the user wrote.
- Self-healing becomes load-bearing rather than decorative. `canApprove()` is a
  pure function over collector health, and it refuses while any cited collector
  is unhealthy. **Sending a prospect a claim sourced from a broken scraper is
  worse than sending nothing** — it is confidently wrong, in writing, to someone
  you want to sell to.
- A rejected fix is discarded explicitly, so nothing else can approve it later.
- An unknown collector is treated as `QUARANTINED`, not assumed healthy. If
  Bellwether cannot say a source works, it does not get to claim it works.

**Bad**

- Slower than `--auto-approve`, by a verification pass and a production run.
- A confirmation run costs a real collector execution every time a heal
  completes.
- The field contract is only as good as `fields.required`. A signal that
  under-specifies its required fields can have a bad fix approved. This is the
  right failure mode — it is visible in config a user can read and fix — but it
  is a real limit.
- Two attempts is a guess. It is a constant (`MAX_ATTEMPTS`) rather than
  something tuned against data we do not yet have.
- We do not know *why* an approved fix fails to reach production, only that it
  does. `approved_ineffective` records the observation without explaining it,
  which is the honest thing to store but not a diagnosis.

## What this cost us

The whole loop is exercised offline in `tests/heal-loop.test.ts` against a stub
CLI: good fix approved, bad fix rejected and retried with a sharpened prompt,
repeated failure quarantined, CLI error quarantined, no-drift no-op. Those tests
run without a network, an API key, or a cent of credit — which is the only
reason the state machine could be finished and trusted before a single collector
existed.
