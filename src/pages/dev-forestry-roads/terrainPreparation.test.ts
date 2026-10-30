import { describe, expect, it } from 'vitest'
import {
  gradePad,
  editTinElevation,
  mosaicRasters,
  parseTerrainBackgrounds,
  parseTerrainPreparation,
  rasterGridValue,
  strategicPointIndices,
  terrainAscii,
  terrainSurfaceLandXml,
} from './terrainPreparation'
import type { LocalRaster } from '../dev-forestry/types'
import { mergePointClouds, type PointCloud } from './pointCloud'
import { gridSurface } from './pointCloud.worker'

const raster = (overrides: Partial<LocalRaster> = {}): LocalRaster => ({
  id: 'grid',
  name: 'Ground',
  kind: 'terrain',
  epsg: 3157,
  origin: [0, 2],
  pixelSize: [1, -1],
  width: 3,
  height: 3,
  values: [10, 11, 12, 13, 14, 15, 16, 17, 18],
  acquired: '',
  verticalReference: 'CGVD2013',
  sha256: 'a'.repeat(64),
  ...overrides,
})
describe('strategic terrain preparation', () => {
  it('combines actual point-cloud arrays and rejects different source CRS keys', async () => {
    const cloud = (start: number): PointCloud => ({
      x: Float64Array.from([start, start + 1, start, start + 1]),
      y: Float64Array.from([0, 0, 1, 1]),
      z: Float64Array.from([10, 11, 12, 13]),
      classification: Uint8Array.from([2, 2, 2, 2]),
      count: 4,
      epsg: 3157,
      verticalEpsg: 6647,
      version: '1.2',
      format: 'las',
      bounds: [start, 0, 10, start + 1, 1, 13],
      sourceCount: 4,
      thinCellM: null,
    })
    const a = cloud(0),
      b = cloud(100),
      merged = mergePointClouds([a, b])
    expect(merged.count).toBe(8)
    expect(merged.sourceCount).toBe(8)
    expect(merged.bounds[3]).toBe(101)
    expect(() => mergePointClouds([a, { ...b, epsg: 3005 }])).toThrow(/matching horizontal and vertical CRS/)
    const surface = await gridSurface(merged, { method: 'tin', cellM: 1, maxCells: 10000, retainTin: true })
    expect(surface.retainedTin?.coordinates.length).toBe(16)
    for (let i = 0; i < surface.retainedTin!.triangles.length; i += 3) {
      const ids = surface.retainedTin!.triangles.slice(i, i + 3),
        coords = surface.retainedTin!.coordinates
      expect(
        Math.max(
          ...ids.map((a, k) => {
            const b = ids[(k + 1) % 3]
            return Math.hypot(coords[2 * a] - coords[2 * b], coords[2 * a + 1] - coords[2 * b + 1])
          }),
        ),
      ).toBeLessThanOrEqual(8)
    }
  })
  it('retains every protected corridor return while coarsening only surrounding terrain deterministically', () => {
    const x = Float64Array.from({ length: 1000 }, (_, i) => i % 50),
      y = Float64Array.from({ length: 1000 }, (_, i) => Math.floor(i / 50)),
      z = Float64Array.from(x, (_, i) => i % 9)
    const options = {
      corridor: {
        points: [
          [10, 0],
          [10, 20],
        ] as Array<[number, number]>,
        halfWidthM: 0.1,
      },
    }
    const a = strategicPointIndices({ x, y, z }, 80, options),
      b = strategicPointIndices({ x, y, z }, 80, options)
    expect(a).toEqual(b)
    expect(a.indices.length).toBeLessThanOrEqual(80)
    expect(a.preserved).toBe(20)
    for (let i = 0; i < 1000; i++) if (x[i] === 10) expect(a.indices).toContain(i)
    expect(() => strategicPointIndices({ x, y, z }, 10, options)).toThrow(/protected points exceed/)
  })
  it('preserves polygon AOI density and rejects excessive region complexity', () => {
    const points = { x: [0, 1, 2, 10, 20], y: [0, 1, 2, 10, 20], z: [1, 2, 3, 4, 5] }
    const result = strategicPointIndices(points, 4, {
      polygons: [
        [
          [-0.5, -0.5],
          [2.5, -0.5],
          [2.5, 2.5],
          [-0.5, 2.5],
        ],
      ],
    })
    expect(result.indices.slice(0, 3)).toEqual([0, 1, 2])
    expect(() =>
      strategicPointIndices(points, 4, {
        corridor: {
          points: [
            [0, 0],
            [1, 1],
          ],
          halfWidthM: -1,
        },
      }),
    ).toThrow(/Invalid preservation/)
  })
  it('mosaics adjacent grids in native source spacing, preserving true source holes and overlap priority', () => {
    const a = raster(),
      b = raster({ id: 'right', origin: [2, 2], values: [90, 91, 92, 93, 94, 95, 96, 97, 98] })
    const mosaic = mosaicRasters([a, b], 'last')
    expect([mosaic.width, mosaic.height, mosaic.pixelSize]).toEqual([5, 3, [1, -1]])
    expect(mosaic.values.slice(0, 5)).toEqual([10, 11, 90, 91, 92])
    expect(mosaicRasters([a, b], 'first').values[2]).toBe(12)
    const gap = mosaicRasters([a, raster({ origin: [5, 2] })])
    expect(gap.values[3]).toBeNull()
    expect(gap.values[4]).toBeNull()
    expect(() => mosaicRasters([a, raster({ epsg: 3005 })])).toThrow(/CRS and vertical datum/)
    expect(() => mosaicRasters([a, raster({ verticalReference: 'CGVD28' })])).toThrow(/CRS and vertical datum/)
  })
  it('refuses a mosaic that cannot fit at source resolution', () => {
    expect(() => mosaicRasters([raster(), raster({ origin: [10_000_000, 2] })])).toThrow(/not silently reduced/)
  })
  it('does not bridge a missing weighted cell while accepting an exact known source centre', () => {
    const r = raster({ values: [10, null, 12, 13, 14, 15, 16, 17, 18] })
    expect(rasterGridValue(r, 0, 2)).toBe(10)
    expect(rasterGridValue(r, 0.5, 2)).toBeNull()
    expect(rasterGridValue(r, -1, 2)).toBeNull()
  })
  it('grades a pad plane, daylight fill batters and leaves no-data untouched', () => {
    const r = raster({ origin: [-10, 10], width: 21, height: 21, values: Array(441).fill(100) })
    r.values[0] = null
    const p = gradePad(r, {
      name: 'Landing',
      center: [0, 0],
      widthM: 4,
      lengthM: 6,
      bearingDegrees: 0,
      elevationM: 102,
      crossfallPercent: 10,
      gradePercent: 5,
      batterHV: 1,
    })
    expect(p.values[10 * 21 + 10]).toBe(102)
    expect(p.values[10 * 21 + 11]).toBeCloseTo(102.1)
    expect(p.values[9 * 21 + 10]).toBeCloseTo(102.05)
    expect(p.values[10 * 21 + 13]).toBeCloseTo(101.2)
    expect(p.values[10 * 21 + 19]).toBe(100)
    expect(p.values[0]).toBeNull()
  })
  it('exports northing/easting LandXML and omits faces crossing source gaps', () => {
    const r = raster({ values: [10, null, 12, 13, 14, 15, 16, 17, 18] })
    const xml = terrainSurfaceLandXml(r)
    expect(xml).toContain('<P id="1">2 0 10</P>')
    expect(xml).not.toContain('<P id="2">')
    expect(xml).not.toMatch(/<F>[^<]*\b2\b/)
    expect(xml).toContain('CGVD2013')
    const ascii = terrainAscii(r)
    expect(ascii).toContain('xllcenter 0\nyllcenter 0')
    expect(ascii).toContain('10 -99999 12')
  })
  it('edits a retained vertex and rebuilds its plane without changing topology or filling source holes', () => {
    const r = raster({ origin: [0.5, 1.5], width: 2, height: 2, values: [10, null, 10, 10] })
    const tin = { coordinates: [0, 0, 2, 0, 0, 2, 2, 2], elevations: [10, 10, 10, 10], triangles: [0, 2, 1, 1, 2, 3] }
    const result = editTinElevation(r, tin, 0, 14)
    expect(result.tin.triangles).toEqual(tin.triangles)
    expect(result.tin.elevations[0]).toBe(14)
    expect(tin.elevations[0]).toBe(10)
    expect(result.raster.values[0]).toBeCloseTo(10)
    expect(result.raster.values[1]).toBeNull()
    expect(result.raster.values[2]).toBeCloseTo(12)
    expect(() => editTinElevation(r, tin, 5, 10)).toThrow(/Select a retained TIN vertex/)
  })
  it('validates processing and independent background bounds without adopting display images as terrain', () => {
    const record = {
      operation: 'mosaic',
      method: 'source order',
      sources: [{ name: 'Source', sha256: 'a'.repeat(64), epsg: 3157, verticalReference: 'CGVD2013' }],
      parameters: { count: 2 },
    }
    expect(parseTerrainPreparation(record)).toEqual(record)
    expect(() =>
      parseTerrainPreparation({
        ...record,
        tin: { coordinates: [0, 0, 1, 0], elevations: [1, 1], triangles: [0, 1, 2] },
      }),
    ).toThrow(/retained terrain TIN/)
    const layer = {
      id: 'chm',
      name: 'Canopy',
      kind: 'canopy',
      epsg: 3157,
      origin: [0, 0],
      pixelSize: [1, -1],
      width: 2,
      height: 2,
      rgba: Array(16).fill(255),
      sha256: 'b'.repeat(64),
      visible: true,
      opacity: 0.5,
    }
    expect(parseTerrainBackgrounds([layer])[0].kind).toBe('canopy')
    expect(() => parseTerrainBackgrounds([layer, layer])).toThrow(/Invalid independent/)
  })
})
