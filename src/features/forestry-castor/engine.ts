import {
  CASTOR_MODEL_VERSION,
  type CastorConfig,
  type CastorHarvestFlow,
  type CastorHarvestPixelRow,
  type CastorHarvestRow,
  type CastorPixel,
  type CastorPriority,
  type CastorProject,
  type CastorResult,
  type CastorRunOptions,
  type CastorSnapshot,
  type CastorStockRow,
  type CastorTreatment,
} from './types'
import {
  commitEcaChange,
  constraintReports,
  createEcaBudgets,
  ecaChangeAllowed,
  evaluateConstraints,
  matchesPredicate,
  pixelValue,
} from './constraints'
import { applyYield, culminationVolume, growthYears } from './growth'
import { yieldSensitivity } from './uncertainty'
import { CASTOR_LIMITS, validateCastorProject } from './validation'

const EPSILON = 1e-9
const totalStock = (pixels: CastorPixel[]) => pixels.reduce((sum, pixel) => sum + pixel.volume * pixel.thlbHa, 0)
const clonePixel = (pixel: CastorPixel): CastorPixel => ({
  ...pixel,
  zones: { ...pixel.zones },
  attributes: pixel.attributes ? { ...pixel.attributes } : undefined,
})

function synchronizeLegacyAttributes(
  pixel: CastorPixel,
  culmination: Map<string, number>,
  protectedFlag?: number,
): void {
  pixel.culminationVolume = culmination.get(pixel.curveId ?? '') ?? pixel.culminationVolume
  if (!pixel.attributes) return
  const sourceId = (value: string | undefined) =>
    value === undefined ? null : Number.isFinite(Number(value)) ? Number(value) : value
  const values: Record<string, number | string | boolean | null> = {
    vol: pixel.volume,
    dist: pixel.distance,
    salvage_vol: pixel.salvageVolume,
    crownclosure: pixel.crownClosure ?? null,
    basalarea: pixel.basalArea ?? null,
    dec_pcnt: pixel.deciduousPercent ?? null,
    yieldid: sourceId(pixel.curveId),
    yieldid_trans: sourceId(pixel.managedCurveId),
    culvar: pixel.culminationVolume ?? 0,
  }
  if (protectedFlag !== undefined) values.zone_const = protectedFlag
  for (const [key, value] of Object.entries(values))
    if (Object.prototype.hasOwnProperty.call(pixel.attributes, key)) pixel.attributes[key] = value
}

interface HarvestPlan {
  index: number
  next: CastorPixel
  volumeM3: number
  liveRemovedM3: number
  type: 'live' | 'salvage' | 'partial'
  fraction: number
  volumeScale: number
  transition: boolean
}

interface ReportBag {
  compartment: string
  flowId: string
  type: CastorHarvestRow['type']
  target: number | null
  effectiveTarget: number | null
  availableHa: number
  events: CastorHarvestPixelRow[]
  volumeM3: number
  transitionArea: number
  transitionVolume: number
}

function compareScalars(a: unknown, b: unknown): number {
  const missingA = a === null || a === undefined || (typeof a === 'number' && !Number.isFinite(a))
  const missingB = b === null || b === undefined || (typeof b === 'number' && !Number.isFinite(b))
  if (missingA || missingB) return missingA === missingB ? 0 : missingA ? 1 : -1
  if (a === b) return 0
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : 1
  return String(a) < String(b) ? -1 : 1
}

function orderValues(a: Record<string, unknown>, b: Record<string, unknown>, priorities: CastorPriority[]): number {
  for (const priority of priorities) {
    const av = a[priority.field]
    const bv = b[priority.field]
    const comparison = compareScalars(av, bv)
    if (comparison) {
      if (av === undefined || av === null) return 1
      if (bv === undefined || bv === null) return -1
      return priority.direction === 'asc' ? comparison : -comparison
    }
  }
  return 0
}

function aggregatePriorities(
  pixels: CastorPixel[],
  priorities: CastorPriority[],
  keyFor: (pixel: CastorPixel) => string,
  culmination: Map<string, number>,
): Map<string, Record<string, unknown>> {
  const groups = new Map<
    string,
    { values: Record<string, unknown>; sums: Record<string, number>; weights: Record<string, number> }
  >()
  for (const pixel of pixels) {
    const key = keyFor(pixel)
    let group = groups.get(key)
    if (!group) {
      group = { values: {}, sums: {}, weights: {} }
      groups.set(key, group)
    }
    for (const { field } of priorities) {
      const value =
        field === 'culminationVolume'
          ? (culmination.get(pixel.curveId ?? '') ?? pixel.culminationVolume)
          : pixelValue(pixel, field)
      if (typeof value === 'number' && Number.isFinite(value)) {
        group.sums[field] = (group.sums[field] ?? 0) + value * pixel.areaHa
        if (!Number.isFinite(group.sums[field]))
          throw new Error(
            `Priority field ${field} overflows area-weighted averaging; supply values in a finite usable range.`,
          )
        group.weights[field] = (group.weights[field] ?? 0) + pixel.areaHa
      } else if (value !== undefined && value !== null && group.values[field] === undefined) group.values[field] = value
    }
  }
  return new Map(
    [...groups.entries()].map(([key, group]) => {
      for (const field of Object.keys(group.sums)) group.values[field] = group.sums[field] / group.weights[field]
      return [key, group.values]
    }),
  )
}

function stockRows(
  pixels: CastorPixel[],
  config: CastorConfig,
  period: number,
  phase: CastorStockRow['phase'],
  protectedMask?: Uint8Array,
): CastorStockRow[] {
  const byCompartment = new Map<
    string,
    { stockM3: number; salvageM3: number; thlbHa: number; availableThlbHa: number; ageHa: number }
  >()
  pixels.forEach((pixel, i) => {
    let row = byCompartment.get(pixel.compartment)
    if (!row) {
      row = { stockM3: 0, salvageM3: 0, thlbHa: 0, availableThlbHa: 0, ageHa: 0 }
      byCompartment.set(pixel.compartment, row)
    }
    row.stockM3 += pixel.volume * pixel.thlbHa
    row.salvageM3 += pixel.salvageVolume * pixel.thlbHa
    row.thlbHa += pixel.thlbHa
    row.ageHa += pixel.age * pixel.thlbHa
    if (pixel.owned && !protectedMask?.[i] && !pixel.treatmentId) row.availableThlbHa += pixel.thlbHa
  })
  const elapsedYears = period * config.stepYears
  return [...byCompartment].map(([compartment, values]) => ({
    scenario: config.scenario,
    period,
    year: config.startYear + elapsedYears,
    elapsedYears,
    compartment,
    phase,
    stockM3: values.stockM3,
    salvageM3: values.salvageM3,
    thlbHa: values.thlbHa,
    availableThlbHa: values.availableThlbHa,
    meanAge: values.thlbHa > 0 ? values.ageHa / values.thlbHa : null,
  }))
}

function makeSnapshot(
  pixels: CastorPixel[],
  config: CastorConfig,
  period: number,
  harvestedYear: Array<number | null>,
  harvestedVolume: number[],
  protectedMask: Uint8Array,
  constraintCounts: number[],
): CastorSnapshot {
  return {
    period,
    year: config.startYear + period * config.stepYears,
    elapsedYears: period * config.stepYears,
    age: pixels.map((pixel) => pixel.age),
    volume: pixels.map((pixel) => pixel.volume),
    height: pixels.map((pixel) => pixel.height),
    eca: pixels.map((pixel) => pixel.eca),
    harvestedYear: [...harvestedYear],
    harvestedVolumeM3: [...harvestedVolume],
    constrained: Array.from(protectedMask),
    constrainedPeriods: [...constraintCounts],
    constrainedYears: constraintCounts.map((count) => count * config.stepYears),
  }
}

interface DistanceNode {
  x: number
  y: number
  axis: 0 | 1
  left?: DistanceNode
  right?: DistanceNode
}
function distanceTree(points: Array<{ x: number; y: number }>, depth = 0): DistanceNode | undefined {
  if (!points.length) return undefined
  const axis = (depth % 2) as 0 | 1
  const field = axis === 0 ? 'x' : 'y'
  points.sort((a, b) => a[field] - b[field])
  const mid = points.length >>> 1
  return {
    ...points[mid],
    axis,
    left: distanceTree(points.slice(0, mid), depth + 1),
    right: distanceTree(points.slice(mid + 1), depth + 1),
  }
}
function closestDistanceSquared(node: DistanceNode | undefined, x: number, y: number, best: number): number {
  if (!node) return best
  const dx = x - node.x
  const dy = y - node.y
  let nearest = Math.min(best, dx * dx + dy * dy)
  const split = node.axis === 0 ? dx : dy
  nearest = closestDistanceSquared(split <= 0 ? node.left : node.right, x, y, nearest)
  if (split * split < nearest) nearest = closestDistanceSquared(split <= 0 ? node.right : node.left, x, y, nearest)
  return nearest
}

/** Pure synchronous engine intended to execute inside a cancellable module Web Worker. */
export function runCastor(
  project: CastorProject,
  settings: CastorConfig,
  options: CastorRunOptions = {},
): CastorResult {
  const validation = validateCastorProject(project, settings)
  if (validation.errors.length)
    throw new Error(validation.errors.map((issue) => `${issue.path}: ${issue.message}`).join('\n'))
  const config: CastorConfig = {
    ...settings,
    blockPriority: settings.blockPriority.map((value) => ({ ...value })),
    uncertainty: { ...settings.uncertainty },
    zonePriority: settings.zonePriority
      ? { ...settings.zonePriority, order: settings.zonePriority.order.map((value) => ({ ...value })) }
      : undefined,
  }
  const warnings = new Set(validation.warnings)
  const warn = (message: string) => {
    if (warnings.size < 200) warnings.add(message)
  }
  const cancelled = () => {
    if (options.shouldCancel?.()) throw new Error('Simulation cancelled.')
  }
  const pixels = project.pixels.map(clonePixel)
  const curves = new Map(project.yieldCurves.map((curve) => [curve.id, curve]))
  const culmination = new Map(project.yieldCurves.map((curve) => [curve.id, culminationVolume(curve)]))
  const treatments = new Map((project.treatments ?? []).map((treatment) => [treatment.id, treatment]))
  const idToIndex = new Map(pixels.map((pixel, index) => [pixel.id, index]))
  const blockIndices = new Map<string, number[]>()
  const neighbors = new Map<string, Set<string>>()
  pixels.forEach((pixel, i) => {
    const list = blockIndices.get(pixel.blockId) ?? []
    list.push(i)
    blockIndices.set(pixel.blockId, list)
  })
  for (const [a, b] of project.adjacency) {
    if (!neighbors.has(a)) neighbors.set(a, new Set())
    if (!neighbors.has(b)) neighbors.set(b, new Set())
    neighbors.get(a)?.add(b)
    neighbors.get(b)?.add(a)
  }
  const providedLandings = new Map(project.landings.map((landing) => [landing.blockId, landing.pixelId]))
  const volumeScales = pixels.map(() => 1)
  if (config.initializeFromYield)
    for (const pixel of pixels) {
      const curve = curves.get(pixel.curveId ?? '')
      if (curve) applyYield(pixel, curve)
    }
  for (const pixel of pixels) synchronizeLegacyAttributes(pixel, culmination, 0)
  const initialRows = stockRows(pixels, config, 0, 'initial')
  const initialByCompartment = new Map(initialRows.map((row) => [row.compartment, row.stockM3]))
  const initialStockM3 = totalStock(pixels)
  const harvestedYear: Array<number | null> = pixels.map(() => null)
  const harvestedVolume = pixels.map(() => 0)
  const constraintCounts = pixels.map(() => 0)
  const assumptions = [
    'Planning adaptation of forestryCastor; this run is not a validated reproduction of the complete SpaDES/Castor system.',
    'Volumes use m³/ha × THLB hectares. Targets are period totals; annual report rates divide by stepYears. Harvested area is cumulative and may include repeated entries.',
    'Zone constraints use consistently owned, denominator-filtered ground hectares and protect whole input pixels conservatively. SQL ranking is retained; source one-hectare cell rounding is not used for irregular areas.',
    'Yield curves are linearly interpolated and held at their supplied endpoints. No external growth model, climate change, mortality or wildfire process is inferred.',
    config.initializeFromYield
      ? 'Initial volume and stand attributes are initialized from the supplied yield curves.'
      : 'Period-zero stock uses the supplied inventory values; future periods use the supplied yield curves. Any discrepancy between inventory and its curve is not calibrated automatically.',
    config.growthTiming === 'upstream-midpoint'
      ? 'The first growth step uses the upstream midpoint convention: max(1, ties-to-even rounding of stepYears/2); later steps use the full interval. Report years label management periods.'
      : 'Growth advances by the complete interval before each management-period decision.',
    'Growing-stock retention uses current live stock and the initial stock of each compartment; committed and scheduled cuts also respect the stock floor.',
    'Overlapping partitions are evaluated in supplied order and each pixel can be harvested at most once per period. Candidates are not truncated by the upstream target/50 query limit.',
    'Scheduled harvesting respects current constraints; blocked scheduled pixels are reported as shortfalls. The upstream followSchedule path bypassed constraints.',
    'Landing points are supplied locations or explicitly identified harvested-pixel candidates, not engineered road-access solutions.',
  ]
  if (config.updateDistance)
    assumptions.push(
      'New-harvest proximity is the minimum of imported distance and distance to subsequent clearcut/salvage cell centres. It treats historical disturbance as permanent; it does not implement disturbanceCastor road recovery or its 20/40/80-year disturbance windows.',
    )
  if (config.uncertainty.enabled)
    assumptions.push(
      'Yield uncertainty is an uncalibrated PGMaps sensitivity extension: a mean-one lognormal multiplier with the supplied CV, shared across the selected schedule per seeded replicate. It does not rerun scheduling or reproduce a fitted gamma/calibration model.',
    )
  if ((project.treatments ?? []).some((treatment) => treatment.method === 'fraction' || !treatment.nextCurveId))
    assumptions.push(
      'Fraction-based partial cutting is a user-supplied sensitivity assumption. Retained live-volume scaling persists during subsequent growth; it is not a calibrated stand-structure response.',
    )
  const result: CastorResult = {
    modelVersion: CASTOR_MODEL_VERSION,
    scenario: config.scenario,
    config,
    warnings: [],
    assumptions,
    harvestReport: [],
    growingStockReport: [...initialRows],
    zoneManagement: [],
    harvestPixelList: [],
    harvestBlockList: [],
    landings: [],
    salvageReport: [],
    snapshots: [
      makeSnapshot(pixels, config, 0, harvestedYear, harvestedVolume, new Uint8Array(pixels.length), constraintCounts),
    ],
    finalPixels: [],
    uncertainty: [],
    summary: {
      initialStockM3,
      finalStockM3: initialStockM3,
      harvestedM3: 0,
      harvestedAreaHa: 0,
      targetM3: 0,
      shortfallM3: 0,
    },
  }
  let zoneValues = new Map<string, Record<string, unknown>>()
  if (config.zonePriority)
    zoneValues = aggregatePriorities(
      pixels,
      config.zonePriority.order,
      (pixel) => pixel.zones[config.zonePriority!.zone] ?? '',
      culmination,
    )

  for (let period = 1; period <= config.periods; period++) {
    cancelled()
    const elapsedYears = period * config.stepYears
    const year = config.startYear + elapsedYears
    const increment = growthYears(config, period)
    pixels.forEach((pixel, index) => {
      if (pixel.age < config.maxYieldAge) pixel.age = Math.min(config.maxYieldAge, pixel.age + increment)
      const curve = curves.get(pixel.curveId ?? '')
      if (curve) applyYield(pixel, curve, volumeScales[index])
      synchronizeLegacyAttributes(pixel, culmination, 0)
    })
    const evaluation = evaluateConstraints(pixels, project.constraints, elapsedYears)
    const protectedMask = evaluation.protectedMask
    const blockedBlocks = new Set<string>()
    if (config.adjacencyHeight !== null)
      for (const [blockId, indices] of blockIndices) {
        let height = 0
        let area = 0
        for (const index of indices) {
          height += pixels[index].height * pixels[index].areaHa
          area += pixels[index].areaHa
        }
        if (area > 0 && height / area <= config.adjacencyHeight) {
          blockedBlocks.add(blockId)
          for (const neighbor of neighbors.get(blockId) ?? []) blockedBlocks.add(neighbor)
        }
      }
    pixels.forEach((pixel, i) => {
      if (blockedBlocks.has(pixel.blockId)) protectedMask[i] = 1
      synchronizeLegacyAttributes(pixel, culmination, protectedMask[i])
    })
    const beforeRows = stockRows(pixels, config, period, 'before-harvest', protectedMask)
    result.growingStockReport.push(...beforeRows)
    result.zoneManagement.push(
      ...constraintReports(pixels, project.constraints, config, period, evaluation, 'before-harvest'),
    )
    const stockBudget = new Map(
      beforeRows.map((row) => [
        row.compartment,
        Math.max(0, row.stockM3 - (initialByCompartment.get(row.compartment) ?? 0) * config.growingStockRetention),
      ]),
    )
    const selected = new Uint8Array(pixels.length)
    const newBlockedBlocks = new Set<string>()
    const newClearcuts: number[] = []
    const ecaBudgets = createEcaBudgets(pixels, project.constraints, elapsedYears)
    const periodEvents: CastorHarvestPixelRow[] = []
    const flows = project.harvestFlows.filter((flow) => flow.period === period)
    const bags = new Map<string, ReportBag>()
    const baseEligible = (index: number) => {
      const pixel = pixels[index]
      return (
        pixel.owned &&
        pixel.thlbHa > 0 &&
        pixel.blockId !== '0' &&
        !protectedMask[index] &&
        !selected[index] &&
        !newBlockedBlocks.has(pixel.blockId) &&
        pixel.age >= config.minimumHarvestAge
      )
    }
    const flowMatches = (pixel: CastorPixel, flow: CastorHarvestFlow) =>
      pixel.compartment === flow.compartment && (!flow.condition || matchesPredicate(pixel, flow.condition))
    if (config.mode === 'queue')
      for (const flow of flows) {
        const availableHa = pixels.reduce(
          (sum, pixel, i) =>
            sum + (flowMatches(pixel, flow) && baseEligible(i) && !pixel.treatmentId ? pixel.thlbHa : 0),
          0,
        )
        const target = flow.targetM3 * config.targetMultiplier
        bags.set(flow.id, {
          compartment: flow.compartment,
          flowId: flow.id,
          type: flow.type,
          target,
          effectiveTarget: flow.type === 'live' ? Math.min(target, stockBudget.get(flow.compartment) ?? 0) : target,
          availableHa,
          events: [],
          volumeM3: 0,
          transitionArea: 0,
          transitionVolume: 0,
        })
      }
    const planCut = (index: number, type: 'live' | 'salvage', fraction = 1): HarvestPlan => {
      const pixel = pixels[index]
      const next = clonePixel(pixel)
      const partial = fraction < 1 && type === 'live'
      const volumeM3 = (type === 'salvage' ? pixel.salvageVolume : pixel.volume) * pixel.thlbHa * fraction
      const liveRemovedM3 =
        type === 'salvage' ? (fraction === 1 ? pixel.volume * pixel.thlbHa : 0) : pixel.volume * pixel.thlbHa * fraction
      let scale = volumeScales[index]
      if (fraction === 1) {
        next.age = 0
        next.volume = 0
        next.height = 0
        next.eca = 1
        next.salvageVolume = 0
        next.basalArea = 0
        next.crownClosure = 0
        next.qmd = 0
        if (type === 'live' && pixel.managedCurveId) next.curveId = pixel.managedCurveId
        scale = 1
      } else if (type === 'salvage') next.salvageVolume *= 1 - fraction
      else {
        next.volume *= 1 - fraction
        next.eca = pixel.eca + (1 - pixel.eca) * fraction
        if (next.basalArea !== undefined) next.basalArea *= 1 - fraction
        scale *= 1 - fraction
      }
      return {
        index,
        next,
        volumeM3,
        liveRemovedM3,
        type: partial ? 'partial' : type,
        fraction,
        volumeScale: scale,
        transition: next.curveId !== pixel.curveId,
      }
    }
    const planTreatment = (index: number, treatment: CastorTreatment): HarvestPlan | null => {
      const pixel = pixels[index]
      const next = clonePixel(pixel)
      const curve = curves.get(treatment.nextCurveId ?? '')
      if (treatment.method !== 'fraction' && curve) {
        next.age = treatment.resetAge ?? pixel.age
        next.curveId = curve.id
        applyYield(next, curve)
        if (next.volume > pixel.volume + EPSILON) {
          warn(
            `Treatment ${treatment.id} has a post-treatment yield above live inventory; affected entries were skipped instead of reporting negative removed volume.`,
          )
          return null
        }
        if (treatment.nextManagedCurveId) next.managedCurveId = treatment.nextManagedCurveId
        next.treatmentId = treatment.nextTreatmentId
        if (treatment.nextSilviculturalSystem !== undefined)
          next.attributes = { ...next.attributes, silvsystem: treatment.nextSilviculturalSystem }
        return {
          index,
          next,
          volumeM3: Math.max(0, pixel.volume - next.volume) * pixel.thlbHa,
          liveRemovedM3: Math.max(0, pixel.volume - next.volume) * pixel.thlbHa,
          type: 'partial',
          fraction: pixel.volume > 0 ? (pixel.volume - next.volume) / pixel.volume : 0,
          volumeScale: 1,
          transition: next.curveId !== pixel.curveId,
        }
      }
      const plan = planCut(index, 'live', treatment.removeFraction ?? 0)
      plan.type = 'partial'
      plan.next.treatmentId = treatment.nextTreatmentId
      if (treatment.nextSilviculturalSystem !== undefined)
        plan.next.attributes = { ...plan.next.attributes, silvsystem: treatment.nextSilviculturalSystem }
      if (treatment.resetAge !== undefined) plan.next.age = treatment.resetAge
      if (treatment.nextManagedCurveId) plan.next.managedCurveId = treatment.nextManagedCurveId
      return plan
    }
    const canCommit = (plans: HarvestPlan[]) => {
      const withdrawals = new Map<string, number>()
      for (const plan of plans) {
        if (!baseEligible(plan.index) || plan.volumeM3 <= EPSILON) return false
        const compartment = pixels[plan.index].compartment
        withdrawals.set(compartment, (withdrawals.get(compartment) ?? 0) + plan.liveRemovedM3)
      }
      for (const [compartment, amount] of withdrawals)
        if (amount > (stockBudget.get(compartment) ?? 0) + EPSILON) return false
      return ecaChangeAllowed(
        pixels,
        plans.map((plan) => ({ index: plan.index, eca: plan.next.eca })),
        ecaBudgets,
      )
    }
    const commit = (plans: HarvestPlan[], bag: ReportBag) => {
      if (result.harvestPixelList.length + periodEvents.length + plans.length > CASTOR_LIMITS.harvestEvents)
        throw new Error(
          `This run exceeds ${CASTOR_LIMITS.harvestEvents} harvested-pixel events; reduce the region or horizon.`,
        )
      commitEcaChange(
        pixels,
        plans.map((plan) => ({ index: plan.index, eca: plan.next.eca })),
        ecaBudgets,
      )
      for (const plan of plans) {
        const pixel = pixels[plan.index]
        const event: CastorHarvestPixelRow = {
          period,
          year,
          elapsedYears,
          pixelId: pixel.id,
          blockId: pixel.blockId,
          compartment: pixel.compartment,
          flowId: bag.flowId,
          type: plan.type,
          areaHa: pixel.thlbHa,
          volumeM3: plan.volumeM3,
          age: pixel.age,
          height: pixel.height,
          removeFraction: plan.fraction,
          x: pixel.x,
          y: pixel.y,
        }
        periodEvents.push(event)
        bag.events.push(event)
        bag.volumeM3 += event.volumeM3
        if (plan.transition) {
          bag.transitionArea += pixel.thlbHa
          bag.transitionVolume += plan.volumeM3
        }
        stockBudget.set(pixel.compartment, Math.max(0, (stockBudget.get(pixel.compartment) ?? 0) - plan.liveRemovedM3))
        if (plan.type === 'salvage' && plan.liveRemovedM3 > EPSILON)
          warn(
            'Full salvage entry resets live volume as in forestryCastor. Live-stock loss is charged to the retention floor; salvage harvest volume reports only dead timber.',
          )
        selected[plan.index] = 1
        harvestedYear[plan.index] = year
        harvestedVolume[plan.index] = plan.volumeM3
        if (plan.fraction === 1 && plan.next.height === 0) newClearcuts.push(plan.index)
        if (config.adjacencyHeight !== null && plan.next.height <= config.adjacencyHeight)
          for (const neighbor of neighbors.get(pixel.blockId) ?? []) newBlockedBlocks.add(neighbor)
        pixels[plan.index] = plan.next
        synchronizeLegacyAttributes(plan.next, culmination, protectedMask[plan.index])
        volumeScales[plan.index] = plan.volumeScale
      }
    }

    if (config.mode === 'queue') {
      // Committed treatments run once, outside the compartment loop. Their realised volume
      // is credited to the first matching live partition, avoiding source double counting.
      for (let index = 0; index < pixels.length; index++) {
        if (index % 1000 === 0) cancelled()
        const pixel = pixels[index]
        const treatment = treatments.get(pixel.treatmentId ?? '')
        if (
          !treatment ||
          !baseEligible(index) ||
          elapsedYears < (treatment.startYear ?? 0) ||
          elapsedYears > (treatment.stopYear ?? Infinity) ||
          !matchesPredicate(pixel, treatment.condition)
        )
          continue
        const plan = planTreatment(index, treatment)
        if (!plan || !canCommit([plan])) continue
        const matchingFlow = flows.find((flow) => flow.type === 'live' && flowMatches(pixel, flow))
        let bag: ReportBag | undefined = matchingFlow ? bags.get(matchingFlow.id) : undefined
        if (bag) {
          const remaining = Math.max(0, (bag.target ?? 0) - bag.volumeM3)
          if (plan.volumeM3 > remaining + EPSILON) continue
        }
        if (!bag) {
          const key = `treatment:${pixel.compartment}`
          bag = bags.get(key) ?? {
            compartment: pixel.compartment,
            flowId: key,
            type: 'partial',
            target: null,
            effectiveTarget: null,
            availableHa: 0,
            events: [],
            volumeM3: 0,
            transitionArea: 0,
            transitionVolume: 0,
          }
          bags.set(key, bag)
        }
        commit([plan], bag)
      }
      const blockValues = aggregatePriorities(pixels, config.blockPriority, (pixel) => pixel.blockId, culmination)
      if (
        config.zonePriority &&
        period > 1 &&
        config.zonePriority.refreshPeriods > 0 &&
        (period - 1) % config.zonePriority.refreshPeriods === 0
      )
        zoneValues = aggregatePriorities(
          pixels,
          config.zonePriority.order,
          (pixel) => pixel.zones[config.zonePriority!.zone] ?? '',
          culmination,
        )
      for (const flow of flows) {
        cancelled()
        const bag = bags.get(flow.id)!
        let remaining = Math.max(0, (bag.target ?? 0) - bag.volumeM3)
        if (flow.type === 'live') remaining = Math.min(remaining, stockBudget.get(flow.compartment) ?? 0)
        bag.effectiveTarget = bag.volumeM3 + remaining
        if (remaining <= EPSILON) continue
        const indices: number[] = []
        pixels.forEach((pixel, i) => {
          if (
            baseEligible(i) &&
            !pixel.treatmentId &&
            flowMatches(pixel, flow) &&
            (flow.type === 'salvage' ? pixel.salvageVolume : pixel.volume) > 0
          )
            indices.push(i)
        })
        indices.sort((ai, bi) => {
          const a = pixels[ai]
          const b = pixels[bi]
          const zone = config.zonePriority
            ? orderValues(
                zoneValues.get(a.zones[config.zonePriority.zone] ?? '') ?? {},
                zoneValues.get(b.zones[config.zonePriority.zone] ?? '') ?? {},
                config.zonePriority.order,
              )
            : 0
          const block = orderValues(
            blockValues.get(a.blockId) ?? {},
            blockValues.get(b.blockId) ?? {},
            config.blockPriority,
          )
          const ownA: Record<string, unknown> = {}
          const ownB: Record<string, unknown> = {}
          for (const { field } of config.blockPriority) {
            ownA[field] =
              field === 'culminationVolume'
                ? (culmination.get(a.curveId ?? '') ?? a.culminationVolume)
                : pixelValue(a, field)
            ownB[field] =
              field === 'culminationVolume'
                ? (culmination.get(b.curveId ?? '') ?? b.culminationVolume)
                : pixelValue(b, field)
          }
          return (
            zone ||
            block ||
            compareScalars(a.blockId, b.blockId) ||
            orderValues(ownA, ownB, config.blockPriority) ||
            a.id - b.id
          )
        })
        const visitedBlocks = new Set<string>()
        for (const [position, index] of indices.entries()) {
          if (position % 1000 === 0) cancelled()
          if (!baseEligible(index)) continue
          const pixel = pixels[index]
          let group = [index]
          if (config.harvestUnit === 'block') {
            if (visitedBlocks.has(pixel.blockId)) continue
            visitedBlocks.add(pixel.blockId)
            group = (blockIndices.get(pixel.blockId) ?? []).filter((i) => pixels[i].owned && pixels[i].thlbHa > 0)
            if (group.some((i) => !baseEligible(i) || pixels[i].treatmentId || !flowMatches(pixels[i], flow))) continue
          }
          const plans = group.map((i) => planCut(i, flow.type))
          const volume = plans.reduce((sum, plan) => sum + plan.volumeM3, 0)
          // Prefix rule: a harvest unit that would exceed the remaining target is not split.
          if (volume > remaining + EPSILON) break
          if (!canCommit(plans)) continue
          commit(plans, bag)
          remaining = Math.max(0, remaining - volume)
        }
      }
    } else {
      for (const [scheduleIndex, scheduled] of (project.schedule ?? []).entries()) {
        if (scheduled.period !== period) continue
        cancelled()
        const wanted = new Set<number>()
        for (const id of scheduled.pixelIds ?? []) {
          const index = idToIndex.get(id)
          if (index !== undefined) wanted.add(index)
        }
        for (const block of scheduled.blockIds ?? [])
          for (const index of blockIndices.get(block) ?? []) wanted.add(index)
        const planned = new Map<string, HarvestPlan[]>()
        for (const index of wanted) {
          const pixel = pixels[index]
          const treatment = treatments.get(pixel.treatmentId ?? '')
          const plan =
            treatment && scheduled.removeFraction === undefined && scheduled.type !== 'salvage'
              ? planTreatment(index, treatment)
              : planCut(index, scheduled.type ?? 'live', scheduled.removeFraction ?? 1)
          if (!plan) continue
          const group = planned.get(pixel.compartment) ?? []
          group.push(plan)
          planned.set(pixel.compartment, group)
        }
        for (const [compartment, plans] of planned) {
          const key = `schedule:${scheduleIndex}:${compartment}`
          const target = plans.reduce((sum, plan) => sum + plan.volumeM3, 0)
          const bag: ReportBag = {
            compartment,
            flowId: key,
            type: scheduled.type ?? (plans.some((plan) => plan.type === 'partial') ? 'partial' : 'live'),
            target,
            effectiveTarget: target,
            availableHa: plans
              .filter((plan) => baseEligible(plan.index))
              .reduce((sum, plan) => sum + pixels[plan.index].thlbHa, 0),
            events: [],
            volumeM3: 0,
            transitionArea: 0,
            transitionVolume: 0,
          }
          bags.set(key, bag)
          for (const plan of plans) if (canCommit([plan])) commit([plan], bag)
        }
      }
    }

    if (config.updateDistance && newClearcuts.length) {
      const tree = distanceTree(newClearcuts.map((index) => ({ x: pixels[index].x!, y: pixels[index].y! })))
      for (const pixel of pixels)
        pixel.distance = Math.sqrt(closestDistanceSquared(tree, pixel.x!, pixel.y!, pixel.distance ** 2))
    }
    pixels.forEach((pixel, index) => {
      if (newBlockedBlocks.has(pixel.blockId)) protectedMask[index] = 1
      if (protectedMask[index]) constraintCounts[index]++
      synchronizeLegacyAttributes(pixel, culmination, protectedMask[index])
    })
    result.zoneManagement.push(
      ...constraintReports(pixels, project.constraints, config, period, evaluation, 'after-harvest'),
    )
    const afterRows = stockRows(pixels, config, period, 'after-harvest', protectedMask)
    result.growingStockReport.push(...afterRows)
    for (const bag of bags.values()) {
      const volumeM3 = bag.volumeM3
      const areaHa = bag.events.reduce((sum, event) => sum + event.areaHa, 0)
      const blocks = new Set(bag.events.map((event) => event.blockId))
      const meanAge = areaHa > 0 ? bag.events.reduce((sum, event) => sum + event.age * event.areaHa, 0) / areaHa : null
      result.harvestReport.push({
        scenario: config.scenario,
        period,
        year,
        elapsedYears,
        compartment: bag.compartment,
        flowId: bag.flowId,
        type: bag.type,
        targetM3: bag.target,
        effectiveTargetM3: bag.effectiveTarget,
        volumeM3,
        areaHa,
        annualVolumeM3: volumeM3 / config.stepYears,
        annualAreaHa: areaHa / config.stepYears,
        meanAge,
        blockCount: blocks.size,
        meanBlockAreaHa: blocks.size ? areaHa / blocks.size : null,
        availableThlbHa: bag.availableHa,
        transitionAreaHa: bag.transitionArea,
        transitionVolumeM3: bag.transitionVolume,
        shortfallM3: bag.target === null ? null : Math.max(0, bag.target - volumeM3),
      })
    }
    result.harvestPixelList.push(...periodEvents)
    const blockEvents = new Map<string, CastorHarvestPixelRow[]>()
    const landingEvents = new Map<string, CastorHarvestPixelRow>()
    for (const event of periodEvents) {
      const key = JSON.stringify([event.blockId, event.compartment, event.type])
      const group = blockEvents.get(key) ?? []
      group.push(event)
      blockEvents.set(key, group)
      if (!landingEvents.has(event.blockId)) landingEvents.set(event.blockId, event)
    }
    for (const events of blockEvents.values()) {
      const areaHa = events.reduce((sum, event) => sum + event.areaHa, 0)
      result.harvestBlockList.push({
        period,
        year,
        elapsedYears,
        blockId: events[0].blockId,
        compartment: events[0].compartment,
        type: events[0].type,
        volumeM3: events.reduce((sum, event) => sum + event.volumeM3, 0),
        areaHa,
        meanHeight: areaHa > 0 ? events.reduce((sum, event) => sum + event.height * event.areaHa, 0) / areaHa : 0,
        pixelCount: events.length,
      })
    }
    for (const [blockId, event] of landingEvents) {
      const provided = providedLandings.get(blockId)
      const pixelId = provided ?? event.pixelId
      const pixel = pixels[idToIndex.get(pixelId)!]
      result.landings.push({
        period,
        year,
        elapsedYears,
        blockId,
        pixelId,
        x: pixel.x,
        y: pixel.y,
        source: provided === undefined ? 'harvest-pixel' : 'provided',
      })
    }
    for (const before of beforeRows) {
      const salvageEvents = periodEvents.filter(
        (event) => event.compartment === before.compartment && event.type === 'salvage',
      )
      result.salvageReport.push({
        period,
        year,
        elapsedYears,
        compartment: before.compartment,
        availableM3: before.salvageM3,
        harvestedM3: salvageEvents.reduce((sum, event) => sum + event.volumeM3, 0),
        remainingM3: afterRows.find((row) => row.compartment === before.compartment)?.salvageM3 ?? 0,
        areaHa: salvageEvents.reduce((sum, event) => sum + event.areaHa, 0),
      })
    }
    result.snapshots.push(
      makeSnapshot(pixels, config, period, harvestedYear, harvestedVolume, protectedMask, constraintCounts),
    )
    options.onProgress?.({
      phase: 'simulation',
      completed: period,
      total: config.periods,
      message: `Management period ${period} of ${config.periods} (${year})`,
    })
  }
  result.finalPixels = pixels
  result.uncertainty = yieldSensitivity(result.harvestReport, config, options)
  result.summary = {
    initialStockM3,
    finalStockM3: totalStock(pixels),
    harvestedM3: result.harvestPixelList.reduce((sum, event) => sum + event.volumeM3, 0),
    harvestedAreaHa: result.harvestPixelList.reduce((sum, event) => sum + event.areaHa, 0),
    targetM3: result.harvestReport.reduce((sum, row) => sum + (row.targetM3 ?? 0), 0),
    shortfallM3: result.harvestReport.reduce((sum, row) => sum + (row.shortfallM3 ?? 0), 0),
  }
  result.warnings = [...warnings]
  return result
}
