import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  activeRoadEngSolution,
  readRoadEngStoredResults,
  roadEngStoredResultsNote,
  roadEngUnitMOfCode,
  storedResultsOfSource,
} from './roadEngStoredResults'

// Two vertical options laid out as RoadEng 9 and 11 write them: the active one ("opt 3") costed,
// the other with an unsolved costing, and an optimization that was never run.
const DSN = [
  '[design]',
  'units=10000',
  '[OptAlignCost-0]',
  'OptParms_CostSolution_v3=0,0,0,-9999,-9999,-9999,-9999,-9999,0,-9999,0,-1,-1,0',
  'OptParms_FullSolution_v3=0,0,0,-9999,-9999,-9999,-9999,-9999,0,-9999,0,-1,-1,0',
  'OptParmsNew=-,0,0,80,0,-10,10,0,0,902.6,2437,23,0,0,32,2275,131071,0,0,0,0,0,0,0,66,0,-9999,-9999,10,0,0,V-align 1,1,0,-9999,1',
  'OptParmsRefAlign=opt 3,opt 3,Ground',
  '[OptAlignCost-1]',
  'OptParms_CostSolution_v3=2,0,0,902.503639918,2448.89837736,216131.467222,1347789.68817,184251.903261,0,0,0.65,1522792015,-1,1',
  'OptParms_FullSolution_v3=0,0,0,-9999,-9999,-9999,-9999,-9999,0,-9999,0,-1,-1,0',
  'OptParmsNew=-,0,0,80,0,-10,10,0,0,902.6,2437,23,0,0,32,0,256,0,0,0,0,0,0,0,194,0,-9999,-9999,200,0,0,opt 3,1,0,-9999,1',
  'OptParmsRefAlign=opt 3,opt 3,Ground',
  '[OptAlignCost]',
  'nOptCostParameters=2,1',
  'OptCostSpacing=10,2275,458751',
  '',
].join('\r\n')

describe('results a RoadEng design stores', () => {
  it("reads the active vertical alignment's last costing: five costs, the stations, when", () => {
    const read = readRoadEngStoredResults(DSN, 1)
    expect(read.activeOption).toBe('opt 3')
    expect(read.unsolved).toEqual(['V-align 1'])
    expect(read.spacingM).toBe(10)
    expect(read.solutions).toHaveLength(1)
    const s = activeRoadEngSolution(read)!
    expect(s).toMatchObject({
      section: 'OptAlignCost-1',
      option: 'opt 3',
      active: true,
      kind: 'costing',
      fromStationM: 902.503639918,
      toStationM: 2448.89837736,
      costs: { haul: 216131.467222, cut: 1347789.68817, fill: 184251.903261, pitOpening: 0, attributes: 0 },
      seconds: 0.65,
      solvedAt: '2018-04-03T21:46:55.000Z',
    })
    expect(s.total).toBeCloseTo(216131.467222 + 1347789.68817 + 184251.903261, 6)
    expect(roadEngStoredResultsNote('Main', read)).toBe(
      "Main: the design stores RoadEng's last costing of vertical alignment \"opt 3\" over stations 902.504–2,448.898 m at 10 m spacing, solved 2018-04-03 21:46 UTC: haul 216,131.47, cut 1,347,789.69, fill 184,251.90; total 1,748,173.06, in the design's currency. Compare with RoadEng… sets these beside the road's own costs.",
    )
  })

  it('converts a foot design’s stations and spacing, and leaves costs in their currency', () => {
    const read = readRoadEngStoredResults(DSN.replace('units=10000', 'units=3048'), 0.3048)
    const s = activeRoadEngSolution(read)!
    expect(s.fromStationM).toBeCloseTo(902.503639918 * 0.3048, 9)
    expect(s.costs.cut).toBe(1347789.68817)
    expect(read.spacingM).toBeCloseTo(3.048, 9)
    expect(roadEngUnitMOfCode('3048')).toBe(0.3048)
    expect(roadEngUnitMOfCode('7')).toBeNull()
  })

  it('finds nothing to compare where nothing was solved, and says so with no note', () => {
    const unsolved = DSN.replace(/OptParms_CostSolution_v3=2,/, 'OptParms_CostSolution_v3=0,')
    const read = readRoadEngStoredResults(unsolved, 1)
    expect(read.solutions).toEqual([])
    expect(activeRoadEngSolution(read)).toBeNull()
    expect(roadEngStoredResultsNote('Main', read)).toBeNull()
    // Auto spacing (negative) is not a spacing.
    expect(readRoadEngStoredResults(DSN.replace('OptCostSpacing=10,', 'OptCostSpacing=-0.1,'), 1).spacingM).toBeNull()
    expect(storedResultsOfSource({ dsn: '', unitCode: '10000' })).toBeNull()
    expect(storedResultsOfSource({ dsn: DSN, unitCode: '42' })).toBeNull()
    expect(activeRoadEngSolution(storedResultsOfSource({ dsn: DSN, unitCode: '10000' })!)?.option).toBe('opt 3')
  })

  it('takes a solved optimization when the costing is not, and lists other options', () => {
    const both = DSN.replace(
      'OptParms_CostSolution_v3=0,0,0,-9999,-9999,-9999,-9999,-9999,0,-9999,0,-1,-1,0',
      'OptParms_CostSolution_v3=2,0,0,0,100,10,20,30,5,-9999,0.1,1716396832,-1,0',
    ).replace(
      /OptParms_CostSolution_v3=2,0,0,902[^\r]*/,
      'OptParms_CostSolution_v3=0,0,0,-9999,-9999,-9999,-9999,-9999,0,-9999,0,-1,-1,0',
    )
    const withFull = both.replace(
      /(\[OptAlignCost-1\]\r\n[^[]*?)OptParms_FullSolution_v3=0,[^\r]*/,
      '$1OptParms_FullSolution_v3=2,0,0,0,200,1,2,3,0,0,1,1716396832,-1,1',
    )
    const read = readRoadEngStoredResults(withFull, 1)
    expect(read.solutions.map((s) => [s.option, s.kind, s.active])).toEqual([
      ['V-align 1', 'costing', false],
      ['opt 3', 'optimization', true],
    ])
    const s = activeRoadEngSolution(read)!
    expect(s.kind).toBe('optimization')
    expect(s.costs).toEqual({ haul: 1, cut: 2, fill: 3, pitOpening: 0, attributes: 0 })
    // −9999 is RoadEng's "no value".
    expect(read.solutions[0].costs.attributes).toBeNull()
    expect(read.solutions[0].total).toBe(65)
  })
})

const samples = process.env.ROADENG_SAMPLES
describe.skipIf(!samples || !existsSync(samples ?? ''))("Softree samples' stored results", () => {
  const dsnOf = (path: string, n = 1) =>
    strFromU8(unzipSync(new Uint8Array(readFileSync(join(samples!, path))))[`Location${n}.dsn`], true)

  it.each([
    [
      'LongRoad_1/LongRoad 1.dsnx',
      'Initial',
      [0, 27786.8536338],
      { haul: 779477.371582, cut: 7550177.33408, fill: 2115094.76746, pitOpening: 0, attributes: 0 },
      '2024-05-22',
      10,
    ],
    [
      'Cul-de-sac-design/CulDeSacExample/CulDeSacExampleComplete.dsnx',
      'opt 3',
      [902.503639918, 2448.89837736],
      { haul: 216131.467222, cut: 1347789.68817, fill: 184251.903261, pitOpening: 0, attributes: 0 },
      '2018-04-03',
      null,
    ],
    [
      'RoadEng-LandXML-Civil-3D/Align stage 1.dsnx',
      'V-align 1',
      [0, 2286.58027467],
      { haul: 30129.0934152, cut: 271172.549833, fill: 12227.3875122, pitOpening: 0, attributes: null },
      '2015-06-11',
      null,
    ],
  ] as const)('%s: %s', (path, option, [from, to], costs, date, spacing) => {
    const read = readRoadEngStoredResults(dsnOf(path), 1)
    expect(read.warnings).toEqual([])
    const s = activeRoadEngSolution(read)!
    expect(s).toMatchObject({ option, kind: 'costing', fromStationM: from, toStationM: to, costs })
    expect(s.solvedAt?.slice(0, 10)).toBe(date)
    expect(read.spacingM).toBe(spacing)
  })

  it("the cul-de-sac's second alignment stores no solved costing", () => {
    const read = readRoadEngStoredResults(dsnOf('Cul-de-sac-design/CulDeSacExample/CulDeSacExampleComplete.dsnx', 2), 1)
    expect(read.solutions).toEqual([])
    expect(read.unsolved).toEqual(['V-align 1'])
  })
})
