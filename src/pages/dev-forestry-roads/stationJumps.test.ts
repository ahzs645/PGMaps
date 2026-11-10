import { describe, expect, it } from 'vitest'
import { analyzeRoad, offsetCoordinate } from './engine'
import { createEngineeringDesign } from './engineeringTypes'
import {
  adjacentJump,
  jumpShortcut,
  reviewJumpFindings,
  stationJumpTargets,
  type StationJumpTarget,
} from './stationJumps'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE } from './terrain'
import type { Alignment, Coordinate, RoadStation } from './types'

const origin: Coordinate = [-122.8, 53.9]
const corner = offsetCoordinate(origin, 0, 200)

function road(): Alignment {
  return {
    id: 'r',
    name: 'Road',
    color: '#16817a',
    points: [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: corner, radiusM: 60 },
      { id: 'c', coordinate: offsetCoordinate(corner, 90, 200), radiusM: 0 },
    ],
    vertical: [
      { id: 'e', chainage: 340, elevation: 806, curveLength: 0 },
      { id: 's', chainage: 0, elevation: 800, curveLength: 0 },
      { id: 'm', chainage: 150, elevation: 803, curveLength: 40 },
    ],
    template: { ...DEFAULT_TEMPLATE },
    overrides: [],
  }
}

const station = (chainage: number, extra: Partial<RoadStation> = {}) =>
  ({ chainage, flags: [], complete: true, ...extra }) as unknown as RoadStation

describe('jump targets', () => {
  it('lists PVIs in chainage order with their curve length', () => {
    const targets = stationJumpTargets(road(), { stations: [], length: 340 })
    expect(targets.pvi.map((t) => [t.chainage, t.label])).toEqual([
      [0, 'PVI 1'],
      [150, 'PVI 2 · VC 40 m'],
      [340, 'PVI 3'],
    ])
  })

  it('lists the fitted curve points of the plan', () => {
    const targets = stationJumpTargets(road(), { stations: [], length: 340 })
    expect(targets.curve.map((t) => t.label)).toEqual(['BC H1', 'EC H1'])
    const [bc, ec] = targets.curve
    // A 90° turn of radius 60 m: the arc is a quarter circle and starts one tangent length (60 m) back.
    expect(bc.chainage).toBeCloseTo(140, 0)
    expect(ec.chainage - bc.chainage).toBeCloseTo((Math.PI / 2) * 60, 0)
  })

  it('has no curve points, not an error, when the plan cannot be fitted', () => {
    const broken = { ...road(), points: [road().points[0]] }
    expect(stationJumpTargets(broken, { stations: [], length: 0 }).curve).toEqual([])
  })

  it('takes one target per run of flagged or incomplete stations, plus outside findings', () => {
    const stations = [
      station(0),
      station(10, { flags: ['Grade above 12%'] }),
      station(20, { flags: ['Grade above 12%'] }),
      station(30),
      station(40, {
        flags: ['Left daylight unresolved: extend section or check terrain'],
        complete: false,
        incompleteReasons: ['Left daylight unresolved: extend section or check terrain'],
      }),
    ]
    const targets = stationJumpTargets(road(), { stations, length: 340 }, [
      { chainage: 20.2, label: 'Sight distance short' },
      { chainage: 300, label: 'Grade exceeds the standard' },
    ])
    expect(targets.flag.map((t) => [t.chainage, t.label])).toEqual([
      [10, 'Grade above 12% (2 stations)'],
      [20.2, 'Sight distance short'],
      [40, 'Left daylight unresolved: extend section or check terrain'],
      [300, 'Grade exceeds the standard'],
    ])
    expect(targets.incomplete.map((t) => t.chainage)).toEqual([40])
  })

  it('merges targets at one place and keeps them on the road', () => {
    const targets = stationJumpTargets(road(), { stations: [], length: 340 }, [
      { chainage: 100, label: 'A' },
      { chainage: 100.3, label: 'B' },
      { chainage: 100.3, label: 'A' },
      { chainage: 400, label: 'Past the end' },
    ])
    expect(targets.flag).toEqual([{ kind: 'flag', chainage: 100, label: 'A · B' }])
  })

  it('lists culverts with their id and both ends of every template range', () => {
    const alignment = road()
    alignment.engineering = {
      ...createEngineeringDesign(),
      templates: [{ id: 'wide', name: 'Wide', template: { ...DEFAULT_TEMPLATE } }],
      assignments: [{ id: 'a1', start: 50, end: 120, templateId: 'wide', side: 'left', transitionM: 0 }],
    }
    const targets = stationJumpTargets(alignment, {
      stations: [],
      length: 340,
      engineering: { culverts: [{ id: 'c1', name: 'C1', chainage: 75 }] } as never,
    })
    expect(targets.culvert).toEqual([{ kind: 'culvert', chainage: 75, label: 'Culvert C1', culvertId: 'c1' }])
    expect(targets.template.map((t) => [t.chainage, t.label])).toEqual([
      [50, 'Wide (left) starts'],
      [120, 'Wide (left) ends'],
    ])
  })
})

describe('Review findings to visit', () => {
  it('takes the Review rows that need attention at a station, and short sight distance', () => {
    // A 20 % climb on a 12 % limit, at a design speed whose stopping distance a crest blocks.
    const alignment = road()
    alignment.vertical = [
      { id: 's', chainage: 0, elevation: 800, curveLength: 0 },
      { id: 'm', chainage: 150, elevation: 830, curveLength: 0 },
      { id: 'e', chainage: 340, elevation: 800, curveLength: 0 },
    ]
    const ground = { elevationAt: () => 800 }
    const analysis = analyzeRoad(alignment, ground, DEFAULT_ROAD_SETTINGS)
    const project = {
      settings: DEFAULT_ROAD_SETTINGS,
      standards: { designSpeedKmh: 50 } as never,
      terrain: { kind: 'geotiff' as const, name: 'DTM.tif', resolutionM: 1, verticalReference: 'CGVD2013' } as never,
      context: [],
      drainage: undefined,
      alignments: [alignment],
    }
    const findings = reviewJumpFindings(project, alignment, analysis)
    expect(findings.some((f) => /^Grade/.test(f.label))).toBe(true)
    // Short eyes come as one finding per stretch and direction, not one per station.
    const sight = findings.filter((f) => /^Stopping sight distance short/.test(f.label))
    expect(sight.map((f) => f.label)).toEqual([
      expect.stringMatching(/looking ahead \(\d+ stations\)$/),
      expect.stringMatching(/looking back \(\d+ stations\)$/),
    ])
    expect(findings.every((f) => f.chainage >= 0 && f.chainage <= analysis.length)).toBe(true)
  }, 30_000)
})

describe('stepping between targets', () => {
  const targets: StationJumpTarget[] = [10, 50, 90].map((chainage) => ({ kind: 'pvi', chainage, label: '' }))

  it('moves to the next or previous target and never stays put', () => {
    expect(adjacentJump(targets, 0, 1)?.chainage).toBe(10)
    expect(adjacentJump(targets, 10, 1)?.chainage).toBe(50)
    expect(adjacentJump(targets, 50, -1)?.chainage).toBe(10)
    expect(adjacentJump(targets, 49.9995, 1)?.chainage).toBe(90)
    expect(adjacentJump(targets, 70, -1)?.chainage).toBe(50)
  })

  it('returns null past the last target either way', () => {
    expect(adjacentJump(targets, 90, 1)).toBeNull()
    expect(adjacentJump(targets, 10, -1)).toBeNull()
    expect(adjacentJump([], 10, 1)).toBeNull()
  })
})

describe('jump keys', () => {
  const key = (k: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey', boolean>> = {}) =>
    jumpShortcut({ key: k, metaKey: false, ctrlKey: false, altKey: false, ...mods })

  it('reads ] as forward and [ as back', () => {
    expect(key(']')).toBe(1)
    expect(key('[')).toBe(-1)
    expect(key('a')).toBeNull()
  })

  it('leaves the browser its ⌘[ and Ctrl+[, but accepts a bracket typed with AltGr', () => {
    expect(key('[', { metaKey: true })).toBeNull()
    expect(key(']', { ctrlKey: true })).toBeNull()
    expect(key(']', { ctrlKey: true, altKey: true })).toBe(1)
  })
})
