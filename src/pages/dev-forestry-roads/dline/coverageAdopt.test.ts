import { describe, expect, it } from 'vitest'
import type { CableLineRecord } from '../cableCoverage'
import { DEFAULT_CABLE_RULE, SUPPORT_CLEARANCE_ZONE_M } from '../cableCoverageRule'
import { layoutRun, savedLayoutToAnalyse } from '../cableLayout/settings'
import { distance } from '../engine'
import { parseProject } from '../project'
import { createDemoProject, localMetricGrid } from '../terrain'
import type { Coordinate, TerrainSource } from '../types'
import { cableLineFromCoverage } from './coverageAdopt'

const origin: Coordinate = [-122.72, 53.89]
const grid = localMetricGrid(origin)
const [x0, y0] = grid.toGrid(origin)
const record: CableLineRecord = {
  id: 7,
  landing: 0,
  bearingDeg: 45,
  horizontalM: 424.26,
  skylineM: 430,
  configuration: 'below',
  designedLanding: false,
  preTensionKN: 140,
  points: [
    { stationM: 0, groundM: 1000, heightM: 10.5, xy: [x0, y0] },
    { stationM: 212.13, groundM: 1050, heightM: 12, xy: [x0 + 150, y0 + 150] },
    { stationM: 424.26, groundM: 1100, heightM: 12, xy: [x0 + 300, y0 + 300] },
  ],
  cells: 100,
  areaHa: 4,
  meanCarriageM: 200,
}
const slope: TerrainSource = { elevationAt: (_lng, lat) => 1000 + (lat - origin[1]) * 30_000 }

describe('a suggested cable line as a D-line', () => {
  const line = cableLineFromCoverage(record, DEFAULT_CABLE_RULE, grid.toLonLat, 'new-id', 'Block A line 7')

  it('runs from the yarder to the tail with the yarder rigging and the screen supports as its saved layout', () => {
    expect(line).toMatchObject({
      id: 'new-id',
      name: 'Block A line 7',
      yarderAt: 'start',
      sagModel: 'mechanics',
      startHeight: 10.5,
      endHeight: 12,
      rigging: DEFAULT_CABLE_RULE.rigging,
    })
    expect(line.start[0]).toBeCloseTo(origin[0], 9)
    const lengthM = distance(line.start, line.end)
    const saved = line.supportLayout!.saved!
    expect(saved).toMatchObject({ preTensionKN: 140, complete: true })
    expect(saved.supports.map((s) => s.heightM)).toEqual([10.5, 12, 12])
    // Stations are scaled to the D-line's own length: the tail lands on the far end.
    expect(saved.supports.at(-1)!.stationM).toBe(lengthM)
    expect(saved.supports[1].stationM).toBeCloseTo(lengthM / 2, 1)
    expect(line.supportLayout).toMatchObject({
      cableSystem: DEFAULT_CABLE_RULE.system,
      maxLoadedDeg: DEFAULT_CABLE_RULE.maxBreakDeg,
      clearanceFromStartM: SUPPORT_CLEARANCE_ZONE_M,
    })
  })

  it('is a valid project D-line whose saved layout can be checked', () => {
    const project = parseProject(JSON.parse(JSON.stringify({ ...createDemoProject(), cables: [line] })))
    expect(project.cables[0].supportLayout?.saved?.supports).toHaveLength(3)
    const prepared = layoutRun(line, slope, line.supportLayout!)
    expect(prepared.ok).toBe(true)
    if (prepared.ok) expect(savedLayoutToAnalyse(prepared.run, line.supportLayout!.saved)).not.toBeNull()
  })
})
