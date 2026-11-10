/**
 * The suggested harvest system per cell, and comparing a run with a pinned one, on synthetic ground.
 */
import { describe, expect, it } from 'vitest'
import { runToCompletion } from './cooperative'
import {
  cableExtractionResult,
  DEFAULT_EXTRACTION_SETTINGS,
  extractionGridFor,
  extractionOnGrid,
  M_CABLE,
  prepareExtractionGrid,
  type ExtractionCells,
  type ExtractionGrid,
  type ExtractionSettings,
} from './extractionReach'
import { HARVEST_SYSTEMS, harvestSystemFeatures, harvestSystemMap, sameExtractionGrid } from './harvestSystems'
import { comparePinnedRun, PIN_GAINED, PIN_LOST, PIN_UNKNOWN, pinnedChangeFeatures } from './pinnedRun'
import type { SkidRoad } from './skidReach'
import type { Coordinate } from './types'

const LON0 = -122.5,
  LAT0 = 54.2,
  M = 111_195,
  COS = Math.cos((LAT0 * Math.PI) / 180)
const toGrid = (c: Coordinate): [number, number] => [(c[0] - LON0) * M * COS, (c[1] - LAT0) * M]
const toLonLat = ([x, y]: [number, number]): Coordinate => [LON0 + x / (M * COS), LAT0 + y / M]
const block: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [
    (
      [
        [-150, 10],
        [150, 10],
        [150, 300],
        [-150, 300],
        [-150, 10],
      ] as [number, number][]
    ).map(toLonLat),
  ],
}
const MAIN: SkidRoad = {
  id: 'main',
  name: 'main',
  kind: 'existing',
  coordinates: (
    [
      [-300, 0],
      [300, 0],
    ] as [number, number][]
  ).map(toLonLat),
}
/** Level to 150 m north of the road, then rising at 60 %. */
const bench = (_x: number, y: number) => (y < 150 ? 1000 : 1000 + 0.6 * (y - 150))

function grid(
  z: (x: number, y: number) => number = bench,
  settings: ExtractionSettings = DEFAULT_EXTRACTION_SETTINGS,
  cellM = 10,
): ExtractionGrid {
  return runToCompletion(
    prepareExtractionGrid({
      block,
      roads: [MAIN],
      ground: { elevationAt: (lon, lat) => z(...toGrid([lon, lat])) },
      toGrid,
      toLonLat,
      settings,
      cellM,
      offBlockM: 50,
    }),
  )
}
const cellAt = (eg: ExtractionGrid, x: number, y: number) => {
  const { origin, cellM, width } = eg.sg.grid
  return Math.round((origin[1] - y) / cellM) * width + Math.round((x - origin[0]) / cellM)
}
/** A stand-in cable run: every known block cell north of `fromY` yarded, at its distance north. */
function cableAbove(eg: ExtractionGrid, fromY: number) {
  const cableGrid = extractionGridFor(eg, { ...eg.settings, machine: 'cable' })
  const n = eg.sg.grid.values.length
  const cells = (): ExtractionCells => ({
    method: new Uint8Array(n),
    totalM: new Float32Array(n).fill(NaN),
    forestM: new Float32Array(n).fill(NaN),
    trackM: new Float32Array(n).fill(NaN),
    winchM: new Float32Array(n).fill(NaN),
    reach: new Float64Array(n).fill(Infinity),
    exit: new Int32Array(n).fill(-1),
  })
  const strict = cells(),
    optimistic = cells()
  const { origin, cellM, width } = eg.sg.grid
  for (const i of eg.sg.blockCells) {
    const y = origin[1] - Math.floor(i / width) * cellM
    if (y <= fromY || !Number.isFinite(eg.sg.grid.values[i])) continue
    for (const c of [strict, optimistic]) {
      c.method[i] = M_CABLE
      c.totalM[i] = c.forestM[i] = y
      c.reach[i] = 0.5
      c.exit[i] = eg.roadCells[0][0]
    }
  }
  return cableExtractionResult(cableGrid, () => true, [strict, optimistic])
}

describe('harvest systems', () => {
  it('suggests ground-based where a ground machine reaches, cable where only a skyline does, else none', () => {
    const eg = grid()
    const skidder = runToCompletion(extractionOnGrid(eg))
    const forwarder = runToCompletion(
      extractionOnGrid(extractionGridFor(eg, { ...DEFAULT_EXTRACTION_SETTINGS, machine: 'forwarder' })),
    )
    const cable = cableAbove(eg, 240)
    const map = harvestSystemMap({ skidder, forwarder, cable })
    const at = (x: number, y: number) => HARVEST_SYSTEMS[map.system[cellAt(eg, x, y)]]
    expect(at(0, 50)).toBe('skidder-or-forwarder')
    // Winched by the skidder from the foot of the slope; the forwarder stops at its limits.
    expect(at(0, 170)).toBe('skidder')
    expect(at(0, 280)).toBe('cable')
    // Between the winch envelope and the skylines: nothing reaches.
    expect(at(0, 230)).toBe('none')
    expect(map.rows.reduce((sum, row) => sum + row.ha, 0)).toBeCloseTo(map.blockHa, 9)
    expect(map.rows.reduce((sum, row) => sum + row.share, 0)).toBeCloseTo(1, 9)
    expect(map.machines).toEqual({ skidder: true, forwarder: true, cable: true })
    const features = harvestSystemFeatures(skidder, map)
    expect(features.length).toBeGreaterThan(0)
    expect(features.every((f) => f.properties?.kind === 'harvest-system' && f.properties.fill)).toBe(true)
  })

  it('keeps ground no run can read unknown, and ground too steep to fell apart', () => {
    const gap = (x: number, y: number) => (y > 60 && y < 80 ? NaN : x > 100 && y > 200 ? 1000 + 2 * y : 1000)
    const eg = grid(gap)
    const skidder = runToCompletion(extractionOnGrid(eg))
    const map = harvestSystemMap({ skidder })
    expect(HARVEST_SYSTEMS[map.system[cellAt(eg, 0, 70)]]).toBe('unknown')
    expect(HARVEST_SYSTEMS[map.system[cellAt(eg, 130, 260)]]).toBe('not-extracted')
    expect(map.machines.cable).toBe(false)
  })

  it('refuses runs on different grids', () => {
    const a = runToCompletion(extractionOnGrid(grid()))
    const b = runToCompletion(extractionOnGrid(grid(bench, DEFAULT_EXTRACTION_SETTINGS, 5)))
    expect(sameExtractionGrid(a, b)).toBe(false)
    expect(() => harvestSystemMap({ skidder: a, forwarder: b })).toThrow(/same block/)
    expect(() => harvestSystemMap({})).toThrow(/at least one/)
  })
})

describe('compare with a pinned run', () => {
  const flat = () => 1000
  const settings = (reach: number): ExtractionSettings => ({
    ...DEFAULT_EXTRACTION_SETTINGS,
    skid: { ...DEFAULT_EXTRACTION_SETTINGS.skid, flatReachM: reach, adverseReachM: reach },
  })

  it('reports ground lost and gained, by state and class, on separately prepared grids', () => {
    const long = runToCompletion(extractionOnGrid(grid(flat, settings(350))))
    const short = runToCompletion(extractionOnGrid(grid(flat, settings(200))))
    expect(sameExtractionGrid(long, short)).toBe(true)
    const c = comparePinnedRun(long, short)
    expect(c.gainedHa).toBe(0)
    expect(c.lostHa).toBeGreaterThan(2)
    expect(c.change[cellAt(short.grid, 0, 280)]).toBe(PIN_LOST)
    const covered = c.states.find((row) => row.state === 'covered')!
    expect(covered.pinnedHa - covered.currentHa).toBeCloseTo(c.lostHa, 9)
    expect(c.classes.reduce((sum, row) => sum + row.pinnedHa, 0)).toBeCloseTo(covered.pinnedHa, 9)
    expect(c.classes.reduce((sum, row) => sum + row.currentHa, 0)).toBeCloseTo(covered.currentHa, 9)
    const back = comparePinnedRun(short, long)
    expect(back.gainedHa).toBeCloseTo(c.lostHa, 9)
    expect(back.change[cellAt(long.grid, 0, 280)]).toBe(PIN_GAINED)
    // Ground within reach both times keeps its distance, give or take a winch line's choice.
    expect(Math.abs(back.meanChangeM!)).toBeLessThan(5)
    expect(pinnedChangeFeatures(long, back).map((f) => f.properties?.role)).toContain('gained')
  })

  it('counts ground unknown in only one run apart, and refuses another grid', () => {
    const known = runToCompletion(extractionOnGrid(grid(flat)))
    const gap = runToCompletion(extractionOnGrid(grid((_x, y) => (y > 100 && y < 120 ? NaN : 1000))))
    const c = comparePinnedRun(known, gap)
    expect(c.unknownChangedHa).toBeGreaterThan(0)
    expect(c.change[cellAt(gap.grid, 0, 110)]).toBe(PIN_UNKNOWN)
    const fine = runToCompletion(extractionOnGrid(grid(flat, DEFAULT_EXTRACTION_SETTINGS, 5)))
    expect(() => comparePinnedRun(known, fine)).toThrow(/another block, grid cell/)
  })
})
