export interface SkylineOptions {
  /** Longest side of the working image. Detail beyond this buys nothing. */
  size: number
  /**
   * Cost per pixel of vertical step between neighbouring columns. Small enough
   * to let a ridge be near-vertical, large enough that the path does not wander
   * through clouds.
   */
  slopeCost: number
  /** Largest vertical step allowed between columns, in pixels. */
  maxSlope: number
  /** Weight of "there is terrain below" against the local switch-on. */
  contrast: number
  /**
   * Cost of each unit of texture the path leaves above it.
   *
   * This is what makes the skyline the *topmost* transition rather than the
   * strongest one. A mountain frame very often has a harder edge below the
   * ridge than the ridge itself — a snowline, a shadow, a treeline — and the
   * cost has to accumulate per row rather than be averaged, or two rows of
   * ridge among sixty of sky barely register and the stronger edge wins.
   */
  skyCost: number
  /** Half-height of the local window, in pixels of the working image. */
  band: number
  /**
   * Texture level, in normalised Sobel units, below which a frame is treated as
   * having no usable structure at all. Without a floor the normalisation turns
   * the sensor noise of a fogged-in frame into a confident-looking skyline.
   */
  floor: number
}

export const DEFAULT_SKYLINE: SkylineOptions = {
  size: 192,
  slopeCost: 0.035,
  maxSlope: 28,
  contrast: 0.25,
  skyCost: 0.3,
  band: 6,
  floor: 0.06,
}

export interface Skyline {
  width: number
  height: number
  /** Horizon row per column. */
  row: Float32Array
  /** Per-column confidence, 0..1. Zero means "do not use this column". */
  strength: Float32Array
  /** Fraction of columns with a usable horizon. */
  coverage: number
}

/**
 * The sky/terrain boundary, one row per column.
 *
 * Brightness is not the cue. Snow against a blue sky inverts it and an overcast
 * sky defeats it entirely; what separates sky from mountain reliably is
 * *texture*, which is near-zero above the horizon and never below it. So the
 * boundary is scored by local edge energy plus the contrast between the mean
 * texture below a candidate row and above it, and a shortest-path walk across
 * the columns keeps the result a single connected skyline rather than a set of
 * independent guesses that can each be wrong in a different direction.
 */
export function extractSkyline(
  rgba: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  opt: SkylineOptions = DEFAULT_SKYLINE,
): Skyline {
  const scale = Math.min(1, opt.size / Math.max(srcW, srcH))
  const w = Math.max(8, Math.round(srcW * scale))
  const h = Math.max(8, Math.round(srcH * scale))

  // Box-filtered downsample: every source pixel contributes, so thin bright
  // features cannot alias into a false edge.
  const gray = new Float32Array(w * h)
  {
    const acc = new Float32Array(w * h)
    const cnt = new Float32Array(w * h)
    for (let sy = 0; sy < srcH; sy++) {
      const dy = Math.min(h - 1, ((sy * h) / srcH) | 0)
      for (let sx = 0; sx < srcW; sx++) {
        const dx = Math.min(w - 1, ((sx * w) / srcW) | 0)
        const p = (sy * srcW + sx) * 4
        acc[dy * w + dx] += 0.2126 * rgba[p] + 0.7152 * rgba[p + 1] + 0.0722 * rgba[p + 2]
        cnt[dy * w + dx]++
      }
    }
    for (let i = 0; i < gray.length; i++) gray[i] = cnt[i] ? acc[i] / cnt[i] / 255 : 0
  }

  // Sobel magnitude, then a light blur so a single noisy pixel cannot anchor
  // the path.
  const edge = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const gx =
        gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1] - (gray[i - w - 1] + 2 * gray[i - 1] + gray[i + w - 1])
      const gy =
        gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1] - (gray[i - w - 1] + 2 * gray[i - w] + gray[i - w + 1])
      edge[i] = Math.hypot(gx, gy)
    }
  }
  const tex = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      tex[i] = (edge[i - w] + edge[i - 1] + edge[i] + edge[i + 1] + edge[i + w]) / 5
    }
  }
  // Normalise against the frame's own texture, but never below an absolute
  // floor: a fogged-in frame has no structure, and dividing by its own maximum
  // would rescale the sensor noise into a confident-looking skyline.
  let texMax = opt.floor
  for (const v of tex) if (v > texMax) texMax = v

  // Everything below works on texture *above the frame's own noise floor*.
  // Empty sky is not literally smooth — sensor noise, JPEG blocking and haze
  // all register — and since the penalty below accumulates per row, sky that
  // costs anything at all would make the result depend on how much sky is in
  // frame. Subtracting a low percentile makes it cost nothing, which is both
  // truer and what keeps the tuning from being a knife edge.
  const sorted = Float32Array.from(tex).sort()
  const base = sorted[Math.floor(sorted.length * 0.2)] / texMax

  // Column-cumulative, so every window mean below is O(1).
  const cum = new Float32Array(w * (h + 1))
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const v = Math.max(0, tex[y * w + x] / texMax - base)
      cum[x * (h + 1) + y + 1] = cum[x * (h + 1) + y] + v
    }
  }
  const mean = (c: number, a: number, b: number): number => (b > a ? (cum[c + b] - cum[c + a]) / (b - a) : 0)

  /**
   * How far down a column the sky reaches.
   *
   * Read it as a running trade: moving the boundary one row down gains
   * whatever terrain that brings into view and pays for the texture it leaves
   * overhead. Through empty sky the texture costs nothing, so the boundary
   * slides freely; at the first real ridge the cost jumps and it stops. The
   * peak therefore sits at the *topmost* transition, which is what a skyline
   * is, rather than at the sharpest one, which on a snow-capped ridge is
   * several degrees too low.
   *
   * Two earlier versions of this got it wrong in instructive ways. Adding the
   * raw edge magnitude at the row is not a change-point measure at all and
   * walks the path down into whatever terrain is busiest — a constant 2.25° of
   * pitch. Averaging the penalty over the whole column above dilutes it to
   * nothing: two ridge rows among sixty of sky move a mean by 3%, and the
   * snowline still won by a clear margin.
   */
  const score = (x: number, y: number): number => {
    const c = x * (h + 1)
    const below = mean(c, y, Math.min(h, y + opt.band))
    return below + opt.contrast * mean(c, y, h) - opt.skyCost * cum[c + y]
  }

  // Shortest path across the columns. The top and bottom rows are excluded:
  // a boundary there means the horizon is outside the frame, not that it sits
  // on the edge of it.
  const y0 = 1
  const y1 = h - 2
  const best = new Float32Array(w * h).fill(-Infinity)
  const from = new Int16Array(w * h).fill(-1)
  for (let y = y0; y <= y1; y++) best[y] = score(0, y)
  for (let x = 1; x < w; x++) {
    for (let y = y0; y <= y1; y++) {
      let bv = -Infinity
      let bi = -1
      const lo = Math.max(y0, y - opt.maxSlope)
      const hi = Math.min(y1, y + opt.maxSlope)
      for (let py = lo; py <= hi; py++) {
        const v = best[(x - 1) * h + py] - opt.slopeCost * Math.abs(py - y)
        if (v > bv) {
          bv = v
          bi = py
        }
      }
      best[x * h + y] = bv + score(x, y)
      from[x * h + y] = bi
    }
  }

  let endY = y0
  for (let y = y0; y <= y1; y++) if (best[(w - 1) * h + y] > best[(w - 1) * h + endY]) endY = y

  const row = new Float32Array(w)
  const strength = new Float32Array(w)
  let y = endY
  for (let x = w - 1; x >= 0; x--) {
    // Sub-pixel: fit a parabola through the score either side of the chosen
    // row. A whole row is 0.35° of pitch at this working size, which is the
    // largest single error left in the fit, and the boundary is a soft ramp
    // rather than a step — no camera resolves a horizon in one pixel.
    let sub = 0
    if (y > y0 && y < y1) {
      const a = score(x, y - 1),
        b = score(x, y),
        c2 = score(x, y + 1)
      const denom = a - 2 * b + c2
      if (denom < -1e-9) sub = Math.max(-0.5, Math.min(0.5, (0.5 * (a - c2)) / denom))
    }
    row[x] = y + sub
    // A column earns its say from how sharply texture switches on across the
    // path. A featureless column — fog, an overexposed sky, the inside of a
    // cloud — contributes nothing rather than a confident guess.
    const c = x * (h + 1)
    const local = mean(c, y, Math.min(h, y + opt.band)) - mean(c, Math.max(0, y - opt.band), y)
    const contrast = mean(c, y, h) - mean(c, 0, y)
    strength[x] = Math.max(0, Math.min(1, 3 * local)) * Math.max(0, Math.min(1, 4 * contrast))
    y = from[x * h + y] >= 0 ? from[x * h + y] : y
  }

  let used = 0
  for (let x = 0; x < w; x++) if (strength[x] > 0.05) used++
  return { width: w, height: h, row, strength, coverage: used / w }
}

/** Convert the reader’s working rows to source image pixels. Strength is not pose confidence. */
export function textureSkyline(pixels: {
  width: number
  height: number
  data: Uint8Array | Uint8ClampedArray
}): Array<{ x: number; y: number } | null> {
  const line = extractSkyline(
    new Uint8ClampedArray(pixels.data.buffer, pixels.data.byteOffset, pixels.data.byteLength),
    pixels.width,
    pixels.height,
  )
  return Array.from(line.row, (y, i) =>
    line.strength[i] > 0.05
      ? { x: ((i + 0.5) * pixels.width) / line.width, y: (y * pixels.height) / line.height }
      : null,
  )
}
