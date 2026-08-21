/**
 * Brand kit extraction.
 *
 * Pulls a company's visual identity off its own public homepage: logo, colour
 * palette, typefaces, and the cadence of its headline writing.
 *
 * This is what makes the generated campaign land. A pitch page rendered in the
 * prospect's own colours, typeface and voice reads as though someone at their
 * company made it — and it is only possible because we already read their site
 * to find the signal in the first place. The scraping is not a means to a
 * dataset here; it is what makes the output feel personal.
 *
 * Everything comes from markup and stylesheets that are already public. No
 * tracker pixel, no data vendor, no personal data.
 */
import { httpGet } from '../adapters/base.js'
import { preflight } from '../adapters/compliance.js'

export interface BrandKit {
  domain: string
  fetchedAt: string
  logoUrl: string | null
  faviconUrl: string | null
  /** Ranked most-used first. Hex, lowercase. */
  palette: string[]
  primary: string | null
  fonts: string[]
  headline: string | null
  description: string | null
  /** Sentences from the page, used to mirror how they write. */
  voiceSamples: string[]
}

const abs = (url: string, base: string): string => {
  try {
    return new URL(url, base).toString()
  } catch {
    return url
  }
}

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i').exec(tag)
  return m ? m[1]! : null
}

const meta = (html: string, property: string): string | null => {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)\\s*=\\s*["']${property}["'][^>]*>`,
    'i',
  )
  const tag = re.exec(html)?.[0]
  return tag ? attr(tag, 'content') : null
}

/** Colours that carry no brand information. */
const isNeutral = (hex: string): boolean => {
  const n = hex.replace('#', '')
  const r = parseInt(n.slice(0, 2), 16)
  const g = parseInt(n.slice(2, 4), 16)
  const b = parseInt(n.slice(4, 6), 16)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const saturation = max === 0 ? 0 : (max - min) / max
  // Greys, near-blacks and near-whites: structural, not identity.
  return saturation < 0.18 || max < 28 || min > 236
}

const normaliseHex = (raw: string): string | null => {
  let h = raw.trim().toLowerCase()
  if (h.startsWith('#')) h = h.slice(1)
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (!/^[0-9a-f]{6}$/.test(h)) return null
  return `#${h}`
}

/** Rank colours by how often the site uses them. */
export function extractPalette(css: string, limit = 6): string[] {
  const counts = new Map<string, number>()

  for (const m of css.matchAll(/#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g)) {
    const hex = normaliseHex(m[0])
    if (hex) counts.set(hex, (counts.get(hex) ?? 0) + 1)
  }

  for (const m of css.matchAll(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/g)) {
    const hex = `#${[m[1], m[2], m[3]]
      .map((v) => Number(v).toString(16).padStart(2, '0'))
      .join('')}`
    const norm = normaliseHex(hex)
    if (norm) counts.set(norm, (counts.get(norm) ?? 0) + 1)
  }

  return [...counts.entries()]
    .filter(([hex]) => !isNeutral(hex))
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([hex]) => hex)
}

export function extractFonts(css: string, limit = 3): string[] {
  const counts = new Map<string, number>()
  for (const m of css.matchAll(/font-family\s*:\s*([^;}"']+)/gi)) {
    const first = m[1]!.split(',')[0]!.replace(/["']/g, '').trim()
    if (!first || first.length > 40) continue
    if (/^(inherit|initial|unset|var\(|-)/i.test(first)) continue
    // Generic families are fallbacks, not identity.
    if (/^(sans-serif|serif|monospace|system-ui|ui-\w+|cursive|fantasy)$/i.test(first)) continue
    counts.set(first, (counts.get(first) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([f]) => f)
}

function extractLogo(html: string, base: string): string | null {
  const og = meta(html, 'og:image')
  if (og) return abs(og, base)

  for (const tag of html.match(/<img[^>]+>/gi) ?? []) {
    const hay = `${attr(tag, 'class') ?? ''} ${attr(tag, 'alt') ?? ''} ${attr(tag, 'src') ?? ''}`
    if (/logo|wordmark|brand/i.test(hay)) {
      const src = attr(tag, 'src')
      if (src && !src.startsWith('data:')) return abs(src, base)
    }
  }
  return null
}

function extractFavicon(html: string, base: string): string | null {
  for (const tag of html.match(/<link[^>]+>/gi) ?? []) {
    const rel = attr(tag, 'rel') ?? ''
    if (/apple-touch-icon|(^|\s)icon(\s|$)|shortcut/i.test(rel)) {
      const href = attr(tag, 'href')
      if (href) return abs(href, base)
    }
  }
  return abs('/favicon.ico', base)
}

/** Short declarative sentences — how the company talks about itself. */
export function extractVoice(html: string, limit = 5): string[] {
  const out: string[] = []
  for (const m of html.matchAll(/<(h1|h2|p)[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const text = m[2]!
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (text.length < 24 || text.length > 160) continue
    if (/cookie|privacy|copyright|all rights reserved|©/i.test(text)) continue
    if (out.includes(text)) continue
    out.push(text)
    if (out.length >= limit) break
  }
  return out
}

/**
 * Read a company's brand from its homepage.
 * Fetches the page plus its first few stylesheets, since palette and typefaces
 * usually live in CSS rather than inline.
 */
export async function extractBrandKit(domain: string): Promise<BrandKit> {
  const base = `https://${domain}/`

  const verdict = await preflight(base)
  if (!verdict.allowed) throw new Error(`refused: ${verdict.reason}`)

  const html = await httpGet(base, 20_000)

  const sheets = [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi)]
    .map((m) => attr(m[0], 'href'))
    .filter((h): h is string => Boolean(h))
    .slice(0, 3)
    .map((h) => abs(h, base))

  const cssParts = await Promise.all(
    sheets.map((u) => httpGet(u, 15_000).catch(() => '')),
  )
  const inline = (html.match(/<style[\s\S]*?<\/style>/gi) ?? []).join('\n')
  const css = [inline, ...cssParts].join('\n')
  // Inline style attributes carry brand colours on many marketing pages.
  const styleAttrs = (html.match(/style\s*=\s*["'][^"']*["']/gi) ?? []).join('\n')

  const palette = extractPalette(`${css}\n${styleAttrs}`)

  return {
    domain,
    fetchedAt: new Date().toISOString(),
    logoUrl: extractLogo(html, base),
    faviconUrl: extractFavicon(html, base),
    palette,
    primary: palette[0] ?? null,
    fonts: extractFonts(css),
    headline: meta(html, 'og:title') ?? firstH1(html),
    description: meta(html, 'og:description') ?? meta(html, 'description'),
    voiceSamples: extractVoice(html),
  }
}

function firstH1(html: string): string | null {
  const m = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)
  return m ? m[1]!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || null : null
}
