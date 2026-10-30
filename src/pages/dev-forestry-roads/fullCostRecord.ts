/** Portable adoption snapshots. Currentness means exact relevant inputs still match, not field approval. */
import type { Alignment, RoadProject } from './types'
import type { FullCostCandidateResult, FullCostLedger } from './fullCostComparison'

export const MAX_FULL_COST_SIGNATURE_BYTES = 8 * 1024 * 1024
/** Bump when quantity, eligibility or cost semantics change so older totals require recalculation. */
export const FULL_COST_MODEL_VERSION = 'connected-access-2026-10-v1'
const MAX_RECORD_ALLOCATIONS = 1000
const MAX_RECORD_PATH_IDS = 75000
const MAX_RECORD_COST_ITEMS = 4000
const LEDGER_KEYS = [
  'newConstruction',
  'internalMaterialHaul',
  'newConstructionFixed',
  'sourceMaterials',
  'sourcePreparation',
  'supplyNetworkHaul',
  'supplyConnectorHaul',
  'networkRehabilitation',
  'networkAccess',
  'networkStructures',
  'networkFixed',
  'subtotal',
  'contingency',
  'total',
] as const

export interface FullCostPathRecord {
  edgeIds: string[]
  roadIds: string[]
  costItemIds: string[]
  lengthM: number
  weightedLengthM: number
  attachmentDistanceM: number
  junctionGapM: number
  totalCost: number
}
export interface FullCostAllocationRecord {
  sourceId: string
  sourceName: string
  use: 'surfacing' | 'fill' | 'waste'
  volumeBasis: 'compacted' | 'bank'
  volumeM3: number
  unitMaterialRate: number
  materialCost: number
  networkDistanceM: number
  networkHaulCost: number
  returnNetworkDistanceM: number
  returnNetworkHaulCost: number
  connectorHaulM3Km: number
  connectorHaulCost: number
  returnConnectorHaulCost: number
  sourcePreparationCost: number
  path: FullCostPathRecord
  returnPath: FullCostPathRecord
}
export interface FullCostReviewRecord {
  schema: 'pgmaps-full-cost-review-v1'
  inputSignature: string
  asOf: string
  candidateId: string
  candidateName: string
  totalCost: number
  ledger: FullCostLedger
  allocations: FullCostAllocationRecord[]
  accessPath: FullCostPathRecord
  accessReturnPath: FullCostPathRecord
  networkCostItems: {
    id: string
    kind: 'rehabilitation' | 'structure' | 'access' | 'fixed'
    amount: number
    label: string
    roadId: string
  }[]
  warnings: string[]
}

/** Exact canonical JSON: object keys sort, array order stays meaningful and no hash can collide. */
function canonicalJson(value: unknown): string {
  const chunks: string[] = []
  const encoder = new TextEncoder()
  const visiting = new Set<object>()
  let bytes = 0
  const append = (text: string) => {
    bytes += encoder.encode(text).byteLength
    if (bytes > MAX_FULL_COST_SIGNATURE_BYTES)
      throw Error(
        'The comparison input signature exceeds 8 MiB. Crop the context or reduce the stored evidence before adopting.',
      )
    chunks.push(text)
  }
  const write = (item: unknown) => {
    if (item === null) return append('null')
    if (typeof item === 'string' || typeof item === 'boolean') return append(JSON.stringify(item))
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw Error('Comparison inputs must contain finite numbers.')
      return append(JSON.stringify(item))
    }
    if (typeof item !== 'object') throw Error('Comparison inputs must contain JSON values.')
    if (visiting.has(item)) throw Error('Comparison inputs cannot contain a cycle.')
    visiting.add(item)
    if (Array.isArray(item)) {
      append('[')
      for (let index = 0; index < item.length; index++) {
        if (index) append(',')
        const entry = item[index]
        write(entry === undefined ? null : entry)
      }
      append(']')
    } else {
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)
        throw Error('Comparison inputs must contain plain JSON objects.')
      const object = item as Record<string, unknown>
      append('{')
      const keys = Object.keys(object)
        .filter((key) => object[key] !== undefined)
        .sort()
      keys.forEach((key, index) => {
        if (index) append(',')
        append(JSON.stringify(key))
        append(':')
        write(object[key])
      })
      append('}')
    }
    visiting.delete(item)
  }
  write(value)
  return chunks.join('')
}

export function fullCostInputSignature(alignment: Alignment, project: RoadProject): string {
  const geometry = Object.fromEntries(Object.entries(alignment).filter(([key]) => key !== 'fullCostRecord'))
  const terrain = {
    ...project.terrain,
    ...(project.terrain.raster
      ? {
          raster: Object.fromEntries(Object.entries(project.terrain.raster).filter(([key]) => key !== 'values')),
        }
      : {}),
  }
  return canonicalJson({
    modelVersion: FULL_COST_MODEL_VERSION,
    alignment: geometry,
    settings: project.settings,
    totalCostPlanning: (project as RoadProject & { totalCostPlanning?: unknown }).totalCostPlanning,
    context: project.context,
    terrain,
  })
}

const object = (raw: unknown, label: string): Record<string, unknown> => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error(`${label} must be an object.`)
  return raw as Record<string, unknown>
}
const text = (raw: unknown, label: string, max = 2000): string => {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > max) throw Error(`${label} is invalid.`)
  return raw
}
const number = (raw: unknown, label: string): number => {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > 1e18)
    throw Error(`${label} must be a finite non-negative number.`)
  return raw
}
const list = (raw: unknown, label: string, max: number): unknown[] => {
  if (!Array.isArray(raw) || raw.length > max) throw Error(`${label} exceeds its supported entry count.`)
  return raw
}
const ids = (raw: unknown, label: string) => list(raw, label, MAX_RECORD_PATH_IDS).map((id) => text(id, label, 300))
const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-6, Math.max(a, b) * 1e-9)

function parsePath(raw: unknown): FullCostPathRecord {
  const p = object(raw, 'Recorded network path')
  return {
    edgeIds: ids(p.edgeIds, 'Recorded edge IDs'),
    roadIds: ids(p.roadIds, 'Recorded road IDs'),
    costItemIds: ids(p.costItemIds, 'Recorded cost item IDs'),
    lengthM: number(p.lengthM, 'Recorded path length'),
    weightedLengthM: number(p.weightedLengthM, 'Recorded weighted path length'),
    attachmentDistanceM: number(p.attachmentDistanceM, 'Recorded attachment distance'),
    junctionGapM: number(p.junctionGapM, 'Recorded junction gaps'),
    totalCost: number(p.totalCost, 'Recorded path cost'),
  }
}

export function parseFullCostRecord(raw: unknown): FullCostReviewRecord {
  const r = object(raw, 'Complete access cost record')
  if (r.schema !== 'pgmaps-full-cost-review-v1') throw Error('Unsupported complete access cost record.')
  const signature = text(r.inputSignature, 'Comparison input signature', MAX_FULL_COST_SIGNATURE_BYTES)
  if (new TextEncoder().encode(signature).byteLength > MAX_FULL_COST_SIGNATURE_BYTES)
    throw Error('Comparison input signature exceeds 8 MiB.')
  let input: unknown
  try {
    input = JSON.parse(signature)
  } catch {
    throw Error('Comparison input signature must contain canonical JSON.')
  }
  if (canonicalJson(input) !== signature) throw Error('Comparison input signature must contain canonical JSON.')
  const asOf = text(r.asOf, 'Comparison assessment date', 10)
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(asOf) ||
    !Number.isFinite(Date.parse(asOf)) ||
    new Date(asOf).toISOString().slice(0, 10) !== asOf
  )
    throw Error('Comparison assessment date must be a real calendar date.')
  const signatureInputs = object(input, 'Recorded comparison inputs')
  const recordedPlanning = object(signatureInputs.totalCostPlanning, 'Recorded planning inputs')
  if (
    recordedPlanning.asOf !== asOf ||
    !signatureInputs.alignment ||
    !signatureInputs.settings ||
    !Array.isArray(signatureInputs.context) ||
    !signatureInputs.terrain
  )
    throw Error('Recorded comparison inputs do not match the assessment date or required model inputs.')
  const values = object(r.ledger, 'Recorded cost breakdown')
  const ledger = Object.fromEntries(
    LEDGER_KEYS.map((key) => [key, number(values[key], `Recorded ${key}`)]),
  ) as unknown as FullCostLedger
  const subtotal = LEDGER_KEYS.filter((key) => !['subtotal', 'contingency', 'total'].includes(key)).reduce(
    (sum, key) => sum + ledger[key],
    0,
  )
  const totalCost = number(r.totalCost, 'Recorded complete access cost')
  if (
    !near(subtotal, ledger.subtotal) ||
    !near(ledger.subtotal + ledger.contingency, ledger.total) ||
    !near(totalCost, ledger.total)
  )
    throw Error('Recorded cost breakdown does not sum to its complete access cost.')
  const allocations = list(r.allocations, 'Recorded source allocations', MAX_RECORD_ALLOCATIONS).map(
    (rawAllocation): FullCostAllocationRecord => {
      const a = object(rawAllocation, 'Recorded source allocation')
      if (
        typeof a.use !== 'string' ||
        !['surfacing', 'fill', 'waste'].includes(a.use) ||
        a.volumeBasis !== (a.use === 'waste' ? 'bank' : 'compacted')
      )
        throw Error('Recorded allocation has an invalid material use or volume basis.')
      return {
        sourceId: text(a.sourceId, 'Recorded source ID', 100),
        sourceName: text(a.sourceName, 'Recorded source name', 200),
        use: a.use as FullCostAllocationRecord['use'],
        volumeBasis: a.volumeBasis as FullCostAllocationRecord['volumeBasis'],
        volumeM3: number(a.volumeM3, 'Recorded allocated volume'),
        unitMaterialRate: number(a.unitMaterialRate, 'Recorded material rate'),
        materialCost: number(a.materialCost, 'Recorded material cost'),
        networkDistanceM: number(a.networkDistanceM, 'Recorded network haul distance'),
        networkHaulCost: number(a.networkHaulCost, 'Recorded network haul cost'),
        returnNetworkDistanceM: number(a.returnNetworkDistanceM, 'Recorded return network distance'),
        returnNetworkHaulCost: number(a.returnNetworkHaulCost, 'Recorded return network haul cost'),
        connectorHaulM3Km: number(a.connectorHaulM3Km, 'Recorded connector haul quantity'),
        connectorHaulCost: number(a.connectorHaulCost, 'Recorded connector haul cost'),
        returnConnectorHaulCost: number(a.returnConnectorHaulCost, 'Recorded return connector haul cost'),
        sourcePreparationCost: number(a.sourcePreparationCost, 'Recorded source preparation'),
        path: parsePath(a.path),
        returnPath: parsePath(a.returnPath),
      }
    },
  )
  const networkCostItems = list(r.networkCostItems, 'Recorded network cost items', MAX_RECORD_COST_ITEMS).map(
    (rawItem) => {
      const c = object(rawItem, 'Recorded network cost item')
      if (typeof c.kind !== 'string' || !['rehabilitation', 'structure', 'access', 'fixed'].includes(c.kind))
        throw Error('Invalid recorded network cost kind.')
      return {
        id: text(c.id, 'Recorded network cost ID', 300),
        kind: c.kind as FullCostReviewRecord['networkCostItems'][number]['kind'],
        amount: number(c.amount, 'Recorded network amount'),
        label: text(c.label, 'Recorded network item'),
        roadId: text(c.roadId, 'Recorded network road ID', 100),
      }
    },
  )
  if (new Set(networkCostItems.map((item) => item.id)).size !== networkCostItems.length)
    throw Error('Recorded network cost IDs must be unique.')
  return {
    schema: 'pgmaps-full-cost-review-v1',
    inputSignature: signature,
    asOf,
    candidateId: text(r.candidateId, 'Recorded candidate ID', 100),
    candidateName: text(r.candidateName, 'Recorded candidate name', 200),
    totalCost,
    ledger,
    allocations,
    accessPath: parsePath(r.accessPath),
    accessReturnPath: parsePath(r.accessReturnPath),
    networkCostItems,
    warnings: list(r.warnings, 'Recorded comparison warnings', 1000).map((warning) =>
      text(warning, 'Recorded comparison warning'),
    ),
  }
}

export function createFullCostRecord(
  alignment: Alignment,
  project: RoadProject,
  result: FullCostCandidateResult,
): FullCostReviewRecord {
  if (
    result.status !== 'feasible' ||
    result.totalCost === null ||
    !result.ledger ||
    !result.accessPath ||
    !result.accessReturnPath
  )
    throw Error('Only a feasible, priced and checked route comparison can be adopted.')
  const planning = (project as RoadProject & { totalCostPlanning?: { asOf: string } }).totalCostPlanning
  if (!planning) throw Error('Complete access cost inputs are missing from the project.')
  return parseFullCostRecord({
    schema: 'pgmaps-full-cost-review-v1',
    inputSignature: fullCostInputSignature(alignment, project),
    asOf: planning.asOf,
    candidateId: result.id,
    candidateName: result.name,
    totalCost: result.totalCost,
    ledger: result.ledger,
    allocations: result.allocations,
    accessPath: result.accessPath,
    accessReturnPath: result.accessReturnPath,
    networkCostItems: result.networkCostItems,
    warnings: [...new Set(result.warnings)],
  })
}

export function isFullCostRecordCurrent(alignment: Alignment, project: RoadProject): boolean {
  const record = (alignment as Alignment & { fullCostRecord?: FullCostReviewRecord }).fullCostRecord
  if (!record) return false
  try {
    return record.inputSignature === fullCostInputSignature(alignment, project)
  } catch {
    return false
  }
}
