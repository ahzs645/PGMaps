import { describe, expect, it } from 'vitest'
import { analyzeRoad, offsetCoordinate } from './engine'
import { reportingRows } from './StationTable'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE } from './terrain'
import type { Coordinate } from './types'

const origin: Coordinate = [-122.8, 53.9]
const analysis = analyzeRoad(
  {
    id: 'r',
    name: 'Road',
    color: '#16817a',
    points: [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: offsetCoordinate(origin, 0, 450), radiusM: 0 },
    ],
    vertical: [
      { id: 's', chainage: 0, elevation: 799, curveLength: 0 },
      { id: 'e', chainage: 450, elevation: 799, curveLength: 0 },
    ],
    template: { ...DEFAULT_TEMPLATE },
    overrides: [],
  },
  { elevationAt: () => 800 },
  DEFAULT_ROAD_SETTINGS,
)

describe('station table reporting interval', () => {
  it('reports every calculated station by default', () => {
    expect(reportingRows(analysis, analysis.stations, 0)).toHaveLength(analysis.stations.length)
  })

  it('reports every 200 m plus the end, summing volumes since the previous row', () => {
    const rows = reportingRows(analysis, analysis.stations, 200)
    expect(rows.map((r) => r.station.chainage)).toEqual([0, 200, 400, 450])
    const total = rows.reduce((sum, r) => sum + r.cutVolume!, 0)
    expect(total).toBeCloseTo(analysis.cutVolumeM3, 6)
    expect(rows[1].span).toBe(200)
  })
})
