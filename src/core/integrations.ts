/**
 * The integration catalog.
 *
 * Everything Bellwether can read from or write to, and whether it is actually
 * wired up right now. Status is computed from real state — zones on the
 * account, collectors on disk, environment variables present — not declared,
 * so this page cannot claim a connection that does not exist.
 *
 * Bright Data is the primary data plane, so its products are listed
 * individually rather than as one line item: they are separate capabilities
 * with separate setup and separate failure modes.
 */

export type IntegrationStatus = 'connected' | 'available' | 'needs-setup' | 'not-shipped'

export interface Integration {
  id: string
  name: string
  vendor: 'Bright Data' | 'Direct' | 'Destination'
  /** What it gets you, in one line, for someone choosing what to turn on. */
  purpose: string
  /** How Bellwether uses it, concretely. */
  usage: string
  status: IntegrationStatus
  detail?: string
  docs?: string
  /** Bright Data scraper type, where applicable. */
  scraperType?: string
}

export interface IntegrationState {
  hasApiKey: boolean
  zones: string[]
  collectorCount: number
  verifiedSourceCount: number
  jobBoardCount: number
  webhookConfigured: boolean
  slackConfigured: boolean
}

export function buildCatalog(s: IntegrationState): Integration[] {
  const bd = s.hasApiKey
  const zone = (name: string) => s.zones.some((z) => z.toLowerCase().includes(name))

  return [
    // ----------------------------------------------------- Bright Data
    {
      id: 'scraper-studio-pdp',
      name: 'Scraper Studio — Page extraction',
      vendor: 'Bright Data',
      scraperType: 'PDP',
      purpose: 'Turn a plain-English description into a structured extractor for any page.',
      usage:
        'Every watched pricing, security, integrations and customers page. One collector per account, because a collector encodes the DOM it was generated from.',
      status: s.collectorCount > 0 ? 'connected' : bd ? 'available' : 'needs-setup',
      detail:
        s.collectorCount > 0
          ? `${s.collectorCount} collector${s.collectorCount === 1 ? '' : 's'} provisioned`
          : 'no collectors yet — run bw:provision',
    },
    {
      id: 'scraper-studio-heal',
      name: 'Scraper Studio — Self-healing',
      vendor: 'Bright Data',
      purpose: 'Repair an extractor in place when the target page is redesigned.',
      usage:
        'Anneal composes the symptom from the signal’s own words, calls heal, scores the preview against the field contract, then approves or rejects. Never --auto-approve.',
      status: s.collectorCount > 0 ? 'connected' : 'available',
      detail: 'same Collector ID survives a repair, so nothing downstream is touched',
    },
    {
      id: 'serp',
      name: 'SERP API',
      vendor: 'Bright Data',
      scraperType: 'Search',
      purpose: 'Structured search results from Google, Bing and Yandex.',
      usage:
        'Prospect discovery. Searching public job boards for the role that signals a buying trigger returns the hiring company in the result URL.',
      status: zone('serp') ? 'connected' : 'needs-setup',
      detail: zone('serp') ? 'zone serp_api1' : 'create a SERP zone',
    },
    {
      id: 'discover',
      name: 'AI Discovery',
      vendor: 'Bright Data',
      purpose: 'Intent-ranked web discovery from a natural-language query.',
      usage:
        'Competitive content: changelogs, comparison pages, docs. Measured NOT to work as a company finder — it ranks pages about a topic, so prospecting uses SERP against job boards instead.',
      status: zone('serp') ? 'connected' : 'needs-setup',
      detail: 'good at content, wrong tool for finding companies',
    },
    {
      id: 'unlocker',
      name: 'Web Unlocker',
      vendor: 'Bright Data',
      purpose: 'Fetch any public page fully rendered, past anti-bot protection.',
      usage:
        'Would give brand-kit extraction and one-off page reads a rendering path that does not depend on a collector.',
      status: zone('unlocker') || zone('web_access') ? 'connected' : 'needs-setup',
      detail: 'no unlocker zone on the account — create one at brightdata.com/cp/web_access/new',
      docs: 'https://brightdata.com/cp/web_access/new',
    },
    {
      id: 'browser',
      name: 'Scraping Browser',
      vendor: 'Bright Data',
      purpose: 'A real remote browser over CDP, drivable with Playwright.',
      usage:
        'For pages whose content only exists after interaction — expanding a pricing toggle, paginating a customer wall.',
      status: zone('browser') ? 'available' : 'needs-setup',
      detail: zone('browser') ? 'zone scraping_browser1 — credentials on file, not yet wired' : 'create a browser zone',
    },
    {
      id: 'trigger-api',
      name: 'Collector API (/dca/trigger)',
      vendor: 'Bright Data',
      purpose: 'Run any collector over plain HTTP, no CLI required.',
      usage:
        'The execution path in CI, where there is no interactive login. Same Collector ID as the CLI path, so a healed collector keeps working on both.',
      status: bd ? 'connected' : 'needs-setup',
      detail: 'used by the scheduled collection workflow',
    },

    // ---------------------------------------------------------- direct
    {
      id: 'job-boards',
      name: 'Greenhouse · Lever · Ashby',
      vendor: 'Direct',
      purpose: 'Every open role at a company, with full job descriptions.',
      usage:
        'Hiring signals, buying-role inference and prospect verification. Documented public JSON APIs — no login, no personal data, and richer than any scrape of the same board.',
      status: s.jobBoardCount > 0 ? 'connected' : 'available',
      detail: `${s.jobBoardCount} board${s.jobBoardCount === 1 ? '' : 's'} bound`,
    },
    {
      id: 'feeds',
      name: 'RSS · Atom · Sitemap',
      vendor: 'Direct',
      purpose: 'Changelogs, blogs and documentation surface, already structured.',
      usage:
        'Shipping velocity, announcements and docs growth. Deliberately not routed through a scraper — a feed is already machine-readable.',
      status: s.verifiedSourceCount > 0 ? 'connected' : 'available',
      detail: `${s.verifiedSourceCount} verified sources`,
    },

    // ----------------------------------------------------- destinations
    {
      id: 'webhook',
      name: 'Webhook',
      vendor: 'Destination',
      purpose: 'POST an approved campaign anywhere — CRM, sequencer, queue.',
      usage: 'Generic JSON, shaped for a CRM record.',
      status: s.webhookConfigured ? 'connected' : 'needs-setup',
      detail: s.webhookConfigured ? 'endpoint configured' : 'set BELLWETHER_WEBHOOK_URL',
    },
    {
      id: 'slack',
      name: 'Slack',
      vendor: 'Destination',
      purpose: 'The morning brief and campaign cards in a channel.',
      usage: 'Incoming webhook, one message per brief.',
      status: s.slackConfigured ? 'connected' : 'needs-setup',
      detail: s.slackConfigured ? 'webhook configured' : 'set BELLWETHER_SLACK_WEBHOOK_URL',
    },
    {
      id: 'export',
      name: 'CSV · JSON export',
      vendor: 'Destination',
      purpose: 'Everything the engine knows, as files.',
      usage: 'The committed export IS the API — data/export/*.json, versioned in git.',
      status: 'connected',
      detail: 'written every run',
    },
    {
      id: 'social',
      name: 'Social auto-posting',
      vendor: 'Destination',
      purpose: 'Publishing campaign content to social platforms.',
      usage:
        'Deliberately not shipped. Rules-adjacent, slow to build, and it impresses nobody.',
      status: 'not-shipped',
    },
  ]
}

export const STATUS_LABEL: Record<IntegrationStatus, string> = {
  connected: 'connected',
  available: 'available',
  'needs-setup': 'needs setup',
  'not-shipped': 'not shipped',
}
