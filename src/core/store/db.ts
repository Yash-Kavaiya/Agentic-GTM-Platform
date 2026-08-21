/**
 * The snapshot store.
 *
 * SQLite via `node:sqlite` — built into Node 22+, so there is no native module
 * to compile and no external database to run. `make demo` works from a clean
 * clone on any machine with Node, which is the whole point.
 *
 * The database is local state. What gets committed to the repo is the JSON
 * export (see ./export.ts), which is what the deployed app reads and what makes
 * the heal log inspectable as a git diff.
 */
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type {
  Observation,
  SignalEvent,
  HealEvent,
  HealthState,
  Baseline,
  HealthMap,
} from '../types.js'

/**
 * `node:sqlite` is loaded through createRequire rather than a static import.
 *
 * It is a Node 22+ builtin that bundlers do not yet recognise: Vite normalises
 * the `node:` prefix away and then fails looking for a package called
 * "sqlite". A runtime require is left alone by every bundler, so the store
 * works identically under tsx, vitest, and a Next.js build.
 */
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')

const DEFAULT_PATH = join(process.cwd(), 'data', 'bellwether.db')

const SCHEMA = `
CREATE TABLE IF NOT EXISTS observations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  collector_id TEXT,
  signal_id    TEXT NOT NULL,
  target_id    TEXT NOT NULL,
  source_url   TEXT NOT NULL,
  observed_at  TEXT NOT NULL,
  rows_json    TEXT NOT NULL,
  row_count    INTEGER NOT NULL,
  ok           INTEGER NOT NULL DEFAULT 1,
  error        TEXT
);
CREATE INDEX IF NOT EXISTS idx_obs_series ON observations(signal_id, target_id, source_url, observed_at);
CREATE INDEX IF NOT EXISTS idx_obs_collector ON observations(collector_id, observed_at);

CREATE TABLE IF NOT EXISTS signal_events (
  id         TEXT PRIMARY KEY,
  signal_id  TEXT NOT NULL,
  target_id  TEXT NOT NULL,
  fired_at   TEXT NOT NULL,
  weight     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_day ON signal_events(fired_at);

CREATE TABLE IF NOT EXISTS evidence (
  id           TEXT PRIMARY KEY,
  event_id     TEXT NOT NULL,
  collector_id TEXT,
  signal_id    TEXT NOT NULL,
  target_id    TEXT NOT NULL,
  source_url   TEXT NOT NULL,
  scraped_at   TEXT NOT NULL,
  sentence     TEXT NOT NULL,
  fields_json  TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES signal_events(id)
);
CREATE INDEX IF NOT EXISTS idx_evidence_event ON evidence(event_id);

CREATE TABLE IF NOT EXISTS collector_state (
  collector_id  TEXT PRIMARY KEY,
  signal_id     TEXT NOT NULL,
  target_id     TEXT,
  state         TEXT NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT NOT NULL,
  baseline_json TEXT
);

CREATE TABLE IF NOT EXISTS heal_events (
  id             TEXT PRIMARY KEY,
  collector_id   TEXT NOT NULL,
  signal_id      TEXT NOT NULL,
  target_id      TEXT NOT NULL,
  attempt        INTEGER NOT NULL,
  symptom        TEXT NOT NULL,
  started_at     TEXT NOT NULL,
  ended_at       TEXT,
  duration_ms    INTEGER,
  from_state     TEXT NOT NULL,
  to_state       TEXT NOT NULL,
  verdict        TEXT,
  before_json    TEXT,
  after_json     TEXT,
  rows_recovered INTEGER,
  error          TEXT
);
CREATE INDEX IF NOT EXISTS idx_heal_collector ON heal_events(collector_id, started_at);
`

export class Store {
  private db: InstanceType<typeof DatabaseSync>

  constructor(path: string = process.env.BELLWETHER_DB ?? DEFAULT_PATH) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA foreign_keys = ON')
    this.db.exec(SCHEMA)
  }

  close(): void {
    this.db.close()
  }

  // ---------------------------------------------------------- observations

  putObservation(o: Observation, ok = true, error?: string): number {
    const stmt = this.db.prepare(
      `INSERT INTO observations
         (collector_id, signal_id, target_id, source_url, observed_at, rows_json, row_count, ok, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    const info = stmt.run(
      o.collectorId,
      o.signalId,
      o.targetId,
      o.sourceUrl,
      o.observedAt,
      JSON.stringify(o.rows),
      o.rows.length,
      ok ? 1 : 0,
      error ?? null,
    )
    return Number(info.lastInsertRowid)
  }

  /**
   * The most recent successful observation of the SAME SOURCE, strictly before `at`.
   *
   * Two constraints, both load-bearing:
   *
   * `observed_at < at` rather than wall-clock now is what makes `--date` replay
   * reproduce the same brief every time.
   *
   * `source_url = ?` is what stops a diff comparing two different pages. When a
   * source URL is corrected — a guessed feed path replaced by a verified one —
   * the old snapshot describes a different document, and diffing across them
   * produces confident nonsense ("documentation grew 128650%"). A signal must
   * only ever fire on a change to one source, so a URL change starts a new
   * series rather than corrupting the old one.
   */
  previousObservation(
    signalId: string,
    targetId: string,
    at: string,
    sourceUrl?: string,
  ): Observation | null {
    const row = sourceUrl
      ? (this.db
          .prepare(
            `SELECT * FROM observations
              WHERE signal_id = ? AND target_id = ? AND source_url = ? AND observed_at < ? AND ok = 1
              ORDER BY observed_at DESC LIMIT 1`,
          )
          .get(signalId, targetId, sourceUrl, at) as Record<string, unknown> | undefined)
      : (this.db
          .prepare(
            `SELECT * FROM observations
              WHERE signal_id = ? AND target_id = ? AND observed_at < ? AND ok = 1
              ORDER BY observed_at DESC LIMIT 1`,
          )
          .get(signalId, targetId, at) as Record<string, unknown> | undefined)
    return row ? this.toObservation(row) : null
  }

  latestObservation(signalId: string, targetId: string, at?: string): Observation | null {
    const row = at
      ? (this.db
          .prepare(
            `SELECT * FROM observations WHERE signal_id = ? AND target_id = ? AND observed_at <= ? AND ok = 1
              ORDER BY observed_at DESC LIMIT 1`,
          )
          .get(signalId, targetId, at) as Record<string, unknown> | undefined)
      : (this.db
          .prepare(
            `SELECT * FROM observations WHERE signal_id = ? AND target_id = ? AND ok = 1
              ORDER BY observed_at DESC LIMIT 1`,
          )
          .get(signalId, targetId) as Record<string, unknown> | undefined)
    return row ? this.toObservation(row) : null
  }

  /** Recent successful observations for a collector, newest first. */
  recentForCollector(collectorId: string, limit = 10): Observation[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM observations WHERE collector_id = ? AND ok = 1
          ORDER BY observed_at DESC LIMIT ?`,
      )
      .all(collectorId, limit) as Record<string, unknown>[]
    return rows.map((r) => this.toObservation(r))
  }

  private toObservation(r: Record<string, unknown>): Observation {
    return {
      collectorId: (r.collector_id as string | null) ?? null,
      signalId: r.signal_id as string,
      targetId: r.target_id as string,
      sourceUrl: r.source_url as string,
      observedAt: r.observed_at as string,
      rows: JSON.parse(r.rows_json as string) as Record<string, unknown>[],
    }
  }

  // --------------------------------------------------------------- events

  putEvent(e: SignalEvent): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO signal_events (id, signal_id, target_id, fired_at, weight)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(e.id, e.signalId, e.targetId, e.firedAt, e.weight)

    const ins = this.db.prepare(
      `INSERT OR REPLACE INTO evidence
         (id, event_id, collector_id, signal_id, target_id, source_url, scraped_at, sentence, fields_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const ev of e.evidence) {
      ins.run(
        ev.id,
        e.id,
        ev.collectorId,
        ev.signalId,
        ev.targetId,
        ev.sourceUrl,
        ev.scrapedAt,
        ev.sentence,
        JSON.stringify(ev.fields),
      )
    }
  }

  /** Events on or before `until`, within `windowDays`. */
  eventsUpTo(until: string, windowDays = 30): SignalEvent[] {
    const from = new Date(Date.parse(until) - windowDays * 86_400_000).toISOString()
    const events = this.db
      .prepare(
        `SELECT * FROM signal_events WHERE fired_at <= ? AND fired_at >= ? ORDER BY fired_at DESC`,
      )
      .all(until, from) as Record<string, unknown>[]

    const evStmt = this.db.prepare(`SELECT * FROM evidence WHERE event_id = ?`)
    return events.map((e) => ({
      id: e.id as string,
      signalId: e.signal_id as string,
      targetId: e.target_id as string,
      firedAt: e.fired_at as string,
      weight: e.weight as number,
      evidence: (evStmt.all(e.id as string) as Record<string, unknown>[]).map((v) => ({
        id: v.id as string,
        collectorId: (v.collector_id as string | null) ?? null,
        signalId: v.signal_id as string,
        targetId: v.target_id as string,
        sourceUrl: v.source_url as string,
        scrapedAt: v.scraped_at as string,
        sentence: v.sentence as string,
        fields: JSON.parse(v.fields_json as string) as Record<string, unknown>,
      })),
    }))
  }

  // ------------------------------------------------------ collector health

  setHealth(
    collectorId: string,
    signalId: string,
    targetId: string | null,
    state: HealthState,
    attempts = 0,
    baseline?: Baseline | null,
  ): void {
    this.db
      .prepare(
        `INSERT INTO collector_state (collector_id, signal_id, target_id, state, attempts, updated_at, baseline_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(collector_id) DO UPDATE SET
           state = excluded.state,
           attempts = excluded.attempts,
           updated_at = excluded.updated_at,
           baseline_json = COALESCE(excluded.baseline_json, collector_state.baseline_json)`,
      )
      .run(
        collectorId,
        signalId,
        targetId,
        state,
        attempts,
        new Date().toISOString(),
        baseline ? JSON.stringify(baseline) : null,
      )
  }

  getHealth(collectorId: string): { state: HealthState; attempts: number; baseline: Baseline | null } | null {
    const r = this.db
      .prepare(`SELECT * FROM collector_state WHERE collector_id = ?`)
      .get(collectorId) as Record<string, unknown> | undefined
    if (!r) return null
    return {
      state: r.state as HealthState,
      attempts: r.attempts as number,
      baseline: r.baseline_json ? (JSON.parse(r.baseline_json as string) as Baseline) : null,
    }
  }

  /** Every collector's current state — what the approval gate consults. */
  healthMap(): HealthMap {
    const rows = this.db
      .prepare(`SELECT collector_id, state FROM collector_state`)
      .all() as Record<string, unknown>[]
    const out: HealthMap = {}
    for (const r of rows) out[r.collector_id as string] = r.state as HealthState
    return out
  }

  // ----------------------------------------------------------- heal events

  putHeal(h: HealEvent): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO heal_events
           (id, collector_id, signal_id, target_id, attempt, symptom, started_at, ended_at,
            duration_ms, from_state, to_state, verdict, before_json, after_json, rows_recovered, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        h.id, h.collectorId, h.signalId, h.targetId, h.attempt, h.symptom,
        h.startedAt, h.endedAt, h.durationMs, h.fromState, h.toState, h.verdict,
        h.before ? JSON.stringify(h.before) : null,
        h.after ? JSON.stringify(h.after) : null,
        h.rowsRecovered, h.error ?? null,
      )
  }

  /**
   * Correct the record when a production check disproves an earlier approval.
   *
   * A heal recorded `approved` because its preview passed the field contract
   * and `scraper approve` succeeded — which was true at the time. A later
   * production run can prove the fix never took effect. Leaving the original
   * verdict would let the dashboard report a repair that did not happen, so
   * the evidence updates the record rather than sitting beside it.
   *
   * Only the most recent attempt is amended: earlier attempts were separately
   * judged and their verdicts still describe what happened to them.
   */
  downgradeLastHeal(collectorId: string, to: HealEvent['verdict'], reason: string): boolean {
    const row = this.db
      .prepare(
        `SELECT id FROM heal_events WHERE collector_id = ? AND verdict = 'approved'
          ORDER BY started_at DESC LIMIT 1`,
      )
      .get(collectorId) as { id?: string } | undefined
    if (!row?.id) return false

    this.db
      .prepare(`UPDATE heal_events SET verdict = ?, error = ? WHERE id = ?`)
      .run(to, reason, row.id)
    return true
  }

  heals(limit = 100): HealEvent[] {
    const rows = this.db
      .prepare(`SELECT * FROM heal_events ORDER BY started_at DESC LIMIT ?`)
      .all(limit) as Record<string, unknown>[]
    return rows.map((r) => ({
      id: r.id as string,
      collectorId: r.collector_id as string,
      signalId: r.signal_id as string,
      targetId: r.target_id as string,
      attempt: r.attempt as number,
      symptom: r.symptom as string,
      startedAt: r.started_at as string,
      endedAt: (r.ended_at as string | null) ?? null,
      durationMs: (r.duration_ms as number | null) ?? null,
      fromState: r.from_state as HealthState,
      toState: r.to_state as HealthState,
      verdict: (r.verdict as HealEvent['verdict']) ?? null,
      before: r.before_json ? JSON.parse(r.before_json as string) : null,
      after: r.after_json ? JSON.parse(r.after_json as string) : null,
      rowsRecovered: (r.rows_recovered as number | null) ?? null,
      error: (r.error as string | undefined) ?? undefined,
    }))
  }
}
