import { describe, expect, it } from 'vitest'
import type { RoadStation, SectionSample } from './types'
import {
  BAND_MIN_SPACING_M,
  ROAD_BAND_MARGIN_M,
  roadBandSegments,
  segmentBoxDistance,
  terrainBandMesh,
  type TerrainBandMesh,
  type TerrainBandSegment,
} from './terrainBandMesh'
import { terrainMesh, type TerrainVertex } from './terrainMesh'

const BOUNDS = [0, 0, 400, 400] // a 5 m coarse grid at the default side budget
const rough = (x: number, y: number) =>
  700 +
  0.08 * x -
  0.05 * y +
  1.3 * Math.sin(x / 2.3) +
  0.9 * Math.sin(y / 1.7 + x / 5.1) +
  0.4 * Math.sin((x + y) / 0.9)

/** A straight road from `start` at `degrees` from east, as segments `step` metres long. */
function road(start: [number, number], degrees: number, length: number, reachM: number, step = 10) {
  const segments: TerrainBandSegment[] = []
  const dx = Math.cos((degrees * Math.PI) / 180),
    dy = Math.sin((degrees * Math.PI) / 180)
  for (let s = 0; s < length; s += step) {
    const e = Math.min(length, s + step)
    segments.push({ a: [start[0] + dx * s, start[1] + dy * s], b: [start[0] + dx * e, start[1] + dy * e], reachM })
  }
  return segments
}

type Mesh = { faces: TerrainVertex[][]; estimatedFaces: TerrainVertex[][]; spacing: number }

const cellKey = (face: TerrainVertex[], spacing: number) => {
  const cx = (face[0].x + face[1].x + face[2].x) / 3,
    cy = (face[0].y + face[1].y + face[2].y) / 3
  return `${Math.floor(cx / spacing)}:${Math.floor(cy / spacing)}`
}
/** A coarse face spans a whole coarse cell across; a fine face spans less. */
const isCoarse = (face: TerrainVertex[], spacing: number) =>
  Math.abs(Math.max(...face.map((p) => p.x)) - Math.min(...face.map((p) => p.x)) - spacing) < 1e-9

function cells(mesh: Mesh) {
  const refined = new Set<string>(),
    coarse = new Set<string>()
  for (const face of [...mesh.faces, ...mesh.estimatedFaces])
    (isCoarse(face, mesh.spacing) ? coarse : refined).add(cellKey(face, mesh.spacing))
  return { refined, coarse }
}

/**
 * Every border between a refined cell and a drawn coarse cell: each fine vertex on it lies on the
 * coarse edge's straight line. Returns the number of borders checked.
 */
function checkSeams(mesh: Mesh) {
  const s = mesh.spacing
  const { refined, coarse } = cells(mesh)
  const coarseLevel = new Map<string, number>()
  for (const face of [...mesh.faces, ...mesh.estimatedFaces])
    if (isCoarse(face, s)) for (const p of face) coarseLevel.set(`${p.x}:${p.y}`, p.z)
  const fine = mesh.faces.filter((face) => !isCoarse(face, s)).flat()
  let borders = 0
  for (const key of refined) {
    const [col, row] = key.split(':').map(Number)
    for (const [dc, dr] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]) {
      if (!coarse.has(`${col + dc}:${row + dr}`)) continue
      borders++
      // The shared side's two coarse corners.
      const x0 = (dc === 1 ? col + 1 : col) * s,
        y0 = (dr === 1 ? row + 1 : row) * s
      const x1 = dc === 0 ? x0 + s : x0,
        y1 = dr === 0 ? y0 + s : y0
      const z0 = coarseLevel.get(`${x0}:${y0}`)!,
        z1 = coarseLevel.get(`${x1}:${y1}`)!
      expect(Number.isFinite(z0) && Number.isFinite(z1)).toBe(true)
      const onSide = fine.filter((p) =>
        dc === 0
          ? Math.abs(p.y - y0) < 1e-9 && p.x > x0 + 1e-9 && p.x < x1 - 1e-9
          : Math.abs(p.x - x0) < 1e-9 && p.y > y0 + 1e-9 && p.y < y1 - 1e-9,
      )
      expect(onSide.length).toBeGreaterThan(0)
      for (const p of onSide) {
        const t = dc === 0 ? (p.x - x0) / s : (p.y - y0) / s
        expect(Math.abs(p.z - (z0 + (z1 - z0) * t))).toBeLessThan(1e-9)
      }
    }
  }
  return borders
}

/** The fields `terrainMesh` returns, read from a band mesh. */
const withoutBand = ({ faces, estimatedFaces, infilledCells, openGapCells, elevations, spacing }: TerrainBandMesh) => ({
  faces,
  estimatedFaces,
  infilledCells,
  openGapCells,
  elevations,
  spacing,
})

describe('terrain band mesh', () => {
  it('measures the distance between a segment and a box', () => {
    expect(segmentBoxDistance(-5, 5, 15, 5, 0, 0, 10, 10)).toBe(0)
    expect(segmentBoxDistance(2, 2, 3, 3, 0, 0, 10, 10)).toBe(0)
    expect(segmentBoxDistance(-3, 0, -3, 10, 0, 0, 10, 10)).toBeCloseTo(3)
    expect(segmentBoxDistance(-4, 13, 13, -4, 0, 0, 10, 10)).toBe(0)
    expect(segmentBoxDistance(-10, 6, 6, -10, 0, 0, 10, 10)).toBeCloseTo(2 * Math.SQRT2, 9)
    expect(segmentBoxDistance(14, 13, 14, 13, 0, 0, 10, 10)).toBeCloseTo(5)
  })

  it('is terrainMesh when there are no segments or no whole division fits', () => {
    const none = terrainBandMesh(BOUNDS, rough, [], false, { segments: [], maxCells: 1e6 })
    expect(none.bandSpacing).toBeNull()
    expect(withoutBand(none)).toEqual(terrainMesh(BOUNDS, rough, []))
    // A 1 m coarse grid with a 0.75 m source cannot be split in two.
    const fineBounds = [0, 0, 96, 96]
    const segments = road([10, 10], 30, 60, 8)
    const tooFine = terrainBandMesh(fineBounds, rough, [], false, { segments, maxCells: 1e6, minSpacing: 0.75 })
    expect(tooFine.spacing).toBe(1)
    expect(tooFine.bandSpacing).toBeNull()
    expect(withoutBand(tooFine)).toEqual(terrainMesh(fineBounds, rough, [], false, { minSpacing: 0.75 }))
    // Segments wholly outside the window refine nothing.
    const outside = terrainBandMesh(BOUNDS, rough, [], false, {
      segments: road([600, 600], 0, 100, 20),
      maxCells: 1e6,
    })
    expect(withoutBand(outside)).toEqual(terrainMesh(BOUNDS, rough, []))
  })

  it('keeps every face outside the band, and the coarse grid, exactly as terrainMesh has them', () => {
    const coarse = terrainMesh(BOUNDS, rough, [])
    const band = terrainBandMesh(BOUNDS, rough, [], false, {
      segments: road([40, 60], 25, 300, 20),
      maxCells: 1e6,
      minSpacing: 1,
    })
    expect(band.refinedCells).toBeGreaterThan(0)
    expect(band.spacing).toBe(coarse.spacing)
    expect(band.elevations).toEqual(coarse.elevations)
    expect(band.estimatedFaces).toEqual(coarse.estimatedFaces)
    expect(band.infilledCells).toBe(coarse.infilledCells)
    expect(band.openGapCells).toBe(coarse.openGapCells)
    const { refined } = cells(band)
    expect(refined.size).toBe(band.refinedCells)
    const outside = (faces: TerrainVertex[][]) => faces.filter((face) => !refined.has(cellKey(face, band.spacing)))
    expect(outside(band.faces)).toEqual(outside(coarse.faces))
    expect(band.faces.filter((face) => isCoarse(face, band.spacing))).toEqual(outside(coarse.faces))
    expect(band.faces.length).toBe(coarse.faces.length + 2 * band.refinedCells * (band.bandDivisions ** 2 - 1))
    expect(band.bandCells).toBe(band.refinedCells * band.bandDivisions ** 2)
  })

  it('meets the coarse ground without a crack on rough ground', () => {
    const band = terrainBandMesh(BOUNDS, rough, [], false, {
      segments: road([30, 50], 40, 320, 15),
      maxCells: 1e6,
      minSpacing: 1,
    })
    expect(band.bandSpacing).toBe(1)
    expect(checkSeams(band)).toBeGreaterThan(20)
    // Inside the band, and on sides two refined cells share, a fine vertex keeps its own sampled level.
    const { refined } = cells(band)
    const s = band.spacing
    let own = 0
    for (const p of band.faces.filter((face) => !isCoarse(face, s)).flat()) {
      const col = p.x / s,
        row = p.y / s
      const onColumn = Number.isInteger(col),
        onRow = Number.isInteger(row)
      if (onColumn && onRow) continue
      const sides = onColumn
        ? [`${col - 1}:${Math.floor(row)}`, `${col}:${Math.floor(row)}`]
        : onRow
          ? [`${Math.floor(col)}:${row - 1}`, `${Math.floor(col)}:${row}`]
          : []
      if (sides.every((key) => refined.has(key))) {
        own++
        expect(p.z).toBe(rough(p.x, p.y))
      }
    }
    expect(own).toBeGreaterThan(1000)
  })

  it('chooses whole divisions from the source cell, the 0.5 m floor and the cell budget', () => {
    const segments = road([30, 50], 40, 320, 15)
    const at = (minSpacing: number | undefined, maxCells: number) =>
      terrainBandMesh(BOUNDS, rough, [], false, { segments, maxCells, minSpacing })
    expect(at(1, 1e7)).toMatchObject({ spacing: 5, bandDivisions: 5, bandSpacing: 1 })
    expect(at(2, 1e7)).toMatchObject({ bandDivisions: 2, bandSpacing: 2.5 })
    expect(at(undefined, 1e7)).toMatchObject({ bandDivisions: 10, bandSpacing: BAND_MIN_SPACING_M })
    expect(at(0, Infinity)).toMatchObject({ bandDivisions: 10 })
    // A long road under a tight budget takes the largest division that fits.
    const full = at(1, 1e7)
    const budget = full.refinedCells * 12
    const tight = at(1, budget)
    expect(tight.bandDivisions).toBe(3)
    expect(tight.bandCells).toBeLessThanOrEqual(budget)
    expect(tight.refinedCells * (tight.bandDivisions + 1) ** 2).toBeGreaterThan(budget)
    expect(checkSeams(tight)).toBeGreaterThan(0)
    // A budget too small for k = 2 gives no band.
    const tiny = at(1, full.refinedCells * 3)
    expect(tiny.bandSpacing).toBeNull()
    expect(withoutBand(tiny)).toEqual(terrainMesh(BOUNDS, rough, [], false, { minSpacing: 1 }))
    expect(at(1, NaN).bandSpacing).toBeNull()
  })

  it('leaves a cell with a hole smaller than a coarse cell as terrainMesh has it, sealed to its neighbours', () => {
    const holed = (x: number, y: number) => (Math.hypot(x - 102, y - 102) < 0.3 ? NaN : rough(x, y))
    const coarse = terrainMesh(BOUNDS, holed, [])
    const band = terrainBandMesh(BOUNDS, holed, [], false, {
      segments: [{ a: [60, 60], b: [160, 160], reachM: 12 }],
      maxCells: 1e6,
      minSpacing: 1,
    })
    const { refined, coarse: kept } = cells(band)
    expect(refined.has('20:20')).toBe(false)
    expect(kept.has('20:20')).toBe(true)
    for (const neighbour of ['19:20', '21:20', '20:19', '20:21']) expect(refined.has(neighbour)).toBe(true)
    const inHole = (faces: TerrainVertex[][]) => faces.filter((face) => cellKey(face, 5) === '20:20')
    expect(inHole(band.faces)).toEqual(inHole(coarse.faces))
    expect(inHole(band.faces)).toHaveLength(2)
    expect(checkSeams(band)).toBeGreaterThanOrEqual(4)
  })

  it('keeps missing samples, open gaps and estimated infill exactly as terrainMesh has them', () => {
    const gap = (x: number, y: number) => (Math.hypot(x - 151, y - 149) < 6 ? NaN : rough(x, y))
    const missing: Array<[number, number]> = [[122.5, 118.5]]
    const segments = [{ a: [60, 60] as [number, number], b: [240, 240] as [number, number], reachM: 15 }]
    for (const fill of [false, true]) {
      const coarse = terrainMesh(BOUNDS, gap, missing, fill, { minSpacing: 1 })
      const band = terrainBandMesh(BOUNDS, gap, missing, fill, { segments, maxCells: 1e6, minSpacing: 1 })
      expect(band.estimatedFaces).toEqual(coarse.estimatedFaces)
      expect(band.infilledCells).toBe(coarse.infilledCells)
      expect(band.openGapCells).toBe(coarse.openGapCells)
      expect(coarse.openGapCells + coarse.infilledCells).toBeGreaterThan(0)
      if (fill) expect(coarse.estimatedFaces.length).toBeGreaterThan(0)
      const { refined } = cells(band)
      for (const face of coarse.estimatedFaces) expect(refined.has(cellKey(face, 5))).toBe(false)
      // The missing analysis sample's cell is never refined, and drawn only as terrainMesh draws it.
      expect(refined.has('24:23')).toBe(false)
      const atMissing = (faces: TerrainVertex[][]) => faces.filter((face) => cellKey(face, 5) === '24:23')
      expect(atMissing(band.faces)).toEqual(atMissing(coarse.faces))
      expect(atMissing([...band.faces, ...band.estimatedFaces])).toEqual(
        atMissing([...coarse.faces, ...coarse.estimatedFaces]),
      )
      expect(refined.size).toBeGreaterThan(0)
      expect(checkSeams(band)).toBeGreaterThan(0)
    }
  })

  it('samples each position once, and only coarse vertices and candidate band cells', () => {
    let coarseCalls = 0
    terrainMesh(
      BOUNDS,
      () => {
        coarseCalls++
        return 700
      },
      [],
      false,
      { minSpacing: 1 },
    )
    const seen = new Set<string>()
    let calls = 0
    const band = terrainBandMesh(
      BOUNDS,
      (x, y) => {
        calls++
        seen.add(`${x}:${y}`)
        return rough(x, y)
      },
      [],
      false,
      { segments: road([20, 30], 45, 400, 10), maxCells: 1e6, minSpacing: 1 },
    )
    const k = band.bandDivisions
    expect(k).toBe(5)
    expect(seen.size).toBe(calls)
    expect(calls).toBeLessThanOrEqual(coarseCalls + band.refinedCells * ((k + 1) ** 2 - 4))
    // Far less than the fine grid over the band's bounding box (about 300 m square at 1 m).
    expect(calls - coarseCalls).toBeLessThan(300 * 300 * 0.25)
  })

  it('refines a connected strip with no stray coarse cell along a road at 17 degrees', () => {
    const band = terrainBandMesh(BOUNDS, rough, [], false, {
      segments: road([25, 40], 17, 330, 12, 7),
      maxCells: 1e6,
      minSpacing: 1,
    })
    const { refined } = cells(band)
    expect(refined.size).toBe(band.refinedCells)
    const byRow = new Map<number, number[]>(),
      byColumn = new Map<number, number[]>()
    for (const key of refined) {
      const [col, row] = key.split(':').map(Number)
      byRow.set(row, [...(byRow.get(row) ?? []), col])
      byColumn.set(col, [...(byColumn.get(col) ?? []), row])
    }
    // No unrefined cell enclosed in a row or a column of the strip.
    for (const values of [...byRow.values(), ...byColumn.values()]) {
      values.sort((a, b) => a - b)
      expect(values[values.length - 1] - values[0] + 1).toBe(values.length)
    }
    // One 4-connected strip.
    const first = refined.values().next().value!
    const reached = new Set([first])
    const queue = [first]
    while (queue.length) {
      const [col, row] = queue.pop()!.split(':').map(Number)
      for (const next of [`${col - 1}:${row}`, `${col + 1}:${row}`, `${col}:${row - 1}`, `${col}:${row + 1}`])
        if (refined.has(next) && !reached.has(next)) {
          reached.add(next)
          queue.push(next)
        }
    }
    expect(reached.size).toBe(refined.size)
    expect(checkSeams(band)).toBeGreaterThan(50)
  })
})

describe('road band segments', () => {
  const station = (index: number, fields: Partial<RoadStation>, section: SectionSample[] = []): RoadStation =>
    ({
      index,
      chainage: index * 10,
      coordinate: [index * 10, 0],
      bearing: 90,
      groundElevation: 700,
      designElevation: 700,
      leftWidth: 2.5,
      rightWidth: 2.5,
      leftDaylightM: null,
      rightDaylightM: null,
      section,
      complete: false,
      flags: [],
      ...fields,
    }) as RoadStation
  const point = (s: RoadStation) => s.coordinate as [number, number]

  it('reaches the wider of its two stations, on its farther side, plus the margin', () => {
    const stations = [
      // Caught at 9 m on the right; the road edge on the left.
      station(0, { leftDaylightM: -3, rightDaylightM: 9, complete: true }),
      // Its left batter stopped short of the ground: the last sample with a design level, 14 m out.
      station(1, { rightDaylightM: 6 }, [
        { offset: -14, ground: 702, design: 701 },
        { offset: -20, ground: 703, design: null },
        { offset: 6, ground: 700, design: 700 },
      ]),
      // Stripped past its 7 m catch to 11 m.
      station(2, { leftDaylightM: -7, rightDaylightM: 4, complete: true }, [
        { offset: -11, ground: 700, design: null, preparedGround: 699.8 },
        { offset: 4, ground: 700, design: 700 },
      ]),
    ]
    const segments = roadBandSegments(stations, point)
    expect(segments).toHaveLength(2)
    expect(segments[0]).toEqual({ a: [0, 0], b: [10, 0], reachM: 14 + ROAD_BAND_MARGIN_M })
    expect(segments[1]).toEqual({ a: [10, 0], b: [20, 0], reachM: 14 + ROAD_BAND_MARGIN_M })
    expect(roadBandSegments(stations.slice(2), point)).toEqual([])
    const lone = [station(0, { leftDaylightM: -7, rightDaylightM: 4, complete: true }), stations[2]]
    expect(roadBandSegments(lone, point, 5)[0].reachM).toBe(11 + 5)
  })

  it('reaches the road edge alone where nothing else is drawn', () => {
    const segments = roadBandSegments([station(0, { leftWidth: 3 }), station(1, { rightWidth: 4.5 })], point, 0)
    expect(segments[0].reachM).toBe(4.5)
  })
})
