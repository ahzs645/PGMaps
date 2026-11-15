import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import proj4 from 'proj4'
import { describe, expect, it } from 'vitest'
import { projectedCrsDefinition } from '@/lib/geo/projectedCrs'
import { balanceWhatIf } from './balanceLine'
import { analyzeRoad, offsetCoordinate } from './engine'
import { haulUnitCost } from './engineering'
import { createEngineeringDesign, DEFAULT_HAUL_SETTINGS, type HaulSettings, type HaulSite } from './engineeringTypes'
import { massHaulDiagram } from './massHaul'
import { parseProject } from './project'
import { roadEngProject } from './roadEngProject'
import {
  compareMassHaul,
  compareOptimalAreas,
  compareOptimalHaul,
  groundMaterialFieldsFromOptimal,
  haulRatesFromOptimalCostModel,
  haulSiteFromOptimalPit,
  MASS_HAUL_COLUMNS,
  massHaulItems,
  massHaulItemsFromAnalysis,
  OPTIMAL_AREAS_COLUMNS,
  OPTIMAL_CONVEYORS,
  OPTIMAL_COST_MODEL_COLUMNS,
  OPTIMAL_HAUL_DETAILED_COLUMNS,
  OPTIMAL_HAUL_MOVEMENT_COLUMNS,
  OPTIMAL_HAUL_VOLUME_COLUMNS,
  OPTIMAL_MATERIAL_COLUMNS,
  OPTIMAL_PIT_COLUMNS,
  optimalAreasFromAnalysis,
  optimalCostModelFromHaul,
  optimalHaulFromAnalysis,
  optimalMaterialCodes,
  optimalMaterialsFromDesign,
  optimalPitFromRoadEng,
  optimalPitsFromSites,
  optimalQuality,
  pgmapsQuality,
  readMassHaulCsv,
  readOptimalAreasCsv,
  readOptimalCostModelCsv,
  readOptimalHaulCsv,
  readOptimalMaterialsCsv,
  readOptimalPitsCsv,
  SOFTREE_FT_M,
  SOFTREE_YD3_M3,
  softreeUnitsForRoadEng,
  writeMassHaulCsv,
  writeOptimalAreasCsv,
  writeOptimalCostModelCsv,
  writeOptimalHaulCsv,
  writeOptimalMaterialsCsv,
  writeOptimalPitsCsv,
  type OptimalHaulExport,
} from './softreeHaulCsv'
import { createDemoProject, DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE, terrainFromMetadata } from './terrain'
import type { Alignment, Coordinate, RoadSettings, TerrainSource } from './types'

/** Every number in `a` within `tolerance` of the same place in `b`; everything else equal. */
function expectClose(a: unknown, b: unknown, tolerance: number, path = '$'): void {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Math.abs(a - b) > tolerance) throw Error(`${path}: ${a} vs ${b}`)
    return
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    expect(a.length, `${path} length`).toBe(b.length)
    a.forEach((x, i) => expectClose(x, b[i], tolerance, `${path}[${i}]`))
    return
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    expect(Object.keys(a).sort(), `${path} keys`).toEqual(Object.keys(b).sort())
    for (const key of Object.keys(a))
      expectClose((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], tolerance, `${path}.${key}`)
    return
  }
  expect(a, path).toEqual(b)
}
const lines = (text: string) => text.split('\r\n')

const origin: Coordinate = [-122.8, 53.9]
const north = (m: number) => offsetCoordinate(origin, 0, m)
const northing = (p: Coordinate) => (((p[1] - origin[1]) * Math.PI) / 180) * 6371008.8
const flat: TerrainSource = { elevationAt: () => 800 }
const hole: TerrainSource = {
  elevationAt: (lng, lat) => {
    const s = northing([lng, lat])
    return s > 95 && s < 105 ? NaN : 800
  },
}
const settings: RoadSettings = {
  stationInterval: 10,
  crossSectionHalfWidth: 30,
  maxGradePercent: 12,
  minRadius: 25,
  cutRate: 2,
  fillRate: 3,
  surfacingRate: 4,
  clearingRate: 0.5,
  shrinkFactor: 0.9,
}
/** A 300 m road on level ground at 800 m: profile through the given levels at 0, 150 and 300 m. */
function road(levels: [number, number, number]): Alignment {
  return {
    id: 'road',
    name: 'Road',
    color: '#16817a',
    points: [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: north(300), radiusM: 0 },
    ],
    vertical: [
      { id: 's', chainage: 0, elevation: levels[0], curveLength: 0 },
      { id: 'm', chainage: 150, elevation: levels[1], curveLength: 0 },
      { id: 'e', chainage: 300, elevation: levels[2], curveLength: 0 },
    ],
    template: {
      leftWidth: 3,
      rightWidth: 3,
      crossfallPercent: 0,
      cutSlope: 1,
      fillSlope: 1,
      ditchWidth: 0,
      ditchDepth: 0,
      surfaceDepth: 0,
    },
    overrides: [],
    engineering: createEngineeringDesign(),
  }
}
const site = (id: string, kind: HaulSite['kind'], chainage: number, extra: Partial<HaulSite> = {}): HaulSite => ({
  id,
  name: `Pit ${id}`,
  kind,
  chainage,
  accessDistanceM: 120,
  capacityM3: null,
  unitRate: 7,
  fixedCost: 500,
  ...extra,
})
/** Fill in its first half and cut in its second, soil over rock, with a borrow and a waste site. */
function hauledRoad() {
  const a = road([803, 800, 798.5])
  const e = a.engineering!
  e.materials = [
    {
      id: 'roadeng-OB',
      name: 'OB · Overburden',
      color: '#987',
      cutRate: 5,
      reusableFraction: 0.6,
      compactionFactor: 0.85,
      quality: 20,
    },
    {
      id: 'rock',
      name: 'Shot rock',
      color: '#678',
      cutRate: 18,
      reusableFraction: 1,
      compactionFactor: 1.25,
      quality: 90,
    },
  ]
  e.strata = [
    { id: 'top', materialId: 'roadeng-OB', start: 0, end: 300, topDepthM: 0, bottomDepthM: 1 },
    { id: 'bottom', materialId: 'rock', start: 0, end: 300, topDepthM: 1, bottomDepthM: null },
  ]
  Object.assign(e.haul, {
    enabled: true,
    freeHaulDistanceM: 60,
    overhaulDistanceM: 200,
    freeHaulRate: 1,
    overhaulRate: 4,
    endHaulRate: 2,
    freeHaulLoadingRate: 0.5,
    overhaulLoadingRate: 1.5,
    endHaulLoadingRate: 3,
  })
  e.sites = [site('b', 'borrow', 290, { materialId: 'rock' }), site('w', 'waste', 10, { unitRate: 2 })]
  return a
}
const toGrid = (c: Coordinate): [number, number] => [(c[0] + 123) * 1e5, northing(c)]

describe('units', () => {
  it('reads a RoadEng design’s units and refuses anything else', () => {
    expect(softreeUnitsForRoadEng(1)).toBe('metric')
    expect(softreeUnitsForRoadEng(0.3048)).toBe('imperial')
    expect(() => softreeUnitsForRoadEng(0.5)).toThrow(/neither metres nor feet/)
  })
})

describe('material codes and quality', () => {
  it('keeps RoadEng codes, derives the rest, and never takes a quality class or UC', () => {
    const codes = optimalMaterialCodes([
      { id: 'roadeng-SR', name: 'SR · Solid rock' },
      { id: 'q', name: 'Q1 gravel' },
      { id: 'u', name: 'Unsorted till' },
      { id: 'u2', name: 'Unsorted silt' },
      { id: 'x', name: '!!' },
    ])
    expect(codes.get('roadeng-SR')).toBe('SR')
    expect(codes.get('__unclassified')).toBe('UC')
    expect(codes.get('q')).not.toMatch(/^Q[1-4]$/i)
    expect(codes.get('u')).toBe('UN')
    expect(codes.get('u2')).toBe('U1')
    expect(new Set(codes.values()).size).toBe(codes.size)
    for (const code of codes.values()) expect(code).toMatch(/^[A-Z0-9]{2}$/)
  })

  it('maps quality to Q1–Q4 and back without drift', () => {
    expect([100, 75, 74, 50, 25, 24, 0].map(optimalQuality)).toEqual([1, 1, 2, 2, 3, 4, 4])
    for (const q of [1, 2, 3, 4]) expect(optimalQuality(pgmapsQuality(q))).toBe(q)
  })
})

describe('Mass Haul export', () => {
  it('writes the knowledge base’s twelve columns in order', () => {
    expect(MASS_HAUL_COLUMNS).toEqual([
      'Cut Vol',
      'Cut Stn1',
      'Cut Stn2',
      'Cut Centroid',
      'Fill Vol',
      'Fill Stn1',
      'Fill Stn2',
      'Fill Centroid',
      'Type',
      'Over Haul (vol*dist)',
      'Over Haul 2 (vol*(dist-FHD))',
      'Direction',
    ])
    expect(lines(writeMassHaulCsv([]))[0]).toBe(MASS_HAUL_COLUMNS.join(','))
  })

  it('splits a hand-worked loop into its over-haul and free-haul parts', () => {
    // Cut rises 1000 m³ over 0–100 m and fills back over 100–200 m. The chord at height h is
    // 200(1 − h/1000) wide, so with 50 m free haul the top 250 m³ are free haul and 750 m³ over haul.
    const [over, free] = massHaulItems(
      [
        [0, 0],
        [100, 1000],
        [200, 0],
      ],
      50,
    )
    expect(over.type).toBe('Over Haul')
    expect(over.direction).toBe('Push')
    expect(over.cutVolumeM3).toBeCloseTo(750, 9)
    expect([over.cutStn1, over.cutStn2, over.cutCentroid]).toEqual([0, 75, 37.5].map((v) => expect.closeTo(v, 9)))
    expect([over.fillStn1, over.fillStn2, over.fillCentroid]).toEqual(
      [125, 200, 162.5].map((v) => expect.closeTo(v, 9)),
    )
    // ∫ 200(1 − h/1000) dh over 0–750, and that less 50 m × 750 m³.
    expect(over.overHaulM3m).toBeCloseTo(93_750, 6)
    expect(over.overHaul2M3m).toBeCloseTo(56_250, 6)
    expect(over.overHaulM3m! / over.cutVolumeM3!).toBeCloseTo(over.fillCentroid! - over.cutCentroid!, 9)
    expect(free).toMatchObject({ type: 'Free Haul', direction: 'Push', overHaulM3m: null, overHaul2M3m: null })
    expect(free.cutVolumeM3).toBeCloseTo(250, 9)
    expect([free.cutStn1, free.cutStn2, free.fillStn1, free.fillStn2]).toEqual(
      [75, 125, 75, 125].map((v) => expect.closeTo(v, 9)),
    )
    expect(free.cutCentroid).toBeCloseTo(100, 9)
    expect(free.fillCentroid).toBe(free.cutCentroid)
  })

  it('pulls a loop below the line and leaves what does not balance as waste or borrow at the end', () => {
    const [below] = massHaulItems(
      [
        [0, 0],
        [100, -400],
        [200, 0],
      ],
      null,
    )
    // Fill first, then the cut that fills it moves down-station.
    expect(below).toMatchObject({ type: 'Free Haul', direction: 'Pull' })
    expect(below.cutVolumeM3).toBeCloseTo(400, 9)
    const [waste] = massHaulItems(
      [
        [0, 0],
        [100, 300],
      ],
      20,
    )
    expect(waste).toMatchObject({ type: 'Waste', direction: 'Push', fillVolumeM3: null })
    expect([waste.cutVolumeM3, waste.cutStn1, waste.cutStn2, waste.cutCentroid]).toEqual(
      [300, 0, 100, 50].map((v) => expect.closeTo(v, 9)),
    )
    const [borrow] = massHaulItems(
      [
        [0, 0],
        [100, -300],
      ],
      20,
    )
    expect(borrow).toMatchObject({ type: 'Borrow', direction: 'Pull', cutVolumeM3: null })
    expect([borrow.fillVolumeM3, borrow.fillStn1, borrow.fillStn2]).toEqual(
      [300, 0, 100].map((v) => expect.closeTo(v, 9)),
    )
  })

  it('agrees with the what-if balance line on a calculated road', () => {
    const a = road([802.5, 799.5, 801])
    const r = analyzeRoad(a, flat, settings)
    const { balance } = massHaulDiagram(r)
    const items = massHaulItemsFromAnalysis(r, { freeHaulDistanceM: 40 })
    const what = balanceWhatIf(balance, 0, 40)
    const of = (type: string) => items.filter((i) => i.type === type)
    const volume = (list: typeof items) => list.reduce((s, i) => s + (i.cutVolumeM3 ?? i.fillVolumeM3 ?? 0), 0)
    expect(volume([...of('Free Haul'), ...of('Over Haul')])).toBeCloseTo(what.volumeM3, 3)
    expect(volume(of('Over Haul'))).toBeCloseTo(what.overhaulM3, 3)
    expect(of('Over Haul').reduce((s, i) => s + i.overHaul2M3m!, 0)).toBeCloseTo(what.overhaulM3m, 2)
    // What leaves at the end is the curve's end ordinate.
    expect(volume([...of('Waste'), ...of('Borrow')])).toBeCloseTo(Math.abs(what.endM3), 3)
    expect(items.length).toBeGreaterThan(2)
  })

  it('round-trips through the file, metric and in feet and cubic yards', () => {
    const r = analyzeRoad(road([802.5, 799.5, 801]), flat, settings)
    const items = massHaulItemsFromAnalysis(r, { freeHaulDistanceM: 40 })
    const text = writeMassHaulCsv(items)
    const back = readMassHaulCsv(text)
    expect(back.warnings).toEqual([])
    expectClose(back.value, items, 0.006)
    expect(writeMassHaulCsv(back.value)).toBe(text)
    const feet = writeMassHaulCsv(items, { units: 'imperial' })
    expectClose(readMassHaulCsv(feet, { units: 'imperial' }).value, items, 0.01)
    expect(Number(lines(feet)[1].split(',')[0])).toBeCloseTo(items[0].cutVolumeM3! / SOFTREE_YD3_M3, 2)
  })

  it('reads a RoadEng-style file with lines above the header, blank over-haul cells and End Haul', () => {
    const text = [
      'Mass haul',
      '',
      MASS_HAUL_COLUMNS.join(','),
      '120.5,0,180,90.2,120.5,0,180,90,Free Haul,,,Pull',
      '800,200,300,260,800,450,520,480,Over Haul,176000,120000,Push',
      '55,600,640,630,,,,,End Haul,,,Push',
      'x,1,2,3,4,5,6,7,Free Haul,,,Push',
    ].join('\n')
    const { value, warnings } = readMassHaulCsv(text)
    expect(value.map((i) => i.type)).toEqual(['Free Haul', 'Over Haul', 'Waste'])
    expect(value[0]).toMatchObject({ overHaulM3m: null, direction: 'Pull', fillCentroid: 90 })
    expect(value[2]).toMatchObject({ fillVolumeM3: null, cutVolumeM3: 55 })
    expect(warnings).toEqual(['Line 7, cutVol: "x" is not a number.'])
    expect(() => readMassHaulCsv('a,b\n1,2')).toThrow(/no "Cut Vol" header/)
  })

  it('compares a RoadEng file with PGMaps’ items', () => {
    const r = analyzeRoad(road([802.5, 799.5, 801]), flat, settings)
    const ours = massHaulItemsFromAnalysis(r, { freeHaulDistanceM: 40 })
    const self = compareMassHaul(ours, ours)
    expect(self.onlyOurs).toEqual([])
    expect(self.onlyTheirs).toEqual([])
    for (const row of [...self.totals, ...self.pairs.flatMap((p) => p.rows)]) expect(row.difference ?? 0).toBe(0)
    const theirs = ours.map((i) => (i.type === 'Over Haul' ? { ...i, cutVolumeM3: i.cutVolumeM3! - 10 } : i))
    const over = compareMassHaul(theirs, ours).totals.find((t) => t.key === 'Over Haul' && t.field === 'volume')!
    expect(over.difference).toBeCloseTo(10 * theirs.filter((i) => i.type === 'Over Haul').length, 9)
  })

  it('refuses a road whose results leave out an invalid input', () => {
    const r = analyzeRoad(road([802.5, 799.5, 801]), flat, settings)
    expect(() =>
      massHaulItemsFromAnalysis({ ...r, invalidInput: { messages: ['Template: bad'] } as never }, null),
    ).toThrow()
  })
})

describe('Optimal Haul export', () => {
  const a = hauledRoad()
  const r = analyzeRoad(a, flat, settings)
  const data = optimalHaulFromAnalysis(r, a.engineering!)

  it('writes each documented section with its columns in order', () => {
    expect(OPTIMAL_HAUL_VOLUME_COLUMNS).toEqual(['Cut', 'Borrow', 'Underflow', 'Fill', 'Waste', 'Overflow', 'Sidecast'])
    expect(OPTIMAL_HAUL_MOVEMENT_COLUMNS).toEqual([
      'Cut',
      'Pit Load',
      'Station Unload (movement)',
      'Pit Unload',
      'Same Station Unload (no movement)',
      'Sidecast (no movement)',
    ])
    expect(OPTIMAL_HAUL_DETAILED_COLUMNS).toEqual([
      'Material',
      'Vol moved',
      'Cut Stn1',
      'Cut Stn2',
      'Fill Stn1',
      'Fill Stn2',
      'Distance',
      'Type',
      'Direction',
      'Comment',
    ])
    const text = lines(writeOptimalHaulCsv(data))
    expect(text[0]).toBe('Cost summary,Haul,Cut,Fill,Pit Opening')
    expect(text[1]).toMatch(/^Total,/)
    expect(text).toContain('Volume summary,Cut,Borrow,Underflow,Fill,Waste,Overflow,Sidecast')
    expect(text).toContain('Pit summary,Pit b,Pit w')
    const detailed = text.indexOf('Detailed movement summary')
    expect(text[detailed + 1]).toBe(OPTIMAL_HAUL_DETAILED_COLUMNS.join(','))
    expect(text.indexOf('Movement details')).toBeLessThan(detailed)
    // Summaries first, the detailed summary last, a blank line between sections.
    expect(text[detailed - 1]).toBe('')
  })

  it('conserves every material in the volume and movement summaries', () => {
    expect(data.volumes.map((v) => v.material)).toEqual(
      ['OB', 'SH', 'UC'].filter((c) => data.volumes.some((v) => v.material === c)),
    )
    for (const v of data.volumes)
      expect(v.cut! + v.borrow! + v.underflow! + v.fill! + v.waste! + v.overflow! + v.sidecast!).toBeCloseTo(0, 6)
    for (const m of data.movements)
      expect(m.cut! + m.pitLoad! + m.stationUnload! + m.pitUnload! + m.sameStationUnload! + m.sidecast!).toBeCloseTo(
        0,
        6,
      )
    const e = r.engineering!
    // Cut in fill-equivalent m³: usable cut compacted plus unusable bank at the material's factor.
    const factor = new Map(a.engineering!.materials.map((m) => [m.id, m.compactionFactor]))
    const expected = e.materials.reduce(
      (s, m) => s + m.usableCompactedM3 + m.unusableBankM3 * (factor.get(m.materialId) ?? settings.shrinkFactor),
      0,
    )
    expect(data.volumes.reduce((s, v) => s + v.cut!, 0)).toBeCloseTo(expected, 4)
    // The pits hold the volume summary's borrow and waste.
    for (const v of data.volumes) {
      const inPits = data.pits.reduce((s, p) => s + (p.volumes[v.material] ?? 0), 0)
      expect(inPits).toBeCloseTo(v.borrow! + v.waste!, 6)
    }
    expect(data.pits.map((p) => [p.name, p.station, p.distance])).toEqual([
      ['Pit b', 290, 120],
      ['Pit w', 10, 120],
    ])
  })

  it('totals the costs of the plan', () => {
    const e = r.engineering!
    expect(data.costTotal!.haul).toBeCloseTo(e.costs.haul, 6)
    expect(data.costTotal!.fill).toBe(e.costs.fill)
    expect(data.costTotal!.pitOpening).toBe(e.costs.sitePreparation)
    expect(data.costs.reduce((s, c) => s + c.fill!, 0)).toBeCloseTo(e.costs.fill, 6)
    // Excavation of every material plus the borrow pit's supply.
    expect(data.costTotal!.cut).toBeCloseTo(e.costs.cut + e.costs.stripping + e.costs.borrow, 4)
    expect(data.leftOut.join(' ')).toMatch(/Waste disposal and sidecast charges/)
  })

  it('puts each movement on one conveyor and carries it from segment to segment', () => {
    expect(data.detailedMovements.length).toBeGreaterThan(0)
    for (const c of OPTIMAL_CONVEYORS) {
      const loaded = data.segments.reduce((s, g) => s + g.conveyors[c].load + g.conveyors[c].loadPit, 0)
      const unloaded = data.segments.reduce((s, g) => s + g.conveyors[c].unload + g.conveyors[c].unloadPit, 0)
      expect(loaded + unloaded).toBeCloseTo(0, 6)
      for (const g of data.segments) expect(g.conveyors[c].transport).toBeGreaterThanOrEqual(0)
    }
    const pitLoads = data.pitDetails.reduce((s, p) => s + OPTIMAL_CONVEYORS.reduce((t, c) => t + p.conveyors[c], 0), 0)
    const pitSummary = data.pits.reduce(
      (s, p) => s + Object.values(p.volumes).reduce<number>((t, v) => t + (v ?? 0), 0),
      0,
    )
    expect(pitLoads).toBeCloseTo(pitSummary, 6)
    // Borrow and cut-to-fill hauled: their m³·km is the haul summary's.
    const e = r.engineering!
    const work = data.detailedMovements
      .filter((d) => !d.comment.startsWith('Mvt to'))
      .reduce((s, d) => s + d.volume * d.distance!, 0)
    expect(work / 1000).toBeCloseTo(e.haul.haulM3Km, 6)
    const borrow = data.detailedMovements.find((d) => d.comment === 'Mvt from Pit b')!
    expect([borrow.cutStn1, borrow.cutStn2]).toEqual([290, 290])
    const waste = data.detailedMovements.find((d) => d.comment === 'Mvt to Pit w')
    if (waste) expect([waste.fillStn1, waste.fillStn2]).toEqual([10, 10])
    for (const d of data.detailedMovements)
      expect(d.direction).toBe(
        (d.fillStn1 ?? 0) + (d.fillStn2 ?? 0) >= (d.cutStn1 ?? 0) + (d.cutStn2 ?? 0) ? 'Push' : 'Pull',
      )
  })

  it('round-trips through the file, metric and in feet and cubic yards', () => {
    const text = writeOptimalHaulCsv(data)
    const back = readOptimalHaulCsv(text)
    expect(back.warnings).toEqual([])
    expectClose({ ...back.value, leftOut: data.leftOut }, data, 0.006)
    expect(writeOptimalHaulCsv(back.value)).toBe(text)
    const feet = readOptimalHaulCsv(writeOptimalHaulCsv(data, { units: 'imperial' }), { units: 'imperial' })
    expectClose({ ...feet.value, leftOut: data.leftOut }, data, 0.01)
  })

  it('writes only the sections asked for', () => {
    const text = writeOptimalHaulCsv(data, { sections: { details: false, haulSummary: false } })
    expect(text).not.toMatch(/Movement details|Detailed movement summary/)
    const back = readOptimalHaulCsv(text).value
    expect(back.segments).toEqual([])
    expect(back.volumes).toHaveLength(data.volumes.length)
  })

  it('reads a RoadEng-style export and keeps detail rows it does not know', () => {
    const text = [
      'Cost summary,Haul,Cut,Fill,Pit Opening',
      'Total,300,900,150,0',
      'GR,100,400,50',
      'SR,200,500,100',
      '',
      'Volume summary,Cut,Borrow,Underflow,Fill,Waste,Overflow,Sidecast',
      'GR,1000,0,0,-700,-300,0,0',
      'SR,500,200,0,-700,0,0,0',
      '',
      'Pit summary,Pit1,Pit2',
      'Station number,0,450',
      'Distance,0,2500',
      'GR,-300,0',
      'SR,0,200',
      '',
      'Movement summary,Cut,Pit Load,Station Unload (movement),Pit Unload,Same Station Unload (no movement),Sidecast (no movement)',
      'GR,1000,0,-600,-300,-100,0',
      'SR,500,200,-700,0,0,0',
      '',
      'Movement details',
      'Station,Something,Else',
      '0,1,2',
      '',
      'Detailed movement summary',
      'Material,Vol moved,Cut Stn1,Cut Stn2,Fill Stn1,Fill Stn2,Distance,Type,Direction,Comment',
      'GR,600,30,90,100,140,60,Freehaul,Push,',
      'GR,300,10,20,0,0,15,Freehaul,Pull,Mvt to Pit1',
      '',
      'SR,200,450,450,300,320,2640,Endhaul,Pull,Mvt from Pit2',
    ].join('\r\n')
    const { value, warnings } = readOptimalHaulCsv(text, { units: 'imperial' })
    expect(warnings).toEqual([])
    expect(value.costTotal).toEqual({ haul: 300, cut: 900, fill: 150, pitOpening: 0 })
    expect(value.costs[0]).toEqual({ material: 'GR', haul: 100, cut: 400, fill: 50, pitOpening: null })
    expect(value.volumes[0].waste).toBeCloseTo(-300 * SOFTREE_YD3_M3, 9)
    expect(value.pits[1]).toMatchObject({ name: 'Pit2', station: 450 * SOFTREE_FT_M, distance: 2500 * SOFTREE_FT_M })
    expect(value.movements[1].pitLoad).toBeCloseTo(200 * SOFTREE_YD3_M3, 9)
    expect(value.detailedMovements.map((d) => [d.material, d.type, d.direction, d.comment])).toEqual([
      ['GR', 'Freehaul', 'Push', ''],
      ['GR', 'Freehaul', 'Pull', 'Mvt to Pit1'],
      ['SR', 'Endhaul', 'Pull', 'Mvt from Pit2'],
    ])
    expect(value.segments).toEqual([])
    expect(value.otherSections).toEqual([
      { title: 'Movement details', rows: [['Movement details'], ['Station', 'Something', 'Else'], ['0', '1', '2']] },
    ])
    expect(() => readOptimalHaulCsv('a,b\n1,2')).toThrow(/none of its section titles/)
  })

  it('compares a RoadEng export with PGMaps’ by material, pit and haul type', () => {
    const self = compareOptimalHaul(data, data)
    expect(self.onlyOurs).toEqual([])
    expect(self.onlyTheirs).toEqual([])
    for (const row of self.rows) expect(row.difference ?? 0).toBeCloseTo(0, 9)
    const theirs: OptimalHaulExport = {
      ...data,
      volumes: data.volumes.map((v) => (v.material === 'OB' ? { ...v, cut: v.cut! + 5 } : v)),
      pits: data.pits.map((p) => ({ ...p, name: p.name.toUpperCase() })),
    }
    const rows = compareOptimalHaul(theirs, data).rows
    expect(rows.find((x) => x.section === 'volume' && x.key === 'OB' && x.field === 'cut')!.difference).toBeCloseTo(
      -5,
      9,
    )
    expect(rows.filter((x) => x.section === 'pit').length).toBeGreaterThan(0)
  })

  it('refuses a road with no adopted material plan', () => {
    const off = road([803, 800, 798.5])
    expect(() => optimalHaulFromAnalysis(analyzeRoad(off, flat, settings), off.engineering!)).toThrow(
      /Turn on haul allocation/,
    )
    const unsolved = hauledRoad()
    unsolved.engineering!.haul.allocation = 'economic'
    unsolved.engineering!.sites = Array.from({ length: 13 }, (_, i) =>
      site(`s${i}`, i % 2 ? 'borrow' : 'waste', 5 + i * 7, { fixedCost: 100 }),
    )
    const result = analyzeRoad(unsolved, flat, settings)
    expect(result.engineering!.haul.optimizationStatus).toBe('unsolved')
    expect(() => optimalHaulFromAnalysis(result, unsolved.engineering!)).toThrow(/not calculated/)
  })
})

describe('Softree Optimal Areas CSV', () => {
  it('writes the nine header lines and the column line of the API’s example', () => {
    const a = hauledRoad()
    const file = optimalAreasFromAnalysis(analyzeRoad(a, flat, settings), a.engineering, { toGrid })
    const text = lines(writeOptimalAreasCsv(file))
    expect(text.slice(0, 10)).toEqual([
      'version',
      '2',
      'no. h-offset',
      '1',
      'h-offset distance',
      '0',
      'no. station',
      String(file.records.length),
      'data start:',
      OPTIMAL_AREAS_COLUMNS.join(','),
    ])
    expect(OPTIMAL_AREAS_COLUMNS).toEqual(['h-offset', 'station', 'x', 'y', 'z(ground)', 'error', 'v-offset'])
    expect(text[10]).toMatch(/^0,0,[-\d.]+,0,800,0,3,M_/)
  })

  it('holds each station’s cut by material, its fill and its centreline depths', () => {
    const a = hauledRoad()
    const r = analyzeRoad(a, flat, settings)
    const file = optimalAreasFromAnalysis(r, a.engineering, { toGrid })
    file.records.forEach((record, i) => {
      const s = r.stations[i]
      const m = record.entries.filter((e) => e.code.startsWith('M_'))
      expect(m.filter((e) => e.value > 0).reduce((t, e) => t + e.value, 0)).toBeCloseTo(s.cutAreaM2!, 3)
      expect(-m.filter((e) => e.value < 0).reduce((t, e) => t + e.value, 0)).toBeCloseTo(s.fillAreaM2!, 3)
      const v = s.designElevation! - s.groundElevation!
      expect(record.vOffset).toBeCloseTo(v, 9)
      expect(record.entries.find((e) => e.code === 'T_MFILL')!.value).toBeCloseTo(v, 9)
      expect(record.entries.find((e) => e.code === 'T_MCUT')!.value).toBeCloseTo(-v, 9)
      for (const e of m) expect(['M_OB', 'M_SH', 'M_UC', 'M_q4']).toContain(e.code)
    })
  })

  it('writes subgrade fill under the quality or material its requirement names', () => {
    const a = hauledRoad()
    a.engineering!.fillRequirements = [
      { id: 'f1', start: 0, end: 80, layer: 'subgrade', minQuality: 60, replaceable: true },
      { id: 'f2', start: 80, end: 150, layer: 'subgrade', materialId: 'rock', replaceable: false },
    ]
    a.engineering!.haul.allocation = 'economic'
    const r = analyzeRoad(a, flat, settings)
    const file = optimalAreasFromAnalysis(r, a.engineering, { toGrid })
    const fillCodes = (station: number) =>
      file.records.find((x) => x.station === station)!.entries.filter((e) => e.value < 0 && e.code.startsWith('M_'))
    expect(fillCodes(50).map((e) => e.code)).toEqual(['M_q2'])
    expect(fillCodes(120).map((e) => e.code)).toEqual(['M_SH'])
  })

  it('writes an incomplete station as an error record with no areas', () => {
    const a = hauledRoad()
    const r = analyzeRoad(a, hole, settings)
    const file = optimalAreasFromAnalysis(r, a.engineering, { toGrid })
    const bad = file.records.filter((x) => x.error)
    expect(bad.length).toBeGreaterThan(0)
    for (const x of bad) expect(x.entries).toEqual([])
    const text = writeOptimalAreasCsv(file)
    expect(lines(text).some((l) => /^0,100,[^,]*,[^,]*,,1,$/.test(l))).toBe(true)
  })

  it('round-trips through the file, metric and in feet', () => {
    const a = hauledRoad()
    const file = optimalAreasFromAnalysis(analyzeRoad(a, hole, settings), a.engineering, { toGrid })
    const text = writeOptimalAreasCsv(file)
    const back = readOptimalAreasCsv(text)
    expect(back.warnings).toEqual([])
    expectClose(back.value, file, 6e-5)
    expect(writeOptimalAreasCsv(back.value)).toBe(text)
    const feet = writeOptimalAreasCsv(file, { units: 'imperial' })
    expectClose(readOptimalAreasCsv(feet, { units: 'imperial' }).value, file, 1e-4)
  })

  it('reads RoadEng’s trial levels, bridges and both names of the fill depth, and compares at our level', () => {
    const text = [
      'version,,,',
      '2',
      'no. h-offset',
      '2',
      'h-offset distance',
      '2.5',
      'no. station',
      '2',
      'data start:',
      'h-offset,station,x,y,z(ground),error,v-offset',
      '-2,10,1000,2000,500,0,-1,M_OB,10,T_MCUT,1,T_FILL,-1',
      '-2,10,1000,2000,500,0,1,M_q1,-4,T_MCUT,-1,T_MFILL,1',
      '0,10,1001,2000,500,0,-1,M_OB,12',
      '0,10,1001,2000,500,0,1,M_q1,-6',
      '0,20,1001,2010,500,0',
      '0,30,1001,2020,500,0,-1,X_OB,3',
    ].join('\r\n')
    const { value, warnings } = readOptimalAreasCsv(text)
    expect(value).toMatchObject({ version: 2, hOffsetCount: 2, hOffsetDistance: 2.5, stationCount: 2 })
    expect(value.records).toHaveLength(5)
    expect(value.records[0].entries.map((e) => e.code)).toEqual(['M_OB', 'T_MCUT', 'T_FILL'])
    expect(value.records[4]).toMatchObject({ station: 20, bridge: true, vOffset: null, entries: [] })
    expect(warnings).toEqual(['Line 16, materials: "X_OB" is neither an M_ material nor a T_ pseudo material.'])

    // Our level 0 at station 10 sits halfway between their −1 and +1 levels at h-offset 0.
    const ours = {
      ...value,
      records: [
        {
          hOffset: 0,
          station: 10,
          x: 1001,
          y: 2000,
          zGround: 500,
          error: false,
          bridge: false,
          vOffset: 0,
          entries: [
            { code: 'M_OB', value: 6 },
            { code: 'M_q1', value: -3 },
          ],
        },
      ],
    }
    const c = compareOptimalAreas(value, ours)
    const at = (field: string) => c.rows.find((x) => x.field === field)!
    expect(at('M_OB')).toMatchObject({ theirs: 6, ours: 6, difference: 0 })
    expect(at('M_Q1')).toMatchObject({ theirs: -3, ours: -3, difference: 0 })
    expect(at('(cut)').difference).toBe(0)
    expect(c.unmatchedTheirs).toEqual([])
    // A level outside their band, or a station they do not have, is unmatched.
    const outside = compareOptimalAreas(value, {
      ...ours,
      records: [
        { ...ours.records[0], vOffset: 3 },
        { ...ours.records[0], station: 50 },
      ],
    })
    expect(outside.unmatchedOurs).toEqual([10, 50])
  })

  it('compares PGMaps with itself without a difference', () => {
    const a = hauledRoad()
    const file = optimalAreasFromAnalysis(analyzeRoad(a, flat, settings), a.engineering, { toGrid })
    const c = compareOptimalAreas(file, file)
    expect(c.unmatchedOurs).toEqual([])
    for (const row of c.rows) expect(row.difference).toBeCloseTo(0, 12)
  })
})

describe('Optimal API materials, pits and cost model', () => {
  const design = hauledRoad().engineering!

  it('writes the structures’ fields in the API’s order', () => {
    expect(lines(writeOptimalMaterialsCsv([]))[0]).toBe(OPTIMAL_MATERIAL_COLUMNS.join(','))
    expect(OPTIMAL_MATERIAL_COLUMNS).toEqual([
      'Identifier',
      'Description',
      'Embankment Cost',
      'Excavation Cost',
      'Quality',
      'Cut Factor',
      'Fill Factor',
      'True Material',
    ])
    expect(lines(writeOptimalPitsCsv([]))[0]).toBe(OPTIMAL_PIT_COLUMNS.join(','))
    expect(OPTIMAL_COST_MODEL_COLUMNS.slice(0, 3)).toEqual([
      'Freehaul Move Cost',
      'Overhaul Move Cost',
      'Endhaul Move Cost',
    ])
  })

  it('round-trips materials and gives a ground material its rate, factor and quality back', () => {
    const rows = optimalMaterialsFromDesign(design.materials, {
      embankmentRate: 3,
      unclassified: { cutRate: 2, compactionFactor: 0.9 },
    })
    expect(rows.map((m) => [m.id, m.description, m.quality])).toEqual([
      ['OB', 'Overburden', 4],
      ['SH', 'Shot rock', 1],
      ['UC', 'Unclassified excavation', null],
    ])
    const text = writeOptimalMaterialsCsv(rows)
    expectClose(readOptimalMaterialsCsv(text).value, rows, 1e-6)
    expect(writeOptimalMaterialsCsv(readOptimalMaterialsCsv(text).value)).toBe(text)
    const yd = readOptimalMaterialsCsv(writeOptimalMaterialsCsv(rows, { units: 'imperial' }), { units: 'imperial' })
    expectClose(yd.value, rows, 1e-4)
    expect(lines(writeOptimalMaterialsCsv(rows, { units: 'imperial' }))[1]).toBe(
      `OB,Overburden,${+(3 * SOFTREE_YD3_M3).toFixed(4)},${+(5 * SOFTREE_YD3_M3).toFixed(4)},4,1,${+(1 / 0.85).toFixed(6)},1`,
    )
    const ob = groundMaterialFieldsFromOptimal(rows[0])
    expect(ob.cutRate).toBe(5)
    expect(ob.compactionFactor).toBeCloseTo(0.85, 12)
    expect(ob.quality).toBe(0)
    expect(readOptimalMaterialsCsv('Identifier,Quality\nAB,7').warnings).toEqual([
      'Line 2, quality: 7 is not a class 1 to 4.',
    ])
  })

  it('round-trips pits back to the same sites', () => {
    const codes = optimalMaterialCodes(design.materials)
    const sites: HaulSite[] = [
      ...design.sites,
      site('c', 'borrow', 150, { capacityM3: 900, sourceNotes: '=quarry, north', enabled: false }),
    ]
    const pits = optimalPitsFromSites(sites, { codes, smart: true })
    expect(pits[0]).toMatchObject({
      id: 'Pit b',
      kind: 'borrow',
      material: 'SH',
      excavationCost: 7,
      disposalCost: null,
    })
    expect(pits[1]).toMatchObject({ kind: 'waste', excavationCost: null, disposalCost: 2 })
    const text = writeOptimalPitsCsv(pits)
    // A comment that would run as a spreadsheet formula is written behind an apostrophe.
    expect(text).toContain(`"'=quarry, north"`)
    const back = readOptimalPitsCsv(text).value
    expectClose(back, pits, 1e-9)
    const idOf = new Map([...codes].map(([id, code]) => [code, id]))
    back.forEach((pit, i) =>
      expect(haulSiteFromOptimalPit(pit, { id: sites[i].id, materialIdOf: (c) => idOf.get(c) })).toEqual(sites[i]),
    )
    expectClose(
      readOptimalPitsCsv(writeOptimalPitsCsv(pits, { units: 'imperial' }), { units: 'imperial' }).value,
      pits,
      1e-3,
    )
  })

  it('prices every haul the same through Optimal’s whole-distance cost lines', () => {
    const h: HaulSettings = { ...DEFAULT_HAUL_SETTINGS, ...design.haul }
    const cm = optimalCostModelFromHaul(h)
    for (const d of [0, 30, 60, 61, 150, 200, 201, 900]) {
      const c = d <= h.freeHaulDistanceM ? 0 : d <= h.overhaulDistanceM ? 1 : 2
      expect(cm.load[c] + (cm.move[c] * d) / 1000).toBeCloseTo(haulUnitCost(h, d), 9)
    }
    const text = writeOptimalCostModelCsv(cm)
    expectClose(readOptimalCostModelCsv(text).value, cm, 1e-9)
    expectClose(
      haulRatesFromOptimalCostModel(readOptimalCostModelCsv(text).value, h),
      {
        freeHaulDistanceM: h.freeHaulDistanceM,
        overhaulDistanceM: h.overhaulDistanceM,
        freeHaulRate: h.freeHaulRate,
        overhaulRate: h.overhaulRate,
        endHaulRate: h.endHaulRate,
        freeHaulLoadingRate: h.freeHaulLoadingRate,
        overhaulLoadingRate: h.overhaulLoadingRate,
        endHaulLoadingRate: h.endHaulLoadingRate,
      },
      1e-9,
    )
    expectClose(
      readOptimalCostModelCsv(writeOptimalCostModelCsv(cm, { units: 'imperial' }), { units: 'imperial' }).value,
      cm,
      2e-4,
    )
  })

  it('finds the haul distances where the cost lines cross when the file leaves them to the lines', () => {
    // Free haul 0 + 10d, overhaul 1 + 5d, end haul 3 + 3d ($/m³, d in km): crossings at 0.2 and 1 km.
    const text = `${OPTIMAL_COST_MODEL_COLUMNS.join(',')}\r\n10,5,3,0,1,3,-1,-1\r\n`
    const cm = readOptimalCostModelCsv(text).value
    expect([cm.freeHaulDistanceM, cm.overhaulDistanceM]).toEqual([null, null])
    const rates = haulRatesFromOptimalCostModel(cm, DEFAULT_HAUL_SETTINGS)
    expect(rates.freeHaulDistanceM).toBeCloseTo(200, 9)
    expect(rates.overhaulDistanceM).toBeCloseTo(1000, 9)
    expect(rates.overhaulLoadingRate).toBeCloseTo(1 + 5 * 0.2, 9)
    expect(lines(writeOptimalCostModelCsv(cm))[1]).toBe('10,5,3,0,1,3,-1,-1')
  })

  it('reads a RoadEng design’s pit line', () => {
    const pit = optimalPitFromRoadEng('500,250,12,800,1000000,1,Pit A,GR,0,0,312.5,0', 1)
    expect(pit).toMatchObject({
      id: 'Pit A',
      kind: 'borrow',
      accessStation: 500,
      accessDistance: 250,
      excavationCost: 12,
      sitePreparation: 800,
      capacityLimit: null,
      material: 'GR',
    })
    const feet = optimalPitFromRoadEng('100,50,9,0,2000,0,Spoil, ,0,0,1,0', SOFTREE_FT_M)
    expect(feet).toMatchObject({ kind: 'waste', material: null, excavationCost: null })
    expect(feet.disposalCost).toBeCloseTo(9 / SOFTREE_YD3_M3, 9)
    expect(feet.capacityLimit).toBeCloseTo(2000 * SOFTREE_YD3_M3, 9)
    expect(() => optimalPitFromRoadEng('1,2,3', 1)).toThrow(/fewer than the eight/)
  })
})

// Softree's published samples, read from a local copy and never committed (see roadEngImport.test.ts).
const samples = process.env.ROADENG_SAMPLES
describe.skipIf(!samples || !existsSync(samples ?? ''))('Softree sample projects', { timeout: 120_000 }, () => {
  const read = (path: string) => new Uint8Array(readFileSync(join(samples!, path)))
  const dsn = (path: string) => strFromU8(unzipSync(read(path))['Location1.dsn'], true)
  const pitLines = (text: string) => [...text.matchAll(/^OptParms_Pit-\d+=(.*)$/gm)].map((m) => m[1].trim())

  it('reads every pit of the samples and writes them back unchanged', () => {
    for (const path of [
      'LongRoad_1/LongRoad 1.dsnx',
      'Cul-de-sac-design/CulDeSacExample/CulDeSacExampleComplete.dsnx',
    ]) {
      const pits = pitLines(dsn(path)).map((v) => optimalPitFromRoadEng(v, 1))
      expect(pits.length).toBeGreaterThan(0)
      const text = writeOptimalPitsCsv(pits)
      expectClose(readOptimalPitsCsv(text).value, pits, 1e-3)
      expect(writeOptimalPitsCsv(readOptimalPitsCsv(text).value)).toBe(text)
    }
    const long = pitLines(dsn('LongRoad_1/LongRoad 1.dsnx')).map((v) => optimalPitFromRoadEng(v, 1))
    expect(long.map((p) => p.kind)).toEqual(['borrow', 'waste', 'waste', 'borrow', 'waste', 'borrow'])
  })

  it('exports LongRoad’s areas and mass haul and reads them back unchanged', () => {
    let n = 0
    const p = roadEngProject(
      [
        { name: 'LongRoad 1.dsnx', bytes: read('LongRoad_1/LongRoad 1.dsnx') },
        { name: 'LongRoad 1.terx', bytes: read('LongRoad_1/LongRoad 1.terx') },
      ],
      {
        newId: () => `id${n++}`,
        color: () => '#123456',
        template: { ...DEFAULT_TEMPLATE },
        verticalReference: 'CGVD2013',
      },
    )
    const project = parseProject({
      ...createDemoProject(),
      name: p.name,
      terrain: p.terrain,
      alignments: p.roads.map((r) => r.alignment),
      activeAlignmentId: p.roads[0].alignment.id,
      context: p.context,
      cables: p.cables,
      reference: p.reference,
      profiles: [],
    })
    const alignment = project.alignments[0]
    const r = analyzeRoad(alignment, terrainFromMetadata(project.terrain)!, DEFAULT_ROAD_SETTINGS)
    const forward = proj4('EPSG:4326', projectedCrsDefinition(p.epsg!)!)
    const grid = (c: Coordinate) => forward.forward(c) as [number, number]
    const areas = optimalAreasFromAnalysis(r, alignment.engineering, { toGrid: grid })
    const text = writeOptimalAreasCsv(areas)
    expect(writeOptimalAreasCsv(readOptimalAreasCsv(text).value)).toBe(text)
    expect(
      compareOptimalAreas(readOptimalAreasCsv(text).value, areas).rows.every((x) => Math.abs(x.difference ?? 0) < 1e-3),
    ).toBe(true)
    const items = massHaulItemsFromAnalysis(r, alignment.engineering?.haul)
    const mass = writeMassHaulCsv(items)
    expect(writeMassHaulCsv(readMassHaulCsv(mass).value)).toBe(mass)
    expect(items.length).toBeGreaterThan(0)

    // The design's own pits as sites, hauled by the nearest-site allocation.
    const e = alignment.engineering!
    const ids = new Map(e.materials.map((m) => [/^roadeng-(.*)$/.exec(m.id)?.[1], m.id]))
    e.sites = pitLines(dsn('LongRoad_1/LongRoad 1.dsnx')).map((v, i) =>
      haulSiteFromOptimalPit(optimalPitFromRoadEng(v, 1), { id: `pit${i}`, materialIdOf: (c) => ids.get(c) }),
    )
    e.haul = { ...e.haul, enabled: true }
    const hauled = analyzeRoad(alignment, terrainFromMetadata(project.terrain)!, DEFAULT_ROAD_SETTINGS)
    const haul = optimalHaulFromAnalysis(hauled, e)
    for (const v of haul.volumes)
      if (v.material !== '??')
        expect(v.cut! + v.borrow! + v.underflow! + v.fill! + v.waste! + v.overflow! + v.sidecast!).toBeCloseTo(0, 3)
    const haulText = writeOptimalHaulCsv(haul)
    const back = readOptimalHaulCsv(haulText)
    expect(back.warnings).toEqual([])
    expect(writeOptimalHaulCsv(back.value)).toBe(haulText)
    expect(haul.pits.map((x) => x.name)).toEqual(['Borrow 1', 'Waste 1', 'Waste 2', 'Borrow 2', 'Waste 3', 'Borrow 3'])
  })
})
