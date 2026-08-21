/**
 * Export readers.
 *
 * The web app never touches the database, the network, or the Bright Data CLI.
 * It reads the JSON the engine committed, at build time. That is what keeps the
 * deployed app a pure function of the repo — and what makes the heal log
 * reviewable as a git diff.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Brief } from '../core/brief.js'
import type { ScoredAccount } from '../core/signals/score.js'
import type { SignalSpec, HealEvent, HealthState } from '../core/types.js'

const DIR = join(process.cwd(), 'data', 'export')

function read<T>(name: string, fallback: T): T {
  const path = join(DIR, name)
  if (!existsSync(path)) return fallback
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return fallback
  }
}

export interface CollectorView {
  key: string
  signalId: string
  collectorId: string
  scraperType: string
  seedUrl: string
  watch: string
  createdAt: string
  viewUrl?: string
  state: HealthState | 'UNKNOWN'
}

export interface AdapterView {
  kind: string
  usesBrightData: boolean
  scraperType: string | null
}

export type SignalView = SignalSpec & {
  coverage: number
  collector: { collectorId: string; scraperType: string } | null
}

export interface HealStats {
  attempts: number
  approved: number
  rejected: number
  ineffective: number
  errored: number
  quarantined: number
  successRate: number
  medianMs: number
  rowsRecovered: number
}

const EMPTY_BRIEF: Brief = {
  date: new Date().toISOString().slice(0, 10),
  generatedAt: new Date().toISOString(),
  headline: 'No brief generated yet',
  entries: [],
  belowThreshold: 0,
  totals: { accountsMoved: 0, signalsFired: 0, evidenceItems: 0 },
}

export const getBrief = (date?: string): Brief =>
  read<Brief>(date ? `brief-${date}.json` : 'brief.json', EMPTY_BRIEF)

export const getAccounts = (): ScoredAccount[] =>
  read<{ accounts: ScoredAccount[] }>('accounts.json', { accounts: [] }).accounts

export const getAccount = (id: string): ScoredAccount | undefined =>
  getAccounts().find((a) => a.targetId === id)

export const getSignals = (): SignalView[] =>
  read<{ signals: SignalView[] }>('signals.json', { signals: [] }).signals

export const getCollectors = (): CollectorView[] =>
  read<{ collectors: CollectorView[] }>('collectors.json', { collectors: [] }).collectors

export const getAdapters = (): AdapterView[] =>
  read<{ adapters: AdapterView[] }>('collectors.json', { adapters: [] }).adapters

export const getHeals = (): { heals: HealEvent[]; stats: HealStats } =>
  read<{ heals: HealEvent[]; stats: HealStats }>('heals.json', {
    heals: [],
    stats: { attempts: 0, approved: 0, rejected: 0, ineffective: 0, errored: 0, quarantined: 0, successRate: 0, medianMs: 0, rowsRecovered: 0 },
  })

export interface Meta {
  generatedAt: string
  signalCount: number
  targetCount: number
  collectorCount: number
  eventCount: number
  verifiedSourceCount: number
  jobBoardCount: number
  icp: { name: string; threshold: number }
}

export const getMeta = (): Meta =>
  read<Meta>('meta.json', {
    generatedAt: new Date().toISOString(),
    signalCount: 0, targetCount: 0, collectorCount: 0, eventCount: 0, verifiedSourceCount: 0, jobBoardCount: 0,
    icp: { name: 'unknown', threshold: 0 },
  })

import type { Campaign } from '../core/campaign/forge.js'
import type { GateVerdict } from '../core/campaign/gate.js'
import type { BrandKit } from '../core/enrich/brandkit.js'

export type CampaignView = Campaign & { gate: GateVerdict }

export const getCampaigns = (): CampaignView[] =>
  read<{ campaigns: CampaignView[] }>('campaigns.json', { campaigns: [] }).campaigns

export const getCampaign = (targetId: string): CampaignView | undefined =>
  getCampaigns().find((c) => c.targetId === targetId)

export const getBrands = (): Record<string, BrandKit> =>
  read<{ brands: Record<string, BrandKit> }>('brands.json', { brands: {} }).brands

export const getBrand = (targetId: string): BrandKit | undefined => getBrands()[targetId]

import type { Candidate } from '../core/discover.js'

export interface CandidatesFile {
  generatedAt: string
  role: string
  candidates: Candidate[]
}

export const getCandidates = (): CandidatesFile =>
  read<CandidatesFile>('candidates.json', { generatedAt: '', role: '', candidates: [] })

import type { BusinessProfile } from '../core/enrich/profile.js'

export type ProfileView = BusinessProfile & { whyNow: string[] }

export const getProfiles = (): Record<string, ProfileView> =>
  read<{ profiles: Record<string, ProfileView> }>('profiles.json', { profiles: {} }).profiles

export const getProfile = (targetId: string): ProfileView | undefined => getProfiles()[targetId]

export interface Capabilities {
  hasApiKey: boolean
  zones: string[]
  webhookConfigured: boolean
  slackConfigured: boolean
}

export const getCapabilities = (): Capabilities =>
  read<Capabilities>('capabilities.json', {
    hasApiKey: false,
    zones: [],
    webhookConfigured: false,
    slackConfigured: false,
  })
