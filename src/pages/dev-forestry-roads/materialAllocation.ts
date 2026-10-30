/**
 * Bounded economic material flow. Variables retain bank units for excavated material and
 * compacted units for borrow. Conversion factors appear in demand equations, never in site
 * capacity equations. Binary site openings account for fixed costs exactly within solver limits.
 */
import { solve, type Constraint, type Model } from 'yalps'
import { acceptsFill, haulDirectionAllowed, materialDemandKey, type requiredFillAt } from './allocationPolicy'
import type { AlignmentEngineering, HaulMovement } from './engineeringTypes'
import { solveSparseMaterialAllocation } from './sparseMaterialAllocation'

export const MAX_ALLOCATION_VARIABLES = 20000
export const MAX_ALLOCATION_CONSTRAINTS = 1200
export const MAX_ALLOCATION_TABLEAU_CELLS = 3_000_000
export const MAX_ALLOCATION_OPENINGS = 12
export const MAX_ALLOCATION_BRANCHES = 2048
export const MAX_ALLOCATION_TABLEAU_UPDATES = 500_000_000
const EPS = 1e-7
export interface AllocationParcel {
  id: string
  start: number
  end: number
  chainage: number
  run: number
  cut: { materialId: string; bank: number; usable: number; unusable: number; factor: number }[]
  fill: number
  /** Additional layer demands; subgrade components replace part of `fill`. */
  demands?: { layer: string; volumeM3: number; materialId?: string; subgrade?: boolean; key?: string }[]
}
type Requirement = ReturnType<typeof requiredFillAt>
type Demand = {
  key: string
  parcel: AllocationParcel
  volume: number
  layer: string
  requirement: Requirement
  flowKey: string
}
type Supply = {
  key: string
  parcel: AllocationParcel
  materialId: string
  bank: number
  factor: number
  reusable: boolean
}
export type Flow = Omit<HaulMovement, 'id' | 'category' | 'haulCost'> & { disposalCost: number; supplyCost: number }
export interface EconomicAllocation {
  status: 'optimal' | 'infeasible'
  objectiveCost: number | null
  movements: Flow[]
  usedSiteIds: string[]
  variables: number
  constraints: number
  reason?: string
}

export function solveMaterialAllocation(
  e: AlignmentEngineering,
  parcels: AllocationParcel[],
  unitHaulCost: (distanceM: number) => number,
  options: { deferExternal?: boolean } = {},
): EconomicAllocation {
  return (
    solveSparseMaterialAllocation(e, parcels, unitHaulCost, options) ??
    solveDenseMaterialAllocation(e, parcels, unitHaulCost, options)
  )
}

/** General piecewise-tariff formulation; retained independently as a small-model oracle. */
export function solveDenseMaterialAllocation(
  e: AlignmentEngineering,
  parcels: AllocationParcel[],
  unitHaulCost: (distanceM: number) => number,
  options: { deferExternal?: boolean } = {},
): EconomicAllocation {
  const requirements = e.fillRequirements ?? []
  const demands: Demand[] = []
  const supplies: Supply[] = []
  for (const parcel of parcels) {
    const extras = parcel.demands ?? []
    const subgrade = Math.max(0, parcel.fill - extras.filter((d) => d.subgrade).reduce((s, d) => s + d.volumeM3, 0))
    for (const d of [{ layer: 'subgrade', volumeM3: subgrade, key: 'subgrade' }, ...extras]) {
      if (d.volumeM3 <= EPS) continue
      const selected = requirements.find(
        (r) => r.layer === d.layer && parcel.chainage >= r.start && parcel.chainage < r.end,
      )
      const requirement =
        selected ??
        (d.materialId
          ? {
              id: `component-${d.layer}`,
              start: parcel.start,
              end: parcel.end,
              layer: d.layer,
              materialId: d.materialId,
              replaceable: false,
            }
          : undefined)
      demands.push({
        key: `d${demands.length}`,
        parcel,
        volume: d.volumeM3,
        layer: d.layer,
        requirement,
        flowKey: d.key ?? materialDemandKey(d.layer, d.materialId, d.subgrade),
      })
    }
    for (const m of parcel.cut) {
      const reusableBank = m.usable / m.factor
      if (reusableBank > EPS)
        supplies.push({
          key: `s${supplies.length}`,
          parcel,
          materialId: m.materialId,
          bank: reusableBank,
          factor: m.factor,
          reusable: true,
        })
      if (m.unusable > EPS)
        supplies.push({
          key: `s${supplies.length}`,
          parcel,
          materialId: m.materialId,
          bank: m.unusable,
          factor: m.factor,
          reusable: false,
        })
    }
  }
  const constraints: Record<string, Constraint> = {}
  const variables: Record<string, Record<string, number>> = {}
  const binaries: string[] = []
  const flows = new Map<string, Flow>()
  const runs = new Map<number, { start: number; end: number }>()
  for (const p of parcels) {
    const r = runs.get(p.run)
    if (r) {
      r.start = Math.min(r.start, p.start)
      r.end = Math.max(r.end, p.end)
    } else runs.set(p.run, { start: p.start, end: p.end })
  }
  const totalFill = demands.reduce((s, d) => s + d.volume, 0)
  const totalBank = supplies.reduce((s, d) => s + d.bank, 0)
  for (const d of demands) constraints[d.key] = { equal: d.volume }
  for (const s of supplies) constraints[s.key] = { equal: s.bank }
  const siteConstraint = new Map<string, string>()
  const sites = e.sites.filter((s) => s.enabled !== false)
  for (const site of sites) {
    const cap = Math.min(site.capacityM3 ?? Infinity, site.kind === 'borrow' ? totalFill : totalBank)
    const key = `capacity:${site.id}`
    siteConstraint.set(site.id, key)
    if (site.fixedCost > 0 && cap > EPS) {
      const open = `open:${site.id}`
      constraints[key] = { max: 0 }
      variables[open] = { [key]: -cap, cost: site.fixedCost }
      binaries.push(open)
    } else constraints[key] = { max: cap }
  }
  if (binaries.length > MAX_ALLOCATION_OPENINGS)
    throw Error(
      `Economic allocation supports at most ${MAX_ALLOCATION_OPENINGS} priced site openings; disable sites or split the road.`,
    )
  const reachable = (chainage: number, parcel: AllocationParcel) => {
    const run = runs.get(parcel.run)!
    const station = Math.round(chainage * 1e6) / 1e6
    return station >= run.start - EPS && station <= run.end + EPS
  }
  const add = (flow: Flow, coefficients: Record<string, number>) => {
    const key = `flow:${flows.size}`
    if (flows.size + binaries.length >= MAX_ALLOCATION_VARIABLES)
      throw Error(
        `Economic allocation exceeds ${MAX_ALLOCATION_VARIABLES} variables; increase station spacing or split the road.`,
      )
    flows.set(key, flow)
    variables[key] = {
      ...coefficients,
      cost: flow.transportedVolumeM3 * (unitHaulCost(flow.distanceM) + flow.supplyCost + flow.disposalCost),
    }
  }
  for (const supply of supplies) {
    if (supply.reusable)
      for (const demand of demands) {
        if (
          supply.parcel.run !== demand.parcel.run ||
          !acceptsFill(supply.materialId, demand.requirement, e.materials) ||
          !haulDirectionAllowed(e.haul, supply.parcel.chainage, demand.parcel.chainage)
        )
          continue
        add(
          {
            kind: 'cut-to-fill',
            sourceId: supply.parcel.id,
            targetId: demand.parcel.id,
            materialId: supply.materialId,
            fromChainage: supply.parcel.chainage,
            toChainage: demand.parcel.chainage,
            distanceM: Math.abs(supply.parcel.chainage - demand.parcel.chainage),
            bankVolumeM3: 1,
            compactedVolumeM3: supply.factor,
            transportedVolumeM3: supply.factor,
            volumeBasis: 'compacted',
            demandLayer: demand.layer,
            demandKey: demand.flowKey,
            supplyCost: 0,
            disposalCost: 0,
          },
          { [supply.key]: 1, [demand.key]: supply.factor },
        )
      }
    for (const site of sites) {
      if (
        site.kind !== 'waste' ||
        !reachable(site.chainage, supply.parcel) ||
        (site.materialId && site.materialId !== supply.materialId) ||
        !haulDirectionAllowed(e.haul, supply.parcel.chainage, site.chainage)
      )
        continue
      add(
        {
          kind: 'waste',
          sourceId: supply.parcel.id,
          targetId: site.id,
          materialId: supply.materialId,
          fromChainage: supply.parcel.chainage,
          toChainage: site.chainage,
          distanceM: Math.abs(supply.parcel.chainage - site.chainage) + site.accessDistanceM,
          bankVolumeM3: 1,
          compactedVolumeM3: supply.reusable ? supply.factor : null,
          transportedVolumeM3: 1,
          volumeBasis: 'bank',
          supplyCost: 0,
          disposalCost: site.unitRate,
        },
        { [supply.key]: 1, [siteConstraint.get(site.id)!]: 1 },
      )
    }
    for (const range of e.haul.sidecastRanges ?? []) {
      const span = Math.max(0, Math.min(supply.parcel.end, range.end) - Math.max(supply.parcel.start, range.start))
      if (
        span <= EPS ||
        supply.parcel.chainage < range.start ||
        supply.parcel.chainage >= range.end ||
        (range.materialIds && !range.materialIds.includes(supply.materialId))
      )
        continue
      const key = `sidecast:${range.id}:${supply.parcel.id}`
      constraints[key] = { max: span * range.capacityBankM3PerM }
      add(
        {
          kind: 'waste',
          sourceId: supply.parcel.id,
          targetId: `sidecast:${range.id}`,
          materialId: supply.materialId,
          fromChainage: supply.parcel.chainage,
          toChainage: supply.parcel.chainage,
          distanceM: 0,
          bankVolumeM3: 1,
          compactedVolumeM3: supply.reusable ? supply.factor : null,
          transportedVolumeM3: 1,
          volumeBasis: 'bank',
          disposalMethod: 'sidecast',
          supplyCost: 0,
          disposalCost: range.unitRate,
        },
        { [supply.key]: 1, [key]: 1 },
      )
      // Sidecasting has disposal cost, no loading/transport charge.
      variables[`flow:${flows.size - 1}`].cost = range.unitRate
    }
  }
  for (const demand of demands)
    for (const site of sites) {
      if (
        site.kind !== 'borrow' ||
        !reachable(site.chainage, demand.parcel) ||
        !acceptsFill(site.materialId ?? null, demand.requirement, e.materials) ||
        !haulDirectionAllowed(e.haul, site.chainage, demand.parcel.chainage)
      )
        continue
      add(
        {
          kind: 'borrow',
          sourceId: site.id,
          targetId: demand.parcel.id,
          materialId: site.materialId ?? null,
          fromChainage: site.chainage,
          toChainage: demand.parcel.chainage,
          distanceM: Math.abs(site.chainage - demand.parcel.chainage) + site.accessDistanceM,
          bankVolumeM3: null,
          compactedVolumeM3: 1,
          transportedVolumeM3: 1,
          volumeBasis: 'compacted',
          demandLayer: demand.layer,
          demandKey: demand.flowKey,
          supplyCost: site.unitRate,
          disposalCost: 0,
        },
        { [demand.key]: 1, [siteConstraint.get(site.id)!]: 1 },
      )
    }
  // Network comparison needs a constrained internal-use plan before external roads/suppliers
  // are priced. Lexicographically minimize unresolved volume, then known internal cost. These
  // placeholders are explicitly marked and never claimed as a complete material prescription.
  let unresolvedPenalty = 0
  if (options.deferExternal) {
    const bound = Object.values(variables).reduce(
      (sum, v) => sum + Math.abs(v.cost ?? 0) * (totalBank + totalFill + 1),
      0,
    )
    unresolvedPenalty = Math.max(1, bound + 1)
    for (const demand of demands) {
      add(
        {
          kind: 'borrow',
          sourceId: '__external-unresolved',
          targetId: demand.parcel.id,
          materialId: demand.requirement?.materialId ?? null,
          fromChainage: demand.parcel.chainage,
          toChainage: demand.parcel.chainage,
          distanceM: 0,
          bankVolumeM3: null,
          compactedVolumeM3: 1,
          transportedVolumeM3: 1,
          volumeBasis: 'compacted',
          demandLayer: demand.layer,
          demandKey: demand.flowKey,
          supplyCost: 0,
          disposalCost: 0,
          externalUnresolved: true,
        },
        { [demand.key]: 1 },
      )
      variables[`flow:${flows.size - 1}`].cost = unresolvedPenalty
    }
    for (const supply of supplies) {
      add(
        {
          kind: 'waste',
          sourceId: supply.parcel.id,
          targetId: '__external-unresolved',
          materialId: supply.materialId,
          fromChainage: supply.parcel.chainage,
          toChainage: supply.parcel.chainage,
          distanceM: 0,
          bankVolumeM3: 1,
          compactedVolumeM3: null,
          transportedVolumeM3: 1,
          volumeBasis: 'bank',
          supplyCost: 0,
          disposalCost: 0,
          externalUnresolved: true,
        },
        { [supply.key]: 1 },
      )
      variables[`flow:${flows.size - 1}`].cost = unresolvedPenalty
    }
  }
  const n = Object.keys(variables).length,
    m = Object.keys(constraints).length
  const cells = (n + 1) * (m * 2 + binaries.length + 1)
  if (m > MAX_ALLOCATION_CONSTRAINTS || cells > MAX_ALLOCATION_TABLEAU_CELLS)
    throw Error(
      'Economic allocation model exceeds its browser budget; increase station spacing, reduce layers/sites or split the road.',
    )
  const infeasible = (reason: string): EconomicAllocation => ({
    status: 'infeasible',
    objectiveCost: null,
    movements: [],
    usedSiteIds: [],
    variables: n,
    constraints: m,
    reason,
  })
  if (!demands.length && !supplies.length)
    return { status: 'optimal', objectiveCost: 0, movements: [], usedSiteIds: [], variables: n, constraints: m }
  if (!n)
    return infeasible(
      'No compatible, reachable material source or disposal capacity satisfies the entered demand and construction rules.',
    )
  const model: Model = { direction: 'minimize', objective: 'cost', variables, constraints, binaries }
  const maxPivots = Math.min(8192, Math.max(128, Math.floor(MAX_ALLOCATION_TABLEAU_UPDATES / Math.max(1, cells))))
  const result = solve(model, {
    precision: 1e-8,
    tolerance: 0,
    maxPivots,
    maxIterations: MAX_ALLOCATION_BRANCHES,
    timeout: 3000,
    checkCycles: true,
  })
  if (result.status === 'infeasible')
    return infeasible(
      'Material requirements, site capacities, construction directions or sidecast limits cannot all be satisfied.',
    )
  if (result.status !== 'optimal' || !Number.isFinite(result.result))
    throw Error(
      `Economic allocation did not finish an optimal solution (${result.status}; ${n} variables, ${m} constraints, ${maxPivots} pivots); reduce the model. No partial prescription was adopted.`,
    )
  const values = new Map(result.variables)
  // Independently check every equality/capacity and binary after the solver's floating-point solve.
  for (const [key, bound] of Object.entries(constraints)) {
    let sum = 0
    for (const [variable, coefficient] of Object.entries(variables))
      sum += (values.get(variable) ?? 0) * (coefficient[key] ?? 0)
    const tolerance = Math.max(1e-5, Math.abs(bound.equal ?? bound.max ?? bound.min ?? 0) * 1e-7)
    if (
      (bound.equal !== undefined && Math.abs(sum - bound.equal) > tolerance) ||
      (bound.max !== undefined && sum > bound.max + tolerance) ||
      (bound.min !== undefined && sum < bound.min - tolerance)
    )
      throw Error('Economic allocation failed its independent material-conservation check.')
  }
  for (const binary of binaries)
    if (Math.abs((values.get(binary) ?? 0) - Math.round(values.get(binary) ?? 0)) > 1e-6)
      throw Error('Economic allocation returned an unresolved site-opening decision.')
  const movements: Flow[] = []
  for (const [key, unit] of flows) {
    const volume = values.get(key) ?? 0
    if (volume <= EPS) continue
    movements.push({
      ...unit,
      bankVolumeM3: unit.bankVolumeM3 === null ? null : unit.bankVolumeM3 * volume,
      compactedVolumeM3: unit.compactedVolumeM3 === null ? null : unit.compactedVolumeM3 * volume,
      transportedVolumeM3: unit.transportedVolumeM3 * volume,
    })
  }
  const usedSiteIds = sites
    .filter((site) =>
      movements.some(
        (m) =>
          !m.externalUnresolved &&
          !m.disposalMethod &&
          (m.kind === 'borrow' ? m.sourceId === site.id : m.kind === 'waste' && m.targetId === site.id),
      ),
    )
    .map((s) => s.id)
  const reconstructed =
    movements.reduce(
      (sum, m) =>
        sum +
        m.transportedVolumeM3 *
          ((m.disposalMethod === 'sidecast' || m.externalUnresolved ? 0 : unitHaulCost(m.distanceM)) +
            m.supplyCost +
            m.disposalCost),
      0,
    ) + sites.filter((s) => usedSiteIds.includes(s.id)).reduce((sum, s) => sum + s.fixedCost, 0)
  const unresolvedCost = movements
    .filter((m) => m.externalUnresolved)
    .reduce((sum, m) => sum + m.transportedVolumeM3 * unresolvedPenalty, 0)
  if (Math.abs(reconstructed + unresolvedCost - result.result) > Math.max(0.01, Math.abs(result.result) * 1e-6))
    throw Error('Economic allocation cost does not reconcile to its material movements.')
  return { status: 'optimal', objectiveCost: reconstructed, movements, usedSiteIds, variables: n, constraints: m }
}
