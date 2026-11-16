/**
 * Where on the road the covered estimate is spent. Attribution never re-prices anything: each row
 * of the cost breakdown (`costBreakdownRows.ts`) keeps exactly the amount the cost dialog shows, and
 * that amount is spread over the road's station intervals in proportion to the row's physical
 * driver. What has no place on the road (a lump sum, a percentage, a shared cost) is `unplaced`,
 * with the reason. For every row, the placed amounts plus the unplaced amount are the row's amount,
 * and the rows add up to the estimate's total (`costAttribution.test.ts` pins both).
 *
 * Intervals follow the station table (`stationReport.ts`): interval k runs from station k to
 * station k + 1, and carries the quantities of station k + 1 (`stationIndex`). An interval is
 * complete when the sections at both ends are.
 *
 * How each driver places its row:
 * - Section quantities (cut, a material's bank cut, shallow rock, overbreak, fill, surfacing,
 *   clearing) by the interval's own volume or area, on the same basis as the row's total
 *   (curvature-corrected where the correction is applied). An incomplete interval has none: its
 *   entry is null, never 0, and it takes no share of the amount.
 * - A haul line through the movements it prices: each movement's charge goes half to the interval
 *   at each end of the movement. An end at a site or pit goes to the interval containing the site's
 *   chainage, a sidecast end to the interval it is cut from. Unallocated borrow and waste (no site,
 *   default rate) follow each interval's borrow or waste less what moved to a site from or to it.
 * - Located items (culverts, stream crossings, a site's supply, disposal or preparation) whole, in
 *   the interval containing their chainage. A chainage exactly on a station goes to the interval
 *   ending there; the road's start goes to the first interval.
 * - Mobilization, contingency and shared crossing costs are unplaced.
 *
 * Material-course placement and both surfacing supply rows follow the interval's whole surfacing
 * volume: courses are not kept per interval, and which intervals a limited supply reaches is not
 * modelled. Fill priced by material follows where the plan places each material's fill, and the
 * rest by the interval's fill.
 *
 * Pure: no DOM or network access.
 */
import { haulCharge, type HaulCostLineSource } from './engineering'
import { placesSubgradeFill } from './fillPlacement'
import { lastResortSites } from './lastResortPits'
import type { CostBreakdownRows, CostDriver, CostPoint, CostRow } from './costBreakdownRows'
import type { HaulMovement } from './engineeringTypes'
import type { Alignment, GroundMaterial, RoadAnalysis, RoadStation } from './types'

const EPS = 1e-9
const UNCLASSIFIED = '__unclassified'

/** One station interval: from station `stationIndex − 1` to station `stationIndex`. */
export interface CostInterval {
  /** The station the interval ends at, whose section a "jump to" opens. */
  stationIndex: number
  start: number
  end: number
  lengthM: number
  /** Both end sections are complete, so its section quantities are known. */
  complete: boolean
}

/** One cost row spread along the road. Arrays are aligned with `CostAttribution.intervals`. */
export interface CostRowAttribution {
  rowId: string
  label: string
  /** The row's amount, exactly as the dialog shows it. */
  amount: number
  /** The amount placed on each interval; null where the row's driver is unknown (incomplete sections). */
  placed: (number | null)[]
  /** Sum of `placed`. */
  placedTotal: number
  /** The part of the amount with no place on the road: `amount − placedTotal`. */
  unplaced: number
  /** Why `unplaced` is not zero; absent when it is. */
  unplacedReason?: string
  /** The driver's unit, e.g. "bank m³", for showing a stretch's quantity beside its cost. Empty when none. */
  driverLabel: string
  /** The driver per interval (the row's own quantity where it has one); null where unknown or for a road-wide row. */
  quantity: (number | null)[]
}

export interface CostAttribution {
  intervals: CostInterval[]
  /** The breakdown's rows in the dialog's order, then contingency where there is one. */
  rows: CostRowAttribution[]
  /**
   * Per interval, everything placed there by every row. On an incomplete interval this is a lower
   * bound: only located items (culverts, crossings, sites, haul ends) can be placed there, while its
   * earthwork, surfacing and clearing are unknown. `costIntensityClasses` calls it unknown.
   */
  total: number[]
  /** The breakdown's total: every row's amount. */
  totalAmount: number
  placedTotal: number
  unplacedTotal: number
}

/** A row id, or `'total'` for all rows together. */
export type CostSeriesId = string | 'total'

/** Interval index ending at or after `chainage` (half-open (start, end]); null off the road. */
function intervalLocator(intervals: readonly CostInterval[]) {
  const first = intervals[0]?.start ?? 0
  const last = intervals.at(-1)?.end ?? 0
  return (chainage: number): number | null => {
    if (!intervals.length || !Number.isFinite(chainage)) return null
    if (chainage < first - 1e-6 || chainage > last + 1e-6) return null
    let lo = 0,
      hi = intervals.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (intervals[mid].end >= chainage - EPS) hi = mid
      else lo = mid + 1
    }
    return lo
  }
}

type DriverQuantity = {
  quantity: (number | null)[]
  /** Driver quantity that belongs to the row but has no interval (a movement end off the road). */
  offRoad: number
  offRoadReason: string
  unit: string
}

const isRoadWide = (driver: CostDriver): driver is Extract<CostDriver, { kind: 'roadWide' }> =>
  driver.kind === 'roadWide'

/** The context every driver reads, built once per attribution. */
function attributionContext(analysis: RoadAnalysis, alignment: Alignment) {
  const stations = analysis.stations
  const intervals: CostInterval[] = []
  for (let i = 1; i < stations.length; i++)
    intervals.push({
      stationIndex: i,
      start: stations[i - 1].chainage,
      end: stations[i].chainage,
      lengthM: stations[i].chainage - stations[i - 1].chainage,
      complete: stations[i - 1].complete && stations[i].complete,
    })
  const locate = intervalLocator(intervals)
  const intervalOfId = (id: string): number | null => {
    const match = /^interval-(\d+)$/.exec(id)
    if (!match) return null
    const k = Number(match[1]) - 1
    return k >= 0 && k < intervals.length ? k : null
  }
  /** The interval a movement end belongs to: its earthwork interval, else the one at its chainage. */
  const endInterval = (id: string, chainage: number) => intervalOfId(id) ?? locate(chainage)
  const applied = analysis.curvatureCorrection?.applied === true
  // With the curvature correction applied, the engineering bank cut takes each interval's
  // correction as a ratio over its average end areas (`calculateEngineering`).
  const preparation = (station: RoadStation, materialId?: string) =>
    (station.preparationAreas ?? [])
      .filter((p) => materialId === undefined || (p.materialId ?? UNCLASSIFIED) === materialId)
      .reduce((sum, p) => sum + p.areaM2, 0)
  const cutScale = intervals.map((interval, k) => {
    const a = stations[k],
      b = stations[k + 1]
    if (!applied || !interval.complete || b.cutVolumeM3 === null) return 1
    const averageEnd = ((a.cutAreaM2! + preparation(a) + b.cutAreaM2! + preparation(b)) * interval.lengthM) / 2
    return averageEnd > 1e-7 ? b.cutVolumeM3 / averageEnd : 1
  })
  const e = alignment.engineering
  const materials = new Map<string, GroundMaterial>((e?.materials ?? []).map((m) => [m.id, m]))
  const sites = e ? [...e.sites, ...lastResortSites(e)] : []
  return {
    analysis,
    alignment,
    stations,
    intervals,
    locate,
    endInterval,
    applied,
    cutScale,
    preparation,
    materials,
    sites,
  }
}
type Context = ReturnType<typeof attributionContext>

/** A section quantity per interval: null where the interval is incomplete. */
function perInterval(ctx: Context, value: (a: RoadStation, b: RoadStation, k: number) => number | null | undefined) {
  return ctx.intervals.map((interval, k) =>
    interval.complete ? (value(ctx.stations[k], ctx.stations[k + 1], k) ?? null) : null,
  )
}

function materialCutQuantity(
  ctx: Context,
  materialId: string,
  part: 'excavation' | 'shallowRock' | 'overbreak',
): (number | null)[] {
  const stations = ctx.analysis.engineering?.stations ?? []
  const areaOf = (k: number) => stations[k]?.materialAreas.find((m) => m.materialId === materialId)?.cutAreaM2 ?? 0
  const rockOf = (station: RoadStation, id = materialId) => station.rock?.areas.find((r) => r.materialId === id)
  const shallow = (a: RoadStation, b: RoadStation, k: number) =>
    (((rockOf(a)?.shallowAreaM2 ?? 0) + (rockOf(b)?.shallowAreaM2 ?? 0)) * ctx.intervals[k].lengthM * ctx.cutScale[k]) /
    2
  if (part === 'shallowRock') return perInterval(ctx, shallow)
  if (part === 'overbreak')
    return perInterval(ctx, (a, b, k) => {
      const ds = ctx.intervals[k].lengthM
      const deep = (id: string) => (((rockOf(a, id)?.deepAreaM2 ?? 0) + (rockOf(b, id)?.deepAreaM2 ?? 0)) * ds) / 2
      const own = deep(materialId)
      // Corrected overbreak is kept per interval for all rock together: share it by average end areas.
      const stored = stations[k + 1]?.deepRockVolumeM3
      if (!ctx.applied || stored == null) return own
      const ids = new Set([...(a.rock?.areas ?? []), ...(b.rock?.areas ?? [])].map((r) => r.materialId))
      const all = [...ids].reduce((sum, id) => sum + deep(id), 0)
      return all > EPS ? (stored * own) / all : own
    })
  return perInterval(ctx, (a, b, k) => {
    const bank =
      ((areaOf(k) + areaOf(k + 1) + ctx.preparation(a, materialId) + ctx.preparation(b, materialId)) *
        ctx.intervals[k].lengthM *
        ctx.cutScale[k]) /
      2
    return bank - shallow(a, b, k)
  })
}

/** Where the plan places each material's fill (`fillPlacementCost`), per interval. */
function fillPlacementQuantity(ctx: Context, materialId: string | null): DriverQuantity {
  const quantity = ctx.intervals.map((interval) => (interval.complete ? 0 : null))
  let offRoad = 0
  const priced = (material: GroundMaterial | undefined) =>
    material?.fillRate !== undefined && material.compactionFactor > 0 ? material : undefined
  const add = (k: number | null, material: GroundMaterial | undefined, compacted: number, bank: number | null) => {
    if (!(compacted > EPS)) return
    const rated = priced(material)
    if ((rated?.id ?? null) !== materialId) return
    const amount = rated ? (bank ?? compacted / rated.compactionFactor) : compacted
    if (k === null || quantity[k] === null) offRoad += amount
    else quantity[k]! += amount
  }
  const received = new Map<number, number>()
  for (const m of ctx.analysis.engineering?.movements ?? []) {
    if (!placesSubgradeFill(m)) continue
    const compacted = m.compactedVolumeM3 ?? m.transportedVolumeM3
    const k = ctx.endInterval(m.targetId, m.toChainage)
    if (k !== null) received.set(k, (received.get(k) ?? 0) + compacted)
    const id = m.materialId ?? ctx.sites.find((s) => s.id === m.sourceId)?.materialId ?? null
    add(k, id === null ? undefined : ctx.materials.get(id), compacted, m.kind === 'cut-to-fill' ? m.bankVolumeM3 : null)
  }
  const requirements = ctx.alignment.engineering?.fillRequirements
  ctx.intervals.forEach((interval, k) => {
    const fill = interval.complete ? ctx.stations[k + 1].fillVolumeM3 : null
    if (fill === null) return
    const left = fill - (received.get(k) ?? 0)
    if (left <= EPS) return
    const middle = (interval.start + interval.end) / 2
    const required = requirements?.find(
      (r) => r.layer === 'subgrade' && r.materialId !== undefined && middle >= r.start && middle < r.end,
    )
    add(k, required ? ctx.materials.get(required.materialId!) : undefined, left, null)
  })
  return {
    quantity,
    offRoad,
    offRoadReason: 'Fill placed off the known road',
    unit: materialId === null ? 'compacted m³' : 'bank m³ placed',
  }
}

const sumByEnd = (
  ctx: Context,
  movements: readonly HaulMovement[],
  end: 'source' | 'target',
  volume: (m: HaulMovement) => number,
) => {
  const totals = new Map<number, number>()
  for (const m of movements) {
    const k = end === 'source' ? ctx.endInterval(m.sourceId, m.fromChainage) : ctx.endInterval(m.targetId, m.toChainage)
    if (k !== null) totals.set(k, (totals.get(k) ?? 0) + volume(m))
  }
  return totals
}

function haulQuantity(ctx: Context, source: HaulCostLineSource): DriverQuantity {
  const quantity: (number | null)[] = ctx.intervals.map(() => 0)
  let offRoad = 0
  const place = (k: number | null, value: number) => {
    if (k === null) offRoad += value
    else quantity[k] = (quantity[k] ?? 0) + value
  }
  const movements = ctx.analysis.engineering?.movements ?? []
  const haul = ctx.alignment.engineering?.haul
  if (source.kind === 'transport' && haul) {
    for (const m of movements) {
      if (m.disposalMethod === 'sidecast' || m.externalUnresolved || m.volumeBasis !== source.basis) continue
      const charge = haulCharge(haul, m.distanceM)
      if (charge.category !== source.category) continue
      const value = source.part === 'distance' ? m.transportedVolumeM3 * charge.chargedKm : m.transportedVolumeM3
      // Half to each end of the movement.
      place(ctx.endInterval(m.sourceId, m.fromChainage), value / 2)
      place(ctx.endInterval(m.targetId, m.toChainage), value / 2)
    }
    return {
      quantity,
      offRoad,
      offRoadReason: 'Haul to or from a place off the road',
      unit: `${source.basis} ${source.part === 'distance' ? 'm³·km' : 'm³'}`,
    }
  }
  if (source.kind === 'sidecast') {
    for (const m of movements)
      if (m.disposalMethod === 'sidecast' && m.targetId === `sidecast:${source.rangeId}`)
        place(ctx.endInterval(m.sourceId, m.fromChainage), m.transportedVolumeM3)
    return { quantity, offRoad, offRoadReason: 'Sidecast from off the known road', unit: 'bank m³' }
  }
  if (source.kind === 'unallocated') {
    const engineeringStations = ctx.analysis.engineering?.stations ?? []
    const borrow = source.material === 'borrow'
    const moved = borrow
      ? sumByEnd(
          ctx,
          movements.filter((m) => m.kind === 'borrow' && !m.externalUnresolved),
          'target',
          (m) => m.compactedVolumeM3 ?? m.transportedVolumeM3,
        )
      : sumByEnd(
          ctx,
          movements.filter((m) => m.kind === 'waste'),
          'source',
          (m) => m.bankVolumeM3 ?? m.transportedVolumeM3,
        )
    const raw = ctx.intervals.map((interval, k) => {
      if (!interval.complete) return null
      const station = engineeringStations[k + 1]
      return (borrow ? station?.borrowVolumeM3 : station?.wasteVolumeM3) ?? null
    })
    const left = raw.map((value, k) => (value === null ? null : Math.max(0, value - (moved.get(k) ?? 0))))
    // Rounding can leave nothing apart from what went to sites: then follow the whole borrow or waste.
    const useful = left.some((value) => (value ?? 0) > EPS) ? left : raw
    return {
      quantity: useful,
      offRoad: 0,
      offRoadReason: '',
      unit: borrow ? 'compacted m³ borrow' : 'bank m³ waste',
    }
  }
  // Site supply, disposal and preparation are located points (`costBreakdownRows.ts`).
  return { quantity, offRoad, offRoadReason: '', unit: '' }
}

function driverQuantity(ctx: Context, row: CostRow): DriverQuantity {
  const driver = row.driver
  const section = (quantity: (number | null)[], unit: string): DriverQuantity => ({
    quantity,
    offRoad: 0,
    offRoadReason: '',
    unit,
  })
  switch (driver.kind) {
    case 'cut':
      return section(
        perInterval(ctx, (_a, b) => b.cutVolumeM3),
        row.unit,
      )
    case 'fill':
      return section(
        perInterval(ctx, (_a, b) => b.fillVolumeM3),
        row.unit,
      )
    case 'surfacing':
      return section(
        perInterval(ctx, (_a, b) => b.surfaceVolumeM3),
        'm³ surfacing',
      )
    case 'clearing':
      return section(
        perInterval(
          ctx,
          (a, b, k) =>
            (((a.clearingWidthM ?? a.leftDaylightM! + a.rightDaylightM!) +
              (b.clearingWidthM ?? b.leftDaylightM! + b.rightDaylightM!)) /
              2) *
            ctx.intervals[k].lengthM,
        ),
        'm² cleared',
      )
    case 'materialCut':
      return section(
        materialCutQuantity(ctx, driver.materialId, driver.part),
        driver.part === 'excavation' ? row.unit : 'bank m³',
      )
    case 'fillPlacement':
      return fillPlacementQuantity(ctx, driver.materialId)
    case 'haul':
      return haulQuantity(ctx, driver.source)
    case 'points':
    case 'roadWide':
      return section(
        ctx.intervals.map(() => null),
        '',
      )
  }
}

const negligible = (value: number, amount: number) => Math.abs(value) <= 1e-9 * Math.max(1, Math.abs(amount))

function attributePoints(
  ctx: Context,
  row: CostRow,
  driver: { unit: string; items: CostPoint[]; remainderReason?: string },
): CostRowAttribution {
  const placed: (number | null)[] = ctx.intervals.map(() => 0)
  const quantity: (number | null)[] = ctx.intervals.map(() => 0)
  let offRoad = false
  for (const item of driver.items) {
    const k = ctx.locate(item.chainage)
    if (k === null) {
      offRoad = true
      continue
    }
    placed[k] = placed[k]! + item.amount
    quantity[k] = quantity[k]! + 1
  }
  const placedTotal = placed.reduce<number>((sum, value) => sum + (value ?? 0), 0)
  const unplaced = row.amount - placedTotal
  return {
    rowId: row.id,
    label: row.item,
    amount: row.amount,
    placed,
    placedTotal,
    unplaced,
    ...(negligible(unplaced, row.amount)
      ? {}
      : {
          unplacedReason: !ctx.intervals.length
            ? 'The road has no station intervals'
            : (driver.remainderReason ?? (offRoad ? 'Beyond the road end' : 'Not traced to a place on the road')),
        }),
    driverLabel: driver.unit,
    quantity,
  }
}

function attributeRow(ctx: Context, row: CostRow): CostRowAttribution {
  const driver = row.driver
  if (driver.kind === 'points') return attributePoints(ctx, row, driver)
  if (isRoadWide(driver))
    return {
      rowId: row.id,
      label: row.item,
      amount: row.amount,
      placed: ctx.intervals.map(() => 0),
      placedTotal: 0,
      unplaced: row.amount,
      ...(row.amount !== 0 ? { unplacedReason: driver.reason } : {}),
      driverLabel: '',
      quantity: ctx.intervals.map(() => null),
    }
  const { quantity, offRoad, offRoadReason, unit } = driverQuantity(ctx, row)
  const known = quantity.reduce<number>((sum, value) => sum + (value ?? 0), 0)
  const weight = known + offRoad
  const spread = row.amount !== 0 && Math.abs(weight) > EPS
  const placed = quantity.map((value) => (value === null ? null : spread ? (row.amount * value) / weight : 0))
  const placedTotal = placed.reduce<number>((sum, value) => sum + (value ?? 0), 0)
  // With nothing off the road the whole amount is placed; the subtraction would only leave rounding.
  const unplaced = spread && offRoad === 0 ? 0 : row.amount - placedTotal
  return {
    rowId: row.id,
    label: row.item,
    amount: row.amount,
    placed,
    placedTotal,
    unplaced,
    ...(negligible(unplaced, row.amount)
      ? {}
      : {
          unplacedReason: !ctx.intervals.length
            ? 'The road has no station intervals'
            : spread
              ? offRoadReason
              : `No ${unit || 'quantity'} on a complete interval of the road`,
        }),
    driverLabel: unit,
    quantity,
  }
}

/**
 * Spreads every row of `breakdown` over the road's station intervals. `breakdown` must be
 * `costBreakdownRows` for the same `analysis` and `alignment`.
 */
export function attributeCosts({
  analysis,
  alignment,
  breakdown,
}: {
  analysis: RoadAnalysis
  alignment: Alignment
  breakdown: CostBreakdownRows
}): CostAttribution {
  const ctx = attributionContext(analysis, alignment)
  const rows = [...breakdown.rows, ...(breakdown.contingency ? [breakdown.contingency] : [])].map((row) =>
    attributeRow(ctx, row),
  )
  const total = ctx.intervals.map((_, k) => rows.reduce((sum, row) => sum + (row.placed[k] ?? 0), 0))
  return {
    intervals: ctx.intervals,
    rows,
    total,
    totalAmount: rows.reduce((sum, row) => sum + row.amount, 0),
    placedTotal: rows.reduce((sum, row) => sum + row.placedTotal, 0),
    unplacedTotal: rows.reduce((sum, row) => sum + row.unplaced, 0),
  }
}

type Series = {
  amounts: (number | null)[]
  quantity: (number | null)[] | null
  /** The interval's amount for this series is unknown or only partly known. */
  unknown: boolean[]
  placedTotal: number
}

function series(attribution: CostAttribution, id: CostSeriesId): Series {
  if (id === 'total')
    return {
      amounts: attribution.total,
      quantity: null,
      unknown: attribution.intervals.map((interval) => !interval.complete),
      placedTotal: attribution.placedTotal,
    }
  const row = attribution.rows.find((r) => r.rowId === id)
  if (!row) throw new RangeError(`No cost row "${id}"`)
  return {
    amounts: row.placed,
    quantity: row.driverLabel ? row.quantity : null,
    unknown: row.placed.map((value) => value === null),
    placedTotal: row.placedTotal,
  }
}

/** A fixed-length piece of the road and what one row (or the total) costs there. */
export interface CostStretch {
  start: number
  end: number
  /** The placed amount in the stretch; an interval split by a stretch boundary is split by length. */
  amount: number
  /** `amount` over the series' placed total (0 when nothing is placed). */
  share: number
  /** The row's driver quantity in the stretch, split the same way; null for the total or where none is known. */
  quantity: number | null
  /** Length of the stretch whose amount is unknown (incomplete sections). */
  unknownM: number
  /**
   * End chainage of the interval in the stretch with the highest cost per metre, and its station
   * (`stationIndex`), to jump to its section. Null when no interval in the stretch costs anything.
   */
  peakChainage: number | null
  peakStationIndex: number | null
}

/**
 * Groups the intervals into stretches `stretchLengthM` long from the road's start (the last one
 * ends at the road's end), in chainage order. The stretches' amounts add up to the series' placed
 * total. `id` is a row id or `'total'`.
 */
export function costStretches(attribution: CostAttribution, id: CostSeriesId, stretchLengthM: number): CostStretch[] {
  if (!(stretchLengthM > 0) || !Number.isFinite(stretchLengthM))
    throw new RangeError('Stretch length must be a positive number of metres')
  const { intervals } = attribution
  if (!intervals.length) return []
  const s = series(attribution, id)
  const roadStart = intervals[0].start,
    roadEnd = intervals.at(-1)!.end
  const count = Math.max(1, Math.ceil((roadEnd - roadStart) / stretchLengthM - 1e-9))
  const stretches = Array.from({ length: count }, (_, j) => ({
    start: roadStart + j * stretchLengthM,
    end: j === count - 1 ? roadEnd : roadStart + (j + 1) * stretchLengthM,
    amount: 0,
    quantity: null as number | null,
    unknownM: 0,
    peakPerM: -Infinity,
    peakChainage: null as number | null,
    peakStationIndex: null as number | null,
  }))
  const binOf = (chainage: number) =>
    Math.min(count - 1, Math.max(0, Math.floor((chainage - roadStart) / stretchLengthM)))
  intervals.forEach((interval, k) => {
    const amount = s.amounts[k],
      quantity = s.quantity?.[k] ?? null
    const perM = interval.lengthM > 0 && amount !== null ? amount / interval.lengthM : null
    const visit = (j: number, fraction: number, overlapM: number) => {
      const stretch = stretches[j]
      if (amount !== null) stretch.amount += amount * fraction
      if (quantity !== null) stretch.quantity = (stretch.quantity ?? 0) + quantity * fraction
      if (s.unknown[k]) stretch.unknownM += overlapM
      if (overlapM > 0 && perM !== null && amount !== 0 && !s.unknown[k] && perM > stretch.peakPerM) {
        stretch.peakPerM = perM
        stretch.peakChainage = interval.end
        stretch.peakStationIndex = interval.stationIndex
      }
    }
    if (!(interval.lengthM > 0)) {
      visit(binOf(interval.start), 1, 0)
      return
    }
    // The last stretch the interval reaches takes what is left, so the stretches add up exactly.
    const last = binOf(interval.end)
    let given = 0
    for (let j = binOf(interval.start); j <= last; j++) {
      const overlapM = Math.max(
        0,
        Math.min(interval.end, stretches[j].end) - Math.max(interval.start, stretches[j].start),
      )
      const fraction = j === last ? 1 - given : overlapM / interval.lengthM
      given += fraction
      visit(j, fraction, overlapM)
    }
  })
  return stretches.map(({ peakPerM: _peak, ...stretch }) => ({
    ...stretch,
    share: s.placedTotal !== 0 ? stretch.amount / s.placedTotal : 0,
  }))
}

/** The `limit` costliest stretches (all by default), costliest first; stretches costing nothing are left out. */
export function rankStretches(stretches: readonly CostStretch[], limit = Infinity): CostStretch[] {
  return stretches
    .filter((stretch) => stretch.amount > 0)
    .sort((a, b) => b.amount - a.amount || a.start - b.start)
    .slice(0, limit)
}

/**
 * Cost-per-metre classes relative to the road's average over its known length: the class of an
 * interval is the first bin whose `maxRatio` its cost per metre ÷ the average is below.
 */
export const COST_INTENSITY_BINS = [
  { index: 0, minRatio: 0, maxRatio: 0.5, label: 'Under half the road average' },
  { index: 1, minRatio: 0.5, maxRatio: 1, label: '0.5–1× the road average' },
  { index: 2, minRatio: 1, maxRatio: 2, label: '1–2× the road average' },
  { index: 3, minRatio: 2, maxRatio: 4, label: '2–4× the road average' },
  { index: 4, minRatio: 4, maxRatio: Infinity, label: '4× the road average or more' },
] as const
export type CostIntensityBin = (typeof COST_INTENSITY_BINS)[number]['index']
/** `unknown`: the interval's sections are incomplete. `none`: nothing is placed there. */
export type CostIntensityClass = CostIntensityBin | 'unknown' | 'none'
export const COST_INTENSITY_SPECIAL_LABELS: Record<'unknown' | 'none', string> = {
  unknown: 'Unknown: sections incomplete',
  none: 'No cost placed',
}

export interface CostIntensity {
  /** Cost per metre of each interval; null where unknown or the interval has no length. */
  perMetre: (number | null)[]
  classes: CostIntensityClass[]
  /** Placed amount on known intervals ÷ their length; null with no known length. */
  averagePerMetre: number | null
}

/**
 * Each interval's cost per metre for a row (or `'total'`) and its class against the road's average
 * $/m over known length. Unknown intervals are `unknown` and stay out of the average (for the total,
 * every incomplete interval, even one holding a located item); a zero-length interval is `none`.
 */
export function costIntensityClasses(attribution: CostAttribution, id: CostSeriesId): CostIntensity {
  const s = series(attribution, id)
  let amount = 0,
    length = 0
  attribution.intervals.forEach((interval, k) => {
    if (s.unknown[k]) return
    amount += s.amounts[k] ?? 0
    length += interval.lengthM
  })
  const averagePerMetre = length > 0 ? amount / length : null
  const perMetre = attribution.intervals.map((interval, k) =>
    s.unknown[k] || !(interval.lengthM > 0) ? null : (s.amounts[k] ?? 0) / interval.lengthM,
  )
  const classes = perMetre.map((value, k): CostIntensityClass => {
    if (s.unknown[k]) return 'unknown'
    if (value === null || Math.abs(s.amounts[k] ?? 0) <= EPS) return 'none'
    if (averagePerMetre === null || !(averagePerMetre > 0)) return 'none'
    const ratio = value / averagePerMetre
    return COST_INTENSITY_BINS.find((bin) => ratio < bin.maxRatio)?.index ?? 4
  })
  return { perMetre, classes, averagePerMetre }
}
