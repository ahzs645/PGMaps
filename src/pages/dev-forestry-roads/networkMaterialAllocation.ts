/**
 * The economic material plan as a minimum-cost network flow, for roads too long for the tableau
 * solvers (`materialAllocation.ts`, `sparseMaterialAllocation.ts`): a LongRoad-length road with
 * thousands of stations and several materials, in the browser, in a second or two.
 *
 * Same rules, same answer: the model holds the same supplies (each interval's usable and unsuitable
 * bank cut by material), demands (subgrade and layer fill, compacted) and sites as the tableau
 * models, the same material rules (`acceptsFill`: exact material or quality), construction
 * directions (`haulDirectionAllowed`), site capacities, sidecast limits and per-unit prices, and it
 * minimizes the same cost, so its optimum equals theirs. Only the way of solving differs:
 *
 * - Units. Cut is counted in compacted m³ (bank × its material's factor) everywhere it flows, its
 *   unsuitable part too, so a cut-to-fill movement needs no gain; going to waste, one unit is
 *   1/factor bank m³ and its haul and disposal cost and its use of a site's bank capacity are scaled
 *   by that. A capacity shared by materials of different factors (a waste site or a sidecast
 *   stretch that can actually fill up) is not a network constraint: such a model is left to the
 *   tableau solvers (`networkAllocationApplies` says why).
 * - Arcs. Every cut → fill pair is a possible movement, too many to list on a long road (millions),
 *   so the network starts with each source's nearest compatible fills on either side, is solved,
 *   and then every pair not in it is priced against the solved node potentials (the dual prices);
 *   pairs that would lower the cost are added and the solve continues from the same tree. When no
 *   pair would lower it, the plan is optimal for the full model: the potentials prove it.
 * - Site openings with a fixed cost are decided by branch and bound over the same relaxation the
 *   tableau model uses (the fixed cost spread over the site's capacity), at most
 *   `MAX_NETWORK_ALLOCATION_BRANCHES` branches.
 *
 * Every solved plan is checked independently, as the tableau models' are: each source's bank cut
 * and each fill's compacted volume conserved, no capacity exceeded, and the cost of the movements
 * equal to the solved cost.
 *
 * Pure: no DOM or network access.
 */
import { acceptsFill, haulDirectionAllowed, materialDemandKey, requiredFillAt } from './allocationPolicy'
import type { AlignmentEngineering, FillRequirement, HaulSite } from './engineeringTypes'
import type { AllocationParcel, EconomicAllocation, Flow } from './materialAllocation'
import { MinCostFlow } from './minCostFlow'

/** Nodes in one network (sources, fills, sites and sidecast stretches). */
export const MAX_NETWORK_ALLOCATION_NODES = 200_000
/** Arcs kept in one network after pricing. */
export const MAX_NETWORK_ALLOCATION_ARCS = 3_000_000
/** Source × fill pairs priced per pricing round (the full model's possible movements). */
export const MAX_NETWORK_ALLOCATION_PAIRS = 60_000_000
/** Pricing rounds before a solve is given up. */
export const MAX_NETWORK_ALLOCATION_ROUNDS = 60
/** Nearest compatible fills on each side of a source in the first network. */
export const NETWORK_ALLOCATION_NEAREST = 12
/** Pairs added per source per pricing round, most cost-lowering first. */
export const NETWORK_ALLOCATION_ADD_PER_SOURCE = 48
/** Branches of the site-opening search. */
export const MAX_NETWORK_ALLOCATION_BRANCHES = 256
/**
 * A pit of last resort's priority penalty, as a multiple of the largest per-m³ cost any movement can
 * have: far above any chain of movements that could take its place, so it serves only where
 * nothing else can.
 */
export const LAST_RESORT_PRIORITY = 100
/** Priced site openings the search decides. */
export const MAX_NETWORK_ALLOCATION_OPENINGS = 12

const EPS = 1e-7
/**
 * Tie-breaks added to every arc's cost: per m³ taken from or sent off the road, and per m³ and
 * metre moved. Where several plans cost the same (zero haul rates, say), they choose the one that
 * keeps material on the road and moves it least. They are far below a cent on any road and are
 * taken out again before the cost is reported.
 */
const TIE_EXTERNAL = 1e-6
const TIE_DISTANCE = 1e-9

type Demand = {
  parcel: AllocationParcel
  volume: number
  layer: string
  key: string
  requirement?: FillRequirement
}
type Supply = { parcel: AllocationParcel; materialId: string; bank: number; factor: number; reusable: boolean }
type Arc = {
  kind: 'fill' | 'waste' | 'borrow' | 'sidecast'
  supply?: number
  demand?: number
  site?: number
  range?: number
}

/** Why the network formulation cannot hold this model, or null when it can. */
export function networkAllocationApplies(
  e: AlignmentEngineering,
  parcels: AllocationParcel[],
  options: { deferExternal?: boolean } = {},
): string | null {
  if (options.deferExternal) return 'internal-use plans for network pricing are solved by the tableau model'
  return build(e, parcels).reason
}

function build(e: AlignmentEngineering, parcels: AllocationParcel[]) {
  const sites = e.sites.filter((site) => site.enabled !== false)
  const supplies: Supply[] = [],
    demands: Demand[] = []
  for (const p of parcels) {
    const extras = p.demands ?? []
    const subgrade = Math.max(0, p.fill - extras.filter((d) => d.subgrade).reduce((s, d) => s + d.volumeM3, 0))
    for (const d of [
      { layer: 'subgrade', volumeM3: subgrade, key: 'subgrade' } as NonNullable<AllocationParcel['demands']>[number],
      ...extras,
    ]) {
      if (!(d.volumeM3 > EPS)) continue
      const requirement =
        requiredFillAt(e, p.chainage, d.layer) ??
        (d.materialId
          ? {
              id: `component-${d.layer}`,
              start: p.start,
              end: p.end,
              layer: d.layer,
              materialId: d.materialId,
              replaceable: false,
            }
          : undefined)
      demands.push({
        parcel: p,
        volume: d.volumeM3,
        layer: d.layer,
        key: d.key ?? materialDemandKey(d.layer, d.materialId, d.subgrade),
        requirement,
      })
    }
    for (const m of p.cut) {
      if (!(m.factor > 0) || !Number.isFinite(m.factor)) continue
      const reusableBank = m.usable / m.factor
      if (reusableBank > EPS)
        supplies.push({ parcel: p, materialId: m.materialId, bank: reusableBank, factor: m.factor, reusable: true })
      if (m.unusable > EPS)
        supplies.push({ parcel: p, materialId: m.materialId, bank: m.unusable, factor: m.factor, reusable: false })
    }
  }
  const totalFill = demands.reduce((s, d) => s + d.volume, 0)
  const totalBank = supplies.reduce((s, d) => s + d.bank, 0)
  // Bank m³ per flow unit. Every supply flows in compacted m³ (bank × its material's factor), the
  // unsuitable part too, so all of one material shares one figure wherever it goes.
  const bankPerUnit = (s: Supply) => 1 / s.factor
  const ranges = e.haul.sidecastRanges ?? []
  const sidecastOf = (s: Supply) =>
    ranges.flatMap((range, ri) => {
      const span = Math.max(0, Math.min(s.parcel.end, range.end) - Math.max(s.parcel.start, range.start))
      return span <= EPS ||
        s.parcel.chainage < range.start ||
        s.parcel.chainage >= range.end ||
        (range.materialIds && !range.materialIds.includes(s.materialId))
        ? []
        : [{ ri, span }]
    })
  let reason: string | null = null
  // Waste sites: a capacity that can bind must see one bank-per-unit figure.
  const wasteUnit = new Map<number, number>()
  sites.forEach((site, i) => {
    if (site.kind !== 'waste' || reason) return
    const cap = Math.min(site.capacityM3 ?? Infinity, totalBank)
    const feeding = supplies.filter(
      (s) =>
        (!site.materialId || site.materialId === s.materialId) &&
        haulDirectionAllowed(e.haul, s.parcel.chainage, site.chainage),
    )
    const reach = feeding.reduce((sum, s) => sum + s.bank, 0)
    const units = new Set(feeding.map((s) => Math.round(bankPerUnit(s) * 1e12) / 1e12))
    if (reach <= cap + EPS) return
    if (units.size > 1) reason = `waste site ${site.name} can fill up and takes material of different swell factors`
    else if (units.size === 1) wasteUnit.set(i, [...units][0])
  })
  const sidecastUnit = new Map<string, number>()
  if (!reason)
    for (const s of supplies)
      for (const { ri, span } of sidecastOf(s)) {
        const key = `${ri}:${parcels.indexOf(s.parcel)}`
        if (sidecastUnit.has(key)) continue
        const at = supplies.filter((x) => x.parcel === s.parcel && sidecastOf(x).some((r) => r.ri === ri))
        const reach = at.reduce((sum, x) => sum + x.bank, 0)
        const units = new Set(at.map((x) => Math.round(bankPerUnit(x) * 1e12) / 1e12))
        if (reach <= span * ranges[ri].capacityBankM3PerM + EPS) sidecastUnit.set(key, NaN)
        else if (units.size > 1) {
          reason = `the sidecast stretch at ${s.parcel.chainage.toFixed(1)} m can fill up and takes material of different swell factors`
          break
        } else sidecastUnit.set(key, [...units][0])
      }
  return { sites, supplies, demands, totalFill, totalBank, bankPerUnit, sidecastOf, wasteUnit, sidecastUnit, reason }
}

/**
 * The optimal economic plan by network flow, or null when the model is not a network (see
 * `networkAllocationApplies`). Throws in plain words when a limit stops it.
 */
export function solveNetworkMaterialAllocation(
  e: AlignmentEngineering,
  parcels: AllocationParcel[],
  unitHaulCost: (distanceM: number) => number,
  options: { deferExternal?: boolean } = {},
): EconomicAllocation | null {
  if (options.deferExternal) return null
  for (const p of parcels)
    if (![p.start, p.end, p.chainage, p.fill].every(Number.isFinite) || p.end < p.start || p.fill < 0)
      throw Error('The material plan received an invalid interval or fill quantity.')
  const model = build(e, parcels)
  if (model.reason) return null
  const { sites, supplies, demands, totalFill, totalBank, bankPerUnit, sidecastOf, wasteUnit, sidecastUnit } = model
  if (!supplies.length && !demands.length)
    return { status: 'optimal', objectiveCost: 0, movements: [], usedSiteIds: [], variables: 0, constraints: 0 }
  const h = e.haul
  const ranges = h.sidecastRanges ?? []

  // Nodes: supplies, demands, sites, sidecast stretches, then the balancing node Z.
  const nS = supplies.length,
    nD = demands.length
  const siteNode = (i: number) => nS + nD + i
  const sidecastKeys = [...sidecastUnit.keys()]
  const sidecastIndex = new Map(sidecastKeys.map((k, i) => [k, i]))
  const sidecastNode = (i: number) => nS + nD + sites.length + i
  const Z = nS + nD + sites.length + sidecastKeys.length
  const nodeCount = Z + 1
  if (nodeCount > MAX_NETWORK_ALLOCATION_NODES)
    throw Error(
      `The material plan needs ${nodeCount.toLocaleString('en-CA')} network nodes, past this workspace's ${MAX_NETWORK_ALLOCATION_NODES.toLocaleString('en-CA')}; increase station spacing or split the road.`,
    )
  const balance = new Float64Array(nodeCount)
  supplies.forEach((s, i) => (balance[i] = s.bank * s.factor))
  demands.forEach((d, j) => (balance[nS + j] = -d.volume))
  balance[Z] = -balance.slice(0, nS + nD).reduce((a, b) => a + b, 0)

  // Effective site capacities (as the tableau models: borrow ≤ all fill, waste ≤ all bank cut).
  const siteCap = sites.map((site) =>
    Math.min(site.capacityM3 ?? Infinity, site.kind === 'borrow' ? totalFill : totalBank),
  )
  const priced = sites.flatMap((site, i) => (site.fixedCost > 0 && siteCap[i] > EPS ? [i] : []))

  // Cost bound over every arc that may ever be added, for the artificial cost.
  const supplyPositions = supplies.map((s) => s.parcel.chainage),
    demandPositions = demands.map((d) => d.parcel.chainage)
  const all = [...supplyPositions, ...demandPositions, ...sites.map((s) => s.chainage)]
  const span = all.length ? Math.max(...all) - Math.min(...all) : 0
  const maxAccess = Math.max(0, ...sites.map((s) => s.accessDistanceM))
  let maxCost = 0
  for (const d of [
    0,
    span,
    span + maxAccess,
    ...[h.freeHaulDistanceM, h.overhaulDistanceM].flatMap((x) => [x, x + 1e-6]),
  ].filter(Number.isFinite))
    maxCost = Math.max(maxCost, Math.abs(unitHaulCost(Math.max(0, d))))
  const maxFactor = Math.max(1, ...supplies.map(bankPerUnit))
  const maxSiteRate = Math.max(
    0,
    ...sites.map((s, i) => s.unitRate + (s.fixedCost > 0 && siteCap[i] > EPS ? s.fixedCost / siteCap[i] : 0)),
    ...ranges.map((r) => r.unitRate),
  )
  maxCost = (maxCost + maxSiteRate) * maxFactor * 2 + 1
  // The haul curve need not be monotone; check it at many distances for the bound.
  for (let k = 0; k <= 64; k++) {
    const d = ((span + maxAccess) * k) / 64
    const c = unitHaulCost(d)
    if (!Number.isFinite(c) || c < 0) throw Error('The haul cost curve gives an invalid cost.')
    maxCost = Math.max(maxCost, (c + maxSiteRate) * maxFactor * 2 + 1)
  }

  // Pits of last resort (`lastResortPits.ts`) carry a priority penalty above the cost of any chain
  // of movements the network can make, so the plan uses them only where nothing else serves. It is
  // taken out of every reported cost.
  const lastResortPenalty = sites.some((site) => site.lastResort) ? maxCost * LAST_RESORT_PRIORITY : 0
  const penaltyOf = (i: number) => (sites[i].lastResort ? lastResortPenalty : 0)
  maxCost += lastResortPenalty * maxFactor

  // Compatible fills of each reusable supply's material, in station order.
  const compatibleByMaterial = new Map<string, number[]>()
  const compatible = (materialId: string) => {
    let list = compatibleByMaterial.get(materialId)
    if (!list) {
      list = demands
        .map((_, j) => j)
        .filter((j) => acceptsFill(materialId, demands[j].requirement, e.materials))
        .sort((a, b) => demandPositions[a] - demandPositions[b])
      compatibleByMaterial.set(materialId, list)
    }
    return list
  }

  const solveRelaxed = (open: Set<number>, closed: Set<number>) => {
    const net = new MinCostFlow(
      nodeCount,
      balance,
      nS * NETWORK_ALLOCATION_NEAREST * 2 + nD * sites.length + nS * sites.length,
    )
    const arcs: Arc[] = []
    const fillPairs = new Set<number>()
    const add = (from: number, to: number, cost: number, capacity: number, arc: Arc) => {
      if (arcs.length >= MAX_NETWORK_ALLOCATION_ARCS)
        throw Error(
          `The material plan needs more than ${MAX_NETWORK_ALLOCATION_ARCS.toLocaleString('en-CA')} movement arcs; increase station spacing or split the road.`,
        )
      net.addArc(from, to, cost, capacity)
      arcs.push(arc)
    }
    const charge = (i: number) => (priced.includes(i) && !open.has(i) ? sites[i].fixedCost / siteCap[i] : 0)
    // Sites: borrow Z → site → fill; waste source → site → Z.
    sites.forEach((site, i) => {
      const cap = closed.has(i) ? 0 : siteCap[i]
      if (site.kind === 'borrow') add(Z, siteNode(i), charge(i) + penaltyOf(i), cap, { kind: 'borrow', site: i })
      else {
        const unit = wasteUnit.get(i)
        add(siteNode(i), Z, 0, unit === undefined ? (closed.has(i) ? 0 : Infinity) : cap / unit, {
          kind: 'waste',
          site: i,
        })
      }
    })
    sidecastKeys.forEach((key, k) => {
      const [ri, pi] = key.split(':').map(Number)
      const unit = sidecastUnit.get(key)!
      const p = parcels[pi]
      const span = Math.max(0, Math.min(p.end, ranges[ri].end) - Math.max(p.start, ranges[ri].start))
      add(sidecastNode(k), Z, 0, Number.isNaN(unit) ? Infinity : (span * ranges[ri].capacityBankM3PerM) / unit, {
        kind: 'sidecast',
        range: ri,
      })
    })
    supplies.forEach((s, si) => {
      const unit = bankPerUnit(s)
      sites.forEach((site, i) => {
        if (
          site.kind !== 'waste' ||
          (site.materialId && site.materialId !== s.materialId) ||
          !haulDirectionAllowed(h, s.parcel.chainage, site.chainage)
        )
          return
        const distance = Math.abs(s.parcel.chainage - site.chainage) + site.accessDistanceM
        const tie = TIE_EXTERNAL + TIE_DISTANCE * distance
        add(
          si,
          siteNode(i),
          (unitHaulCost(distance) + site.unitRate + charge(i) + penaltyOf(i) + tie) * unit,
          Infinity,
          {
            kind: 'waste',
            supply: si,
            site: i,
          },
        )
      })
      for (const { ri } of sidecastOf(s)) {
        const k = sidecastIndex.get(`${ri}:${parcels.indexOf(s.parcel)}`)!
        add(si, sidecastNode(k), (ranges[ri].unitRate + TIE_EXTERNAL) * unit, Infinity, {
          kind: 'sidecast',
          supply: si,
          range: ri,
        })
      }
    })
    demands.forEach((d, dj) =>
      sites.forEach((site, i) => {
        if (
          site.kind !== 'borrow' ||
          !acceptsFill(site.materialId ?? null, d.requirement, e.materials) ||
          !haulDirectionAllowed(h, site.chainage, d.parcel.chainage)
        )
          return
        const distance = Math.abs(site.chainage - d.parcel.chainage) + site.accessDistanceM
        add(
          siteNode(i),
          nS + dj,
          site.unitRate + unitHaulCost(distance) + TIE_EXTERNAL + TIE_DISTANCE * distance,
          Infinity,
          {
            kind: 'borrow',
            site: i,
            demand: dj,
          },
        )
      }),
    )
    const addFill = (si: number, dj: number) => {
      const id = si * nD + dj
      if (fillPairs.has(id)) return false
      fillPairs.add(id)
      const distance = Math.abs(supplyPositions[si] - demandPositions[dj])
      add(si, nS + dj, unitHaulCost(distance) + TIE_DISTANCE * distance, Infinity, {
        kind: 'fill',
        supply: si,
        demand: dj,
      })
      return true
    }
    // First network: each reusable source's nearest compatible fills on each side.
    supplies.forEach((s, si) => {
      if (!s.reusable) return
      const list = compatible(s.materialId)
      const x = supplyPositions[si]
      let lo = 0,
        hi = list.length
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (demandPositions[list[mid]] < x) lo = mid + 1
        else hi = mid
      }
      for (let k = lo - 1, n = 0; k >= 0 && n < NETWORK_ALLOCATION_NEAREST; k--)
        if (haulDirectionAllowed(h, x, demandPositions[list[k]])) n += addFill(si, list[k]) ? 1 : 0
      for (let k = lo, n = 0; k < list.length && n < NETWORK_ALLOCATION_NEAREST; k++)
        if (haulDirectionAllowed(h, x, demandPositions[list[k]])) n += addFill(si, list[k]) ? 1 : 0
    })
    // Solve, price every pair not in the network, add those that lower the cost, repeat.
    const tolerance = net.defaultTolerance(maxCost)
    let rounds = 0
    for (;;) {
      const status = net.solve({ maxCost })
      if (status === 'limit')
        throw Error('The material plan did not finish: the network solver reached its pivot limit. Split the road.')
      if (status === 'infeasible') return { status: 'infeasible' as const, net, arcs }
      let pairs = 0,
        added = 0
      const best: { dj: number; rc: number }[] = []
      const piD = new Float64Array(nD)
      for (let dj = 0; dj < nD; dj++) piD[dj] = net.potential(nS + dj)
      for (let si = 0; si < nS; si++) {
        const s = supplies[si]
        if (!s.reusable) continue
        const piS = net.potential(si),
          x = supplyPositions[si]
        best.length = 0
        const list = compatible(s.materialId)
        pairs += list.length
        for (let k = 0; k < list.length; k++) {
          const dj = list[k]
          // Haul costs are never negative, so a fill priced at or below this source cannot gain.
          if (piD[dj] - piS <= tolerance) continue
          const distance = Math.abs(x - demandPositions[dj])
          const rc = unitHaulCost(distance) + TIE_DISTANCE * distance + piS - piD[dj]
          if (rc >= -tolerance || fillPairs.has(si * nD + dj)) continue
          if (!haulDirectionAllowed(h, x, demandPositions[dj])) continue
          best.push({ dj, rc })
        }
        if (pairs > MAX_NETWORK_ALLOCATION_PAIRS)
          throw Error(
            `The material plan has more than ${MAX_NETWORK_ALLOCATION_PAIRS.toLocaleString('en-CA')} possible cut-to-fill movements to price; increase station spacing or split the road.`,
          )
        if (best.length > NETWORK_ALLOCATION_ADD_PER_SOURCE) best.sort((a, b) => a.rc - b.rc)
        for (const b of best.slice(0, NETWORK_ALLOCATION_ADD_PER_SOURCE)) added += addFill(si, b.dj) ? 1 : 0
      }
      if (!added) break
      if (++rounds > MAX_NETWORK_ALLOCATION_ROUNDS)
        throw Error(
          `The material plan did not finish within ${MAX_NETWORK_ALLOCATION_ROUNDS} pricing rounds; increase station spacing or split the road.`,
        )
    }
    return { status: 'optimal' as const, net, arcs }
  }

  type Solved = Exclude<ReturnType<typeof solveRelaxed>, { status: 'infeasible' }>
  // Branch and bound over priced site openings.
  if (priced.length > MAX_NETWORK_ALLOCATION_OPENINGS)
    throw Error(
      `The material plan decides at most ${MAX_NETWORK_ALLOCATION_OPENINGS} priced site openings; disable sites or split the road.`,
    )
  const usage = (solved: Solved) => {
    const used = new Float64Array(sites.length)
    solved.arcs.forEach((arc, a) => {
      const f = solved.net.flowOf(a)
      if (f <= 0 || arc.site === undefined) return
      if (arc.kind === 'borrow' && arc.demand !== undefined) used[arc.site] += f
      if (arc.kind === 'waste' && arc.supply !== undefined) used[arc.site] += f * bankPerUnit(supplies[arc.supply])
    })
    return used
  }
  let incumbent: { solved: Solved; open: Set<number>; cost: number } | null = null
  let branches = 0,
    anyFeasible = false
  const stack: { open: Set<number>; closed: Set<number> }[] = [{ open: new Set(), closed: new Set() }]
  while (stack.length) {
    if (++branches > MAX_NETWORK_ALLOCATION_BRANCHES)
      throw Error(
        `The material plan did not finish: the search over site openings passed ${MAX_NETWORK_ALLOCATION_BRANCHES} branches. Disable sites or split the road. No partial prescription was adopted.`,
      )
    const node = stack.pop()!
    const solved = solveRelaxed(node.open, node.closed)
    if (solved.status === 'infeasible') continue
    anyFeasible = true
    const bound = solved.net.totalCost() + [...node.open].reduce((s, i) => s + sites[i].fixedCost, 0)
    if (incumbent && bound >= incumbent.cost - Math.max(0.01, Math.abs(incumbent.cost) * 1e-9)) continue
    const used = usage(solved)
    const fractional = priced.find(
      (i) =>
        !node.open.has(i) &&
        !node.closed.has(i) &&
        used[i] > siteCap[i] * 1e-9 + EPS &&
        used[i] < siteCap[i] * (1 - 1e-9) - EPS,
    )
    if (fractional === undefined) {
      const open = new Set([...node.open, ...priced.filter((i) => !node.closed.has(i) && used[i] > EPS)])
      incumbent = { solved, open, cost: bound }
      continue
    }
    stack.push({ open: node.open, closed: new Set([...node.closed, fractional]) })
    stack.push({ open: new Set([...node.open, fractional]), closed: node.closed })
  }
  const nodes = nodeCount
  if (!anyFeasible || !incumbent)
    return {
      status: 'infeasible',
      objectiveCost: null,
      movements: [],
      usedSiteIds: [],
      variables: 0,
      constraints: nodes,
      reason:
        'Material requirements, site capacities, construction directions or sidecast limits cannot all be satisfied.',
    }
  const { solved } = incumbent
  const { net, arcs } = solved

  // Movements, conservation and cost.
  const movements: Flow[] = []
  const supplyOut = new Float64Array(nS),
    demandIn = new Float64Array(nD),
    siteUsed = new Float64Array(sites.length)
  const sidecastUsed = new Map<string, number>()
  const flowTol = Math.max(1e-9, (totalFill + totalBank) * 1e-12)
  arcs.forEach((arc, a) => {
    const f = net.flowOf(a)
    if (f <= flowTol || arc.supply === undefined) {
      if (arc.kind === 'borrow' && arc.demand !== undefined && f > flowTol) {
        const site = sites[arc.site!],
          d = demands[arc.demand]
        demandIn[arc.demand] += f
        siteUsed[arc.site!] += f
        movements.push({
          kind: 'borrow',
          sourceId: site.id,
          targetId: d.parcel.id,
          materialId: site.materialId ?? null,
          fromChainage: site.chainage,
          toChainage: d.parcel.chainage,
          distanceM: Math.abs(site.chainage - d.parcel.chainage) + site.accessDistanceM,
          bankVolumeM3: null,
          compactedVolumeM3: f,
          transportedVolumeM3: f,
          volumeBasis: 'compacted',
          demandLayer: d.layer,
          demandKey: d.key,
          supplyCost: site.unitRate,
          disposalCost: 0,
        })
      }
      return
    }
    const s = supplies[arc.supply]
    const bank = f * bankPerUnit(s)
    supplyOut[arc.supply] += bank
    if (arc.kind === 'fill') {
      const d = demands[arc.demand!]
      demandIn[arc.demand!] += f
      movements.push({
        kind: 'cut-to-fill',
        sourceId: s.parcel.id,
        targetId: d.parcel.id,
        materialId: s.materialId,
        fromChainage: s.parcel.chainage,
        toChainage: d.parcel.chainage,
        distanceM: Math.abs(s.parcel.chainage - d.parcel.chainage),
        bankVolumeM3: bank,
        compactedVolumeM3: f,
        transportedVolumeM3: f,
        volumeBasis: 'compacted',
        demandLayer: d.layer,
        demandKey: d.key,
        supplyCost: 0,
        disposalCost: 0,
      })
    } else if (arc.kind === 'waste') {
      const site = sites[arc.site!]
      siteUsed[arc.site!] += bank
      movements.push({
        kind: 'waste',
        sourceId: s.parcel.id,
        targetId: site.id,
        materialId: s.materialId,
        fromChainage: s.parcel.chainage,
        toChainage: site.chainage,
        distanceM: Math.abs(s.parcel.chainage - site.chainage) + site.accessDistanceM,
        bankVolumeM3: bank,
        compactedVolumeM3: s.reusable ? f : null,
        transportedVolumeM3: bank,
        volumeBasis: 'bank',
        supplyCost: 0,
        disposalCost: site.unitRate,
      })
    } else {
      const range = ranges[arc.range!]
      const key = `${arc.range}:${parcels.indexOf(s.parcel)}`
      sidecastUsed.set(key, (sidecastUsed.get(key) ?? 0) + bank)
      movements.push({
        kind: 'waste',
        sourceId: s.parcel.id,
        targetId: `sidecast:${range.id}`,
        materialId: s.materialId,
        fromChainage: s.parcel.chainage,
        toChainage: s.parcel.chainage,
        distanceM: 0,
        bankVolumeM3: bank,
        compactedVolumeM3: s.reusable ? f : null,
        transportedVolumeM3: bank,
        volumeBasis: 'bank',
        disposalMethod: 'sidecast',
        supplyCost: 0,
        disposalCost: range.unitRate,
      })
    }
  })
  const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-5, Math.abs(b) * 1e-7)
  supplies.forEach((s, i) => {
    if (!close(supplyOut[i], s.bank))
      throw Error('Network allocation failed its independent check: a source was not all moved.')
  })
  demands.forEach((d, i) => {
    if (!close(demandIn[i], d.volume))
      throw Error('Network allocation failed its independent check: a fill was not met.')
  })
  sites.forEach((_, i) => {
    if (siteUsed[i] > siteCap[i] + Math.max(1e-5, siteCap[i] * 1e-7))
      throw Error('Network allocation failed its independent check: a site capacity was exceeded.')
  })
  for (const [key, used] of sidecastUsed) {
    const [ri, pi] = key.split(':').map(Number)
    const p = parcels[pi]
    const span = Math.max(0, Math.min(p.end, ranges[ri].end) - Math.max(p.start, ranges[ri].start))
    if (used > span * ranges[ri].capacityBankM3PerM + Math.max(1e-5, used * 1e-7))
      throw Error('Network allocation failed its independent check: a sidecast limit was exceeded.')
  }
  const usedSiteIds = sites.filter((_, i) => siteUsed[i] > flowTol).map((s) => s.id)
  const objective =
    movements.reduce(
      (sum, m) =>
        sum +
        m.transportedVolumeM3 *
          ((m.disposalMethod === 'sidecast' ? 0 : unitHaulCost(m.distanceM)) + m.supplyCost + m.disposalCost),
      0,
    ) + sites.filter((s) => usedSiteIds.includes(s.id)).reduce((sum, s: HaulSite) => sum + s.fixedCost, 0)
  const ties = movements.reduce(
    (sum, m) =>
      sum +
      (m.kind === 'cut-to-fill'
        ? m.transportedVolumeM3 * TIE_DISTANCE * m.distanceM
        : (m.kind === 'borrow' ? 1 : m.bankVolumeM3! / m.transportedVolumeM3) *
          m.transportedVolumeM3 *
          (TIE_EXTERNAL + TIE_DISTANCE * m.distanceM)),
    0,
  )
  const penalties = movements.reduce((sum, m) => {
    const id = m.kind === 'borrow' ? m.sourceId : m.kind === 'waste' ? m.targetId : null
    const i = id === null ? -1 : sites.findIndex((site) => site.id === id)
    return i < 0 ? sum : sum + penaltyOf(i) * (m.kind === 'borrow' ? m.transportedVolumeM3 : m.bankVolumeM3!)
  }, 0)
  if (Math.abs(objective + ties + penalties - incumbent.cost) > Math.max(0.01, Math.abs(objective) * 1e-6))
    throw Error('Network allocation cost does not reconcile to its material movements.')
  return {
    status: 'optimal',
    objectiveCost: objective,
    movements,
    usedSiteIds,
    variables: arcs.length,
    constraints: nodes,
    method: 'network',
  }
}
