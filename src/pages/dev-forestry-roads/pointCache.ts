/**
 * Numbers stored by an exact (x, y) pair, as a `Map` keyed by `x + ',' + y` stores them: positions
 * that print the same share an entry (0 and −0 alike, every NaN alike), and `set` on a known pair
 * replaces its value. A search reads its terrain and corridor caches millions of times; turning two
 * doubles into a string for each read was a third of its time, and a `Map` of `Map`s still a fifth.
 * This is an open-addressed table on typed arrays, hashed on the doubles' bits.
 *
 * Pure: no DOM or network access.
 */
const bits = new Float64Array(1),
  words = new Uint32Array(bits.buffer)

/** 0 and −0 are one key, and so is every NaN, as they are once printed. */
const canonical = (value: number) => (value !== value ? NaN : value === 0 ? 0 : value)
const same = (a: number, b: number) => a === b || (a !== a && b !== b)

function hash(x: number, y: number) {
  bits[0] = canonical(x)
  let h = Math.imul(words[0] ^ Math.imul(words[1], 0x85ebca6b), 0x9e3779b1)
  bits[0] = canonical(y)
  h = Math.imul(h ^ words[0] ^ Math.imul(words[1], 0xc2b2ae35), 0x27d4eb2f)
  return h ^ (h >>> 15)
}

export class PointCache {
  private xs: Float64Array
  private ys: Float64Array
  private values: Float64Array
  private used: Uint8Array
  private mask: number
  /** Distinct pairs held. */
  size = 0

  constructor(capacity = 1024) {
    let slots = 16
    while (slots < capacity * 2) slots *= 2
    this.xs = new Float64Array(slots)
    this.ys = new Float64Array(slots)
    this.values = new Float64Array(slots)
    this.used = new Uint8Array(slots)
    this.mask = slots - 1
  }

  /** The slot holding (x, y), or the empty slot where it would go. */
  private find(x: number, y: number) {
    let i = hash(x, y) & this.mask
    while (this.used[i] && !(same(this.xs[i], x) && same(this.ys[i], y))) i = (i + 1) & this.mask
    return i
  }

  get(x: number, y: number): number | undefined {
    const i = this.find(x, y)
    return this.used[i] ? this.values[i] : undefined
  }

  set(x: number, y: number, value: number) {
    let i = this.find(x, y)
    if (!this.used[i]) {
      // Kept at most half full, so a probe stays short.
      if ((this.size + 1) * 2 > this.used.length) {
        this.grow()
        i = this.find(x, y)
      }
      this.used[i] = 1
      this.xs[i] = x
      this.ys[i] = y
      this.size++
    }
    this.values[i] = value
  }

  private grow() {
    const { xs, ys, values, used } = this
    const slots = used.length * 2
    this.xs = new Float64Array(slots)
    this.ys = new Float64Array(slots)
    this.values = new Float64Array(slots)
    this.used = new Uint8Array(slots)
    this.mask = slots - 1
    for (let j = 0; j < used.length; j++) {
      if (!used[j]) continue
      const i = this.find(xs[j], ys[j])
      this.used[i] = 1
      this.xs[i] = xs[j]
      this.ys[i] = ys[j]
      this.values[i] = values[j]
    }
  }
}

/**
 * `value.toFixed(9)` as a number of billionths, for |value| under 1,000 (longitude and latitude):
 * equal for two values exactly when their `toFixed(9)` strings are equal. Null outside that range,
 * where the caller keys by the string itself. A value within float error of a rounding tie is
 * settled by `toFixed` itself, and "-0.000000000" keeps its own key, as it does as a string.
 */
export function fixed9Key(value: number): number | null {
  if (!(Math.abs(value) < 1000)) return null
  const scaled = value * 1e9
  const floor = Math.floor(scaled),
    fraction = scaled - floor
  // Below 1,000 the product is within 6e-5 of the exact one, so only a near-tie needs the string.
  const units =
    Math.abs(fraction - 0.5) < 1e-3 ? Number(value.toFixed(9).replace('.', '')) : fraction < 0.5 ? floor : floor + 1
  return units === 0 && value < 0 ? NEGATIVE_ZERO_KEY : units
}
/** Not a whole number, so no billionth count can take it. */
const NEGATIVE_ZERO_KEY = 0.5
