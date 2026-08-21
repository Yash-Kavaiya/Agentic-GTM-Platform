/**
 * The Bright Data boundary.
 *
 * This is the ONLY module in Bellwether that shells out. Everything else works
 * in terms of Observations and CollectorBindings, so the platform can be read,
 * tested, and reasoned about without a network or an API key.
 *
 * Commands used (CLI v0.3.x):
 *   brightdata scraper create  <url> "<watch>"     --name <n>       -o <json>
 *   brightdata scraper run     <cid> <url>         [--urls a,b]     -o <json>
 *   brightdata scraper heal    <cid> "<symptom>"   --url <u>        -o <json>
 *   brightdata scraper approve <cid>               [--url <u>] [--reject] -o <json>
 *   brightdata budget
 *
 * Note we never pass `--auto-approve` to `heal`. The whole point of Anneal is
 * that Bellwether reads `preview_result`, checks it against the signal's field
 * contract, and only then approves or rejects. See ../anneal/heal.ts.
 */
import { execFile } from 'node:child_process'
import { readFile, unlink, mkdtemp } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

export interface BdEnvelope {
  collector_id?: string
  status?: string
  completed_steps?: string[]
  view_url?: string
  created_at?: string
  preview_result?: unknown
  data?: unknown
  error?: string
  [k: string]: unknown
}

export interface BdResult {
  envelope: BdEnvelope | null
  rows: Record<string, unknown>[]
  stdout: string
  stderr: string
  code: number
  /** The exact argv, recorded so the UI and heal log can show what ran. */
  command: string
  durationMs: number
}

export class BrightDataError extends Error {
  constructor(
    message: string,
    readonly result: BdResult,
  ) {
    super(message)
    this.name = 'BrightDataError'
  }
}

/** Set BELLWETHER_DRY_RUN=1 to exercise the whole pipeline without spending credit. */
export const isDryRun = () => process.env.BELLWETHER_DRY_RUN === '1'

/**
 * Resolve the CLI's JS entrypoint so we can invoke it as `node <entry>`.
 *
 * Calling the `brightdata` shim directly is awkward cross-platform: on Windows
 * it is a .cmd, which Node refuses to execFile without a shell, and running it
 * through a shell would mangle the quoting of `watch` strings that contain
 * commas, quotes and parentheses. Going straight to the JS file sidesteps all
 * of it and keeps arguments as a real argv array.
 */
let cachedEntry: string | null | undefined
function resolveCliEntry(): string | null {
  if (cachedEntry !== undefined) return cachedEntry
  const require = createRequire(import.meta.url)
  const candidates = ['@brightdata/cli/package.json']
  for (const c of candidates) {
    try {
      const pkgPath = require.resolve(c)
      const pkg = require(c) as { bin?: string | Record<string, string> }
      const bin = typeof pkg.bin === 'string' ? pkg.bin : (pkg.bin?.brightdata ?? pkg.bin?.bdata)
      if (bin) {
        const entry = join(pkgPath, '..', bin)
        if (existsSync(entry)) return (cachedEntry = entry)
      }
    } catch {
      /* not installed locally — fall through to the global lookup */
    }
  }
  // Global install: npm puts it under <prefix>/node_modules/@brightdata/cli
  for (const root of globalRoots()) {
    const pkgJson = join(root, '@brightdata', 'cli', 'package.json')
    if (!existsSync(pkgJson)) continue
    try {
      const pkg = JSON.parse(require('node:fs').readFileSync(pkgJson, 'utf8')) as {
        bin?: string | Record<string, string>
      }
      const bin = typeof pkg.bin === 'string' ? pkg.bin : (pkg.bin?.brightdata ?? pkg.bin?.bdata)
      if (bin) {
        const entry = join(pkgJson, '..', bin)
        if (existsSync(entry)) return (cachedEntry = entry)
      }
    } catch {
      /* keep looking */
    }
  }
  return (cachedEntry = null)
}

function globalRoots(): string[] {
  const roots: string[] = []
  if (process.env.APPDATA) roots.push(join(process.env.APPDATA, 'npm', 'node_modules'))
  if (process.env.npm_config_prefix) {
    roots.push(join(process.env.npm_config_prefix, 'node_modules'))
    roots.push(join(process.env.npm_config_prefix, 'lib', 'node_modules'))
  }
  roots.push('/usr/local/lib/node_modules', '/usr/lib/node_modules')
  return roots
}

interface RunOpts {
  /** Milliseconds. `scraper create` legitimately takes 5-25 minutes. */
  timeoutMs?: number
  /** Called with each chunk of CLI output, for live progress in the terminal. */
  onProgress?: (chunk: string) => void
}

/**
 * Run one CLI command and return its JSON envelope.
 *
 * The envelope is read from a temp file written with `-o` rather than parsed
 * out of stdout, because the CLI streams human-readable progress to stdout
 * during long operations and that would corrupt a naive JSON.parse.
 */
export async function bdata(args: string[], opts: RunOpts = {}): Promise<BdResult> {
  const { timeoutMs = 120_000, onProgress } = opts
  const started = Date.now()
  const dir = await mkdtemp(join(tmpdir(), 'bellwether-'))
  const outFile = join(dir, 'envelope.json')
  const argv = [...args, '-o', outFile]
  const command = `brightdata ${argv.join(' ')}`

  const entry = resolveCliEntry()
  if (!entry) {
    const result: BdResult = {
      envelope: null, rows: [], stdout: '', stderr: '', code: -1, command, durationMs: 0,
    }
    throw new BrightDataError(
      'Bright Data CLI not found. Install it with `npm install -g @brightdata/cli`.',
      result,
    )
  }

  const { stdout, stderr, code } = await new Promise<{
    stdout: string; stderr: string; code: number
  }>((resolve) => {
    const child = execFile(
      process.execPath,
      [entry, ...argv],
      { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, env: process.env },
      (err, so, se) => {
        resolve({
          stdout: so ?? '',
          stderr: se ?? '',
          code: err ? ((err as NodeJS.ErrnoException & { code?: number }).code ?? 1) : 0,
        })
      },
    )
    if (onProgress) {
      child.stdout?.on('data', (d) => onProgress(String(d)))
      child.stderr?.on('data', (d) => onProgress(String(d)))
    }
  })

  let envelope: BdEnvelope | null = null
  try {
    envelope = JSON.parse(await readFile(outFile, 'utf8')) as BdEnvelope
  } catch {
    envelope = extractJson(stdout)
  }
  await unlink(outFile).catch(() => {})

  return {
    envelope,
    rows: rowsFrom(envelope),
    stdout,
    stderr,
    code: typeof code === 'number' ? code : 1,
    command,
    durationMs: Date.now() - started,
  }
}

/** Last-resort recovery when `-o` produced nothing: find a JSON body in stdout. */
function extractJson(s: string): BdEnvelope | null {
  const start = s.search(/[[{]/)
  if (start < 0) return null
  for (let end = s.length; end > start; end--) {
    const slice = s.slice(start, end)
    if (!/[\]}]$/.test(slice.trimEnd())) continue
    try {
      return JSON.parse(slice.trimEnd()) as BdEnvelope
    } catch {
      /* keep shrinking */
    }
  }
  return null
}

/** Envelopes wrap rows differently per command; normalise to a row array. */
export function rowsFrom(envelope: BdEnvelope | null): Record<string, unknown>[] {
  if (!envelope) return []
  const candidates = [envelope.data, envelope.preview_result, envelope.rows, envelope.result]
  for (const c of candidates) {
    if (Array.isArray(c)) return c as Record<string, unknown>[]
    if (c && typeof c === 'object') return [c as Record<string, unknown>]
  }
  return Array.isArray(envelope) ? (envelope as Record<string, unknown>[]) : []
}

// ------------------------------------------------------------- commands

export function scraperCreate(
  url: string,
  watch: string,
  name: string,
  opts: RunOpts = {},
): Promise<BdResult> {
  // `watch` is passed through verbatim. It is the user's plain-language
  // description and nothing is allowed to rewrite it on the way to the CLI.
  return bdata(['scraper', 'create', url, watch, '--name', name], {
    timeoutMs: 30 * 60_000,
    ...opts,
  })
}

export function scraperRun(
  collectorId: string,
  urls: string[],
  opts: RunOpts = {},
): Promise<BdResult> {
  const args =
    urls.length === 1
      ? ['scraper', 'run', collectorId, urls[0]!]
      : ['scraper', 'run', collectorId, '--urls', urls.join(',')]
  return bdata(args, { timeoutMs: 10 * 60_000, ...opts })
}

/**
 * Ask Bright Data to repair a collector. Stops at the approval gate on purpose:
 * the returned envelope carries `status: "awaiting_approval"` and a
 * `preview_result` for Bellwether to verify before committing.
 */
export function scraperHeal(
  collectorId: string,
  symptom: string,
  url: string,
  opts: RunOpts = {},
): Promise<BdResult> {
  return bdata(['scraper', 'heal', collectorId, symptom, '--url', url], {
    timeoutMs: 25 * 60_000,
    ...opts,
  })
}

export function scraperApprove(
  collectorId: string,
  o: { url?: string; reject?: boolean } = {},
  opts: RunOpts = {},
): Promise<BdResult> {
  const args = ['scraper', 'approve', collectorId]
  if (o.url) args.push('--url', o.url)
  if (o.reject) args.push('--reject')
  return bdata(args, { timeoutMs: 5 * 60_000, ...opts })
}

/** Account balance and usage — the ROI dashboard reads real numbers from this. */
export function budget(opts: RunOpts = {}): Promise<BdResult> {
  return bdata(['budget'], { timeoutMs: 60_000, ...opts })
}
