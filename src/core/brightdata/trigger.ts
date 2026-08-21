/**
 * The Collector ID as an API.
 *
 * `scraper run` (see ./cli.ts) is the right execution path on a developer
 * machine. It is the wrong one in CI or a serverless function, where there is
 * no CLI and no interactive login. This module is the same collector reached
 * over plain HTTP:
 *
 *   POST https://api.brightdata.com/dca/trigger?collector=<c_*>&queue_next=1
 *        -> { "collection_id": "j_*" }
 *   GET  https://api.brightdata.com/dca/dataset?id=<j_*>
 *        -> { "status": "building" }  ... until ready, then a JSON array of rows
 *
 * The important property: the Collector ID is the stable contract. `scraper
 * heal` repairs a collector in place and keeps the same ID, so both execution
 * paths — and every schedule and integration pointed at them — survive a repair
 * with nothing downstream touched. That is why Anneal can fix a broken source
 * without the rest of Bellwether knowing anything happened.
 */
const API_BASE = 'https://api.brightdata.com'

export interface TriggerInput {
  url: string
  [k: string]: unknown
}

export interface TriggerResult {
  collectionId: string
  rows: Record<string, unknown>[]
  durationMs: number
  pollCount: number
}

export class TriggerError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message)
    this.name = 'TriggerError'
  }
}

function apiKey(): string {
  const key = process.env.BRIGHTDATA_API_KEY
  if (!key) {
    throw new TriggerError(
      'BRIGHTDATA_API_KEY is not set. Copy .env.example to .env and fill it in, ' +
        'or use the CLI path (`bdata login`) instead.',
    )
  }
  return key
}

const authHeaders = () => ({
  authorization: `Bearer ${apiKey()}`,
  'content-type': 'application/json',
})

/** Queue inputs against a collector. Returns the collection (snapshot) id. */
export async function trigger(
  collectorId: string,
  inputs: TriggerInput[],
  opts: { queueNext?: boolean } = {},
): Promise<string> {
  const queueNext = opts.queueNext ?? true
  const url = `${API_BASE}/dca/trigger?collector=${encodeURIComponent(collectorId)}&queue_next=${queueNext ? 1 : 0}`

  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(inputs),
    signal: AbortSignal.timeout(60_000),
  })

  const body = await res.text()
  if (!res.ok) {
    throw new TriggerError(`trigger failed for ${collectorId}: HTTP ${res.status}`, res.status, body)
  }

  let parsed: { collection_id?: string; snapshot_id?: string }
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new TriggerError(`trigger returned non-JSON for ${collectorId}`, res.status, body)
  }

  const id = parsed.collection_id ?? parsed.snapshot_id
  if (!id) throw new TriggerError(`trigger returned no collection_id`, res.status, body)
  return id
}

/**
 * Fetch a collection once.
 * Returns `null` while the collector is still building, rows when it is done.
 */
export async function fetchCollection(
  collectionId: string,
): Promise<Record<string, unknown>[] | null> {
  const res = await fetch(`${API_BASE}/dca/dataset?id=${encodeURIComponent(collectionId)}`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(60_000),
  })

  const body = await res.text()
  if (!res.ok) {
    throw new TriggerError(`dataset fetch failed: HTTP ${res.status}`, res.status, body)
  }

  // The docs' own readiness test: results are ready when the body is an array.
  if (body.trimStart().startsWith('[')) {
    return JSON.parse(body) as Record<string, unknown>[]
  }

  try {
    const status = JSON.parse(body) as { status?: string; error?: string }
    if (status.error) throw new TriggerError(`collection failed: ${status.error}`, res.status, body)
  } catch (e) {
    if (e instanceof TriggerError) throw e
    // Unparseable and not an array — treat as still building.
  }
  return null
}

/**
 * Trigger and poll to completion.
 *
 * Docs put a typical run at 30-90s for 1-10 inputs, so the five-second poll
 * they recommend is right; the default ceiling gives a slow run room without
 * hanging a cron job forever.
 */
export async function triggerAndWait(
  collectorId: string,
  inputs: TriggerInput[],
  opts: { intervalMs?: number; timeoutMs?: number; onPoll?: (n: number) => void } = {},
): Promise<TriggerResult> {
  const { intervalMs = 5_000, timeoutMs = 10 * 60_000, onPoll } = opts
  const started = Date.now()

  const collectionId = await trigger(collectorId, inputs)

  let pollCount = 0
  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, intervalMs))
    pollCount++
    onPoll?.(pollCount)

    const rows = await fetchCollection(collectionId)
    if (rows) {
      return { collectionId, rows, durationMs: Date.now() - started, pollCount }
    }
  }

  throw new TriggerError(
    `collection ${collectionId} did not finish within ${Math.round(timeoutMs / 1000)}s`,
  )
}
