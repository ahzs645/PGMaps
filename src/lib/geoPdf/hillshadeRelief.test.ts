import { describe, expect, it } from 'vitest'
import {
  fitHillshadeLighting,
  hillshadeOnGrid,
  refineWithHillshade,
  refineWithHillshadeNow,
  RELIEF,
  type ReliefInput,
} from './hillshadeRelief'
import type { PdfImageMosaic } from './types'

const WIDTH = 200,
  HEIGHT = 140,
  CELL = 2,
  INTERVAL = 10
/** A hillside rising to the east with gullies and benches a contour TIN cannot hold. Rows run south. */
const ground = (col: number, row: number) => {
  const x = col * CELL,
    y = (HEIGHT - 1 - row) * CELL
  return (
    900 +
    0.32 * x +
    0.06 * y +
    // Shapes the contours hold, then relief finer than their spacing.
    7 * Math.sin(x / 45) * Math.cos(y / 38) +
    1.1 * Math.sin(x / 6.5) * Math.cos(y / 11) +
    0.7 * Math.sin(y / 9)
  )
}
const truth = Float32Array.from({ length: WIDTH * HEIGHT }, (_, i) => ground(i % WIDTH, Math.floor(i / WIDTH)))
/** The shading formula a plain hillshade uses, on central differences, quantised to a byte. */
function hillshade(z: Float32Array, azimuthDeg = 315, altitudeDeg = 45, curve = (v: number) => v) {
  const zenith = ((90 - altitudeDeg) * Math.PI) / 180,
    az = (azimuthDeg * Math.PI) / 180
  const out = new Float32Array(z.length).fill(NaN)
  for (let row = 1; row < HEIGHT - 1; row++)
    for (let col = 1; col < WIDTH - 1; col++) {
      const i = row * WIDTH + col
      const p = (z[i + 1] - z[i - 1]) / (2 * CELL),
        q = (z[i - WIDTH] - z[i + WIDTH]) / (2 * CELL)
      const v =
        (Math.cos(zenith) - Math.sin(zenith) * (p * Math.sin(az) + q * Math.cos(az))) / Math.sqrt(1 + p * p + q * q)
      out[i] = Math.round(255 * curve(Math.max(0, Math.min(1, v)))) / 255
    }
  return out
}
/** Where the ground crosses each contour level along the rows and the columns: the sheet's contour lines as points. */
function contourPoints() {
  const points: number[] = []
  const cross = (a: number, b: number) => {
    const out: [number, number][] = []
    for (let level = Math.ceil(Math.min(a, b) / INTERVAL) * INTERVAL; level <= Math.max(a, b); level += INTERVAL)
      if (a !== b) out.push([(level - a) / (b - a), level])
    return out
  }
  for (let row = 0; row < HEIGHT; row++)
    for (let col = 0; col < WIDTH - 1; col++)
      for (const [t, level] of cross(truth[row * WIDTH + col], truth[row * WIDTH + col + 1]))
        points.push(col + t, row, level)
  for (let col = 0; col < WIDTH; col++)
    for (let row = 0; row < HEIGHT - 1; row++)
      for (const [t, level] of cross(truth[row * WIDTH + col], truth[(row + 1) * WIDTH + col]))
        points.push(col, row + t, level)
  return Float32Array.from(points)
}
/** The contour surface a sheet gives: straight lines between the contours along each row, nothing past the outer ones. */
function contourSurface() {
  const prior = new Float32Array(WIDTH * HEIGHT).fill(NaN)
  for (let row = 0; row < HEIGHT; row++) {
    const crossings: [number, number][] = []
    for (let col = 0; col < WIDTH - 1; col++) {
      const a = truth[row * WIDTH + col],
        b = truth[row * WIDTH + col + 1]
      for (let level = Math.ceil(Math.min(a, b) / INTERVAL) * INTERVAL; level <= Math.max(a, b); level += INTERVAL)
        if (a !== b) crossings.push([col + (level - a) / (b - a), level])
    }
    crossings.sort((a, b) => a[0] - b[0])
    for (let k = 1; k < crossings.length; k++) {
      const [c0, z0] = crossings[k - 1],
        [c1, z1] = crossings[k]
      for (let col = Math.ceil(c0); col <= Math.floor(c1); col++)
        prior[row * WIDTH + col] = c1 > c0 ? z0 + ((z1 - z0) * (col - c0)) / (c1 - c0) : z0
    }
  }
  return prior
}
const input = (shade = hillshade(truth)): ReliefInput => ({
  width: WIDTH,
  height: HEIGHT,
  cellM: CELL,
  prior: contourSurface(),
  shade,
  anchors: contourPoints(),
  intervalM: INTERVAL,
})
/** Root-mean-square miss of the true ground, over the cells both surfaces have, away from the edge. */
function miss(values: Float32Array, among: Float32Array) {
  let sum = 0,
    count = 0
  for (let row = 12; row < HEIGHT - 12; row++)
    for (let col = 12; col < WIDTH - 12; col++) {
      const i = row * WIDTH + col
      if (!Number.isFinite(values[i]) || !Number.isFinite(among[i])) continue
      sum += (values[i] - truth[i]) ** 2
      count++
    }
  return Math.sqrt(sum / count)
}

describe('ground between contours from a hillshade', () => {
  it('reads the sun from the hillshade and the contours together', () => {
    const light = fitHillshadeLighting(contourSurface(), hillshade(truth), WIDTH, HEIGHT, CELL)
    expect(light.azimuthDeg).toBeGreaterThan(305)
    expect(light.azimuthDeg).toBeLessThan(325)
    expect(Math.abs(light.altitudeDeg - 45)).toBeLessThan(4)
    expect(light.correlation).toBeGreaterThan(0.8)
    // A sun in the south-east is found where it is.
    const other = fitHillshadeLighting(contourSurface(), hillshade(truth, 135, 45), WIDTH, HEIGHT, CELL)
    // On one hillside the aspects are few, so the bearing is read to within a couple of tens of degrees.
    expect(Math.abs(other.azimuthDeg - 135)).toBeLessThan(20)
  })

  it('recovers the relief the contours cannot hold, and stays on the contours', () => {
    const given = input()
    const result = refineWithHillshadeNow(given)
    const before = miss(given.prior, result.values),
      after = miss(result.values, given.prior)
    expect(before).toBeGreaterThan(0.4)
    expect(after).toBeLessThan(before * 0.5)
    // Still on the contour heights: read back at the contour points.
    let worst = 0
    for (let k = 0; k < given.anchors.length; k += 3) {
      const c0 = Math.floor(given.anchors[k]),
        r0 = Math.floor(given.anchors[k + 1])
      if (c0 < 12 || r0 < 12 || c0 >= WIDTH - 13 || r0 >= HEIGHT - 13) continue
      const tx = given.anchors[k] - c0,
        ty = given.anchors[k + 1] - r0,
        i = r0 * WIDTH + c0
      const v =
        result.values[i] * (1 - tx) * (1 - ty) +
        result.values[i + 1] * tx * (1 - ty) +
        result.values[i + WIDTH] * (1 - tx) * ty +
        result.values[i + WIDTH + 1] * tx * ty
      if (Number.isFinite(v)) worst = Math.max(worst, Math.abs(v - given.anchors[k + 2]))
    }
    expect(worst).toBeLessThan(1.5)
    expect(result.refinedCells).toBeGreaterThan(result.cells * 0.9)
    expect(result.medianChangeM).toBeGreaterThan(0.1)
    expect(result.shadeResidualGrey).toBeLessThan(12)
  })

  it('never moves ground further than one contour interval, and leaves ground without hillshade alone', () => {
    const shade = hillshade(truth)
    // No hillshade over the western third.
    for (let row = 0; row < HEIGHT; row++) for (let col = 0; col < 66; col++) shade[row * WIDTH + col] = NaN
    const given = input(shade)
    const result = refineWithHillshadeNow(given)
    let moved = 0
    for (let i = 0; i < result.values.length; i++) {
      const prior = given.prior[i]
      // Ground stays ground and gaps stay gaps.
      expect(Number.isFinite(result.values[i])).toBe(Number.isFinite(prior))
      if (!Number.isFinite(prior)) continue
      expect(Math.abs(result.values[i] - prior)).toBeLessThanOrEqual(INTERVAL + 1e-4)
      if (i % WIDTH < 66) expect(result.values[i]).toBe(prior)
      else if (result.values[i] !== prior) moved++
    }
    expect(moved).toBeGreaterThan(1000)
    // The change fades in from the hillshade's edge instead of stepping.
    const row = 70 * WIDTH
    expect(Math.abs(result.values[row + 66] - given.prior[row + 66])).toBeLessThan(
      Math.abs(result.values[row + 66 + RELIEF.taperCells] - given.prior[row + 66 + RELIEF.taperCells]) + 0.35,
    )
  })

  it('refuses a picture that is not a plain hillshade, and says why', () => {
    // A gamma curve, as a display stretch applies: greys no longer follow the shading formula.
    expect(() => refineWithHillshadeNow(input(hillshade(truth, 315, 45, (v) => v ** 2.2)))).toThrow(
      /stretched|gamma|plain hillshade/,
    )
    // Another surface's hillshade does not follow these contours.
    const elsewhere = Float32Array.from(
      truth,
      (_, i) => 900 + 40 * Math.sin((i % WIDTH) / 6) * Math.cos(Math.floor(i / WIDTH) / 5),
    )
    expect(() => refineWithHillshadeNow(input(hillshade(elsewhere)))).toThrow(
      /does not follow|stretched|plain hillshade/,
    )
    expect(() => refineWithHillshadeNow({ ...input(), anchors: new Float32Array(0) })).toThrow(/contour points/)
    expect(() => refineWithHillshadeNow({ ...input(), shade: new Float32Array(4) })).toThrow(/different grids/)
  })

  it('reports its progress as it goes', () => {
    const steps = refineWithHillshade(input())
    const seen: number[] = []
    let next = steps.next()
    while (!next.done) {
      seen.push(next.value)
      next = steps.next()
    }
    expect(seen.length).toBeGreaterThan(5)
    expect(seen.every((value, i) => value >= 0 && value <= 1 && (!i || value >= seen[i - 1] - 1e-9))).toBe(true)
  })
})

describe('a hillshade layer laid on a contour surface', () => {
  const wkt =
    'PROJCS["NAD83 / BC Albers",GEOGCS["NAD83",DATUM["North_American_Datum_1983",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Albers_Conic_Equal_Area"],PARAMETER["standard_parallel_1",50],PARAMETER["standard_parallel_2",58.5],PARAMETER["latitude_of_center",45],PARAMETER["longitude_of_center",-126],PARAMETER["false_easting",1000000],PARAMETER["false_northing",0],UNIT["metre",1]]'
  // Two 4 × 4 tiles of 1 m pixels side by side; the grey of a pixel is 10 × its column.
  const mosaic: PdfImageMosaic = {
    version: 1,
    kind: 'hillshade',
    width: 8,
    height: 4,
    transform: [1, 0, 0, -1, 1000, 2000],
    wkt,
    tiles: [0, 4].map((col) => ({ image: '', col, row: 0, width: 4, height: 4, reference: '', lossy: true })),
  }
  const tile = (from: number) => Uint8Array.from({ length: 16 }, (_, i) => 10 * (from + (i % 4)))
  // 2 m cells whose centres sit on the pixel corners at x = 1001, 1003, …, y = 1999, 1997.
  const grid = { epsg: 3005, origin: [1001, 1999] as [number, number], cellM: 2, width: 4, height: 2 }

  it('gives each cell the mean grey of the pixels under it', () => {
    const shade = hillshadeOnGrid(mosaic, [tile(0), tile(4)], grid)
    // A cell centred on x = 1001 covers pixel columns 0 and 1: greys 0 and 10.
    expect(Array.from(shade.subarray(0, 4), (v) => Math.round(v * 255))).toEqual([5, 25, 45, 65])
    expect(Array.from(shade.subarray(4), (v) => Math.round(v * 255))).toEqual([5, 25, 45, 65])
    // Four bytes a pixel are read as colour and turned to grey.
    const rgba = Uint8Array.from({ length: 64 }, (_, i) => (i % 4 === 3 ? 255 : 100))
    expect(Math.round(hillshadeOnGrid(mosaic, [rgba, tile(4)], grid)[0] * 255)).toBe(100)
  })

  it('leaves cells no tile covers, or a tile that did not decode covers, without a value', () => {
    const shade = hillshadeOnGrid(mosaic, [tile(0), null], grid)
    expect([...shade.subarray(0, 4)].map(Number.isFinite)).toEqual([true, true, false, false])
    const beyond = hillshadeOnGrid(mosaic, [tile(0), tile(4)], { ...grid, origin: [1007, 1999], width: 2 })
    expect([...beyond].map(Number.isFinite)).toEqual([true, false, true, false])
  })

  it('refuses sheets in different projections', () => {
    expect(() => hillshadeOnGrid(mosaic, [tile(0), tile(4)], { ...grid, epsg: 26910 })).toThrow(/different projections/)
  })
})
