/**
 * Minimum-cost flow by the primal network simplex method, written for the economic material plan
 * (`networkMaterialAllocation.ts`): real-valued supplies, capacities and costs, and arcs that can be
 * added to a solved network so that a pricing loop continues from the optimal tree it had.
 *
 * The method is the textbook one (Ahuja, Magnanti and Orlin, *Network Flows*, 1993, chapter 11):
 * a spanning tree of basic arcs rooted at an artificial node, every other arc at its lower or upper
 * bound, node potentials from the tree, an entering arc chosen by block search over the reduced
 * costs, and the leaving arc chosen by Cunningham's rule — the last blocking arc met when the pivot
 * cycle is walked along its orientation from its apex — which keeps the tree strongly feasible and
 * so cannot cycle on degenerate pivots. The artificial arcs start the tree (big-M costs), and any flow
 * left on them at the optimum means the supplies cannot be met.
 *
 * Reduced cost of arc a = cost(a) + π(from) − π(to). The potentials of a solved network are its
 * dual prices: an arc not in the network whose reduced cost is not negative cannot lower the cost.
 *
 * Pure: no DOM or network access.
 */

export type MinCostFlowStatus = 'optimal' | 'infeasible' | 'limit'

const LOWER = 1,
  UPPER = -1,
  TREE = 0

export class MinCostFlow {
  readonly nodeCount: number
  private readonly root: number
  private supply: Float64Array
  // Arcs (growable).
  private from: Int32Array
  private to: Int32Array
  private cost: Float64Array
  private cap: Float64Array
  private flow: Float64Array
  private state: Int8Array
  private arcs = 0
  // Tree.
  private parent: Int32Array
  private pred: Int32Array
  private depth: Int32Array
  private pi: Float64Array
  private firstChild: Int32Array
  private nextSibling: Int32Array
  private prevSibling: Int32Array
  private started = false
  private bigM = 0
  private searchStart = 0
  /** Pivots made so far, across every `solve`. */
  pivots = 0

  constructor(nodeCount: number, supplies: ArrayLike<number>, arcCapacity = 1024) {
    if (supplies.length !== nodeCount) throw Error('One supply per node is needed.')
    this.nodeCount = nodeCount
    this.root = nodeCount
    const n = nodeCount + 1
    this.supply = new Float64Array(n)
    for (let i = 0; i < nodeCount; i++) {
      const b = supplies[i]
      if (!Number.isFinite(b)) throw Error('A node supply is not a finite number.')
      this.supply[i] = b
    }
    const m = Math.max(16, arcCapacity + nodeCount)
    this.from = new Int32Array(m)
    this.to = new Int32Array(m)
    this.cost = new Float64Array(m)
    this.cap = new Float64Array(m)
    this.flow = new Float64Array(m)
    this.state = new Int8Array(m)
    this.parent = new Int32Array(n).fill(-1)
    this.pred = new Int32Array(n).fill(-1)
    this.depth = new Int32Array(n)
    this.pi = new Float64Array(n)
    this.firstChild = new Int32Array(n).fill(-1)
    this.nextSibling = new Int32Array(n).fill(-1)
    this.prevSibling = new Int32Array(n).fill(-1)
    // Artificial arcs 0 … nodeCount − 1, one per node, between it and the root.
    for (let v = 0; v < nodeCount; v++) {
      const out = this.supply[v] >= 0
      this.pushArc(out ? v : this.root, out ? this.root : v, 0, Infinity)
    }
  }

  get arcCount(): number {
    return this.arcs - this.nodeCount
  }

  private grow() {
    const m = this.from.length * 2
    const copy = <T extends Int32Array | Float64Array | Int8Array>(a: T, make: (n: number) => T) => {
      const b = make(m)
      b.set(a)
      return b
    }
    this.from = copy(this.from, (k) => new Int32Array(k))
    this.to = copy(this.to, (k) => new Int32Array(k))
    this.cost = copy(this.cost, (k) => new Float64Array(k))
    this.cap = copy(this.cap, (k) => new Float64Array(k))
    this.flow = copy(this.flow, (k) => new Float64Array(k))
    this.state = copy(this.state, (k) => new Int8Array(k))
  }

  private pushArc(from: number, to: number, cost: number, cap: number) {
    if (this.arcs === this.from.length) this.grow()
    const a = this.arcs++
    this.from[a] = from
    this.to[a] = to
    this.cost[a] = cost
    this.cap[a] = cap
    this.flow[a] = 0
    this.state[a] = LOWER
    return a
  }

  /**
   * Add an arc at zero flow; returns its id (0-based, in order of adding). Arcs may be added after
   * a solve; the next solve continues from the tree it left.
   */
  addArc(from: number, to: number, cost: number, capacity = Infinity): number {
    if (from < 0 || from >= this.nodeCount || to < 0 || to >= this.nodeCount || from === to)
      throw Error('An arc must join two different nodes of the network.')
    if (!Number.isFinite(cost) || !(capacity >= 0))
      throw Error('An arc needs a finite cost and a capacity of 0 or more.')
    if (this.started && Math.abs(cost) * (this.nodeCount + 1) >= this.bigM)
      throw Error('An arc added after solving costs more than the network was set up for.')
    return this.pushArc(from, to, cost, capacity) - this.nodeCount
  }

  flowOf(arc: number): number {
    return this.flow[arc + this.nodeCount]
  }

  /** Dual price of a node: the reduced cost of an arc u→v is cost + potential(u) − potential(v). */
  potential(node: number): number {
    return this.pi[node]
  }

  /** Flow left on the artificial arcs, which is supply that could not be routed. */
  unroutedFlow(): number {
    let sum = 0
    for (let a = 0; a < this.nodeCount; a++) sum += this.flow[a]
    return sum
  }

  /** Σ cost × flow over the real arcs. */
  totalCost(): number {
    let sum = 0
    for (let a = this.nodeCount; a < this.arcs; a++) if (this.flow[a] !== 0) sum += this.cost[a] * this.flow[a]
    return sum
  }

  /**
   * The reduced cost below which an arc is taken as not improving: rounding in potentials that hold
   * the artificial cost, or a part in 10¹⁰ of the cost scale, whichever is larger.
   */
  defaultTolerance(maxCost: number): number {
    return Math.max(
      1e-13 * (this.bigM || Math.max(1, maxCost) * (this.nodeCount + 1) * 4),
      1e-10 * Math.max(1, maxCost),
    )
  }

  private start(maxCost: number) {
    this.started = true
    this.bigM = Math.max(1, maxCost) * (this.nodeCount + 1) * 4
    const r = this.root
    this.depth[r] = 0
    this.pi[r] = 0
    for (let v = 0; v < this.nodeCount; v++) {
      const a = v
      this.cost[a] = this.bigM
      this.flow[a] = Math.abs(this.supply[v])
      this.state[a] = TREE
      this.parent[v] = r
      this.pred[v] = a
      this.depth[v] = 1
      // v→root (supply) gives π(v) = −M; root→v gives π(v) = M.
      this.pi[v] = this.from[a] === v ? -this.bigM : this.bigM
      this.linkChild(r, v)
    }
  }

  private linkChild(p: number, v: number) {
    const head = this.firstChild[p]
    this.nextSibling[v] = head
    this.prevSibling[v] = -1
    if (head >= 0) this.prevSibling[head] = v
    this.firstChild[p] = v
  }

  private unlinkChild(p: number, v: number) {
    const prev = this.prevSibling[v],
      next = this.nextSibling[v]
    if (prev >= 0) this.nextSibling[prev] = next
    else this.firstChild[p] = next
    if (next >= 0) this.prevSibling[next] = prev
    this.prevSibling[v] = this.nextSibling[v] = -1
  }

  private reducedCost(a: number) {
    return this.cost[a] + this.pi[this.from[a]] - this.pi[this.to[a]]
  }

  /**
   * Solve (or continue solving) to optimality. `maxCost` bounds |cost| of every arc that will ever
   * be added, so the artificial cost stays above any path; it is fixed by the first call.
   */
  solve(options: { maxCost: number; maxPivots?: number; costTolerance?: number }): MinCostFlowStatus {
    if (!this.started) this.start(options.maxCost)
    const maxPivots = options.maxPivots ?? 5_000_000
    const tol = options.costTolerance ?? this.defaultTolerance(options.maxCost)
    let flowScale = 0
    for (let v = 0; v < this.nodeCount; v++) flowScale += Math.abs(this.supply[v])
    const flowTol = Math.max(1e-12, flowScale * 1e-13)
    const m = this.arcs
    const block = Math.max(64, Math.ceil(Math.sqrt(m)))
    let done = 0
    for (;;) {
      // Block search: the most violating arc among the next `block` arcs that holds a violation.
      const total = this.arcs
      let best = -1,
        bestViolation = tol,
        scanned = 0
      let a = this.searchStart % total
      while (scanned < total) {
        const s = this.state[a]
        if (s !== TREE && this.cap[a] > 0) {
          const v = s * this.reducedCost(a) * -1
          if (v > bestViolation) {
            bestViolation = v
            best = a
          }
        }
        scanned++
        a = a + 1 === total ? 0 : a + 1
        if (scanned % block === 0 && best >= 0) break
      }
      this.searchStart = a
      if (best < 0) break
      if (done++ >= maxPivots) return 'limit'
      this.pivots++
      this.pivot(best, flowTol)
    }
    return this.unroutedFlow() > Math.max(1e-9, flowScale * 1e-9) ? 'infeasible' : 'optimal'
  }

  private pivot(e: number, flowTol: number) {
    const atLower = this.state[e] === LOWER
    // Orientation: flow is pushed s → t along the entering arc.
    const s = atLower ? this.from[e] : this.to[e]
    const t = atLower ? this.to[e] : this.from[e]
    let delta = atLower ? this.cap[e] - this.flow[e] : this.flow[e]
    // Find the apex.
    let u = s,
      v = t
    while (u !== v) {
      if (this.depth[u] > this.depth[v]) u = this.parent[u]
      else if (this.depth[v] > this.depth[u]) v = this.parent[v]
      else {
        u = this.parent[u]
        v = this.parent[v]
      }
    }
    const apex = u
    // Residual on each side. s-side is walked from the apex down to s (parent → child), so its
    // forward arcs point down; t-side from t up to the apex, so its forward arcs point up.
    for (let x = s; x !== apex; x = this.parent[x]) {
      const a = this.pred[x]
      const forward = this.to[a] === x
      const r = forward ? this.cap[a] - this.flow[a] : this.flow[a]
      if (r < delta) delta = r
    }
    for (let x = t; x !== apex; x = this.parent[x]) {
      const a = this.pred[x]
      const forward = this.from[a] === x
      const r = forward ? this.cap[a] - this.flow[a] : this.flow[a]
      if (r < delta) delta = r
    }
    if (!Number.isFinite(delta)) throw Error('The material plan has a cycle of unbounded negative cost.')
    if (delta < 0) delta = 0
    // Leaving arc: the last blocking arc along apex → s → t → apex. Prefer the t-side nearest the
    // apex, then the entering arc, then the s-side nearest s.
    let leaving = -1,
      leavingNode = -1,
      leavingSide: 's' | 't' | 'e' = 'e'
    for (let x = t; x !== apex; x = this.parent[x]) {
      const a = this.pred[x]
      const forward = this.from[a] === x
      const r = forward ? this.cap[a] - this.flow[a] : this.flow[a]
      if (r <= delta + flowTol) {
        leaving = a
        leavingNode = x
        leavingSide = 't'
      }
    }
    if (leaving < 0) {
      const r = atLower ? this.cap[e] - this.flow[e] : this.flow[e]
      if (r <= delta + flowTol) leavingSide = 'e'
      else {
        for (let x = s; x !== apex; x = this.parent[x]) {
          const a = this.pred[x]
          const forward = this.to[a] === x
          const rr = forward ? this.cap[a] - this.flow[a] : this.flow[a]
          // Walking up from s meets the arcs in reverse order: the first blocking one is the last.
          if (rr <= delta + flowTol) {
            leaving = a
            leavingNode = x
            leavingSide = 's'
            break
          }
        }
        if (leaving < 0) throw Error('The network simplex found no leaving arc.')
      }
    }
    // Change the flow around the cycle.
    if (delta > 0) {
      this.flow[e] += atLower ? delta : -delta
      for (let x = s; x !== apex; x = this.parent[x]) {
        const a = this.pred[x]
        this.flow[a] += this.to[a] === x ? delta : -delta
      }
      for (let x = t; x !== apex; x = this.parent[x]) {
        const a = this.pred[x]
        this.flow[a] += this.from[a] === x ? delta : -delta
      }
    }
    if (leavingSide === 'e') {
      this.state[e] = atLower ? UPPER : LOWER
      if (this.state[e] === UPPER) this.flow[e] = this.cap[e]
      else this.flow[e] = 0
      return
    }
    // Snap the leaving arc to its bound.
    const la = leaving
    const lForwardFlow = leavingSide === 't' ? this.from[la] === leavingNode : this.to[la] === leavingNode // flow increased on it
    if (lForwardFlow) {
      this.flow[la] = this.cap[la]
      this.state[la] = UPPER
    } else {
      this.flow[la] = 0
      this.state[la] = LOWER
    }
    this.state[e] = TREE
    // Re-hang the subtree cut off by the leaving arc from the entering arc's endpoint inside it.
    const q = leavingSide === 's' ? s : t
    const p = leavingSide === 's' ? t : s
    let child = q,
      newParent = p,
      newPred = e
    for (;;) {
      const oldParent = this.parent[child],
        oldPred = this.pred[child]
      this.unlinkChild(oldParent, child)
      this.parent[child] = newParent
      this.pred[child] = newPred
      this.linkChild(newParent, child)
      if (child === leavingNode) break
      newParent = child
      newPred = oldPred
      child = oldParent
    }
    // Depth and potentials of the moved subtree.
    const stack = [q]
    while (stack.length) {
      const x = stack.pop()!
      const par = this.parent[x],
        a = this.pred[x]
      this.depth[x] = this.depth[par] + 1
      this.pi[x] = this.from[a] === par ? this.pi[par] + this.cost[a] : this.pi[par] - this.cost[a]
      for (let c = this.firstChild[x]; c >= 0; c = this.nextSibling[c]) stack.push(c)
    }
  }
}
