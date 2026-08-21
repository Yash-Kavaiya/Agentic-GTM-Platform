# 1. The repository is the database

**Status:** accepted
**Date:** 2026-08-21

## Context

Bellwether has to persist snapshots, signal events, an evidence ledger and a
heal log, and it has to show them on a deployed web app. The obvious options
were a hosted Postgres, a SQLite file the app reads, or something else.

Two constraints made the choice for us:

- **Vercel has no writable filesystem.** A serverless function cannot own
  mutable state, so the app cannot be the thing that writes.
- **The heal log is the most important artifact in the project.** Whatever
  stores it should make it easy to inspect and hard to quietly alter.

## Decision

The engine is local-first and CI-first. It writes SQLite (`node:sqlite`, a Node
22+ builtin — no native module to compile) and exports JSON to `data/export/`.
GitHub Actions runs the engine on a cron and **commits the export**. That commit
triggers a Vercel redeploy, and the app reads the JSON at build time.

The deployed app never touches a database, a network call, or the Bright Data
CLI at request time.

## Consequences

**Good**

- The heal log is a git diff. A reviewer can read exactly what a collector
  returned before and after a repair, at the commit where it happened, with
  authorship and a timestamp they did not have to trust us for.
- `make demo` works from a clean clone. No services to start, no credentials
  needed to look at the product.
- The deployed app is a pure function of the repository, so "what is live" is
  always answerable by reading one commit.
- No native modules. `better-sqlite3` needs a compiler toolchain and its
  prebuilds lag new Node releases; `node:sqlite` needs neither.

**Bad**

- Write latency is a deploy, not a request. This is fine for a platform whose
  natural cadence is daily, and wrong for anything interactive.
- Signal Studio cannot write from the deployed site. Locally it is fully
  functional; deployed, it previews the YAML and the exact `scraper create`
  command it would run. A `repository_dispatch` from an API route would close
  the gap and is deliberately out of scope.
- Export size grows with history. At the current cadence this is kilobytes per
  day; a real deployment would prune or window it.

## Alternatives considered

**Hosted Postgres / Turso.** Correct for a real product, and the right thing to
migrate to. Rejected here because it adds a credential, a network dependency and
a cold-start path to every page, in exchange for write latency nobody needs — and
it would have cost the git-diff property that makes the heal log legible.

**SQLite committed directly.** A binary blob in git. Diffs are unreadable, which
throws away the entire benefit.
