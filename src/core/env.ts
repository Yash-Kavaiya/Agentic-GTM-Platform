/**
 * Load .env into process.env.
 *
 * Node 20.6+ ships this natively, so there is no dotenv dependency. Called at
 * the top of each CLI entry point, before anything reads a key.
 *
 * The Bright Data CLI is invoked as a child process with `env: process.env`,
 * so loading here is what lets `bdata scraper create` authenticate without the
 * key ever being typed on a command line or landing in shell history.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

let loaded = false

export function loadEnv(): void {
  if (loaded) return
  loaded = true
  const path = join(process.cwd(), '.env')
  if (!existsSync(path)) return
  try {
    process.loadEnvFile(path)
  } catch {
    // A malformed .env must not take the whole CLI down; the caller will
    // report a missing key with a far more useful message than a parse error.
  }
}

/** True when a Bright Data credential is available by any route. */
export const hasBrightDataKey = (): boolean => Boolean(process.env.BRIGHTDATA_API_KEY)
