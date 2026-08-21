/**
 * RSS/Atom and sitemap adapters.
 *
 * Both read XML that is already structured and published for machines. There is
 * no extraction problem to solve here, so there is no collector: a scraper in
 * front of an RSS feed would add cost, latency and a failure mode in exchange
 * for nothing.
 *
 * This is the compliant, higher-signal replacement for watching a company's
 * social accounts. A changelog feed says what shipped, with a timestamp, and
 * without the noise.
 */
import type { CollectorBinding, Observation, SignalSpec, Target } from '../types.js'
import { type SourceAdapter, defaultPreflight, httpGet, makeObservation } from './base.js'
import { resolveUrl, hasVerifiedSource } from '../config/load.js'

// ------------------------------------------------------------------ XML

const decode = (s: string): string =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Pull the first <tag>…</tag> value out of an XML fragment. */
function tag(xml: string, name: string): string | null {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(xml)
  return m ? decode(m[1]!) : null
}

/** Atom puts the URL in an attribute rather than a text node. */
function linkHref(xml: string): string | null {
  const m = /<link[^>]*href=["']([^"']+)["']/i.exec(xml)
  return m ? m[1]! : (tag(xml, 'link') ?? null)
}

export interface FeedEntry extends Record<string, unknown> {
  title: string
  published_at: string | null
  summary: string | null
  url: string | null
}

export function parseFeed(xml: string): FeedEntry[] {
  const chunks = xml.match(/<(item|entry)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi) ?? []
  return chunks
    .map((c) => ({
      title: tag(c, 'title') ?? '',
      published_at: tag(c, 'pubDate') ?? tag(c, 'published') ?? tag(c, 'updated'),
      summary: tag(c, 'description') ?? tag(c, 'summary') ?? tag(c, 'content'),
      url: linkHref(c),
    }))
    .filter((e) => e.title)
}

export interface SitemapUrl extends Record<string, unknown> {
  loc: string
  lastmod: string | null
}

export function parseSitemap(xml: string): SitemapUrl[] {
  const chunks = xml.match(/<url(?:\s[^>]*)?>[\s\S]*?<\/url>/gi) ?? []
  if (chunks.length > 0) {
    return chunks
      .map((c) => ({ loc: tag(c, 'loc') ?? '', lastmod: tag(c, 'lastmod') }))
      .filter((u) => u.loc)
  }
  // A sitemap index points at child sitemaps; surface those as entries so the
  // count still means something.
  const locs = xml.match(/<loc>([\s\S]*?)<\/loc>/gi) ?? []
  return locs.map((l) => ({ loc: decode(l.replace(/<\/?loc>/gi, '')), lastmod: null })).filter((u) => u.loc)
}

// -------------------------------------------------------------- adapters

/**
 * Only bind to a source we have confirmed exists.
 *
 * Feed paths vary wildly between sites, and a template default is a guess.
 * Binding to an unverified guess turns every run into a wall of 404s that
 * buries the real errors, so an unprobed pair is skipped instead.
 */
const bindVerified = (signal: SignalSpec, target: Target): CollectorBinding | null =>
  hasVerifiedSource(signal, target)
    ? {
        collectorId: null,
        signalId: signal.id,
        targetId: target.id,
        url: resolveUrl(signal, target),
        usesBrightData: false,
      }
    : null

export const rssAdapter: SourceAdapter = {
  kind: 'rss',
  usesBrightData: false,
  scraperType: null,
  preflight: defaultPreflight,

  bind: bindVerified,

  async observe(binding: CollectorBinding, _signal: SignalSpec, at: Date): Promise<Observation> {
    const xml = await httpGet(binding.url)
    return makeObservation(binding, [{ entries: parseFeed(xml) }], at)
  },
}

export const sitemapAdapter: SourceAdapter = {
  kind: 'sitemap',
  usesBrightData: false,
  scraperType: null,
  preflight: defaultPreflight,

  bind: bindVerified,

  async observe(binding: CollectorBinding, _signal: SignalSpec, at: Date): Promise<Observation> {
    const xml = await httpGet(binding.url, 25_000)
    return makeObservation(binding, [{ urls: parseSitemap(xml) }], at)
  },
}
