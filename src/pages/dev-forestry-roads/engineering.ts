/** User-defined materials and structures applied to supported, sampled road sections. */
import { surfacingSupplyCost } from './gravel'
import type {
  Alignment,
  AlignmentEngineering,
  Coordinate,
  Culvert,
  CulvertAnalysis,
  EngineeringAnalysis,
  EngineeringCosts,
  EngineeringStation,
  GroundMaterial,
  HaulMovement,
  HaulSettings,
  HaulSite,
  HaulSummary,
  MaterialQuantity,
  ResolvedGroundLayer,
  RoadAnalysis,
  RoadSettings,
  RoadStation,
  TerrainSource,
} from './types'
import { hasCompleteCoverage } from './analysisResult'
import { curveDesignAt, surfaceLayersAt } from './engine'
import { sectionCrossfall, templateAt } from './templates'
import { solveMaterialAllocation, type AllocationParcel } from './materialAllocation'
import { materialDemandKey, requiredFillAt } from './allocationPolicy'

const EPS = 1e-7
const R = 6371008.8
const RAD = Math.PI / 180
const finite = (n: number): number | null => (Number.isFinite(n) ? n : null)
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n))

/** Geometry is supplied by the same compiled path/profile used for road stationing. */
export interface EngineeringGeometry {
  positionAt(chainage: number): { coordinate: Coordinate; bearing: number }
  offsetCoordinate(point: Coordinate, bearing: number, distance: number): Coordinate
  designElevationAt(chainage: number): number | null
  widthsAt(chainage: number): { leftWidth: number; rightWidth: number }
}

function activeLayers(alignment: Alignment, chainage: number, length: number): ResolvedGroundLayer[] {
  const e = alignment.engineering!
  // The last cross-section uses the approach-side geology; an adjacent range that
  // starts at the road end must not be counted alongside the preceding material.
  const lookup = Math.abs(chainage - length) < 1e-6 ? Math.max(0, chainage - 1e-7) : chainage
  return e.strata
    .filter((s) => lookup >= s.start && lookup < s.end)
    .sort((a, b) => a.topDepthM - b.topDepthM)
    .map((s) => {
      const m = e.materials.find((m) => m.id === s.materialId)!
      return {
        id: s.id,
        materialId: s.materialId,
        name: m.name,
        color: m.color,
        topDepthM: s.topDepthM,
        bottomDepthM: s.bottomDepthM,
      }
    })
}

/** Exact integral of max(linear ground-minus-formation depth − horizon, 0). */
function cutBelowDepth(station: RoadStation, depth: number): number {
  let area = 0
  const section = station.section
  for (let i = 1; i < section.length; i++) {
    const a = section[i - 1],
      b = section[i]
    if (a.design === null || b.design === null || a.ground === null || b.ground === null) continue
    const pa = a.preparedGround === undefined ? a.ground : a.preparedGround,
      pb = b.preparedGround === undefined ? b.ground : b.preparedGround
    if (pa === null || pb === null) continue
    const da = a.ground - a.design - depth,
      db = b.ground - b.design - depth,
      ca = pa - a.design,
      cb = pb - b.design,
      width = b.offset - a.offset
    // Clip classified excavation by prepared ground, but keep depth horizons referenced to
    // original ground. Include all linear breakpoints before integrating the clipped shape.
    const knots = [0, 1]
    for (const [v0, v1] of [
      [da, db],
      [ca, cb],
      [da - ca, db - cb],
    ])
      if (v0 * v1 < 0) knots.push(v0 / (v0 - v1))
    knots.sort((x, y) => x - y)
    const value = (t: number) => Math.max(0, Math.min(da + (db - da) * t, ca + (cb - ca) * t))
    for (let k = 1; k < knots.length; k++)
      area += ((value(knots[k - 1]) + value(knots[k])) * (knots[k] - knots[k - 1]) * width) / 2
  }
  return area
}

type MaterialCut = { materialId: string; bank: number; usable: number; unusable: number; factor: number }
type EarthworkInterval = AllocationParcel
type Source = {
  id: string
  chainage: number
  run: number
  entries: Array<MaterialCut & { remaining: number }>
  available: number
}
type Run = { start: number; end: number }

function emptyHaul(enabled: boolean, complete: boolean): HaulSummary {
  return {
    enabled,
    freeHaulM3: 0,
    overhaulM3: 0,
    endHaulM3: 0,
    haulM3Km: 0,
    wasteFreeHaulBankM3: 0,
    wasteOverhaulBankM3: 0,
    wasteEndHaulBankM3: 0,
    wasteHaulM3Km: 0,
    borrowCompactedM3: 0,
    wasteBankM3: 0,
    unallocatedBorrowM3: 0,
    unallocatedWasteM3: 0,
    complete,
  }
}

/**
 * CAD per transported m³ moved `distanceM`: free haul is charged over its whole distance at the
 * free-haul rate; overhaul and endhaul only beyond the free-haul distance, each at its own rate;
 * every class adds its loading rate. This is the piecewise haul-cost curve shown with the rates.
 */
export function haulUnitCost(h: HaulSettings, distanceM: number) {
  const charge = haulCharge(h, distanceM)
  return charge.chargedKm * h[charge.rateKey] + h[charge.loadingRateKey]
}

const HAUL_CLASS_RATES = {
  freehaul: { rateKey: 'freeHaulRate', loadingRateKey: 'freeHaulLoadingRate' },
  overhaul: { rateKey: 'overhaulRate', loadingRateKey: 'overhaulLoadingRate' },
  endhaul: { rateKey: 'endHaulRate', loadingRateKey: 'endHaulLoadingRate' },
} as const satisfies Record<
  HaulMovement['category'],
  { rateKey: keyof HaulSettings; loadingRateKey: keyof HaulSettings }
>

/** The haul class of a movement `distanceM` long and the kilometres its distance rate is charged over. */
function haulCharge(h: HaulSettings, distanceM: number) {
  const category: HaulMovement['category'] =
    distanceM <= h.freeHaulDistanceM + EPS
      ? 'freehaul'
      : distanceM <= h.overhaulDistanceM + EPS
        ? 'overhaul'
        : 'endhaul'
  const chargedKm =
    category === 'freehaul' ? Math.max(0, distanceM) / 1000 : Math.max(0, distanceM - h.freeHaulDistanceM) / 1000
  return { category, chargedKm, ...HAUL_CLASS_RATES[category] }
}

/**
 * One priced line of the haul, borrow, waste and site-preparation cost: `amount = quantity × rate`
 * exactly. A null `rateKey` is a site's own rate or fixed cost rather than a haul setting.
 */
export interface HaulCostLine {
  id: string
  group: 'haul' | 'borrow' | 'waste' | 'sitePreparation'
  item: string
  quantity: number
  unit: string
  rate: number
  rateUnit: string
  rateKey: keyof HaulSettings | null
  amount: number
}

const HAUL_CLASS_NAMES: Record<HaulMovement['category'], string> = {
  freehaul: 'Free haul',
  overhaul: 'Overhaul',
  endhaul: 'Endhaul',
}

/**
 * Splits the allocated haul cost into lines whose quantity × rate is their amount: per haul class
 * and volume basis, its distance charge (m³·km) and its loading (m³) — compacted fill/borrow and
 * bank waste are never added together — then borrow and waste per site at the site's rate, the
 * unallocated remainder at the default rate, and each used site's preparation cost. The lines of a
 * group sum to that group's cost in `EngineeringCosts`.
 */
export function haulCostLines(e: AlignmentEngineering, result: EngineeringAnalysis): HaulCostLine[] {
  const h = e.haul,
    lines: HaulCostLine[] = []
  if (!h.enabled) return lines
  for (const basis of ['compacted', 'bank'] as const) {
    const label = basis === 'compacted' ? 'fill and borrow' : 'waste'
    for (const category of ['freehaul', 'overhaul', 'endhaul'] as const) {
      let work = 0,
        volume = 0
      for (const m of result.movements) {
        if (m.disposalMethod === 'sidecast' || m.externalUnresolved) continue
        if (m.volumeBasis !== basis) continue
        const charge = haulCharge(h, m.distanceM)
        if (charge.category !== category) continue
        work += m.transportedVolumeM3 * charge.chargedKm
        volume += m.transportedVolumeM3
      }
      const { rateKey, loadingRateKey } = HAUL_CLASS_RATES[category]
      if (work > EPS)
        lines.push({
          id: `haul-${category}-${basis}`,
          group: 'haul',
          item: `${HAUL_CLASS_NAMES[category]} · ${label}`,
          quantity: work,
          unit: `${basis} m³·km`,
          rate: h[rateKey],
          rateUnit: '$/m³·km',
          rateKey,
          amount: work * h[rateKey],
        })
      if (volume > EPS)
        lines.push({
          id: `loading-${category}-${basis}`,
          group: 'haul',
          item: `${HAUL_CLASS_NAMES[category]} loading · ${label}`,
          quantity: volume,
          unit: `${basis} m³`,
          rate: h[loadingRateKey],
          rateUnit: '$/m³',
          rateKey: loadingRateKey,
          amount: volume * h[loadingRateKey],
        })
    }
  }
  const used: HaulSite[] = []
  for (const kind of ['borrow', 'waste'] as const) {
    const basis = kind === 'borrow' ? 'compacted' : 'bank'
    for (const site of e.sites) {
      if (site.kind !== kind) continue
      const volume = result.movements
        .filter(
          (m) =>
            !m.externalUnresolved &&
            !m.disposalMethod &&
            m.kind === kind &&
            (kind === 'borrow' ? m.sourceId : m.targetId) === site.id,
        )
        .reduce((sum, m) => sum + m.transportedVolumeM3, 0)
      if (volume <= EPS) continue
      used.push(site)
      lines.push({
        id: `${kind}-${site.id}`,
        group: kind,
        item: `${kind === 'borrow' ? 'Borrow supply' : 'Waste disposal'} · ${site.name}`,
        quantity: volume,
        unit: `${basis} m³`,
        rate: site.unitRate,
        rateUnit: '$/m³',
        rateKey: null,
        amount: volume * site.unitRate,
      })
    }
    const unallocated = kind === 'borrow' ? result.haul.unallocatedBorrowM3 : result.haul.unallocatedWasteM3
    const rateKey = kind === 'borrow' ? 'borrowRate' : 'wasteRate'
    if (unallocated > EPS && result.haul.allocationMethod !== 'economic')
      lines.push({
        id: `${kind}-unallocated`,
        group: kind,
        item: `${kind === 'borrow' ? 'Borrow supply' : 'Waste disposal'} · no site, default rate`,
        quantity: unallocated,
        unit: `${basis} m³`,
        rate: h[rateKey],
        rateUnit: '$/m³',
        rateKey,
        amount: unallocated * h[rateKey],
      })
  }
  for (const site of used)
    lines.push({
      id: `site-${site.id}`,
      group: 'sitePreparation',
      item: `Site preparation · ${site.name}`,
      quantity: 1,
      unit: 'lump sum',
      rate: site.fixedCost,
      rateUnit: '$',
      rateKey: null,
      amount: site.fixedCost,
    })
  for (const range of h.sidecastRanges ?? []) {
    const volume = result.movements
      .filter((m) => m.disposalMethod === 'sidecast' && m.targetId === `sidecast:${range.id}`)
      .reduce((sum, m) => sum + m.transportedVolumeM3, 0)
    if (volume > EPS)
      lines.push({
        id: `sidecast-${range.id}`,
        group: 'waste',
        item: `Permitted sidecast · ${range.start}–${range.end} m`,
        quantity: volume,
        unit: 'bank m³',
        rate: range.unitRate,
        rateUnit: '$/bank m³',
        rateKey: null,
        amount: volume * range.unitRate,
      })
  }
  return lines
}

function economicHaul(alignment: Alignment, intervals: EarthworkInterval[], coverageComplete: boolean) {
  const e = alignment.engineering!,
    h = e.haul
  const summary = emptyHaul(h.enabled, coverageComplete)
  summary.allocationMethod = 'economic'
  summary.sidecastBankM3 = 0
  const movements: HaulMovement[] = []
  const costs = { haul: 0, borrow: 0, waste: 0, sitePreparation: 0 }
  const warnings: string[] = []
  if (!h.enabled) {
    summary.complete = false
    summary.optimizationStatus = 'not-requested'
    warnings.push(
      'Material requirements or construction constraints are entered, but haul allocation is disabled. Material suitability and constructible movements have not been established.',
    )
    return { summary, movements, costs, warnings }
  }
  const solved = solveMaterialAllocation(e, intervals, (d) => haulUnitCost(h, d), {
    deferExternal: h.deferExternalSupply,
  })
  summary.optimizationStatus = h.deferExternalSupply ? 'not-requested' : solved.status
  if (solved.status === 'infeasible') {
    summary.complete = false
    summary.unallocatedBorrowM3 = intervals.reduce(
      (sum, p) => sum + p.fill + (p.demands ?? []).filter((d) => !d.subgrade).reduce((s, d) => s + d.volumeM3, 0),
      0,
    )
    summary.unallocatedWasteM3 = intervals.reduce((sum, p) => sum + p.cut.reduce((s, m) => s + m.bank, 0), 0)
    warnings.push(
      `${solved.reason} No economic material prescription or movement cost was adopted; zero movement costs do not mean the work is free.`,
    )
    return { summary, movements, costs, warnings }
  }
  summary.objectiveCost = solved.objectiveCost ?? undefined
  costs.sitePreparation = e.sites
    .filter((s) => solved.usedSiteIds.includes(s.id))
    .reduce((sum, s) => sum + s.fixedCost, 0)
  for (const flow of solved.movements) {
    const { supplyCost, disposalCost, ...input } = flow
    const { category } = haulCharge(h, flow.distanceM)
    const haulCost =
      flow.disposalMethod === 'sidecast' || flow.externalUnresolved
        ? 0
        : flow.transportedVolumeM3 * haulUnitCost(h, flow.distanceM)
    movements.push({ ...input, id: `haul-${movements.length + 1}`, category, haulCost })
    costs.haul += haulCost
    costs.borrow += flow.transportedVolumeM3 * supplyCost
    costs.waste += flow.transportedVolumeM3 * disposalCost
    if (flow.kind === 'borrow') summary.borrowCompactedM3 += flow.transportedVolumeM3
    if (flow.kind === 'waste') summary.wasteBankM3 += flow.transportedVolumeM3
    if (flow.externalUnresolved) {
      if (flow.kind === 'borrow') summary.unallocatedBorrowM3 += flow.transportedVolumeM3
      else summary.unallocatedWasteM3 += flow.transportedVolumeM3
      continue
    }
    if (flow.disposalMethod === 'sidecast') {
      summary.sidecastBankM3! += flow.transportedVolumeM3
      continue
    }
    if (flow.volumeBasis === 'bank') {
      summary.wasteHaulM3Km += (flow.transportedVolumeM3 * flow.distanceM) / 1000
      if (category === 'freehaul') summary.wasteFreeHaulBankM3 += flow.transportedVolumeM3
      else if (category === 'overhaul') summary.wasteOverhaulBankM3 += flow.transportedVolumeM3
      else summary.wasteEndHaulBankM3 += flow.transportedVolumeM3
    } else {
      summary.haulM3Km += (flow.transportedVolumeM3 * flow.distanceM) / 1000
      if (category === 'freehaul') summary.freeHaulM3 += flow.transportedVolumeM3
      else if (category === 'overhaul') summary.overhaulM3 += flow.transportedVolumeM3
      else summary.endHaulM3 += flow.transportedVolumeM3
    }
  }
  summary.complete = coverageComplete && summary.unallocatedBorrowM3 < EPS && summary.unallocatedWasteM3 < EPS
  if (!coverageComplete)
    warnings.push(
      'Economic allocation applies only inside each continuous supported run; material is not transferred across missing terrain or daylight.',
    )
  warnings.push(
    h.deferExternalSupply
      ? 'Internal-use material plan only: external supply/disposal parcels remain explicitly unresolved for connected network pricing; this is not a complete economic prescription.'
      : `Economic material flow solved to optimality within ${solved.variables} variables and ${solved.constraints} constraints, including fixed site openings. It does not schedule equipment or validate site permissions.`,
  )
  return { summary, movements, costs, warnings }
}

/**
 * Reproducible allocation scenario: fill intervals in chainage order draw from the
 * nearest remaining cut in the same supported run. It is not a global optimizer.
 */
function allocateHaul(alignment: Alignment, intervals: EarthworkInterval[], coverageComplete: boolean) {
  const e = alignment.engineering!,
    h = e.haul
  if (
    h.allocation === 'economic' ||
    h.deferExternalSupply ||
    e.fillRequirements?.length ||
    h.directionRanges?.length ||
    h.sidecastRanges?.length ||
    intervals.some((p) => p.demands?.length)
  )
    return economicHaul(alignment, intervals, coverageComplete)
  const summary = emptyHaul(h.enabled, coverageComplete)
  const movements: HaulMovement[] = [],
    warnings: string[] = []
  const costs = { haul: 0, borrow: 0, waste: 0, sitePreparation: 0 }
  if (!h.enabled) return { summary, movements, costs, warnings }
  const runs = new Map<number, Run>()
  for (const p of intervals) {
    const run = runs.get(p.run)
    if (run) run.end = p.end
    else runs.set(p.run, { start: p.start, end: p.end })
  }
  const sources: Source[] = intervals
    .filter((p) => p.cut.some((m) => m.usable > EPS))
    .map((p) => ({
      id: p.id,
      chainage: p.chainage,
      run: p.run,
      entries: p.cut.filter((m) => m.usable > EPS).map((m) => ({ ...m, remaining: m.usable })),
      available: p.cut.reduce((sum, m) => sum + m.usable, 0),
    }))
  const availableSites = e.sites
    .filter((s) => s.enabled !== false)
    .map((s) => ({ ...s, remaining: s.capacityM3 ?? Infinity }))
  const usedSites = new Set<string>()
  const movement = (input: Omit<HaulMovement, 'id' | 'category' | 'haulCost'>) => {
    if (movements.length >= 20000)
      throw new Error('Haul allocation exceeds 20,000 movements; split the road or simplify the material layers.')
    const { category } = haulCharge(h, input.distanceM)
    const haulCost = input.transportedVolumeM3 * haulUnitCost(h, input.distanceM)
    const row: HaulMovement = { ...input, id: `haul-${movements.length + 1}`, category, haulCost }
    movements.push(row)
    costs.haul += haulCost
    if (input.volumeBasis === 'bank') {
      summary.wasteHaulM3Km += (input.transportedVolumeM3 * input.distanceM) / 1000
      if (category === 'freehaul') summary.wasteFreeHaulBankM3 += input.transportedVolumeM3
      else if (category === 'overhaul') summary.wasteOverhaulBankM3 += input.transportedVolumeM3
      else summary.wasteEndHaulBankM3 += input.transportedVolumeM3
    } else {
      summary.haulM3Km += (input.transportedVolumeM3 * input.distanceM) / 1000
      if (category === 'freehaul') summary.freeHaulM3 += input.transportedVolumeM3
      else if (category === 'overhaul') summary.overhaulM3 += input.transportedVolumeM3
      else summary.endHaulM3 += input.transportedVolumeM3
    }
  }
  const siteFlow = (
    kind: HaulSite['kind'],
    interval: Pick<EarthworkInterval, 'id' | 'chainage' | 'run'>,
    amount: number,
    materialId: string | null,
    compactedPerBank: number | null,
  ) => {
    const run = runs.get(interval.run)!
    let remaining = amount
    const candidates = availableSites.filter((s) => {
      // Mandatory calculation stations are rounded to micrometres in analyzeRoad.
      // Match that registration for reachability, keeping entered chainage for haul distances.
      const station = Math.round(s.chainage * 1e6) / 1e6
      return s.kind === kind && station >= run.start - EPS && station <= run.end + EPS
    })
    const compare = (a: (typeof candidates)[number], b: (typeof candidates)[number]) => {
      const da = Math.abs(a.chainage - interval.chainage) + a.accessDistanceM
      const db = Math.abs(b.chainage - interval.chainage) + b.accessDistanceM
      if (h.siteSelection === 'delivered-cost') {
        // Compare this interval's available batches, including setup only if unused.
        // Chainage-order allocation is deterministic, not a global haul solution.
        const rate = (s: typeof a, d: number) =>
          s.remaining <= EPS
            ? Infinity
            : s.unitRate +
              haulUnitCost(h, d) +
              (usedSites.has(s.id) ? 0 : s.fixedCost) / Math.min(remaining, s.remaining)
        const difference = rate(a, da) - rate(b, db)
        if (Number.isFinite(difference) && Math.abs(difference) > EPS) return difference
        if (a.remaining <= EPS && b.remaining > EPS) return 1
        if (b.remaining <= EPS && a.remaining > EPS) return -1
      }
      return da - db || a.id.localeCompare(b.id)
    }
    while (remaining > EPS) {
      // A capacity-limited cheap source changes the next batch size and setup cost per m³.
      const site = candidates.filter((s) => s.remaining > EPS).sort(compare)[0]
      if (!site) break
      const volume = Math.min(remaining, site.remaining)
      if (volume <= EPS) continue
      site.remaining -= volume
      remaining -= volume
      costs[kind] += volume * site.unitRate
      if (!usedSites.has(site.id)) {
        costs.sitePreparation += site.fixedCost
        usedSites.add(site.id)
      }
      movement({
        kind,
        sourceId: kind === 'borrow' ? site.id : interval.id,
        targetId: kind === 'borrow' ? interval.id : site.id,
        materialId,
        fromChainage: kind === 'borrow' ? site.chainage : interval.chainage,
        toChainage: kind === 'borrow' ? interval.chainage : site.chainage,
        distanceM: Math.abs(site.chainage - interval.chainage) + site.accessDistanceM,
        bankVolumeM3: kind === 'waste' ? volume : null,
        compactedVolumeM3: kind === 'borrow' ? volume : compactedPerBank === null ? null : volume * compactedPerBank,
        transportedVolumeM3: volume,
        volumeBasis: kind === 'borrow' ? 'compacted' : 'bank',
      })
    }
    if (kind === 'borrow') summary.unallocatedBorrowM3 += Math.max(0, remaining)
    else summary.unallocatedWasteM3 += Math.max(0, remaining)
    costs[kind] += Math.max(0, remaining) * (kind === 'borrow' ? h.borrowRate : h.wasteRate)
  }
  let comparisons = 0
  for (const demand of intervals) {
    let remaining = demand.fill
    while (remaining > EPS) {
      let nearest: Source | undefined,
        nearestDistance = Infinity
      for (const source of sources) {
        if (++comparisons > 20000000)
          throw new Error('Haul allocation budget exceeded; split this road into shorter design sections.')
        if (source.run !== demand.run || source.available <= EPS) continue
        const d = Math.abs(source.chainage - demand.chainage)
        if (d < nearestDistance - EPS) {
          nearest = source
          nearestDistance = d
        }
      }
      if (!nearest) break
      for (const material of nearest.entries) {
        const volume = Math.min(remaining, material.remaining)
        if (volume <= EPS) continue
        material.remaining -= volume
        nearest.available -= volume
        remaining -= volume
        movement({
          kind: 'cut-to-fill',
          sourceId: nearest.id,
          targetId: demand.id,
          materialId: material.materialId,
          fromChainage: nearest.chainage,
          toChainage: demand.chainage,
          distanceM: nearestDistance,
          bankVolumeM3: volume / material.factor,
          compactedVolumeM3: volume,
          transportedVolumeM3: volume,
          volumeBasis: 'compacted',
        })
        if (remaining <= EPS) break
      }
    }
    if (remaining > EPS) {
      summary.borrowCompactedM3 += remaining
      siteFlow('borrow', demand, remaining, null, null)
    }
  }
  for (const p of intervals)
    for (const material of p.cut)
      if (material.unusable > EPS) {
        summary.wasteBankM3 += material.unusable
        siteFlow('waste', p, material.unusable, material.materialId, null)
      }
  for (const source of sources)
    for (const material of source.entries)
      if (material.remaining > EPS) {
        const bank = material.remaining / material.factor
        summary.wasteBankM3 += bank
        siteFlow('waste', source, bank, material.materialId, material.factor)
      }
  summary.complete = coverageComplete && summary.unallocatedBorrowM3 < EPS && summary.unallocatedWasteM3 < EPS
  if (!coverageComplete)
    warnings.push(
      'Haul is allocated separately within each continuously supported road section; material is not moved across a terrain/daylight gap.',
    )
  if (summary.unallocatedBorrowM3 > EPS || summary.unallocatedWasteM3 > EPS)
    warnings.push(
      'Some borrow/waste has no reachable site capacity. Default supply/disposal rates are included, but its unknown haul distance and haul cost are excluded.',
    )
  return { summary, movements, costs, warnings }
}

function planarOffset(origin: Coordinate, coordinate: Coordinate): [number, number] {
  return [(coordinate[0] - origin[0]) * RAD * R * Math.cos(origin[1] * RAD), (coordinate[1] - origin[1]) * RAD * R]
}

function interpolateSection(station: RoadStation, offset: number): number | null {
  for (let i = 1; i < station.section.length; i++) {
    const a = station.section[i - 1],
      b = station.section[i]
    if (offset < a.offset - EPS || offset > b.offset + EPS || a.design === null || b.design === null) continue
    const t = (offset - a.offset) / (b.offset - a.offset)
    return a.design * (1 - t) + b.design * t
  }
  return null
}

function calculateCulvert(
  c: Culvert,
  alignment: Alignment,
  analysis: RoadAnalysis,
  terrain: TerrainSource,
  geometry: EngineeringGeometry,
): CulvertAnalysis {
  const location = geometry.positionAt(c.chainage),
    angle = (location.bearing + 90 + c.skewDegrees + 360) % 360
  const start = geometry.offsetCoordinate(location.coordinate, angle, -c.lengthM / 2),
    end = geometry.offsetCoordinate(location.coordinate, angle, c.lengthM / 2)
  const station = analysis.stations.reduce((nearest, p) =>
    Math.abs(p.chainage - c.chainage) < Math.abs(nearest.chainage - c.chainage) ? p : nearest,
  )
  const cosine = Math.cos(c.skewDegrees * RAD)
  // A centred barrel must reach the farther daylight on BOTH ends; a summed span is unsafe for asymmetric sections.
  const requiredLengthM =
    station.complete && station.leftDaylightM !== null && station.rightDaylightM !== null
      ? (2 * Math.max(station.leftDaylightM, station.rightDaylightM)) / cosine
      : null
  const knownInverts = c.inletInvertM !== null && c.outletInvertM !== null
  const warnings: string[] = []
  let associationResolved = true
  if (c.sourceFeatureId) {
    const nearest = analysis.crossings
      .filter((crossing) => crossing.featureId === c.sourceFeatureId)
      .reduce<
        (typeof analysis.crossings)[number] | undefined
      >((best, crossing) => (!best || Math.abs(crossing.chainage - c.chainage) < Math.abs(best.chainage - c.chainage) ? crossing : best), undefined)
    if (!nearest) {
      associationResolved = false
      warnings.push(
        'The associated feature has no current road intersection. Review the recorded culvert station and crossing association.',
      )
    } else {
      const separation = Math.abs(nearest.chainage - c.chainage)
      if (separation > 1 + EPS) {
        associationResolved = false
        warnings.push(
          `The nearest associated crossing is at ${nearest.chainage.toFixed(2)} m, ${separation.toFixed(2)} m from the entered culvert station. Review the recorded station and crossing association.`,
        )
      }
    }
  }
  if (!knownInverts) warnings.push('Enter both surveyed/design invert elevations to calculate pipe grade and cover.')
  if (!knownInverts)
    warnings.push('Pipe quantity and cost provisionally use horizontal span until both inverts are entered.')
  if (requiredLengthM === null) warnings.push('Required span is unknown because the road daylight is unresolved.')
  else if (c.lengthM + EPS < requiredLengthM)
    warnings.push(`Barrel is shorter than the centred daylight span (${requiredLengthM.toFixed(2)} m).`)
  const distances = Array.from({ length: 41 }, (_, i) => (c.lengthM * i) / 40)
  distances.push(c.lengthM / 2)
  for (const value of [-station.leftWidth / cosine, station.rightWidth / cosine])
    if (Math.abs(value) <= c.lengthM / 2) distances.push(c.lengthM / 2 + value)
  const candidates = analysis.stations.filter(
    (s) => Math.abs(s.chainage - c.chainage) <= c.lengthM + 2 * (analysis.stations[1]?.chainage ?? 10),
  )
  // Closest-segment initialization followed by projection onto the actual fitted path.
  const project = (coordinate: Coordinate) => {
    let best = Infinity,
      chainage = c.chainage
    for (let i = 1; i < candidates.length; i++) {
      const a = candidates[i - 1],
        b = candidates[i],
        av = planarOffset(coordinate, a.coordinate),
        bv = planarOffset(coordinate, b.coordinate)
      const x = bv[0] - av[0],
        y = bv[1] - av[1],
        length2 = x * x + y * y
      const t = length2 > EPS ? clamp(-(av[0] * x + av[1] * y) / length2, 0, 1) : 0
      const d = (av[0] + t * x) ** 2 + (av[1] + t * y) ** 2
      if (d < best) {
        best = d
        chainage = a.chainage + (b.chainage - a.chainage) * t
      }
    }
    for (let i = 0; i < 5; i++) {
      const p = geometry.positionAt(chainage),
        delta = planarOffset(p.coordinate, coordinate),
        b = p.bearing * RAD
      const along = delta[0] * Math.sin(b) + delta[1] * Math.cos(b)
      const next = clamp(chainage + along, 0, analysis.length)
      if (Math.abs(next - chainage) < 1e-6) break
      chainage = next
    }
    const p = geometry.positionAt(chainage),
      delta = planarOffset(p.coordinate, coordinate),
      b = p.bearing * RAD
    return {
      chainage,
      offset: delta[0] * Math.cos(b) - delta[1] * Math.sin(b),
      along: delta[0] * Math.sin(b) + delta[1] * Math.cos(b),
    }
  }
  const profile = [...new Set(distances)]
    .sort((a, b) => a - b)
    .map((distanceM) => {
      const coordinate = geometry.offsetCoordinate(location.coordinate, angle, distanceM - c.lengthM / 2),
        projected = project(coordinate)
      const widths = geometry.widthsAt(projected.chainage),
        t = templateAt(alignment, projected.chainage).template
      const z = geometry.designElevationAt(projected.chainage)
      const inFormation =
        Math.abs(projected.along) < 0.01 &&
        projected.offset >= -widths.leftWidth - 1e-5 &&
        projected.offset <= widths.rightWidth + 1e-5
      // The section's own crossfall here, superelevated on a curve, so cover is taken from the drawn formation.
      const formationElevation =
        inFormation && z !== null
          ? z -
            (Math.abs(projected.offset) *
              sectionCrossfall(
                t,
                projected.offset < 0 ? 'left' : 'right',
                curveDesignAt(alignment, projected.chainage),
              )) /
              100
          : null
      const invertElevation = knownInverts
        ? c.inletInvertM! + ((c.outletInvertM! - c.inletInvertM!) * distanceM) / c.lengthM
        : distanceM === 0
          ? c.inletInvertM
          : Math.abs(distanceM - c.lengthM) < EPS
            ? c.outletInvertM
            : null
      return {
        distanceM,
        coordinate,
        groundElevation: finite(terrain.elevationAt(...coordinate)),
        formationElevation,
        invertElevation,
        crownElevation: invertElevation === null ? null : invertElevation + c.diameterM,
      }
    })
  const covers = profile.flatMap((p) =>
    p.formationElevation !== null && p.crownElevation !== null ? [p.formationElevation - p.crownElevation] : [],
  )
  const coverM =
    knownInverts && covers.length && station.complete && profile.every((p) => p.groundElevation !== null)
      ? Math.min(...covers)
      : null
  const gradePercent = knownInverts ? (100 * (c.outletInvertM! - c.inletInvertM!)) / c.lengthM : null
  if (coverM === null && knownInverts)
    warnings.push('Cover is unknown where the road formation or terrain is unsupported.')
  if (coverM !== null && coverM < c.minCoverM - EPS)
    warnings.push(`Minimum sampled subgrade cover (${coverM.toFixed(2)} m) is below ${c.minCoverM.toFixed(2)} m.`)
  if (gradePercent !== null && gradePercent >= -EPS)
    warnings.push('The entered outlet is not lower than the inlet; review flow direction and pipe grade.')
  if (profile.some((p) => p.groundElevation === null)) warnings.push('Terrain is missing along part of the barrel.')
  const barrelAreaM2 = (Math.PI * c.diameterM ** 2) / 4
  const barrelLengthM = knownInverts ? Math.hypot(c.lengthM, c.outletInvertM! - c.inletInvertM!) : null
  return {
    id: c.id,
    name: c.name,
    chainage: c.chainage,
    coordinate: location.coordinate,
    bearing: angle,
    start,
    end,
    requiredLengthM,
    coverM,
    gradePercent,
    barrelLengthM,
    barrelAreaM2,
    barrelInternalVolumeM3: barrelAreaM2 * (barrelLengthM ?? c.lengthM),
    installedCost: (barrelLengthM ?? c.lengthM) * c.unitCost + c.fixedCost,
    profile,
    complete: coverM !== null && requiredLengthM !== null && associationResolved,
    warnings,
  }
}

export function calculateEngineering(
  alignment: Alignment,
  analysis: RoadAnalysis,
  settings: RoadSettings,
  terrain: TerrainSource,
  geometry: EngineeringGeometry,
): EngineeringAnalysis {
  const e = alignment.engineering!
  const defaults: GroundMaterial = {
    id: '__unclassified',
    name: 'Unclassified excavation',
    color: '#94a3b8',
    cutRate: settings.cutRate,
    reusableFraction: 1,
    compactionFactor: settings.shrinkFactor,
  }
  const materials = [...e.materials, defaults]
  const quantities = new Map<string, MaterialQuantity>(
    materials.map((m) => [
      m.id,
      {
        materialId: m.id,
        name: m.name,
        color: m.color,
        purpose: m.purpose ?? 'earthwork',
        bankCutM3: 0,
        usableCompactedM3: 0,
        unusableBankM3: 0,
        excavationCost: 0,
      },
    ]),
  )
  const materialMap = new Map(materials.map((m) => [m.id, m]))
  let sectionWork = 0
  const stations: EngineeringStation[] = analysis.stations.map((s) => {
    const layers = activeLayers(alignment, s.chainage, analysis.length)
    if ((sectionWork += layers.length * s.section.length) > 15000000)
      throw new Error('Material section budget exceeded; split the alignment or simplify its depth horizons.')
    const areas = new Map(materials.map((m) => [m.id, 0]))
    if (s.complete) {
      let assigned = 0
      for (const layer of layers) {
        const area = Math.max(
          0,
          cutBelowDepth(s, layer.topDepthM) - (layer.bottomDepthM === null ? 0 : cutBelowDepth(s, layer.bottomDepthM)),
        )
        areas.set(layer.materialId, areas.get(layer.materialId)! + area)
        assigned += area
      }
      if (assigned > s.cutAreaM2! + 1e-5)
        throw new Error('Material classification exceeds excavation area; check overlapping layers.')
      areas.set(defaults.id, Math.max(0, s.cutAreaM2! - assigned))
    }
    return {
      chainage: s.chainage,
      template: templateAt(alignment, s.chainage),
      layers,
      materialAreas: materials.map((m) => ({ materialId: m.id, cutAreaM2: s.complete ? areas.get(m.id)! : null })),
      usableCutVolumeM3: s.complete && s.index === 0 ? 0 : null,
      unusableCutVolumeM3: s.complete && s.index === 0 ? 0 : null,
      massM3: null,
    }
  })
  let mass = 0,
    massKnown = analysis.stations[0]?.complete ?? false,
    run = 0,
    previousComplete = false
  if (stations.length && massKnown) stations[0].massM3 = 0
  const intervals: EarthworkInterval[] = []
  for (let i = 1; i < stations.length; i++) {
    const a = analysis.stations[i - 1],
      b = analysis.stations[i],
      current = stations[i],
      previous = stations[i - 1]
    if (!a.complete || !b.complete) {
      previousComplete = false
      massKnown = false
      continue
    }
    if (!previousComplete) run++
    previousComplete = true
    const ds = b.chainage - a.chainage,
      cut: MaterialCut[] = []
    let usable = 0,
      unusable = 0
    for (let j = 0; j < materials.length; j++) {
      const m = materials[j]
      const preparation = (station: RoadStation) =>
        (station.preparationAreas ?? [])
          .filter((p) => (p.materialId ?? defaults.id) === m.id)
          .reduce((sum, p) => sum + p.areaM2, 0)
      const bank =
        ((previous.materialAreas[j].cutAreaM2! +
          current.materialAreas[j].cutAreaM2! +
          preparation(a) +
          preparation(b)) *
          ds) /
        2
      const reusable = bank * m.reusableFraction * m.compactionFactor,
        waste = bank * (1 - m.reusableFraction)
      const q = quantities.get(m.id)!
      q.bankCutM3 += bank
      q.usableCompactedM3 += reusable
      q.unusableBankM3 += waste
      q.excavationCost += bank * m.cutRate
      usable += reusable
      unusable += waste
      if (bank > EPS)
        cut.push({ materialId: m.id, bank, usable: reusable, unusable: waste, factor: m.compactionFactor })
    }
    current.usableCutVolumeM3 = usable
    current.unusableCutVolumeM3 = unusable
    const chainage = (a.chainage + b.chainage) / 2
    const demands: NonNullable<EarthworkInterval['demands']> = []
    const addLayer = (id: string, materialId: string | undefined, areaA: number, areaB: number, subgrade = false) => {
      if (!materialId && !requiredFillAt(e, chainage, id)) return
      const volumeM3 = Math.max(0, ((areaA + areaB) * ds) / 2)
      if (volumeM3 > EPS)
        demands.push({
          layer: id,
          key: materialDemandKey(id, materialId, subgrade),
          volumeM3,
          ...(materialId ? { materialId } : {}),
          ...(subgrade ? { subgrade: true } : {}),
        })
    }
    const layerA = surfaceLayersAt(alignment, a.chainage),
      layerM = surfaceLayersAt(alignment, chainage),
      layerB = surfaceLayersAt(alignment, b.chainage)
    for (const key of new Set(
      [...layerA, ...layerM, ...layerB].map((layer) => materialDemandKey(layer.id, layer.materialId)),
    )) {
      const rows = [layerA, layerM, layerB].map((layers) =>
        layers.filter((layer) => materialDemandKey(layer.id, layer.materialId) === key),
      )
      const row = [...rows[1], ...rows[0], ...rows[2]][0],
        id = row.id,
        materialId = row.materialId
      if (!materialId && !requiredFillAt(e, chainage, id)) continue
      const areas = rows.map((layers) => layers.reduce((sum, layer) => sum + layer.areaM2, 0))
      const volumeM3 = ((areas[0] + 4 * areas[1] + areas[2]) * ds) / 6
      if (volumeM3 > EPS) demands.push({ layer: id, key, volumeM3, ...(materialId ? { materialId } : {}) })
    }
    for (const key of new Set(
      [...(a.componentAreas ?? []), ...(b.componentAreas ?? [])].map((c) =>
        materialDemandKey(c.id, c.materialId, true),
      ),
    )) {
      const rows = [a.componentAreas ?? [], b.componentAreas ?? []].map((items) =>
        items.filter((c) => materialDemandKey(c.id, c.materialId, true) === key),
      )
      const component = [...rows[0], ...rows[1]][0]
      addLayer(
        component.id,
        component.materialId,
        rows[0].reduce((sum, c) => sum + c.areaM2, 0),
        rows[1].reduce((sum, c) => sum + c.areaM2, 0),
        true,
      )
    }
    if (massKnown) {
      mass += usable - b.fillVolumeM3! - demands.filter((d) => !d.subgrade).reduce((sum, d) => sum + d.volumeM3, 0)
      current.massM3 = mass
    }
    intervals.push({
      id: `interval-${i}`,
      start: a.chainage,
      end: b.chainage,
      chainage,
      run,
      cut,
      fill: b.fillVolumeM3!,
      ...(demands.length ? { demands } : {}),
    })
  }
  const coverageComplete = hasCompleteCoverage(analysis)
  const haul = allocateHaul(alignment, intervals, coverageComplete)
  const warnings = [...haul.warnings]
  if (
    !e.sitePreparation?.length &&
    e.materials.some((m) => m.purpose === 'stripping') &&
    e.strata.some((s) => materialMap.get(s.materialId)?.purpose === 'stripping')
  )
    warnings.push(
      'Stripping quantities classify excavated material only. No ground removal or replacement fill beneath embankments is modeled.',
    )
  const outOfRange = e.culverts.filter((c) => c.chainage > analysis.length + EPS)
  if (outOfRange.length)
    warnings.push(
      `${outOfRange.length} culvert(s) lie beyond the road end and are excluded from structure geometry and cost.`,
    )
  const culverts = e.culverts
    .filter((c) => c.chainage <= analysis.length + EPS)
    .map((c) => calculateCulvert(c, alignment, analysis, terrain, geometry))
  for (const c of culverts) for (const warning of c.warnings) warnings.push(`${c.name}: ${warning}`)
  const materialResults = [...quantities.values()].filter((m) => m.bankCutM3 > EPS || m.materialId !== defaults.id)
  const usableCutM3 = materialResults.reduce((sum, m) => sum + m.usableCompactedM3, 0)
  const unusableCutM3 = materialResults.reduce((sum, m) => sum + m.unusableBankM3, 0)
  const strippingCutM3 = materialResults
    .filter((m) => m.purpose === 'stripping')
    .reduce((sum, m) => sum + m.bankCutM3, 0)
  const materialLayerVolumeM3 = intervals.reduce(
    (sum, p) => sum + (p.demands ?? []).filter((d) => !d.subgrade).reduce((s, d) => s + d.volumeM3, 0),
    0,
  )
  const materialLayerPlacementCost = materialLayerVolumeM3 * settings.fillRate
  if (materialLayerVolumeM3 > EPS)
    warnings.push(
      'Material-allocated surface courses price material and haul separately; their placement uses the entered fill-placement rate. Only remaining generic surfacing uses the delivered surfacing rate/supply scenario.',
    )
  const costs: EngineeringCosts = {
    cut: materialResults.filter((m) => m.purpose !== 'stripping').reduce((sum, m) => sum + m.excavationCost, 0),
    stripping: materialResults.filter((m) => m.purpose === 'stripping').reduce((sum, m) => sum + m.excavationCost, 0),
    fill: analysis.fillVolumeM3 * settings.fillRate,
    surfacing:
      surfacingSupplyCost(
        Math.max(0, analysis.surfaceVolumeM3 - materialLayerVolumeM3),
        settings.surfacingRate,
        e.surfacingSupply,
      ).cost + materialLayerPlacementCost,
    clearing: analysis.clearingAreaM2 * settings.clearingRate,
    structures: culverts.reduce((sum, c) => sum + c.installedCost, 0),
    ...haul.costs,
    mobilization: e.haul.mobilizationCost,
    subtotal: 0,
    contingency: 0,
    total: 0,
  }
  costs.subtotal =
    costs.cut +
    costs.stripping +
    costs.fill +
    costs.surfacing +
    costs.clearing +
    costs.structures +
    costs.haul +
    costs.borrow +
    costs.waste +
    costs.sitePreparation +
    costs.mobilization
  costs.contingency = (costs.subtotal * e.haul.contingencyPercent) / 100
  costs.total = costs.subtotal + costs.contingency
  return {
    stations,
    materials: materialResults,
    culverts,
    movements: haul.movements,
    haul: haul.summary,
    costs,
    usableCutM3,
    unusableCutM3,
    strippingCutM3,
    balanceM3: usableCutM3 - analysis.fillVolumeM3 - materialLayerVolumeM3,
    complete: coverageComplete && haul.summary.complete && culverts.every((c) => c.complete) && !outOfRange.length,
    warnings,
    ...(materialLayerVolumeM3 > EPS ? { materialLayerVolumeM3, materialLayerPlacementCost } : {}),
  }
}

/** Section design interpolation used by exports and dimension callouts. */
export { interpolateSection }
