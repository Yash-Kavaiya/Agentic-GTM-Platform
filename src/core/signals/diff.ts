/**
 * Snapshot diffing.
 *
 * A signal fires on a CHANGE, not on a state. "Enterprise tier exists" is not
 * news; "an Enterprise tier appeared between Tuesday and Wednesday" is the
 * whole product. So every rule is evaluated against a pair of observations.
 *
 * Two kinds of comparison, because signals ask two different questions:
 *
 *   set diff     what appeared or vanished from a collection
 *                (a new tier, a new integration, a new compliance badge)
 *
 *   paired diff  what changed value while staying the same thing
 *                (the Pro tier's price moved from $20 to $25)
 *
 * A paired diff needs to know which item is "the same thing" across snapshots.
 * Bellwether uses the signal's first required field as the identity: for the
 * pricing signals that is `tiers[].name`, so tiers are matched by name and
 * their prices compared. That is why `fields.required` is ordered and why the
 * identity field is listed first.
 */
import { resolveField, resolveStrings, parsePath } from './fieldpath.js'

export interface SetDiff {
  field: string
  added: string[]
  removed: string[]
  countBefore: number
  countAfter: number
  /** Signed percentage change in item count; 0 when there was nothing before. */
  deltaPct: number
}

export interface PairedChange {
  identity: string
  before: string
  after: string
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ')

/** What appeared and vanished at `path` between two snapshots. */
export function diffSet(before: unknown[], after: unknown[], path: string): SetDiff {
  const b = resolveStrings(before, path).map(norm)
  const a = resolveStrings(after, path).map(norm)

  const bSet = new Set(b)
  const aSet = new Set(a)

  const countBefore = b.length
  const countAfter = a.length

  return {
    field: path,
    added: [...aSet].filter((v) => !bSet.has(v)),
    removed: [...bSet].filter((v) => !aSet.has(v)),
    countBefore,
    countAfter,
    deltaPct: countBefore === 0 ? 0 : ((countAfter - countBefore) / countBefore) * 100,
  }
}

/**
 * Split `tiers[].price` into the collection path (`tiers[]`) and the leaf
 * (`price`), so items can be paired on a sibling field.
 */
export function splitLeaf(path: string): { collection: string; leaf: string } | null {
  const segments = parsePath(path)
  if (segments.length < 2) return null
  const leaf = segments[segments.length - 1]!
  const collection = segments
    .slice(0, -1)
    .map((s) => `${s.key}${s.iterate ? '[]' : ''}`)
    .join('.')
  return { collection, leaf: leaf.key }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const asString = (v: unknown): string | null =>
  v === null || v === undefined ? null : typeof v === 'string' ? v : JSON.stringify(v)

/**
 * Items whose `valuePath` changed while their identity stayed the same.
 *
 * `identityPath` and `valuePath` must address leaves of the same collection,
 * e.g. `tiers[].name` and `tiers[].price`.
 */
export function diffPaired(
  before: unknown[],
  after: unknown[],
  identityPath: string,
  valuePath: string,
): PairedChange[] {
  const idParts = splitLeaf(identityPath)
  const valParts = splitLeaf(valuePath)
  if (!idParts || !valParts || idParts.collection !== valParts.collection) return []

  const index = (rows: unknown[]) => {
    const out = new Map<string, string | null>()
    for (const item of resolveField(rows, idParts.collection)) {
      if (!isRecord(item)) continue
      const id = asString(item[idParts.leaf])
      if (id === null) continue
      out.set(norm(id), asString(item[valParts.leaf]))
    }
    return out
  }

  const b = index(before)
  const a = index(after)

  const changes: PairedChange[] = []
  for (const [identity, afterVal] of a) {
    if (!b.has(identity)) continue // new item — that is a set diff, not a change
    const beforeVal = b.get(identity)!
    if (beforeVal === null || afterVal === null) continue
    if (norm(beforeVal) !== norm(afterVal)) {
      changes.push({ identity, before: beforeVal, after: afterVal })
    }
  }
  return changes
}

/** Percentage change in the number of items at `path`. */
export function countDeltaPct(before: unknown[], after: unknown[], path: string): number {
  return diffSet(before, after, path).deltaPct
}
