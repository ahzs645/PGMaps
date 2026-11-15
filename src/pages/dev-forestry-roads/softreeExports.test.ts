import proj4 from 'proj4'
import { describe, expect, it } from 'vitest'
import { projectedCrsDefinition } from '@/lib/geo/projectedCrs'
import { analyzeRoad } from './engine'
import { createEngineeringDesign, type HaulSite } from './engineeringTypes'
import type { XY } from './landXmlImport'
import { roadEngProjectExport } from './roadEngProjectExport'
import { parseSoftreeLocationAscii, parseSoftreeTerrainAscii } from './softreeAscii'
import {
  locationAsciiFile,
  massHaulCsvFile,
  optimalAreasCsvFile,
  optimalHaulCsvFile,
  optimalInputFiles,
  softreeUnitM,
  softreeUnits,
  terrainAsciiFromRoadEngProject,
} from './softreeExports'
import { MASS_HAUL_COLUMNS, readOptimalMaterialsCsv, readOptimalPitsCsv } from './softreeHaulCsv'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE } from './terrain'
import type { Alignment, Coordinate, ContextFeature } from './types'

const utm = proj4('EPSG:4326', projectedCrsDefinition(3157)!)
const lonLat = (x: number, y: number) => utm.inverse([515_000 + x, 5_975_000 + y]) as Coordinate
const toGrid = (c: Coordinate) => utm.forward([...c]) as XY
/** Ground rising 5 % to the east from 800 m. */
const ground = { elevationAt: (lon: number, lat: number) => 800 + 0.05 * (toGrid([lon, lat])[0] - 515_000) }
const site = (id: string, kind: HaulSite['kind'], chainage: number): HaulSite => ({
  id,
  name: `Pit ${id}`,
  kind,
  chainage,
  accessDistanceM: 50,
  capacityM3: null,
  unitRate: 7,
  fixedCost: 500,
})
function road(): Alignment {
  const engineering = createEngineeringDesign()
  engineering.haul = { ...engineering.haul, enabled: true }
  engineering.sites = [site('b', 'borrow', 0), site('w', 'waste', 300)]
  return {
    id: 'r',
    name: 'Spur 7',
    color: '#000000',
    points: [
      { id: 'a', coordinate: lonLat(0, 0), radiusM: 0 },
      { id: 'b', coordinate: lonLat(300, 0), radiusM: 0 },
    ],
    vertical: [
      { id: 's', chainage: 0, elevation: 801, curveLength: 0 },
      { id: 'e', chainage: 300, elevation: 812, curveLength: 0 },
    ],
    template: { ...DEFAULT_TEMPLATE },
    overrides: [],
    engineering,
  }
}

describe('Softree files from a calculated road', () => {
  const alignment = road()
  const analysis = analyzeRoad(alignment, ground, DEFAULT_ROAD_SETTINGS)

  it('take the units of a project opened from a RoadEng design in feet, and metres otherwise', () => {
    expect(softreeUnits({})).toBe('metric')
    expect(softreeUnits({ localPlane: { offsetM: [0, 0], unitM: 0.3048, source: 'x' } })).toBe('imperial')
    expect(softreeUnitM({ localPlane: { offsetM: [0, 0], unitM: 1, source: 'x' } })).toBe(1)
  })

  it('write the mass haul, optimal haul and areas files, in feet when asked', () => {
    const mass = massHaulCsvFile(analysis, alignment.engineering, 'metric')
    expect(mass.split('\r\n')[0]).toBe(MASS_HAUL_COLUMNS.join(','))
    const haul = optimalHaulCsvFile(analysis, alignment.engineering, 'metric')
    expect(haul.text).toMatch(/Cost summary/)
    expect(Array.isArray(haul.leftOut)).toBe(true)
    const metric = optimalAreasCsvFile(analysis, alignment.engineering, toGrid, 'metric')
    const feet = optimalAreasCsvFile(analysis, alignment.engineering, toGrid, 'imperial')
    const easting = (text: string) => Number(text.split('\r\n')[10].split(',')[2])
    expect(easting(feet)).toBeCloseTo(easting(metric) / 0.3048, 2)
    expect(() => optimalHaulCsvFile(analysis, undefined, 'metric')).toThrow(/haul allocation/)
  })

  it('write the Optimal inputs as three CSV files that read back', () => {
    const files = optimalInputFiles(alignment.engineering, DEFAULT_ROAD_SETTINGS, 'metric', 'spur')
    expect(files.map((f) => f.path)).toEqual([
      'spur-optimal-materials.csv',
      'spur-optimal-pits.csv',
      'spur-optimal-cost-model.csv',
    ])
    // No ground types: unclassified excavation at the project's cut rate.
    expect(readOptimalMaterialsCsv(files[0].content).value).toEqual([
      expect.objectContaining({ id: 'UC', excavationCost: DEFAULT_ROAD_SETTINGS.cutRate }),
    ])
    expect(readOptimalPitsCsv(files[1].content).value.map((p) => p.id)).toEqual(['Pit b', 'Pit w'])
    expect(() => optimalInputFiles(undefined, DEFAULT_ROAD_SETTINGS, 'metric', 'spur')).toThrow(/Engineering/)
  })

  it('write the location file from the start station, in the unit and layout chosen', () => {
    const text = locationAsciiFile(alignment, analysis, toGrid, {
      unitM: 0.3048,
      startStationM: 1000,
      delimiter: '\t',
      singleLine: false,
    })
    const file = parseSoftreeLocationAscii(text)
    expect(file.layout.delimiter).toBe('\t')
    expect(file.stations[0].lStation).toBeCloseTo(1000 / 0.3048, 3)
    expect(file.stations).toHaveLength(analysis.stations.length)
    const cl = file.stations[0].points.find((p) => p.flag === 'SG' && p.code === 'CL')!
    expect(cl.x! * 0.3048).toBeCloseTo(515_000, 1)
    expect(cl.z! * 0.3048).toBeCloseTo(801, 2)
    const single = locationAsciiFile(alignment, analysis, toGrid, {
      unitM: 1,
      startStationM: 0,
      delimiter: ',',
      singleLine: true,
    })
    expect(single.trim().split('\r\n')).toHaveLength(analysis.stations.length)
  })

  it('write the terrain ASCII file from the RoadEng project export’s terrain', () => {
    const raster = {
      origin: [514_990, 5_975_040] as [number, number],
      pixelSize: [10, -10] as [number, number],
      width: 33,
      height: 9,
      values: Array.from({ length: 33 * 9 }, (_, i) => 800 + (i % 33)),
    }
    const stream: ContextFeature = {
      id: 's',
      name: 'Willow Creek',
      kind: 'stream',
      geometry: { type: 'LineString', coordinates: [lonLat(100, -30), lonLat(110, 30)] },
    } as ContextFeature
    const zipped = roadEngProjectExport({
      name: 'Spur 7',
      roads: [{ alignment, analysis }],
      grid: { epsg: 3157, toGrid, raster: { ...raster } as never },
      context: [stream],
      cables: [],
      reference: [],
      elevationAt: (c) => ground.elevationAt(c[0], c[1]),
    })
    const written = terrainAsciiFromRoadEngProject(zipped.bytes)
    const file = parseSoftreeTerrainAscii(written.text)
    const named = file.features.find((f) => /Willow Creek/.test(f.name))
    expect(named?.points.length).toBe(6)
    const groundPoints = file.features.filter((f) => f.type === 'points' || f.type === 'point')
    expect(groundPoints.reduce((n, f) => n + f.points.length / 3, 0)).toBe(33 * 9)
    expect(written.notes[0]).toMatch(/features/)
  })
})
