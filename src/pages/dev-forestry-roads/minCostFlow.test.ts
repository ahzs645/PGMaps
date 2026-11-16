import { describe, expect, it } from 'vitest'
import { solve, type Constraint } from 'yalps'
import { MinCostFlow } from './minCostFlow'

type Arc = [from: number, to: number, cost: number, capacity?: number]

function network(supplies: number[], arcs: Arc[]) {
  const net = new MinCostFlow(supplies.length, supplies)
  for (const [from, to, cost, capacity] of arcs) net.addArc(from, to, cost, capacity)
  return net
}

/** The same problem as a linear program, solved by the tableau solver the plan used before. */
function lp(supplies: number[], arcs: Arc[]) {
  const constraints: Record<string, Constraint> = {}
  supplies.forEach((b, v) => (constraints[`n${v}`] = { equal: b }))
  const variables: Record<string, Record<string, number>> = {}
  arcs.forEach(([from, to, cost, capacity], a) => {
    variables[`a${a}`] = { cost, [`n${from}`]: 1, [`n${to}`]: -1, ...(capacity !== undefined ? { [`c${a}`]: 1 } : {}) }
    if (capacity !== undefined) constraints[`c${a}`] = { max: capacity }
  })
  return solve({ direction: 'minimize', objective: 'cost', constraints, variables })
}

describe('minimum-cost flow', () => {
  it('solves a transport problem to its worked optimum', () => {
    // Two sources (10, 15) to three sinks (8, 9, 8); costs by hand: the optimum ships
    // 0→0 8, 0→2 2, 1→1 9, 1→2 6 for 8·1 + 2·4 + 9·2 + 6·3 = 52.
    const supplies = [10, 15, -8, -9, -8]
    const arcs: Arc[] = [
      [0, 2, 1],
      [0, 3, 5],
      [0, 4, 4],
      [1, 2, 6],
      [1, 3, 2],
      [1, 4, 3],
    ]
    const net = network(supplies, arcs)
    expect(net.solve({ maxCost: 6 })).toBe('optimal')
    expect(net.totalCost()).toBeCloseTo(52, 9)
    expect([0, 1, 2, 3, 4, 5].map((a) => net.flowOf(a))).toEqual([8, 0, 2, 0, 9, 6])
    // The potentials price every arc: none at zero flow has a negative reduced cost.
    arcs.forEach(([from, to, cost], a) => {
      const reduced = cost + net.potential(from) - net.potential(to)
      if (net.flowOf(a) === 0) expect(reduced).toBeGreaterThanOrEqual(-1e-9)
      else expect(reduced).toBeCloseTo(0, 9)
    })
  })

  it('respects capacities and reports supply that cannot be routed', () => {
    const capped = network(
      [5, -5],
      [
        [0, 1, 1, 3],
        [0, 1, 4],
      ],
    )
    expect(capped.solve({ maxCost: 4 })).toBe('optimal')
    expect([capped.flowOf(0), capped.flowOf(1)]).toEqual([3, 2])
    expect(capped.totalCost()).toBeCloseTo(11, 9)
    const blocked = network([5, -5], [[0, 1, 1, 3]])
    expect(blocked.solve({ maxCost: 1 })).toBe('infeasible')
    expect(blocked.unroutedFlow()).toBeCloseTo(4, 9)
  })

  it('continues from its tree when an arc is added, to the same optimum as a fresh solve', () => {
    const supplies = [10, 15, -8, -9, -8]
    const arcs: Arc[] = [
      [0, 2, 1],
      [0, 3, 5],
      [1, 3, 2],
      [1, 4, 3],
      [0, 4, 9],
      [1, 2, 9],
    ]
    const net = network(supplies, arcs)
    expect(net.solve({ maxCost: 9 })).toBe('optimal')
    const before = net.totalCost()
    net.addArc(0, 4, 0.5)
    expect(net.solve({ maxCost: 9 })).toBe('optimal')
    const fresh = network(supplies, [...arcs, [0, 4, 0.5]])
    expect(fresh.solve({ maxCost: 9 })).toBe('optimal')
    expect(net.totalCost()).toBeCloseTo(fresh.totalCost(), 9)
    expect(net.totalCost()).toBeLessThan(before)
  })

  it('agrees with the tableau linear program on random networks', () => {
    let seed = 11
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    for (let trial = 0; trial < 60; trial++) {
      const n = 4 + Math.floor(random() * 9)
      const supplies = Array.from({ length: n }, () => Math.round((random() - 0.5) * 40 * 1000) / 1000)
      supplies[n - 1] -= supplies.reduce((s, b) => s + b, 0)
      const arcs: Arc[] = []
      for (let k = 0; k < n * 3; k++) {
        const from = Math.floor(random() * n),
          to = Math.floor(random() * n)
        if (from === to) continue
        arcs.push(random() < 0.3 ? [from, to, random() * 10, random() * 15] : [from, to, random() * 10])
      }
      const net = network(supplies, arcs)
      const status = net.solve({ maxCost: 10 })
      const reference = lp(supplies, arcs)
      expect(status === 'optimal' ? 'optimal' : 'infeasible').toBe(
        reference.status === 'optimal' ? 'optimal' : 'infeasible',
      )
      if (status === 'optimal') expect(net.totalCost()).toBeCloseTo(reference.result, 6)
    }
  })

  it('refuses arcs it cannot hold', () => {
    const net = new MinCostFlow(2, [1, -1])
    expect(() => net.addArc(0, 0, 1)).toThrow(/two different nodes/)
    expect(() => net.addArc(0, 1, Number.NaN)).toThrow(/finite cost/)
    expect(() => new MinCostFlow(2, [1])).toThrow(/One supply per node/)
  })
})
