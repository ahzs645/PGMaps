/**
 * Exact adjacent-chain formulation for continuous linear, zero-loading haul quotes.
 * A fill chain transports bank material at its compacted-volume haul cost; a separate waste
 * chain transports bank volume. This avoids the dense all-source/all-demand transport matrix.
 * Every solved chain is decomposed back to actual source→destination movements and rechecked.
 */
import { solve, type Constraint, type Model } from 'yalps'
import { acceptsFill, haulDirectionAllowed, materialDemandKey, requiredFillAt } from './allocationPolicy'
import type { AlignmentEngineering, FillRequirement, HaulSite } from './engineeringTypes'
import type { AllocationParcel, EconomicAllocation, Flow } from './materialAllocation'

export const MAX_SPARSE_ALLOCATION_VARIABLES = 20_000
export const MAX_SPARSE_ALLOCATION_CONSTRAINTS = 1_200
export const MAX_SPARSE_ALLOCATION_TABLEAU_CELLS = 3_000_000
const MAX_OPENINGS = 12
const EPS = 1e-8
type Demand = { parcel: AllocationParcel; volume: number; layer: string; key: string; requirement?: FillRequirement }
type Supply = { parcel: AllocationParcel; materialId: string; bank: number; factor: number; reusable: boolean }
type Net = {
  kind: 'fill' | 'waste'
  run: number
  materialId: string
  factor: number
  supplies: number[]
  sinks: number[]
  positions: number[]
  nodes: string[]
  injections: { variable: string; supply: number; node: number }[]
  arcs: { variable: string; from: number; to: number }[]
  outlets: { variable: string; target: number; node: number }[]
}

/** Return the proven tariff slope over the entire possible haul domain, or null. */
export function linearHaulSlope(
  e: AlignmentEngineering,
  maximumDistanceM: number,
  unitCost: (distanceM: number) => number,
): number | null {
  const h = e.haul
  if (
    !Number.isFinite(maximumDistanceM) ||
    maximumDistanceM < 0 ||
    [h.freeHaulLoadingRate, h.overhaulLoadingRate, h.endHaulLoadingRate].some((rate) => rate !== 0)
  )
    return null
  const f = h.freeHaulDistanceM,
    o = h.overhaulDistanceM
  let slope: number
  if (maximumDistanceM <= f) slope = h.freeHaulRate / 1_000
  else if (f > 0) {
    // Beyond free haul the existing tariff prices only the excess distance. At nonzero free
    // distance this is linear through the origin only when all reachable distance rates are 0.
    const rates = [
      h.freeHaulRate,
      ...(maximumDistanceM > f && o > f ? [h.overhaulRate] : []),
      ...(maximumDistanceM > o ? [h.endHaulRate] : []),
    ]
    if (rates.some((rate) => rate !== 0)) return null
    slope = 0
  } else {
    const rates = [...(o > 0 ? [h.overhaulRate] : []), ...(maximumDistanceM > o ? [h.endHaulRate] : [])]
    if (!rates.length) rates.push(h.freeHaulRate)
    if (rates.some((rate) => rate !== rates[0])) return null
    slope = rates[0] / 1_000
  }
  if (!Number.isFinite(slope) || slope < 0) return null
  // haulCharge gives the zero-distance free class an epsilon-wide interval even when f=0.
  // Different free rates would therefore still be a tiny non-linear step, not an exact chain quote.
  if (maximumDistanceM > 0 && f === 0 && h.freeHaulRate / 1_000 !== slope) return null
  // Verify that the supplied callback is the same tariff, including its exact boundary behavior.
  const samples = [0, maximumDistanceM, maximumDistanceM / 2, ...[f, o].flatMap((d) => [d, d - 1e-6, d + 1e-6])]
  for (const d of samples.filter((d) => d >= 0 && d <= maximumDistanceM)) {
    const actual = unitCost(d),
      expected = slope * d
    if (!Number.isFinite(actual) || Math.abs(actual - expected) > Math.max(1e-10, Math.abs(expected) * 1e-10))
      return null
  }
  return slope
}

/** Null means the quote is not representable by this exact formulation; callers must use dense allocation. */
export function solveSparseMaterialAllocation(
  e: AlignmentEngineering,
  parcels: AllocationParcel[],
  unitHaulCost: (distanceM: number) => number,
  options: { deferExternal?: boolean } = {},
): EconomicAllocation | null {
  if (options.deferExternal) return null
  const sites = e.sites.filter((site) => site.enabled !== false)
  const runs = new Map<number, { start: number; end: number }>()
  for (const p of parcels) {
    if (![p.start, p.end, p.chainage, p.fill].every(Number.isFinite) || p.end < p.start || p.fill < 0)
      throw Error('Sparse allocation received an invalid interval or fill quantity.')
    const run = runs.get(p.run)
    if (run) {
      run.start = Math.min(run.start, p.start)
      run.end = Math.max(run.end, p.end)
    } else runs.set(p.run, { start: p.start, end: p.end })
  }
  const reachable = (site: HaulSite, runId: number) => {
    const run = runs.get(runId)!,
      station = Math.round(site.chainage * 1e6) / 1e6
    return station >= run.start - 1e-7 && station <= run.end + 1e-7
  }
  const maximumDistanceM = Math.max(
    0,
    ...[...runs].map(
      ([runId, run]) =>
        run.end - run.start + Math.max(0, ...sites.filter((s) => reachable(s, runId)).map((s) => s.accessDistanceM)),
    ),
  )
  const slope = linearHaulSlope(e, maximumDistanceM, unitHaulCost)
  if (slope === null) return null

  const supplies: Supply[] = [],
    demands: Demand[] = []
  for (const p of parcels) {
    const extras = p.demands ?? []
    if (extras.some((d) => !Number.isFinite(d.volumeM3) || d.volumeM3 < 0))
      throw Error('Sparse allocation received an invalid layer demand.')
    const subgradeDemand = extras.filter((d) => d.subgrade).reduce((sum, d) => sum + d.volumeM3, 0)
    if (subgradeDemand > p.fill + Math.max(1e-5, p.fill * 1e-7))
      throw Error('Component material demand exceeds its containing subgrade fill.')
    const subgrade = Math.max(0, p.fill - extras.filter((d) => d.subgrade).reduce((sum, d) => sum + d.volumeM3, 0))
    for (const d of [{ layer: 'subgrade', volumeM3: subgrade, key: 'subgrade' }, ...extras]) {
      if (d.volumeM3 <= EPS) continue
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
      if (
        !Number.isFinite(m.factor) ||
        m.factor <= 0 ||
        ![m.usable, m.unusable, m.bank].every((v) => Number.isFinite(v) && v >= 0)
      )
        throw Error('Sparse allocation received invalid material volumes or conversion factors.')
      if (Math.abs(m.usable / m.factor + m.unusable - m.bank) > Math.max(1e-5, m.bank * 1e-7))
        throw Error('Classified usable and unsuitable material do not conserve bank excavation.')
      if (m.usable / m.factor > EPS)
        supplies.push({
          parcel: p,
          materialId: m.materialId,
          bank: m.usable / m.factor,
          factor: m.factor,
          reusable: true,
        })
      if (m.unusable > EPS)
        supplies.push({ parcel: p, materialId: m.materialId, bank: m.unusable, factor: m.factor, reusable: false })
    }
  }
  const constraints: Record<string, Constraint> = {},
    variables: Record<string, Record<string, number>> = {}
  const binaries: string[] = [],
    activeSites = new Set<number>()
  if (supplies.length + demands.length + sites.length > MAX_SPARSE_ALLOCATION_CONSTRAINTS)
    throw Error(
      'Sparse economic allocation model exceeds its constraint budget; increase station spacing or split the road.',
    )
  let variableCount = 0
  const add = (cost: number, coefficients: Record<string, number>) => {
    if (++variableCount > MAX_SPARSE_ALLOCATION_VARIABLES)
      throw Error('Sparse material allocation exceeds 20,000 variables; split the road.')
    if (!Number.isFinite(cost) || cost < 0) throw Error('Sparse allocation received an invalid cost.')
    const id = `v${variableCount}`
    variables[id] = { ...coefficients, cost }
    return id
  }
  const sKey = (i: number) => `s${i}`,
    dKey = (i: number) => `d${i}`,
    capKey = (i: number) => `cap${i}`
  supplies.forEach((s, i) => {
    constraints[sKey(i)] = { equal: s.bank }
  })
  demands.forEach((d, i) => {
    constraints[dKey(i)] = { equal: d.volume }
  })
  const totalFill = demands.reduce((sum, d) => sum + d.volume, 0),
    totalBank = supplies.reduce((sum, s) => sum + s.bank, 0)
  sites.forEach((site, i) => {
    constraints[capKey(i)] = {
      max: Math.min(site.capacityM3 ?? Infinity, site.kind === 'borrow' ? totalFill : totalBank),
    }
  })
  const nets: Net[] = [],
    byNet = new Map<string, Net>()
  const network = (kind: Net['kind'], supply: Supply) => {
    const key = JSON.stringify([kind, supply.parcel.run, supply.materialId, kind === 'fill' ? supply.factor : 1])
    let net = byNet.get(key)
    if (!net) {
      net = {
        kind,
        run: supply.parcel.run,
        materialId: supply.materialId,
        factor: kind === 'fill' ? supply.factor : 1,
        supplies: [],
        sinks: [],
        positions: [],
        nodes: [],
        injections: [],
        arcs: [],
        outlets: [],
      }
      byNet.set(key, net)
      nets.push(net)
    }
    return net
  }
  supplies.forEach((s, i) => {
    if (
      s.reusable &&
      demands.some((d) => d.parcel.run === s.parcel.run && acceptsFill(s.materialId, d.requirement, e.materials))
    )
      network('fill', s).supplies.push(i)
    if (
      sites.some(
        (site) =>
          site.kind === 'waste' &&
          reachable(site, s.parcel.run) &&
          (!site.materialId || site.materialId === s.materialId),
      )
    )
      network('waste', s).supplies.push(i)
  })
  for (let ni = 0; ni < nets.length; ni++) {
    const net = nets[ni]
    net.sinks =
      net.kind === 'fill'
        ? demands.flatMap((d, i) =>
            d.parcel.run === net.run && acceptsFill(net.materialId, d.requirement, e.materials) ? [i] : [],
          )
        : sites.flatMap((site, i) =>
            site.kind === 'waste' &&
            reachable(site, net.run) &&
            (!site.materialId || site.materialId === net.materialId)
              ? [i]
              : [],
          )
    net.positions = [
      ...new Set([
        ...net.supplies.map((i) => supplies[i].parcel.chainage),
        ...net.sinks.map((i) => (net.kind === 'fill' ? demands[i].parcel.chainage : sites[i].chainage)),
      ]),
    ].sort((a, b) => a - b)
    const index = new Map(net.positions.map((s, i) => [s, i]))
    net.nodes = net.positions.map((_, i) => `n${ni}:${i}`)
    net.nodes.forEach((key) => {
      constraints[key] = { equal: 0 }
    })
    for (const si of net.supplies) {
      const node = index.get(supplies[si].parcel.chainage)!
      net.injections.push({ supply: si, node, variable: add(0, { [sKey(si)]: 1, [net.nodes[node]]: 1 }) })
    }
    for (let i = 1; i < net.positions.length; i++) {
      const from = net.positions[i - 1],
        to = net.positions[i],
        cost = (to - from) * slope * (net.kind === 'fill' ? net.factor : 1)
      if (haulDirectionAllowed(e.haul, from, to))
        net.arcs.push({ from: i - 1, to: i, variable: add(cost, { [net.nodes[i - 1]]: -1, [net.nodes[i]]: 1 }) })
      if (haulDirectionAllowed(e.haul, to, from))
        net.arcs.push({ from: i, to: i - 1, variable: add(cost, { [net.nodes[i]]: -1, [net.nodes[i - 1]]: 1 }) })
    }
    for (const target of net.sinks) {
      const node = index.get(net.kind === 'fill' ? demands[target].parcel.chainage : sites[target].chainage)!
      const variable =
        net.kind === 'fill'
          ? add(0, { [net.nodes[node]]: -1, [dKey(target)]: net.factor })
          : add(sites[target].unitRate + sites[target].accessDistanceM * slope, {
              [net.nodes[node]]: -1,
              [capKey(target)]: 1,
            })
      net.outlets.push({ variable, target, node })
      if (net.kind === 'waste') activeSites.add(target)
    }
  }
  const direct: { variable: string; flow: Flow; supply?: number; demand?: number; site?: number }[] = []
  for (let si = 0; si < supplies.length; si++) {
    const s = supplies[si]
    for (let ri = 0; ri < (e.haul.sidecastRanges ?? []).length; ri++) {
      const range = e.haul.sidecastRanges![ri]
      const span = Math.max(0, Math.min(s.parcel.end, range.end) - Math.max(s.parcel.start, range.start))
      if (
        span <= EPS ||
        s.parcel.chainage < range.start ||
        s.parcel.chainage >= range.end ||
        (range.materialIds && !range.materialIds.includes(s.materialId))
      )
        continue
      const key = `side${ri}:${parcels.indexOf(s.parcel)}`
      constraints[key] = { max: span * range.capacityBankM3PerM }
      direct.push({
        variable: add(range.unitRate, { [sKey(si)]: 1, [key]: 1 }),
        supply: si,
        flow: {
          kind: 'waste',
          sourceId: s.parcel.id,
          targetId: `sidecast:${range.id}`,
          materialId: s.materialId,
          fromChainage: s.parcel.chainage,
          toChainage: s.parcel.chainage,
          distanceM: 0,
          bankVolumeM3: 1,
          compactedVolumeM3: s.reusable ? s.factor : null,
          transportedVolumeM3: 1,
          volumeBasis: 'bank',
          disposalMethod: 'sidecast',
          supplyCost: 0,
          disposalCost: range.unitRate,
        },
      })
    }
  }
  demands.forEach((d, di) =>
    sites.forEach((site, siteIndex) => {
      if (
        site.kind !== 'borrow' ||
        !reachable(site, d.parcel.run) ||
        !acceptsFill(site.materialId ?? null, d.requirement, e.materials) ||
        !haulDirectionAllowed(e.haul, site.chainage, d.parcel.chainage)
      )
        return
      const distanceM = Math.abs(site.chainage - d.parcel.chainage) + site.accessDistanceM
      direct.push({
        variable: add(site.unitRate + distanceM * slope, { [dKey(di)]: 1, [capKey(siteIndex)]: 1 }),
        demand: di,
        site: siteIndex,
        flow: {
          kind: 'borrow',
          sourceId: site.id,
          targetId: d.parcel.id,
          materialId: site.materialId ?? null,
          fromChainage: site.chainage,
          toChainage: d.parcel.chainage,
          distanceM,
          bankVolumeM3: null,
          compactedVolumeM3: 1,
          transportedVolumeM3: 1,
          volumeBasis: 'compacted',
          demandLayer: d.layer,
          demandKey: d.key,
          supplyCost: site.unitRate,
          disposalCost: 0,
        },
      })
      activeSites.add(siteIndex)
    }),
  )
  for (const i of activeSites) {
    const site = sites[i],
      cap = constraints[capKey(i)].max!
    if (site.fixedCost > 0 && cap > EPS) {
      if (binaries.length >= MAX_OPENINGS)
        throw Error(
          'Sparse economic allocation supports at most 12 priced site openings; disable sites or split the road.',
        )
      constraints[capKey(i)] = { max: 0 }
      binaries.push(add(site.fixedCost, { [capKey(i)]: -cap }))
    }
  }
  const n = Object.keys(variables).length,
    m = Object.keys(constraints).length,
    cells = (n + 1) * (m * 2 + binaries.length + 1)
  if (m > MAX_SPARSE_ALLOCATION_CONSTRAINTS || cells > MAX_SPARSE_ALLOCATION_TABLEAU_CELLS)
    throw Error(
      'Sparse economic allocation model exceeds its browser budget; increase station spacing or split the road.',
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
  if (!supplies.length && !demands.length)
    return { status: 'optimal', objectiveCost: 0, movements: [], usedSiteIds: [], variables: n, constraints: m }
  if (!n)
    return infeasible('No compatible, reachable material source or disposal capacity satisfies the construction rules.')
  const model: Model = { direction: 'minimize', objective: 'cost', variables, constraints, binaries }
  const maxPivots = Math.min(8192, Math.max(128, Math.floor(500_000_000 / Math.max(1, cells))))
  const result = solve(model, {
    precision: 1e-8,
    tolerance: 0,
    maxPivots,
    maxIterations: 2048,
    timeout: 3000,
    checkCycles: true,
  })
  if (result.status === 'infeasible')
    return infeasible(
      'Material requirements, site capacities, construction directions or sidecast limits cannot all be satisfied.',
    )
  if (result.status !== 'optimal' || !Number.isFinite(result.result))
    throw Error(
      `Sparse economic allocation did not finish an optimal solution (${result.status}; ${n} variables, ${m} constraints, ${maxPivots} pivots). No partial prescription was adopted.`,
    )
  const values = new Map(result.variables)
  for (const [key, bound] of Object.entries(constraints)) {
    let value = 0
    for (const [variable, coefficients] of Object.entries(variables))
      value += (values.get(variable) ?? 0) * (coefficients[key] ?? 0)
    const tolerance = Math.max(1e-5, Math.abs(bound.equal ?? bound.max ?? 0) * 1e-7)
    if (
      (bound.equal !== undefined && Math.abs(value - bound.equal) > tolerance) ||
      (bound.max !== undefined && value > bound.max + tolerance)
    )
      throw Error('Sparse allocation failed its independent material-conservation check.')
  }
  for (const id of binaries)
    if (Math.abs((values.get(id) ?? 0) - Math.round(values.get(id) ?? 0)) > 1e-6)
      throw Error('Sparse allocation returned an unresolved site-opening decision.')
  const movements: Flow[] = [],
    usedSites = new Set<number>(),
    supplyOut = new Float64Array(supplies.length),
    demandIn = new Float64Array(demands.length),
    siteUsed = new Float64Array(sites.length)
  const emit = (unit: Flow, volume: number) => {
    if (volume <= EPS) return
    movements.push({
      ...unit,
      bankVolumeM3: unit.bankVolumeM3 === null ? null : unit.bankVolumeM3 * volume,
      compactedVolumeM3: unit.compactedVolumeM3 === null ? null : unit.compactedVolumeM3 * volume,
      transportedVolumeM3: unit.transportedVolumeM3 * volume,
    })
  }
  for (const row of direct) {
    const amount = Math.max(0, values.get(row.variable) ?? 0)
    emit(row.flow, amount)
    if (row.supply !== undefined) supplyOut[row.supply] += amount
    if (row.demand !== undefined) demandIn[row.demand] += amount
    if (row.site !== undefined && amount > EPS) {
      usedSites.add(row.site)
      siteUsed[row.site] += amount
    }
  }
  for (const net of nets) {
    type Packet = { supply: number; amount: number }
    const packets: Packet[][] = net.nodes.map(() => []),
      arcs = net.arcs.map((a) => ({ ...a, remaining: Math.max(0, values.get(a.variable) ?? 0) }))
    // Cancel opposite flows, which can only survive at zero cost in an optimum. This leaves
    // a directed acyclic chain without changing node conservation or the objective.
    for (const arc of arcs) {
      const reverse = arcs.find((a) => a.from === arc.to && a.to === arc.from)
      if (!reverse) continue
      const cancel = Math.min(arc.remaining, reverse.remaining)
      arc.remaining -= cancel
      reverse.remaining -= cancel
    }
    for (const injection of net.injections) {
      const amount = Math.max(0, values.get(injection.variable) ?? 0)
      if (amount > EPS) packets[injection.node].push({ supply: injection.supply, amount })
    }
    const degree = new Int32Array(net.nodes.length),
      outgoing = net.nodes.map(() => [] as typeof arcs)
    for (const arc of arcs)
      if (arc.remaining > EPS) {
        degree[arc.to]++
        outgoing[arc.from].push(arc)
      }
    const queue = Array.from(degree.keys()).filter((i) => degree[i] === 0)
    let visited = 0
    for (let qi = 0; qi < queue.length; qi++) {
      const node = queue[qi]
      visited++
      const available = packets[node]
      let head = 0
      const take = (amount: number, accept: (supply: number, volume: number) => void) => {
        let left = amount
        while (left > EPS && head < available.length) {
          const packet = available[head],
            used = Math.min(left, packet.amount)
          if (used > EPS) accept(packet.supply, used)
          packet.amount -= used
          left -= used
          if (packet.amount <= EPS) head++
        }
        if (left > Math.max(1e-5, amount * 1e-7))
          throw Error('Sparse flow could not be decomposed into conserved source movements.')
      }
      for (const outlet of net.outlets.filter((o) => o.node === node)) {
        const amount = Math.max(0, values.get(outlet.variable) ?? 0)
        take(amount, (si, bank) => {
          const s = supplies[si]
          supplyOut[si] += bank
          if (net.kind === 'fill') {
            const d = demands[outlet.target]
            demandIn[outlet.target] += bank * net.factor
            emit(
              {
                kind: 'cut-to-fill',
                sourceId: s.parcel.id,
                targetId: d.parcel.id,
                materialId: s.materialId,
                fromChainage: s.parcel.chainage,
                toChainage: d.parcel.chainage,
                distanceM: Math.abs(s.parcel.chainage - d.parcel.chainage),
                bankVolumeM3: 1,
                compactedVolumeM3: net.factor,
                transportedVolumeM3: net.factor,
                volumeBasis: 'compacted',
                demandLayer: d.layer,
                demandKey: d.key,
                supplyCost: 0,
                disposalCost: 0,
              },
              bank,
            )
          } else {
            const site = sites[outlet.target]
            usedSites.add(outlet.target)
            siteUsed[outlet.target] += bank
            emit(
              {
                kind: 'waste',
                sourceId: s.parcel.id,
                targetId: site.id,
                materialId: s.materialId,
                fromChainage: s.parcel.chainage,
                toChainage: site.chainage,
                distanceM: Math.abs(s.parcel.chainage - site.chainage) + site.accessDistanceM,
                bankVolumeM3: 1,
                compactedVolumeM3: s.reusable ? s.factor : null,
                transportedVolumeM3: 1,
                volumeBasis: 'bank',
                supplyCost: 0,
                disposalCost: site.unitRate,
              },
              bank,
            )
          }
        })
      }
      for (const arc of outgoing[node]) {
        take(arc.remaining, (supply, amount) => packets[arc.to].push({ supply, amount }))
        if (!--degree[arc.to]) queue.push(arc.to)
      }
      const residual = available.slice(head).reduce((sum, p) => sum + p.amount, 0)
      if (residual > Math.max(1e-5, supplies.reduce((sum, s) => sum + s.bank, 0) * 1e-7))
        throw Error('Sparse flow left source material without a destination.')
    }
    if (visited !== net.nodes.length) throw Error('Sparse flow decomposition contains a directed cycle.')
  }
  supplies.forEach((s, i) => {
    if (Math.abs(s.bank - supplyOut[i]) > Math.max(1e-5, s.bank * 1e-7))
      throw Error('Sparse source movements do not conserve bank excavation.')
  })
  demands.forEach((d, i) => {
    if (Math.abs(d.volume - demandIn[i]) > Math.max(1e-5, d.volume * 1e-7))
      throw Error('Sparse demand movements do not conserve compacted fill.')
  })
  sites.forEach((site, i) => {
    if (site.capacityM3 !== null && siteUsed[i] > site.capacityM3 + Math.max(1e-5, site.capacityM3 * 1e-7))
      throw Error('Sparse movements exceed a physical site capacity.')
  })
  const objective =
    movements.reduce(
      (sum, m) =>
        sum +
        m.transportedVolumeM3 *
          ((m.disposalMethod === 'sidecast' ? 0 : unitHaulCost(m.distanceM)) + m.supplyCost + m.disposalCost),
      0,
    ) + [...usedSites].reduce((sum, i) => sum + sites[i].fixedCost, 0)
  if (Math.abs(objective - result.result) > Math.max(0.01, Math.abs(result.result) * 1e-6))
    throw Error('Sparse material movements do not reconcile to the solved cost.')
  return {
    status: 'optimal',
    objectiveCost: objective,
    movements,
    usedSiteIds: [...usedSites].map((i) => sites[i].id),
    variables: n,
    constraints: m,
  }
}
