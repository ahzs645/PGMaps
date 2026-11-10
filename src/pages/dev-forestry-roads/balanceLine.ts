/**
 * A hand-set balance line on the mass-haul diagram, as a what-if: where it cuts the curve, the road
 * between two cuts balances (cut there fills there), and the volume and haul of each balanced
 * stretch follow from the curve's shape. Nothing here feeds the design, the solved allocation or
 * the reported haul.
 *
 * The method is the classical one (mass-haul or Brückner diagram): with the curve M(x) and a
 * horizontal line at b, take thin layers of the curve between the line and each loop's peak. A layer
 * at height h is a chord across the loop; its volume dh moves the chord's width w(h). The loop's
 * volume is its peak height above the line, its haul (m³·m) is ∫ w dh, the area between curve and
 * line, and with a free-haul distance F the overhaul is ∫ (w − F) dh over the layers wider than F.
 * A chord that reaches a road end before it closes does not balance: that material comes in or
 * leaves at that end.
 *
 * The curve is taken as given: the known earthwork carried across lengths whose sections are
 * incomplete, at full distance, as the diagram draws it. No DOM.
 */

/** Layers per loop between its foot and its peak, besides a break at every vertex height. */
export const BALANCE_LINE_LAYERS = 400
const EPS = 1e-9

export interface BalanceLoop {
  /** Chainage where the loop leaves the line, or the road start when it is open there. */
  start: number
  end: number
  /** Above the line, cut comes first and moves up-station; below, it moves down-station. */
  direction: 'up-station' | 'down-station'
  /** The loop reaches a road end without coming back to the line. */
  open: 'start' | 'end' | 'both' | null
  /** Volume that balances inside the loop, m³ (the diagram's units). */
  volumeM3: number
  /** Σ volume × distance moved, m³·m. */
  haulM3m: number
  /** `haulM3m / volumeM3`; null with no volume. */
  meanHaulM: number | null
  /** Volume moved farther than the free-haul distance, and its m³·m beyond that distance. */
  overhaulM3: number
  overhaulM3m: number
}

export interface BalanceWhatIf {
  levelM3: number
  freeHaulM: number | null
  loops: BalanceLoop[]
  /** Road length inside loops that close at both ends. */
  balancedLengthM: number
  /** Totals over every loop. */
  volumeM3: number
  haulM3m: number
  overhaulM3: number
  overhaulM3m: number
  /**
   * M at the road start minus the line: above zero that much comes in at the start (borrow), below
   * zero it leaves there (waste). At the end the signs turn round: above zero it leaves.
   */
  startM3: number
  endM3: number
}

/** The levels the line can sit at: the curve's own range, which always includes zero. */
export function balanceLevelRange(balance: readonly (readonly [number, number])[]): [number, number] {
  let low = 0,
    high = 0
  for (const [, mass] of balance) {
    low = Math.min(low, mass)
    high = Math.max(high, mass)
  }
  return [low, high]
}

/** The chords of a non-negative polyline at height h: intervals where u ≥ h, with whether each touches an end. */
function chords(xs: readonly number[], us: readonly number[], h: number) {
  const out: { from: number; to: number; touchesStart: boolean; touchesEnd: boolean }[] = []
  let open: number | null = us[0] >= h ? xs[0] : null
  let fromStart = open !== null
  for (let i = 1; i < xs.length; i++) {
    const a = us[i - 1],
      b = us[i]
    if (open === null && a < h && b >= h) {
      open = b - a > EPS ? xs[i - 1] + ((h - a) / (b - a)) * (xs[i] - xs[i - 1]) : xs[i]
      fromStart = false
    } else if (open !== null && a >= h && b < h) {
      const to = a - b > EPS ? xs[i - 1] + ((a - h) / (a - b)) * (xs[i] - xs[i - 1]) : xs[i - 1]
      out.push({ from: open, to, touchesStart: fromStart, touchesEnd: false })
      open = null
    }
  }
  if (open !== null) out.push({ from: open, to: xs[xs.length - 1], touchesStart: fromStart, touchesEnd: true })
  return out
}

function loopOf(
  xs: number[],
  us: number[],
  sign: 1 | -1,
  openStart: boolean,
  openEnd: boolean,
  freeHaulM: number | null,
): BalanceLoop {
  const peak = Math.max(...us)
  // Layer breaks at every vertex height, so each chord's width is linear within a layer, then
  // split evenly so a layer is never thicker than peak / BALANCE_LINE_LAYERS.
  const breaks = [...new Set([0, peak, ...us.filter((u) => u > 0 && u < peak)])].sort((a, b) => a - b)
  let volume = 0,
    haul = 0,
    overVolume = 0,
    overHaul = 0
  for (let k = 1; k < breaks.length; k++) {
    const span = breaks[k] - breaks[k - 1]
    const parts = Math.max(1, Math.ceil((span / peak) * BALANCE_LINE_LAYERS))
    const dh = span / parts
    for (let j = 0; j < parts; j++) {
      const h = breaks[k - 1] + (j + 0.5) * dh
      for (const chord of chords(xs, us, h)) {
        // A chord that runs out at an open road end does not balance inside the road.
        if ((chord.touchesStart && openStart) || (chord.touchesEnd && openEnd)) continue
        const w = chord.to - chord.from
        volume += dh
        haul += w * dh
        if (freeHaulM !== null && w > freeHaulM + EPS) {
          overVolume += dh
          overHaul += (w - freeHaulM) * dh
        }
      }
    }
  }
  return {
    start: xs[0],
    end: xs[xs.length - 1],
    direction: sign > 0 ? 'up-station' : 'down-station',
    open: openStart && openEnd ? 'both' : openStart ? 'start' : openEnd ? 'end' : null,
    volumeM3: volume,
    haulM3m: haul,
    meanHaulM: volume > EPS ? haul / volume : null,
    overhaulM3: overVolume,
    overhaulM3m: overHaul,
  }
}

/**
 * Loops, volumes and haul for a balance line at `levelM3` on a diagram's `balance` curve
 * ([chainage, cumulative m³], in chainage order). `freeHaulM` null leaves overhaul at zero.
 */
export function balanceWhatIf(
  balance: readonly (readonly [number, number])[],
  levelM3: number,
  freeHaulM: number | null,
): BalanceWhatIf {
  const result: BalanceWhatIf = {
    levelM3,
    freeHaulM,
    loops: [],
    balancedLengthM: 0,
    volumeM3: 0,
    haulM3m: 0,
    overhaulM3: 0,
    overhaulM3m: 0,
    startM3: 0,
    endM3: 0,
  }
  if (balance.length < 2) return result
  // The curve less the line, with a vertex added wherever it crosses the line.
  const points: [number, number][] = []
  for (let i = 0; i < balance.length; i++) {
    const [x, m] = balance[i]
    const d = Math.abs(m - levelM3) < EPS ? 0 : m - levelM3
    if (i > 0) {
      const [px, pd] = points[points.length - 1]
      if (pd * d < 0) points.push([px + (pd / (pd - d)) * (x - px), 0])
    }
    points.push([x, d])
  }
  result.startM3 = points[0][1]
  result.endM3 = points[points.length - 1][1]
  // Runs of one sign between zeros.
  let first = 0
  while (first < points.length - 1) {
    let last = first + 1
    while (last < points.length - 1 && points[last][1] !== 0) last++
    const run = points.slice(first, last + 1)
    const nonZero = run.find(([, d]) => d !== 0)
    if (nonZero && run[run.length - 1][0] - run[0][0] > EPS) {
      const sign: 1 | -1 = nonZero[1] > 0 ? 1 : -1
      const openStart = first === 0 && run[0][1] !== 0
      const openEnd = last === points.length - 1 && run[run.length - 1][1] !== 0
      const loop = loopOf(
        run.map(([x]) => x),
        run.map(([, d]) => Math.max(0, sign * d)),
        sign,
        openStart,
        openEnd,
        freeHaulM,
      )
      result.loops.push(loop)
      if (!loop.open) result.balancedLengthM += loop.end - loop.start
      result.volumeM3 += loop.volumeM3
      result.haulM3m += loop.haulM3m
      result.overhaulM3 += loop.overhaulM3
      result.overhaulM3m += loop.overhaulM3m
    }
    first = last
  }
  return result
}
