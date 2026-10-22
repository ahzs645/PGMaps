import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { initTools, runTool } from 'whitebox-wasm/tools'
import { buildGroundGrid, readLasHeader } from './lasSurface'
import {
  classifyGround,
  encodeLas,
  groundSummary,
  isLaz,
  readPointCloud,
  readPointCloudHeader,
  setWhiteboxSources,
} from './pointCloud'

const wasmDir = dirname(createRequire(import.meta.url).resolve('whitebox-wasm'))
const toolsWasm = readFileSync(join(wasmDir, 'whitebox-cli.wasm'))

interface Point {
  x: number
  y: number
  z: number
  cls: number
}

/** A LAS 1.2 file, point format 1, with GeoTIFF keys naming EPSG:26910 and vertical EPSG:5703. */
function las(points: Point[]) {
  const headerSize = 227,
    vlrLength = 8 + 8 * 2,
    offset = headerSize + 54 + vlrLength,
    record = 28
  const bytes = new Uint8Array(offset + points.length * record)
  const view = new DataView(bytes.buffer)
  bytes.set(new TextEncoder().encode('LASF'), 0)
  view.setUint8(24, 1)
  view.setUint8(25, 2)
  view.setUint16(94, headerSize, true)
  view.setUint32(96, offset, true)
  view.setUint32(100, 1, true)
  view.setUint8(104, 1)
  view.setUint16(105, record, true)
  view.setUint32(107, points.length, true)
  const scale = 0.001,
    origin = [500000, 6000000, 0]
  const extent = (key: 'x' | 'y' | 'z', pick: (a: number, b: number) => number) =>
    points.reduce((a, p) => pick(a, p[key]), key === 'x' ? points[0].x : key === 'y' ? points[0].y : points[0].z)
  ;[scale, scale, scale].forEach((s, i) => view.setFloat64(131 + i * 8, s, true))
  origin.forEach((o, i) => view.setFloat64(155 + i * 8, o, true))
  ;(['x', 'y', 'z'] as const).forEach((key, i) => {
    view.setFloat64(179 + i * 16, extent(key, Math.max), true)
    view.setFloat64(187 + i * 16, extent(key, Math.min), true)
  })
  bytes.set(new TextEncoder().encode('LASF_Projection'), headerSize + 2)
  view.setUint16(headerSize + 18, 34735, true)
  view.setUint16(headerSize + 20, vlrLength, true)
  ;[1, 1, 0, 2, 3072, 0, 1, 26910, 4096, 0, 1, 5703].forEach((v, i) => view.setUint16(headerSize + 54 + i * 2, v, true))
  points.forEach((p, i) => {
    const at = offset + i * record
    view.setInt32(at, Math.round((p.x - origin[0]) / scale), true)
    view.setInt32(at + 4, Math.round((p.y - origin[1]) / scale), true)
    view.setInt32(at + 8, Math.round(p.z / scale), true)
    view.setUint8(at + 14, 0b001_001)
    view.setUint8(at + 15, p.cls)
  })
  return bytes
}

/** A header-only LAS 1.4 carrying an OGC WKT VLR. */
function lasWithWkt(wkt: string) {
  const text = new TextEncoder().encode(wkt + '\0')
  const bytes = new Uint8Array(375 + 54 + text.length)
  const view = new DataView(bytes.buffer)
  bytes.set(new TextEncoder().encode('LASF'), 0)
  view.setUint16(6, 16, true)
  view.setUint8(24, 1)
  view.setUint8(25, 4)
  view.setUint16(94, 375, true)
  view.setUint32(96, bytes.length, true)
  view.setUint32(100, 1, true)
  view.setUint8(104, 6)
  view.setUint16(105, 30, true)
  bytes.set(new TextEncoder().encode('LASF_Projection'), 375 + 2)
  view.setUint16(375 + 18, 2112, true)
  view.setUint16(375 + 20, text.length, true)
  bytes.set(text, 375 + 54)
  return bytes
}

// A 40 × 40 m hillside at 80 % with a little relief, ground every 1 m and a crown return every
// 2 m, 15–25 m up.
const points: Point[] = []
for (let x = 0; x < 40; x++)
  for (let y = 0; y < 40; y++) {
    const ground = 800 + 0.8 * x + 0.1 * y + 0.15 * Math.sin(x * 1.7 + y * 0.9)
    points.push({ x: 500000 + x, y: 6000000 + y, z: ground, cls: 2 })
    if (x % 2 === 0 && y % 2 === 0)
      points.push({ x: 500000.3 + x, y: 6000000.3 + y, z: ground + 15 + ((x * 7 + y * 3) % 10), cls: 5 })
  }
const truthGround = points.map((p) => p.cls === 2)
const lasBytes = las(points)
let lazBytes: Uint8Array

beforeAll(async () => {
  setWhiteboxSources({ lidar: readFileSync(join(wasmDir, 'whitebox_wasm_bg.wasm')), tools: toolsWasm })
  await initTools(toolsWasm)
  // lidar_shift with no shift rewrites the cloud; a .laz output name makes it LAZ.
  const result = await runTool('lidar_shift', {
    args: ['--input=/work/in.las', '--output=/work/out.laz'],
    input: { 'in.las': lasBytes },
  })
  expect(result.exitCode).toBe(0)
  lazBytes = result.files['out.laz']
})

function score(classes: Uint8Array) {
  let ground = 0,
    canopy = 0
  classes.forEach((c, i) => {
    if (c !== 2) return
    if (truthGround[i]) ground++
    else canopy++
  })
  const groundTotal = truthGround.filter(Boolean).length
  return { groundRecall: ground / groundTotal, canopyAsGround: canopy / (points.length - groundTotal) }
}

describe('LAS and LAZ point clouds', () => {
  it('tells LAZ from LAS by its header and reads the CRS from either', () => {
    expect(isLaz(lasBytes)).toBe(false)
    expect(isLaz(lazBytes)).toBe(true)
    const header = readPointCloudHeader(lazBytes)
    expect(header).toMatchObject({ compressed: true, version: '1.4', pointFormat: 6, points: points.length })
    // WhiteboxTools writes an OGC WKT VLR naming EPSG:26910 but drops the vertical datum.
    expect(header.epsg).toBe(26910)
    expect(header.verticalEpsg).toBeNull()
    // lasSurface's reader still refuses LAZ, which is why pointCloud.ts reads its own header.
    expect(() => readLasHeader(lazBytes.slice().buffer)).toThrow(/LAZ/)
  })

  it('reads authority codes from compound WKT, WKT2 IDs too', () => {
    const wkt1 =
      'COMPD_CS["NAD83(CSRS) / BC Albers + CGVD2013",PROJCS["NAD83 / BC Albers",GEOGCS["NAD83",AUTHORITY["EPSG","4269"]],' +
      'UNIT["metre",1],AUTHORITY["EPSG","3005"]],VERT_CS["CGVD2013 height",VERT_DATUM["CGVD2013",2005],AUTHORITY["EPSG","6647"]]]'
    expect(readPointCloudHeader(lasWithWkt(wkt1))).toMatchObject({ epsg: 3005, verticalEpsg: 6647, compressed: false })
    const wkt2 =
      'COMPOUNDCRS["x",PROJCRS["NAD83(CSRS) / UTM zone 10N",BASEGEOGCRS["NAD83(CSRS)",ID["EPSG",4617]],ID["EPSG",3157]],' +
      'VERTCRS["CGVD2013(CGG2013) height",ID["EPSG",6647]]]'
    expect(readPointCloudHeader(lasWithWkt(wkt2))).toMatchObject({ epsg: 3157, verticalEpsg: 6647 })
  })

  it('decodes the LAZ to the same points and classes as the LAS', async () => {
    const fromLas = await readPointCloud(lasBytes)
    const fromLaz = await readPointCloud(lazBytes)
    expect(fromLas).toMatchObject({
      format: 'las',
      version: '1.2',
      epsg: 26910,
      verticalEpsg: 5703,
      count: points.length,
    })
    expect(fromLaz).toMatchObject({ format: 'laz', epsg: 26910, count: points.length, thinCellM: null })
    for (let i = 0; i < points.length; i++) {
      expect(Math.abs(fromLaz.x[i] - fromLas.x[i])).toBeLessThan(1e-6)
      expect(Math.abs(fromLaz.y[i] - fromLas.y[i])).toBeLessThan(1e-6)
      expect(Math.abs(fromLaz.z[i] - fromLas.z[i])).toBeLessThan(1e-6)
    }
    expect(Array.from(fromLaz.classification)).toEqual(Array.from(fromLas.classification))
    expect(fromLas.x[0]).toBeCloseTo(500000, 6)
    expect(fromLas.bounds[3]).toBeCloseTo(500039, 6)
    expect(fromLas.bounds[5]).toBeCloseTo(
      points.reduce((a, p) => Math.max(a, p.z), 0),
      3,
    )
    expect(groundSummary(fromLaz)).toEqual({
      total: points.length,
      ground: 1600,
      noise: 0,
      byClass: [
        { cls: 2, count: 1600 },
        { cls: 5, count: 400 },
      ],
    })
  })

  it('thins an oversized cloud to the lowest, ground-first point per cell', async () => {
    const cloud = await readPointCloud(lazBytes, { maxPoints: 500 })
    expect(cloud.sourceCount).toBe(points.length)
    expect(cloud.count).toBeLessThanOrEqual(500)
    expect(cloud.count).toBeGreaterThan(250)
    expect(cloud.thinCellM).toBeGreaterThan(1)
    expect(groundSummary(cloud).ground).toBe(cloud.count)
  })

  it('round-trips through encodeLas into the existing ground grid', async () => {
    const cloud = await readPointCloud(lazBytes)
    const grid = buildGroundGrid(encodeLas({ ...cloud, verticalEpsg: 5703 }).slice().buffer, { cellM: 1 })
    expect(grid.epsg).toBe(26910)
    expect(grid.groundPoints).toBe(1600)
    expect(readLasHeader(encodeLas({ ...cloud, verticalEpsg: 5703 }).slice().buffer).verticalEpsg).toBe(5703)
  })
})

describe('ground classification', () => {
  const unclassified = las(points.map((p) => ({ ...p, cls: 1 })))

  it('finds the hillside under the canopy, in tiles or whole, and keeps noise out', async () => {
    const whole = await classifyGround(unclassified)
    expect(score(whole).groundRecall).toBeGreaterThan(0.98)
    expect(score(whole).canopyAsGround).toBe(0)
    // With the top-hat normalisation on, the upslope edge strip is lost but nothing else changes.
    const normalised = await classifyGround(unclassified, { params: { slopeNorm: true, slopeThreshold: 60 } })
    expect(score(normalised).groundRecall).toBeGreaterThan(0.9)
    expect(score(normalised).canopyAsGround).toBe(0)

    // Tiles of ~300 points with a 6 m overlap agree with the single run.
    const progress: number[] = []
    const tiled = await classifyGround(unclassified, { tilePoints: 300, onProgress: (done) => progress.push(done) })
    expect(progress.length).toBeGreaterThan(4)
    let same = 0
    tiled.forEach((c, i) => (same += c === whole[i] ? 1 : 0))
    expect(same / points.length).toBeGreaterThan(0.99)

    // A low noise return keeps its class rather than dragging the ground down.
    const noisy = await readPointCloud(unclassified)
    noisy.z[100] -= 30
    noisy.classification[100] = 7
    const withNoise = await classifyGround(noisy)
    expect(withNoise[100]).toBe(7)
    expect(score(withNoise).groundRecall).toBeGreaterThan(0.95)
  })

  it('also runs the segmentation filter, from LAZ bytes', async () => {
    const laz = (
      await runTool('lidar_shift', {
        args: ['--input=/work/in.las', '--output=/work/out.laz'],
        input: { 'in.las': unclassified },
      })
    ).files['out.laz']
    const classes = await classifyGround(laz, { method: 'segmentation' })
    expect(classes.length).toBe(points.length)
    expect(score(classes).groundRecall).toBeGreaterThan(0.9)
    expect(score(classes).canopyAsGround).toBeLessThan(0.02)
  })
})
