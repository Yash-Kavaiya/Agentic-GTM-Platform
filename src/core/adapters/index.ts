/**
 * Adapter registration.
 *
 * Importing this module wires every shipped adapter into the registry. The
 * engine only ever asks for an adapter by kind, so adding a source means adding
 * one file and one line here — nothing in the pipeline changes.
 */
import { register } from './base.js'
import { webAdapter } from './web.js'
import { jobsAdapter } from './jobs.js'
import { rssAdapter, sitemapAdapter } from './feeds.js'

register(webAdapter)
register(jobsAdapter)
register(rssAdapter)
register(sitemapAdapter)

// `docs` (Bright Data Sitemap type) and `search` (Search type) share the web
// adapter's execution path; they are registered once their collectors exist.
register({ ...webAdapter, kind: 'docs', scraperType: 'Sitemap' })
register({ ...webAdapter, kind: 'search', scraperType: 'Search' })

export * from './base.js'
export { webAdapter, jobsAdapter, rssAdapter, sitemapAdapter }
