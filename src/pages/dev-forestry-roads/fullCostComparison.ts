/** Bounded horizontal alternatives, priced on checked new connectors and a real road graph. */
import { alignmentLength, analyzeRoad, distance, effectiveWidths, positionAt } from './engine'
import { createEngineeringDesign } from './engineeringTypes'
import { hasCompleteCoverage } from './analysisResult'
import { sideValue, templateAt } from './templates'
import type { Alignment, ContextFeature, RoadAnalysis, RoadSettings, TerrainSource } from './types'
import type {
  RoadNetworkAttachmentInput,
  RoadNetworkCostItem,
  RoadNetworkPath,
  RoadNetworkPathOptions,
} from './roadNetworkTypes'
import {
  parseTotalCostPlanning,
  type RoadPlanMaterialUse,
  type RoadPlanSource,
  type TotalCostPlanning,
} from './fullCostPlanning'

export const MAX_FULL_COST_CANDIDATES = 8
export const MAX_FULL_COST_PATH_SEARCHES = 10000
export const MAX_FULL_COST_ALLOCATIONS = 300
const EPS = 1e-6
const KINDS: RoadPlanMaterialUse[] = ['surfacing', 'fill', 'waste']
export const candidateNetworkAttachmentId = (id: string) => `candidate:${id}`
export const sourceNetworkAttachmentId = (id: string) => `source:${id}`
export const OUTLET_NETWORK_ATTACHMENT_ID = 'outlet'

export interface FullCostMaterialDemand {
  id: string
  use: RoadPlanMaterialUse
  volumeBasis: 'compacted' | 'bank'
  volumeM3: number
  chainage: number
  /** Actual proposed connector chainage; no Euclidean supply shortcut. */
  connectorHaulDistanceM: number
}
export interface FullCostCandidateInput {
  id: string
  name: string
  /** This geometry contains new construction only; reused access is priced on the graph. */
  alignment: Alignment
  analysis: RoadAnalysis
  entryChainage: number
  entryRoadId?: string | null
  checks: {
    adoptable: boolean
    failures: { message: string }[]
    unknowns: { message: string }[]
    metrics?: { maxFormationUphillGradePercent: number; maxFormationDownhillGradePercent: number }
  }
}
export type FullCostPathFinder = (
  fromAttachmentId: string,
  toAttachmentId: string,
  options: RoadNetworkPathOptions,
) => RoadNetworkPath | null
export interface FullCostSourceAllocation {
  sourceId: string
  sourceName: string
  use: RoadPlanMaterialUse
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
  path: RoadNetworkPath
  returnPath: RoadNetworkPath
}
export interface FullCostLedger {
  newConstruction: number
  internalMaterialHaul: number
  newConstructionFixed: number
  sourceMaterials: number
  sourcePreparation: number
  supplyNetworkHaul: number
  supplyConnectorHaul: number
  networkRehabilitation: number
  networkAccess: number
  networkStructures: number
  networkFixed: number
  subtotal: number
  contingency: number
  total: number
}
export interface FullCostCandidateResult {
  id: string
  name: string
  status: 'feasible' | 'infeasible' | 'unpriced'
  /** Null whenever a gate, access path, quantity or required price is unresolved. */
  totalCost: number | null
  blockers: string[]
  warnings: string[]
  ledger: FullCostLedger | null
  allocations: FullCostSourceAllocation[]
  accessPath: RoadNetworkPath | null
  accessReturnPath: RoadNetworkPath | null
  networkCostItems: RoadNetworkCostItem[]
  demands: FullCostMaterialDemand[]
}
export interface FullCostComparison {
  candidates: FullCostCandidateResult[]
  winnerId: string | null
  pathSearches: number
  scope: string
}

/** Build all attachments together so path item IDs remain stable and selected road levels are honored. */
export function fullCostNetworkAttachments(
  inputs: FullCostCandidateInput[],
  planning: TotalCostPlanning,
): RoadNetworkAttachmentInput[] {
  return [
    ...(planning.outlet
      ? [
          {
            id: OUTLET_NETWORK_ATTACHMENT_ID,
            coordinate: planning.outlet,
            ...(planning.outletRoadId ? { roadId: planning.outletRoadId } : {}),
          },
        ]
      : []),
    ...inputs.map((input) => ({
      id: candidateNetworkAttachmentId(input.id),
      coordinate: positionAt(input.alignment, input.entryChainage).coordinate,
      ...(input.entryRoadId ? { roadId: input.entryRoadId } : {}),
    })),
    ...planning.sources
      .filter((source) => source.enabled && source.entrance !== null)
      .map((source) => ({
        id: sourceNetworkAttachmentId(source.id),
        coordinate: source.entrance!,
        ...(source.entranceRoadId ? { roadId: source.entranceRoadId } : {}),
      })),
  ]
}

/** Normalize external procurement away; retain measured materials, templates and internal transfers. */
export function analyzeFullCostConnector(
  alignment: Alignment,
  terrain: TerrainSource,
  settings: RoadSettings,
  context: ContextFeature[] = [],
): RoadAnalysis {
  const engineering = alignment.engineering ?? createEngineeringDesign()
  return analyzeRoad(
    {
      ...alignment,
      engineering: {
        ...engineering,
        sites: [],
        surfacingSupply: undefined,
        haul: { ...engineering.haul, enabled: true },
      },
    },
    terrain,
    settings,
    context,
  )
}

/** Exact engine surfacing integration, with the same explicit midpoint mass-haul parcels. */
export function buildFullCostDemands(
  alignment: Alignment,
  analysis: RoadAnalysis,
  entryChainage: number,
): FullCostMaterialDemand[] {
  if (!hasCompleteCoverage(analysis))
    throw Error('New connector quantities require complete terrain and daylight coverage.')
  if (!analysis.engineering?.haul.enabled)
    throw Error('Recalculate internal cut/fill transfers with analyzeFullCostConnector before comparing full costs.')
  if (!Number.isFinite(entryChainage) || entryChainage < -EPS || entryChainage > analysis.length + EPS)
    throw Error('The network tie-in chainage is outside the candidate road.')
  if (Math.min(Math.abs(entryChainage), Math.abs(entryChainage - analysis.length)) > 0.001)
    throw Error('The priced new connector must tie into the existing network at a road endpoint.')
  if (
    !(analysis.length > 1) ||
    Math.abs(alignmentLength(alignment) - analysis.length) > 0.001 ||
    !analysis.centerline.length ||
    distance(positionAt(alignment, 0).coordinate, analysis.centerline[0]) > 0.01 ||
    distance(positionAt(alignment, analysis.length).coordinate, analysis.centerline.at(-1)!) > 0.01
  )
    throw Error('The cost quantities do not match the current fitted horizontal candidate.')
  const surfaced = { ...alignment, overrides: alignment.overrides.filter((override) => override.kind !== 'landing') }
  const area = (chainage: number) => {
    const widths = effectiveWidths(surfaced, chainage),
      template = templateAt(alignment, chainage).template
    return (
      widths.leftWidth * sideValue(template, 'left', 'SurfaceDepth') +
      widths.rightWidth * sideValue(template, 'right', 'SurfaceDepth')
    )
  }
  const cutToFill = analysis.engineering.movements.filter((movement) => movement.kind === 'cut-to-fill')
  const fillUsed = new Map<string, number>(),
    bankUsed = new Map<string, number>()
  for (const movement of cutToFill) {
    fillUsed.set(movement.targetId, (fillUsed.get(movement.targetId) ?? 0) + movement.transportedVolumeM3)
    bankUsed.set(movement.sourceId, (bankUsed.get(movement.sourceId) ?? 0) + (movement.bankVolumeM3 ?? 0))
  }
  const demand: FullCostMaterialDemand[] = []
  for (let i = 1; i < analysis.stations.length; i++) {
    const a = analysis.stations[i - 1],
      b = analysis.stations[i]
    if (!a.complete || !b.complete || b.fillVolumeM3 === null || b.cutVolumeM3 === null)
      throw Error('A new connector interval has incomplete quantities.')
    const chainage = (a.chainage + b.chainage) / 2,
      ds = b.chainage - a.chainage
    const intervalId = `interval-${i}`
    const suppliedFill = fillUsed.get(intervalId) ?? 0
    const usedBankCut = bankUsed.get(intervalId) ?? 0
    if (suppliedFill > b.fillVolumeM3 + EPS || usedBankCut > b.cutVolumeM3 + EPS)
      throw Error('Internal material transfers exceed the candidate interval quantities.')
    const aa = area(a.chainage),
      am = area(chainage),
      ab = area(b.chainage)
    const surfaceM3 = ((aa + 4 * am + ab) * ds) / 6
    const surfaceHaulM3M =
      ((aa * Math.abs(a.chainage - entryChainage) +
        4 * am * Math.abs(chainage - entryChainage) +
        ab * Math.abs(b.chainage - entryChainage)) *
        ds) /
      6
    for (const [use, volumeM3] of [
      ['surfacing', surfaceM3],
      ['fill', Math.max(0, b.fillVolumeM3 - suppliedFill)],
      ['waste', Math.max(0, b.cutVolumeM3 - usedBankCut)],
    ] as const) {
      if (volumeM3 <= EPS) continue
      demand.push({
        id: `${use}-${i}`,
        use,
        volumeBasis: use === 'waste' ? 'bank' : 'compacted',
        volumeM3,
        chainage,
        connectorHaulDistanceM: use === 'surfacing' ? surfaceHaulM3M / volumeM3 : Math.abs(chainage - entryChainage),
      })
    }
  }
  const sum = (use: RoadPlanMaterialUse) =>
    demand.filter((item) => item.use === use).reduce((total, item) => total + item.volumeM3, 0)
  if (
    Math.abs(sum('surfacing') - analysis.surfaceVolumeM3) > Math.max(EPS, analysis.surfaceVolumeM3 * 1e-8) ||
    Math.abs(sum('fill') - analysis.engineering.haul.borrowCompactedM3) > Math.max(EPS, analysis.fillVolumeM3 * 1e-8) ||
    Math.abs(sum('waste') - analysis.engineering.haul.wasteBankM3) > Math.max(EPS, analysis.cutVolumeM3 * 1e-8)
  )
    throw Error('Material demand parcels do not conserve the road engine quantities.')
  return demand
}

const sourceProblems = (source: RoadPlanSource): string[] => {
  const problems: string[] = []
  if (!source.entrance) problems.push('physical entrance is unknown')
  if (!source.accessConfirmed) problems.push('supply/disposal access is unreviewed')
  if (!source.qualityConfirmed) problems.push('material suitability or disposal acceptance is unreviewed')
  for (const [key, label] of [
    ['acquisitionRate', 'acquisition/disposal'],
    ['processingRate', 'processing'],
    ['loadingRate', 'loading'],
    ['placementRate', 'placement'],
    ['fixedCost', 'source preparation'],
  ] as const)
    if (source[key] === null) problems.push(`${label} price is unknown`)
  return problems
}
const sourceUnitRate = (source: RoadPlanSource): number =>
  source.acquisitionRate! + source.processingRate! + source.loadingRate! + source.placementRate!

/** Max-flow feasibility preserves scarce shared aggregate capacity for the other material uses. */
function capacityFeasible(
  demand: Record<RoadPlanMaterialUse, number>,
  sources: { source: RoadPlanSource; remaining: number }[],
  reachable: Set<string>,
): boolean {
  const total = KINDS.reduce((sum, kind) => sum + demand[kind], 0)
  if (total <= EPS) return true
  const count = sources.length + 5,
    sink = count - 1,
    matrix = Array.from({ length: count }, () => new Float64Array(count))
  sources.forEach(({ source, remaining }, index) => {
    matrix[0][index + 1] = Math.min(total, remaining)
    KINDS.forEach((kind, k) => {
      if (source.uses.includes(kind) && reachable.has(`${source.id}:${kind}`))
        matrix[index + 1][sources.length + 1 + k] = total
    })
  })
  KINDS.forEach((kind, k) => {
    matrix[sources.length + 1 + k][sink] = demand[kind]
  })
  let flow = 0
  while (flow < total - EPS) {
    const previous = new Int32Array(count).fill(-1),
      queue = [0]
    previous[0] = 0
    for (let q = 0; q < queue.length && previous[sink] < 0; q++)
      for (let next = 1; next < count; next++)
        if (previous[next] < 0 && matrix[queue[q]][next] > EPS) {
          previous[next] = queue[q]
          queue.push(next)
        }
    if (previous[sink] < 0) return false
    let amount = total - flow
    for (let node = sink; node !== 0; node = previous[node]) amount = Math.min(amount, matrix[previous[node]][node])
    for (let node = sink; node !== 0; node = previous[node]) {
      matrix[previous[node]][node] -= amount
      matrix[node][previous[node]] += amount
    }
    flow += amount
  }
  return true
}

export function compareFullCostCandidates(
  inputs: FullCostCandidateInput[],
  rawPlanning: TotalCostPlanning,
  pathFinder: FullCostPathFinder,
): FullCostComparison {
  if (
    !inputs.length ||
    inputs.length > MAX_FULL_COST_CANDIDATES ||
    new Set(inputs.map((input) => input.id)).size !== inputs.length
  )
    throw Error(`Compare 1–${MAX_FULL_COST_CANDIDATES} uniquely identified new connector candidates.`)
  const planning = parseTotalCostPlanning(rawPlanning)
  let pathSearches = 0
  const findPath: FullCostPathFinder = (from, to, options) => {
    if (++pathSearches > MAX_FULL_COST_PATH_SEARCHES)
      throw Error('Full-cost network path budget exceeded; reduce sources or horizontal alternatives.')
    return pathFinder(from, to, options)
  }
  const results = inputs.map((input): FullCostCandidateResult => {
    const result: FullCostCandidateResult = {
      id: input.id,
      name: input.name,
      status: 'infeasible',
      totalCost: null,
      blockers: [],
      warnings: [],
      ledger: null,
      allocations: [],
      accessPath: null,
      accessReturnPath: null,
      networkCostItems: [],
      demands: [],
    }
    const reject = (status: 'infeasible' | 'unpriced', message: string) => {
      result.status = status
      result.blockers.push(message)
    }
    if (!input.checks.adoptable) {
      input.checks.failures.forEach((issue) => reject('infeasible', issue.message))
      input.checks.unknowns.forEach((issue) =>
        reject(input.checks.failures.length ? 'infeasible' : 'unpriced', issue.message),
      )
      if (!result.blockers.length) reject('unpriced', 'The final connector checks have not passed.')
      return result
    }
    if (!planning.outlet) {
      reject('unpriced', 'A physical network outlet/gateway must be reviewed and located.')
      return result
    }
    if (
      planning.newConstructionFixedCost === null ||
      planning.haulRatePerM3Km === null ||
      planning.returnHaulRatePerM3Km === null
    ) {
      reject(
        'unpriced',
        'Enter the new-construction fixed cost, loaded truck rate and empty return rate, including explicit zeros where applicable.',
      )
      return result
    }
    const engineering = input.analysis.engineering
    if (!engineering) {
      reject('unpriced', 'Engineering quantities and internal material transfers must be calculated.')
      return result
    }
    try {
      result.demands = buildFullCostDemands(input.alignment, input.analysis, input.entryChainage)
    } catch (error) {
      reject('unpriced', error instanceof Error ? error.message : 'Candidate quantities are unresolved.')
      return result
    }
    const adverse = planning.connectorChecks.maxAdverseGradePercent,
      favourable = planning.connectorChecks.maxFavourableGradePercent
    if (adverse === null || favourable === null) {
      reject(
        'unpriced',
        'Loaded adverse and favourable grade limits are required for actual aggregate and waste travel directions.',
      )
      return result
    }
    const grades = input.analysis.stations
      .map((station) => station.gradePercent)
      .filter((grade): grade is number => grade !== null && Number.isFinite(grade))
    const uphill = input.checks.metrics?.maxFormationUphillGradePercent ?? Math.max(0, ...grades)
    const downhill =
      input.checks.metrics?.maxFormationDownhillGradePercent ?? Math.max(0, ...grades.map((grade) => -grade))
    for (const kind of KINDS) {
      if (!result.demands.some((demand) => demand.use === kind)) continue
      const forward =
        kind === 'waste'
          ? input.entryChainage > input.analysis.length / 2
          : input.entryChainage < input.analysis.length / 2
      const actualAdverse = forward ? uphill : downhill,
        actualFavourable = forward ? downhill : uphill
      if (actualAdverse > adverse + EPS || actualFavourable > favourable + EPS)
        reject(
          'infeasible',
          `${kind === 'waste' ? 'Outgoing waste' : 'Incoming aggregate'} travel on the new connector exceeds the entered loaded ${actualAdverse > adverse + EPS ? 'adverse' : 'favourable'} grade limit.`,
        )
    }
    if (result.blockers.length) return result
    if (engineering.culverts.some((culvert) => !culvert.complete)) {
      reject('unpriced', 'A new-connector structure has incomplete geometry or cover.')
      return result
    }
    const paid = new Set<string>(),
      costItems = new Map<string, RoadNetworkCostItem>()
    const addPath = (path: RoadNetworkPath): boolean => {
      if (path.totalCost === null || path.costItems.some((item) => item.amount === null)) return false
      for (const item of path.costItems) {
        if (!paid.has(item.id)) costItems.set(item.id, item)
        paid.add(item.id)
      }
      result.warnings.push(...path.warnings)
      return true
    }
    const accessId = candidateNetworkAttachmentId(input.id)
    result.accessPath = findPath(accessId, OUTLET_NETWORK_ATTACHMENT_ID, {
      objective: 'total-cost',
      distanceRatePerM: 0,
      paidCostItemIds: [],
      allowUnpricedCosts: false,
    })
    if (!result.accessPath) {
      const unpriced = findPath(accessId, OUTLET_NETWORK_ATTACHMENT_ID, {
        objective: 'distance',
        distanceRatePerM: 0,
        paidCostItemIds: [],
        allowUnpricedCosts: true,
      })
      reject(
        unpriced ? 'unpriced' : 'infeasible',
        unpriced
          ? 'The connected outlet route has unknown rehabilitation, bridge/structure or access prices.'
          : 'No permitted, vehicle-compatible connected road path reaches the required outlet.',
      )
      return result
    }
    if (!addPath(result.accessPath)) {
      reject('unpriced', 'Existing network access has unpriced costs.')
      return result
    }
    result.accessReturnPath = findPath(OUTLET_NETWORK_ATTACHMENT_ID, accessId, {
      objective: 'total-cost',
      distanceRatePerM: 0,
      paidCostItemIds: [...paid],
      allowUnpricedCosts: false,
    })
    if (!result.accessReturnPath) {
      const diagnostic = findPath(OUTLET_NETWORK_ATTACHMENT_ID, accessId, {
        objective: 'distance',
        distanceRatePerM: 0,
        paidCostItemIds: [...paid],
        allowUnpricedCosts: true,
      })
      reject(
        diagnostic ? 'unpriced' : 'infeasible',
        diagnostic
          ? 'The return access route from the outlet has unpriced rehabilitation, bridge or access costs.'
          : 'No permitted directed return route connects the outlet to the new connector.',
      )
      return result
    }
    if (!addPath(result.accessReturnPath)) {
      reject('unpriced', 'The outlet return route has unknown network costs.')
      return result
    }
    const remaining: Record<RoadPlanMaterialUse, number> = { surfacing: 0, fill: 0, waste: 0 }
    const connectorM3Km: Record<RoadPlanMaterialUse, number> = { surfacing: 0, fill: 0, waste: 0 }
    for (const demand of result.demands) {
      remaining[demand.use] += demand.volumeM3
      connectorM3Km[demand.use] += (demand.volumeM3 * demand.connectorHaulDistanceM) / 1000
    }
    const initialDemand = { ...remaining }
    const sources = planning.sources
      .filter(
        (source) =>
          source.enabled &&
          (source.capacityM3 === null || source.capacityM3 > EPS) &&
          source.uses.some((kind) => remaining[kind] > EPS),
      )
      .flatMap((source) => {
        const problems = sourceProblems(source)
        if (problems.length) {
          result.warnings.push(`${source.name} excluded: ${problems.join('; ')}.`)
          return []
        }
        return [{ source, remaining: source.capacityM3 ?? Infinity }]
      })
    const reachable = new Set<string>()
    let unknownNetwork = false
    for (const state of sources)
      for (const kind of KINDS) {
        if (!state.source.uses.includes(kind) || remaining[kind] <= EPS) continue
        const sourceId = sourceNetworkAttachmentId(state.source.id),
          from = kind === 'waste' ? accessId : sourceId,
          to = kind === 'waste' ? sourceId : accessId
        const path = findPath(from, to, {
          objective: 'total-cost',
          distanceRatePerM: (Math.min(remaining[kind], state.remaining) * planning.haulRatePerM3Km) / 1000,
          paidCostItemIds: [...paid],
          allowUnpricedCosts: false,
        })
        const returnPath =
          path && path.totalCost !== null
            ? findPath(to, from, {
                objective: 'total-cost',
                distanceRatePerM: (Math.min(remaining[kind], state.remaining) * planning.returnHaulRatePerM3Km) / 1000,
                paidCostItemIds: [...paid, ...path.costItemIds],
                allowUnpricedCosts: false,
              })
            : null
        const key = `${state.source.id}:${kind}`
        if (
          path &&
          returnPath &&
          path.totalCost !== null &&
          returnPath.totalCost !== null &&
          [...path.costItems, ...returnPath.costItems].every((item) => item.amount !== null)
        ) {
          reachable.add(key)
        } else {
          const diagnostic = findPath(from, to, {
            objective: 'distance',
            distanceRatePerM: 0,
            paidCostItemIds: [...paid],
            allowUnpricedCosts: true,
          })
          const diagnosticReturn = findPath(to, from, {
            objective: 'distance',
            distanceRatePerM: 0,
            paidCostItemIds: [...paid],
            allowUnpricedCosts: true,
          })
          const connected = diagnostic !== null && diagnosticReturn !== null
          unknownNetwork ||= connected
          result.warnings.push(
            `${state.source.name} excluded for ${kind}: ${connected ? 'network rehabilitation, structure or access costs are unknown' : 'no connected permitted route for both loaded and return trips with the selected vehicle and season'}.`,
          )
        }
      }
    if (!capacityFeasible(remaining, sources, reachable)) {
      const excludedUnknown = planning.sources.some(
        (source) =>
          source.enabled &&
          (source.capacityM3 === null || source.capacityM3 > EPS) &&
          source.uses.some((kind) => remaining[kind] > EPS) &&
          sourceProblems(source).length,
      )
      reject(
        unknownNetwork || excludedUnknown ? 'unpriced' : 'infeasible',
        'Reviewed sources with priced connected haul routes cannot meet every required compacted aggregate and bank waste quantity. No Euclidean or base-rate supply fallback is used.',
      )
      return result
    }
    const usedSources = new Set<string>()
    for (const kind of KINDS)
      while (remaining[kind] > EPS) {
        if (result.allocations.length >= MAX_FULL_COST_ALLOCATIONS) {
          reject('unpriced', 'Source batch allocation exceeded its 300-batch comparison budget.')
          return result
        }
        const choices: {
          state: (typeof sources)[number]
          amount: number
          path: RoadNetworkPath
          returnPath: RoadNetworkPath
          unit: number
          setup: number
          score: number
        }[] = []
        for (const state of sources) {
          const key = `${state.source.id}:${kind}`
          if (!reachable.has(key) || state.remaining <= EPS) continue
          let amount = Math.min(remaining[kind], state.remaining)
          const fits = (trial: number) => {
            state.remaining -= trial
            remaining[kind] -= trial
            const feasible = capacityFeasible(remaining, sources, reachable)
            state.remaining += trial
            remaining[kind] += trial
            return feasible
          }
          if (!fits(amount)) {
            let low = 0,
              high = amount
            for (let step = 0; step < 45; step++) {
              const mid = (low + high) / 2
              if (fits(mid)) low = mid
              else high = mid
            }
            amount = low
          }
          if (amount <= EPS) continue
          const sourceId = sourceNetworkAttachmentId(state.source.id)
          const path = findPath(kind === 'waste' ? accessId : sourceId, kind === 'waste' ? sourceId : accessId, {
            objective: 'total-cost',
            distanceRatePerM: (amount * planning.haulRatePerM3Km) / 1000,
            paidCostItemIds: [...paid],
            allowUnpricedCosts: false,
          })
          if (!path || path.totalCost === null) continue
          const returnPath = findPath(kind === 'waste' ? sourceId : accessId, kind === 'waste' ? accessId : sourceId, {
            objective: 'total-cost',
            distanceRatePerM: (amount * planning.returnHaulRatePerM3Km) / 1000,
            paidCostItemIds: [...paid, ...path.costItemIds],
            allowUnpricedCosts: false,
          })
          if (!returnPath || returnPath.totalCost === null) continue
          const unit = sourceUnitRate(state.source),
            setup = usedSources.has(state.source.id) ? 0 : state.source.fixedCost!
          choices.push({
            state,
            amount,
            path,
            returnPath,
            unit,
            setup,
            score: unit + (path.totalCost + returnPath.totalCost + setup) / amount,
          })
        }
        choices.sort((a, b) => a.score - b.score || a.state.source.id.localeCompare(b.state.source.id))
        const chosen = choices[0]
        if (!chosen || !addPath(chosen.path) || !addPath(chosen.returnPath)) {
          reject('unpriced', 'Source allocation could not produce a complete priced network path.')
          return result
        }
        const source = chosen.state.source
        const connectorWork =
          initialDemand[kind] > EPS ? (connectorM3Km[kind] * chosen.amount) / initialDemand[kind] : 0
        result.allocations.push({
          sourceId: source.id,
          sourceName: source.name,
          use: kind,
          volumeBasis: kind === 'waste' ? 'bank' : 'compacted',
          volumeM3: chosen.amount,
          unitMaterialRate: chosen.unit,
          materialCost: chosen.unit * chosen.amount,
          networkDistanceM: chosen.path.lengthM,
          networkHaulCost: chosen.path.haulCost,
          returnNetworkDistanceM: chosen.returnPath.lengthM,
          returnNetworkHaulCost: chosen.returnPath.haulCost,
          connectorHaulM3Km: connectorWork,
          connectorHaulCost: connectorWork * planning.haulRatePerM3Km,
          returnConnectorHaulCost: connectorWork * planning.returnHaulRatePerM3Km,
          sourcePreparationCost: chosen.setup,
          path: chosen.path,
          returnPath: chosen.returnPath,
        })
        chosen.state.remaining -= chosen.amount
        remaining[kind] -= chosen.amount
        usedSources.add(source.id)
      }
    const internalHaul = engineering.movements
      .filter((movement) => movement.kind === 'cut-to-fill')
      .reduce((sum, movement) => sum + movement.haulCost, 0)
    const internalFillRatio =
      input.analysis.fillVolumeM3 > EPS ? Math.max(0, 1 - initialDemand.fill / input.analysis.fillVolumeM3) : 0
    // Engine clearing covers the daylight prism only. The final-check allowance is an
    // additional strip on each side, priced at the same entered unit rate, before contingency.
    const extraClearingAreaM2 = 2 * planning.connectorChecks.clearingExtraM * input.analysis.length
    const clearingRate =
      input.analysis.clearingAreaM2 > EPS ? engineering.costs.clearing / input.analysis.clearingAreaM2 : null
    if (extraClearingAreaM2 > EPS && (clearingRate === null || !Number.isFinite(clearingRate) || clearingRate < 0)) {
      reject('unpriced', 'The extra clearing allowance has no resolvable entered clearing rate.')
      return result
    }
    const extraClearingCost = extraClearingAreaM2 * (clearingRate ?? 0)
    if (extraClearingAreaM2 > EPS)
      result.warnings.push(
        `Additional clearing allowance: ${planning.connectorChecks.clearingExtraM} m each side × ${input.analysis.length.toFixed(2)} m fitted length = ${extraClearingAreaM2.toFixed(2)} m² at $${clearingRate!.toFixed(2)}/m², included once in new construction. This station-strip allowance does not deduct overlap at curves or junctions.`,
      )
    const ledger: FullCostLedger = {
      newConstruction:
        engineering.costs.cut +
        engineering.costs.stripping +
        engineering.costs.fill * internalFillRatio +
        engineering.costs.clearing +
        extraClearingCost +
        engineering.costs.structures +
        engineering.costs.mobilization,
      internalMaterialHaul: internalHaul,
      newConstructionFixed: planning.newConstructionFixedCost,
      sourceMaterials: 0,
      sourcePreparation: 0,
      supplyNetworkHaul: 0,
      supplyConnectorHaul: 0,
      networkRehabilitation: 0,
      networkAccess: 0,
      networkStructures: 0,
      networkFixed: 0,
      subtotal: 0,
      contingency: 0,
      total: 0,
    }
    for (const allocation of result.allocations) {
      ledger.sourceMaterials += allocation.materialCost
      ledger.sourcePreparation += allocation.sourcePreparationCost
      ledger.supplyNetworkHaul += allocation.networkHaulCost + allocation.returnNetworkHaulCost
      ledger.supplyConnectorHaul += allocation.connectorHaulCost + allocation.returnConnectorHaulCost
    }
    for (const item of costItems.values()) {
      if (item.amount === null || !Number.isFinite(item.amount) || item.amount < 0) {
        reject('unpriced', 'A network cost item is unknown or invalid.')
        return result
      }
      const key = {
        rehabilitation: 'networkRehabilitation',
        access: 'networkAccess',
        structure: 'networkStructures',
        fixed: 'networkFixed',
      }[item.kind] as 'networkRehabilitation' | 'networkAccess' | 'networkStructures' | 'networkFixed'
      ledger[key] += item.amount
    }
    ledger.subtotal =
      ledger.newConstruction +
      ledger.internalMaterialHaul +
      ledger.newConstructionFixed +
      ledger.sourceMaterials +
      ledger.sourcePreparation +
      ledger.supplyNetworkHaul +
      ledger.supplyConnectorHaul +
      ledger.networkRehabilitation +
      ledger.networkAccess +
      ledger.networkStructures +
      ledger.networkFixed
    ledger.contingency = (ledger.subtotal * (input.alignment.engineering?.haul.contingencyPercent ?? 0)) / 100
    ledger.total = ledger.subtotal + ledger.contingency
    if (!Object.values(ledger).every((value) => Number.isFinite(value) && value >= -EPS)) {
      reject('unpriced', 'The full-cost ledger contains a nonfinite or negative amount.')
      return result
    }
    result.status = 'feasible'
    result.totalCost = ledger.total
    result.ledger = ledger
    result.networkCostItems = [...costItems.values()]
    result.warnings = [...new Set(result.warnings)]
    return result
  })
  const winner = results
    .filter((result) => result.status === 'feasible' && result.totalCost !== null)
    .sort((a, b) => a.totalCost! - b.totalCost! || a.id.localeCompare(b.id))[0]
  return {
    candidates: results,
    winnerId: winner?.id ?? null,
    pathSearches,
    scope:
      'Lowest complete entered construction, connected access and material-delivery cost among the checked horizontal alternatives. Finite material-use source batches; not a global network, pit or road optimization.',
  }
}
