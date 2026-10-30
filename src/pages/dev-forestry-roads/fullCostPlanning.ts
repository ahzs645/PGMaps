import type { Coordinate } from './types'
import type { RoadNetworkPolicy } from './roadNetworkTypes'
import { createRoadNetworkPolicy, parseRoadNetworkPolicy } from './roadNetwork'
import {
  DEFAULT_CONNECTOR_CHECK_OPTIONS,
  parseConnectorCheckOptions,
  type ConnectorCheckOptions,
} from './connectorCheckOptions'

export type RoadPlanMaterialUse = 'surfacing' | 'fill' | 'waste'
export interface RoadPlanSource {
  id: string
  name: string
  enabled: boolean
  /** Reviewed physical entrance, never an automatically substituted polygon centre. */
  entrance: Coordinate | null
  /** Disambiguates an entrance at an overpass or overlapping independently connected road. */
  entranceRoadId: string | null
  accessConfirmed: boolean
  qualityConfirmed: boolean
  /** Waste is bank m³ and may not share a capacity with compacted aggregate. */
  uses: RoadPlanMaterialUse[]
  /** Null is an explicitly unbounded planning capacity; quoted usable units depend on uses. */
  capacityM3: number | null
  acquisitionRate: number | null
  processingRate: number | null
  loadingRate: number | null
  placementRate: number | null
  fixedCost: number | null
  notes: string
}

export interface TotalCostPlanning {
  networkPolicy: RoadNetworkPolicy
  connectorChecks: ConnectorCheckOptions
  asOf: string
  /** Reviewed destination/gateway on the connected road network. */
  outlet: Coordinate | null
  outletRoadId: string | null
  sources: RoadPlanSource[]
  newConstructionFixedCost: number | null
  /** Transported m³·km on the loaded directed route. */
  haulRatePerM3Km: number | null
  /** Empty truck cost per payload-equivalent m³·km; explicit 0 if included in the loaded quote. */
  returnHaulRatePerM3Km: number | null
}

export const MAX_FULL_COST_SOURCES = 30
export function createTotalCostPlanningDefaults(asOf?: string): TotalCostPlanning {
  const date =
    asOf ??
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
  return {
    networkPolicy: createRoadNetworkPolicy(date),
    connectorChecks: structuredClone(DEFAULT_CONNECTOR_CHECK_OPTIONS),
    asOf: date,
    outlet: null,
    outletRoadId: null,
    sources: [],
    newConstructionFixedCost: null,
    haulRatePerM3Km: null,
    returnHaulRatePerM3Km: null,
  }
}

export function createRoadPlanSource(id: string): RoadPlanSource {
  return {
    id,
    name: 'Entered supply source',
    enabled: false,
    entrance: null,
    entranceRoadId: null,
    accessConfirmed: false,
    qualityConfirmed: false,
    uses: ['surfacing', 'fill'],
    capacityM3: null,
    acquisitionRate: null,
    processingRate: null,
    loadingRate: null,
    placementRate: null,
    fixedCost: null,
    notes: '',
  }
}

const record = (raw: unknown, label: string): Record<string, unknown> => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error(`${label} must be an object.`)
  return raw as Record<string, unknown>
}
const flag = (raw: unknown, label: string): boolean => {
  if (typeof raw !== 'boolean') throw Error(`${label} must be a boolean.`)
  return raw
}
const text = (raw: unknown, label: string, max: number, empty = false): string => {
  if (typeof raw !== 'string' || (!empty && !raw.trim()) || raw.length > max)
    throw Error(`${label} must contain ${empty ? '0' : '1'}–${max} characters.`)
  return raw
}
const price = (raw: unknown, label: string, max = 1e6): number | null => {
  if (raw === null) return null
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > max)
    throw Error(`${label} must be unknown (null) or between 0 and ${max}.`)
  return raw
}
const coordinate = (raw: unknown, label: string): Coordinate | null => {
  if (raw === null) return null
  if (
    !Array.isArray(raw) ||
    raw.length !== 2 ||
    typeof raw[0] !== 'number' ||
    typeof raw[1] !== 'number' ||
    !Number.isFinite(raw[0]) ||
    !Number.isFinite(raw[1]) ||
    Math.abs(raw[0]) > 180 ||
    Math.abs(raw[1]) >= 85
  )
    throw Error(`${label} must be a WGS84 longitude/latitude pair or null.`)
  return [raw[0], raw[1]]
}
const roadReference = (raw: unknown, label: string): string | null =>
  raw === null || raw === undefined ? null : text(raw, label, 200)

export function parseTotalCostPlanning(raw: unknown): TotalCostPlanning {
  const r = record(raw, 'Full-cost planning')
  const asOf = text(r.asOf, 'Planning date', 10)
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(asOf) ||
    !Number.isFinite(Date.parse(asOf)) ||
    new Date(asOf).toISOString().slice(0, 10) !== asOf
  )
    throw Error('Planning date must be a valid YYYY-MM-DD date.')
  if (!Array.isArray(r.sources) || r.sources.length > MAX_FULL_COST_SOURCES)
    throw Error(`Full-cost planning supports at most ${MAX_FULL_COST_SOURCES} sources.`)
  const sources = r.sources.map((rawSource): RoadPlanSource => {
    const s = record(rawSource, 'Planning source')
    const id = text(s.id, 'Source ID', 100)
    if (!/^[a-zA-Z0-9_.:-]+$/.test(id)) throw Error('Source ID contains unsupported characters.')
    if (
      !Array.isArray(s.uses) ||
      !s.uses.length ||
      s.uses.length > 2 ||
      s.uses.some((use) => typeof use !== 'string' || !['surfacing', 'fill', 'waste'].includes(use)) ||
      new Set(s.uses).size !== s.uses.length ||
      (s.uses.includes('waste') && s.uses.length !== 1)
    )
      throw Error('Source uses must be surfacing/fill or a separate bank-volume waste site.')
    return {
      id,
      name: text(s.name, 'Source name', 200),
      enabled: flag(s.enabled, 'Source enabled'),
      entrance: coordinate(s.entrance, 'Source entrance'),
      entranceRoadId: roadReference(s.entranceRoadId, 'Source entrance road ID'),
      accessConfirmed: flag(s.accessConfirmed, 'Source access review'),
      qualityConfirmed: flag(s.qualityConfirmed, 'Source material review'),
      uses: s.uses as RoadPlanMaterialUse[],
      capacityM3: price(s.capacityM3, 'Source capacity', 1e12),
      acquisitionRate: price(s.acquisitionRate, 'Source acquisition/disposal rate'),
      processingRate: price(s.processingRate, 'Source processing rate'),
      loadingRate: price(s.loadingRate, 'Source loading rate'),
      placementRate: price(s.placementRate, 'Source placement rate'),
      fixedCost: price(s.fixedCost, 'Source preparation cost', 1e12),
      notes: text(s.notes, 'Source notes', 2000, true),
    }
  })
  if (new Set(sources.map((source) => source.id)).size !== sources.length)
    throw Error('Planning source IDs must be unique.')
  return {
    networkPolicy: parseRoadNetworkPolicy({ ...record(r.networkPolicy, 'Network policy'), asOf }),
    connectorChecks: parseConnectorCheckOptions(r.connectorChecks),
    asOf,
    outlet: coordinate(r.outlet, 'Network outlet'),
    outletRoadId: roadReference(r.outletRoadId, 'Network outlet road ID'),
    sources,
    newConstructionFixedCost: price(r.newConstructionFixedCost, 'New construction fixed cost', 1e12),
    haulRatePerM3Km: price(r.haulRatePerM3Km, 'Network haul rate'),
    returnHaulRatePerM3Km: price(r.returnHaulRatePerM3Km, 'Empty return haul rate'),
  }
}
