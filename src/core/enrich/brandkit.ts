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

/**
 * Find the company's logo.
 *
 * Order matters and og:image is LAST, not first. An og:image is a social share
 * card — typically 1200x630, with a headline, a screenshot and a background —
 * and dropping one into the header of a generated microsite looks nothing like
 * a logo. It is a usable fallback and a poor first choice.
 *
 * An SVG named "logo" is the real thing: small, sharp at any size, and actually
 * the mark the company uses.
 */
/**
 * Images that are on the page but are not this company's mark.
 *
 * A marketing homepage is full of other companies' logos — integration grids,
 * customer walls, "works with" strips. Matching on the src path alone picked
 * `/images/logos/frameworks/stripe.svg` off Supabase's homepage: a real logo,
 * for the wrong company, on a page about the right one.
 */
const FOREIGN_LOGO = /\/(logos|partners|customers|integrations|frameworks|brands)\//i

function extractLogo(html: string, base: string): string | null {
  // A company's own mark sits in the masthead. Everything below the header is
  // somebody else's logo, a screenshot, or an illustration — so only the top of
  // the document is considered.
  const headerEnd = html.search(/<\/header>|<\/nav>/i)
  const masthead = html.slice(0, headerEnd > 0 ? headerEnd : Math.min(html.length, 20_000))
  const imgs = masthead.match(/<img[^>]+>/gi) ?? []

  const pick = (predicate: (src: string, label: string) => boolean): string | null => {
    for (const tag of imgs) {
      const src = attr(tag, 'src')
      if (!src || src.startsWith('data:') || FOREIGN_LOGO.test(src)) continue
      // Only what the page CALLS the image counts, never the path — a path is
      // how the wrong company's logo gets in.
      const label = `${attr(tag, 'class') ?? ''} ${attr(tag, 'alt') ?? ''}`
      if (predicate(src, label)) return abs(src, base)
    }
    return null
  }

  // A vector mark the page itself labels a logo: the real thing, sharp at any size.
  const svgLogo = pick((src, label) => /logo|wordmark/i.test(label) && /\.svg(\?|$)/i.test(src))
  if (svgLogo) return svgLogo

  const labelled = pick((_src, label) => /logo|wordmark|brand/i.test(label))
  if (labelled) return labelled

  // An apple-touch-icon is a genuine square mark, unlike a share card.
  for (const tag of html.match(/<link[^>]+>/gi) ?? []) {
    if (/apple-touch-icon/i.test(attr(tag, 'rel') ?? '')) {
      const href = attr(tag, 'href')
      if (href) return abs(href, base)
    }
  }

  // Last resort. An og:image is a 1200x630 social card, not a logo — usable,
  // but only when nothing better exists.
  const og = meta(html, 'og:image')
  return og ? abs(og, base) : null
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
