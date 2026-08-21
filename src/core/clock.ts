/**
 * Injectable clock.
 *
 * Every "now" in Bellwether comes from here. That is what makes
 * `bellwether brief --date 2026-08-21` possible: the whole pipeline can be
 * replayed against stored snapshots for any past morning, which means the demo
 * never depends on a live site changing on cue.
 */
export interface Clock {
  now(): Date
}

export const systemClock: Clock = { now: () => new Date() }

/** A clock pinned to an instant, for replay and for tests. */
export const fixedClock = (at: Date | string): Clock => {
  const d = typeof at === 'string' ? new Date(at) : at
  if (Number.isNaN(d.getTime())) throw new Error(`invalid date: ${String(at)}`)
  return { now: () => new Date(d) }
}

/** Start-of-day in UTC, the unit the Morning Brief is grouped by. */
export const dayOf = (d: Date | string): string =>
  (typeof d === 'string' ? d : d.toISOString()).slice(0, 10)

export const daysBetween = (a: Date | string, b: Date | string): number => {
  const t1 = typeof a === 'string' ? Date.parse(a) : a.getTime()
  const t2 = typeof b === 'string' ? Date.parse(b) : b.getTime()
  return Math.abs(t2 - t1) / 86_400_000
}
