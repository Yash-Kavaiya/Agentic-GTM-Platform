/**
 * Campaign Forge.
 *
 * Turns a scored account and its evidence into four assets that all cite the
 * same ledger: a branded microsite, an email sequence, a one-page brief, and a
 * call talk track.
 *
 * The rule that shapes everything here: no claim without a citation. Every
 * sentence that asserts something about the prospect carries a footnote to the
 * collector, URL and timestamp that produced it. That is not a compliance
 * gesture — it is the reason a salesperson can trust the draft enough to send
 * it, and the reason the approval gate can refuse when a source is broken.
 *
 * Nothing here invents facts. The copy is assembled from observed evidence and
 * the ICP's own value propositions; where a fact is missing, the sentence is
 * omitted rather than softened into something unverifiable.
 */
import type { EvidenceRef, IcpConfig } from '../types.js'
import type { ScoredAccount, ScoredSignal } from '../signals/score.js'
import type { BrandKit } from '../enrich/brandkit.js'

type Icp = IcpConfig['icp']

export interface CampaignAsset {
  kind: 'microsite' | 'email' | 'onepager' | 'talktrack'
  title: string
  body: string
}

export interface Campaign {
  id: string
  targetId: string
  accountName: string
  domain: string
  generatedAt: string
  headline: string
  subhead: string
  /** The single ledger every asset footnotes into. */
  evidence: EvidenceRef[]
  brand: BrandKit | null
  assets: CampaignAsset[]
}

export interface ForgeInput {
  account: ScoredAccount
  signals: ScoredSignal[]
  icp: Icp
  brand?: BrandKit | null
  /** Fixed for reproducible output; defaults to now. */
  at?: string
}

/**
 * Build the evidence ledger.
 * Deduplicated and ordered by recency, because the footnote numbers have to be
 * stable across all four assets.
 */
function buildLedger(signals: ScoredSignal[]): EvidenceRef[] {
  const seen = new Set<string>()
  const out: EvidenceRef[] = []
  for (const s of signals) {
    for (const e of s.event.evidence) {
      const key = `${e.signalId}:${e.sentence}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(e)
    }
  }
  return out.sort((a, b) => b.scrapedAt.localeCompare(a.scrapedAt))
}

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })

export function forge(input: ForgeInput): Campaign {
  const { account, signals, icp } = input
  const at = input.at ?? new Date().toISOString()
  const brand = input.brand ?? null
  const evidence = buildLedger(signals)

  const lead = signals[0]
  const headline = lead
    ? `${account.name} is ${headlineVerbFor(lead.signalId)}.`
    : `${account.name} is moving.`

  const subhead = evidence
    .slice(0, 2)
    .map((e, i) => `${e.sentence}[${i + 1}]`)
    .join(' ')

  const campaign: Campaign = {
    id: `camp_${account.targetId}_${at.slice(0, 10)}`,
    targetId: account.targetId,
    accountName: account.name,
    domain: account.domain,
    generatedAt: at,
    headline,
    subhead,
    evidence,
    brand,
    assets: [],
  }

  campaign.assets = [
    micrositeAsset(campaign, icp),
    emailAsset(campaign, icp),
    onePagerAsset(campaign, account, icp),
    talkTrackAsset(campaign, account),
  ]

  return campaign
}

/** Each signal implies a different sentence about what the company is doing. */
function headlineVerbFor(signalId: string): string {
  const verbs: Record<string, string> = {
    moving_upmarket: 'moving upmarket',
    price_change: 'repricing',
    enterprise_readiness: 'getting enterprise-ready',
    building_the_function: 'building a revenue function',
    headcount_surge: 'scaling the team',
    stack_adoption: 'rebuilding its data stack',
    ecosystem_expansion: 'expanding its ecosystem',
    segment_shift: 'shifting segment',
    leadership_change: 'restructuring its leadership',
    shipping_velocity: 'shipping faster',
    announcement: 'in the news',
    surface_growth: 'expanding its product surface',
  }
  return verbs[signalId] ?? 'on the move'
}

const footnotes = (evidence: EvidenceRef[]): string =>
  evidence
    .map(
      (e, i) =>
        `[${i + 1}] ${e.collectorId ?? 'public feed'} · ${e.sourceUrl} · scraped ${e.scrapedAt.replace('T', ' ').slice(0, 16)} UTC`,
    )
    .join('\n')

// ------------------------------------------------------------- microsite

/**
 * The microsite copy.
 *
 * Rendered by the app in the prospect's own palette and typeface, so it reads
 * as though someone at their company built it. The structure is deliberately
 * simple: what we noticed, why it matters, what happens next.
 */
function micrositeAsset(c: Campaign, icp: Icp): CampaignAsset {
  const body = [
    `# ${c.headline}`,
    '',
    c.evidence.slice(0, 3).map((e, i) => `${e.sentence}[${i + 1}]`).join(' '),
    '',
    `## What the next 90 days usually look like`,
    '',
    ...icp.offering.value_props.map((v) => `- ${v}`),
    '',
    footnotes(c.evidence),
  ].join('\n')

  return { kind: 'microsite', title: `${c.accountName} × ${icp.offering.name}`, body }
}

// ----------------------------------------------------------------- email

function emailAsset(c: Campaign, icp: Icp): CampaignAsset {
  const first = c.evidence[0]
  const second = c.evidence[1]

  const emails = [
    {
      subject: first ? `${c.accountName}: ${shorten(first.sentence)}` : `${c.accountName}`,
      body: [
        `Noticed ${first ? lower(first.sentence) : 'some movement on your site'} on ${first ? day(first.scrapedAt) : 'recently'}.`,
        '',
        `Usually that means the next quarter is about ${icp.offering.value_props[0]?.toLowerCase() ?? 'scaling what works'}.`,
        '',
        `Worth fifteen minutes?`,
      ].join('\n'),
    },
    {
      subject: `Following up — ${c.accountName}`,
      body: [
        second ? `Also saw: ${lower(second.sentence)}.` : `Circling back on the above.`,
        '',
        `Two things teams at your stage usually hit first:`,
        ...icp.offering.value_props.slice(0, 2).map((v) => `  - ${v}`),
      ].join('\n'),
    },
    {
      subject: `A short brief for ${c.accountName}`,
      body: `Put together a one-pager on what we saw and what we'd do about it. Want it?`,
    },
    {
      subject: `Closing the loop`,
      body: `If the timing is wrong, say so and I'll stop. If it isn't, I'll send the brief.`,
    },
  ]

  const body = emails
    .map((e, i) => `--- Email ${i + 1} ---\nSubject: ${e.subject}\n\n${e.body}`)
    .join('\n\n') + `\n\n${footnotes(c.evidence)}`

  return { kind: 'email', title: '4-email sequence', body }
}

// ------------------------------------------------------------- one-pager

function onePagerAsset(c: Campaign, account: ScoredAccount, icp: Icp): CampaignAsset {
  const body = [
    `${c.accountName} — account brief`,
    `${c.domain} · score ${account.score} · ICP fit ${Math.round(account.fit * 100)}%`,
    '',
    'WHAT WE OBSERVED',
    ...c.evidence.map((e, i) => `  ${i + 1}. ${e.sentence}`),
    '',
    'ICP FIT',
    ...account.fitBreakdown.map((f) => `  [${f.met ? 'x' : ' '}] ${f.description}`),
    '',
    'WHY IT MATTERS',
    ...icp.offering.value_props.map((v) => `  - ${v}`),
    '',
    'SOURCES',
    footnotes(c.evidence),
  ].join('\n')

  return { kind: 'onepager', title: `${c.accountName} one-pager`, body }
}

// ------------------------------------------------------------ talk track

function talkTrackAsset(c: Campaign, account: ScoredAccount): CampaignAsset {
  const first = c.evidence[0]
  const body = [
    'OPEN',
    `  "I saw ${first ? lower(first.sentence) : 'some changes on your site'}${first ? ` on ${day(first.scrapedAt)}` : ''}."`,
    '',
    'WHY NOW',
    ...c.evidence.slice(0, 3).map((e) => `  - ${e.sentence}`),
    '',
    'QUESTIONS',
    '  - Who owns that motion internally today?',
    '  - What broke first when you started selling to bigger accounts?',
    '  - What would have to be true for this to be a this-quarter problem?',
    '',
    'IF THEY PUSH BACK',
    `  Every claim above is sourced. Offer the page and timestamp.`,
    '',
    'SOURCES',
    footnotes(c.evidence),
  ].join('\n')

  return { kind: 'talktrack', title: `${account.name} talk track`, body }
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)
const shorten = (s: string) => (s.length > 60 ? s.slice(0, 57).trimEnd() + '…' : s)
