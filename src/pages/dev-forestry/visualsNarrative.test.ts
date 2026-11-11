import { describe, expect, it } from 'vitest'

import {
  compassPoint,
  evqoOverlaps,
  gradeVisibility,
  lineToPolygonMeters,
  narrativeInputFromScene,
  viewCaption,
  viewpointKindFromName,
  viewpointLabel,
  visibilityShares,
  visualsNarrative,
  type ClassOverlap,
  type ViewpointFinding,
  type VisibilityShares,
} from './visualsNarrative'
import type { AnalysisResult, TargetPolygon } from './types'
import type { PolygonGeometry } from './visibility'

const box = (west: number, south: number, east: number, north: number): PolygonGeometry => ({
  type: 'Polygon',
  coordinates: [
    [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ],
  ],
})

const shares = (visible: number, screened = 0, unknown = 0): VisibilityShares => ({
  visible,
  screened,
  unknown,
  hidden: 1 - visible - screened - unknown,
})

const overlap = (code: ClassOverlap['code'], share: number, side: ClassOverlap['side'] = null, edgeOnly = false) => ({
  code,
  share,
  areaHectares: share * 50,
  side,
  edgeOnly,
})

const hwy = (s: VisibilityShares, extra: Partial<ViewpointFinding> = {}): ViewpointFinding => ({
  name: 'Hwy 97',
  kind: 'highway',
  shares: s,
  elevationAngleDegrees: 4,
  ...extra,
})

/*
 * Each case is a planner's own paragraph (BCTS Prince George, 2026 blocks),
 * reduced to the facts the run supplies. The draft need not match their text
 * word for word, but it must say the same thing in the same order.
 */
describe('visualsNarrative against the reference paragraphs', () => {
  it('CHU_26_1 splits visibility by class and puts a WTRA in the visible PR', () => {
    const narrative = visualsNarrative({
      blockName: 'CHU_26_1',
      overlaps: [overlap('R', 0.5, 'west'), overlap('PR', 0.45, 'east')],
      viewpoints: [hwy(shares(0.04), { byCode: { R: shares(0), PR: shares(0.08) } })],
      nearbyRoads: [{ name: 'DABE 2000', distanceMeters: 25 }],
      screenshotCount: 2,
    })
    expect(narrative.applies).toBe(true)
    expect(narrative.paragraph).toContain("Block overlaps EVQO Retention 'R' and Partial Retention 'PR' polygons.")
    expect(narrative.paragraph).toContain(
      "The area within the block that overlaps the 'R' polygon is not visible from Hwy 97, however the area that overlaps the 'PR' may be visible from Hwy 97.",
    )
    expect(narrative.paragraph).toContain(
      "It would be a good idea to strategically place a WTRA within the 'PR' overlap as well as pulling back the boundary from the DABE 2000, leaving a windfirm screen between the block edge and the DABE 2000.",
    )
    expect(narrative.paragraph.endsWith('See screenshots below.')).toBe(true)
  })

  it('CHU_26_2 contrasts the hidden highway with the rec site that may see it', () => {
    const narrative = visualsNarrative({
      blockName: 'CHU_26_2',
      overlaps: [overlap('M', 0.8)],
      viewpoints: [
        hwy(shares(0)),
        { name: 'Davie Lake South Rec Site', kind: 'rec-site', shares: shares(0.05), elevationAngleDegrees: 3 },
      ],
      nearbyRoads: [{ name: 'Davie Lake FSR', distanceMeters: 40 }],
    })
    expect(narrative.sentences.map((s) => s.text)).toEqual([
      "Most of the block overlaps EVQO Modification 'M' polygon.",
      'Block is not visible from Hwy 97, but may be visible from Davie Lake South Rec Site.',
      'Leave a windfirm buffer between the block boundary and the Davie Lake FSR for screening.',
      'Complete VIA post layout.',
    ])
  })

  it('CHU_26_3 names the side, groups two viewpoints, and meets M on the desktop', () => {
    const narrative = visualsNarrative({
      blockName: 'CHU_26_3',
      overlaps: [overlap('M', 0.35, 'east')],
      viewpoints: [
        { name: 'the north edge of Bear Lake', kind: 'community', shares: shares(0.06), elevationAngleDegrees: 3 },
        hwy(shares(0.03)),
      ],
      alteration: { percent: 3.2, objective: 'M', maxPercent: 18, rangeLabel: '7.1–18%' },
    })
    expect(narrative.sentences.slice(0, 3).map((s) => s.text)).toEqual([
      "The eastern portion of the block overlaps EVQO Modification 'M' polygon.",
      'Block may be visible from the north edge of Bear Lake and from Hwy 97.',
      'Based on desktop review, block should meet the requirements for EVQO M.',
    ])
  })

  it('CHU_26_4 keeps the boundary off a sliver of PR along its edge', () => {
    const narrative = visualsNarrative({
      blockName: 'CHU_26_4',
      overlaps: [overlap('PR', 0.04, 'northeast', true)],
      viewpoints: [hwy(shares(0))],
    })
    expect(narrative.paragraph).toContain(
      "There are small overlaps with EVQO Partial Retention 'PR' polygon. The overlap is very minor, just around the edges of the block boundary.",
    )
    expect(narrative.paragraph).toContain("Do not expand the boundary north or east into the 'PR' polygon.")
    expect(narrative.paragraph).not.toContain('Complete VIA')
  })

  it('ML_26_1 in plain view under M asks for an internal WTRA and a post-layout VIA', () => {
    const narrative = visualsNarrative({
      blockName: 'ML_26_1',
      overlaps: [overlap('M', 1)],
      viewpoints: [hwy(shares(0.4))],
      adjacentBlocks: ['McLeod22_4', 'McLeod23_4', 'DK552'],
    })
    expect(narrative.sentences.map((s) => s.text)).toEqual([
      "Block overlaps EVQO Modification 'M' polygon.",
      'Block will be visible from Hwy 97.',
      'Recommend having an internal WTRA within the block to break up the opening. Avoid laying out straight/angular boundaries.',
      'Complete VIA post layout taking into account adjacent blocks (McLeod22_4, McLeod23_4, DK552).',
    ])
  })

  it('ML_26_2 reports a minor PR and screening along the highway', () => {
    const narrative = visualsNarrative({
      blockName: 'ML_26_2',
      overlaps: [overlap('M', 0.97), overlap('PR', 0.03, 'north')],
      viewpoints: [hwy(shares(0, 0.3))],
    })
    expect(narrative.paragraph).toContain(
      "Block overlaps EVQO Modification 'M' and Partial Retention 'PR' polygons. The overlap with 'PR' is very minor.",
    )
    expect(narrative.paragraph).toContain(
      'Block may not be visible directly from Hwy 97 due to screening along Hwy 97.',
    )
    expect(narrative.paragraph).toContain('Complete VIA post layout.')
  })

  it('ML_26_4 reads flat terrain and screening', () => {
    const narrative = visualsNarrative({
      blockName: 'ML_26_4',
      overlaps: [overlap('M', 1)],
      viewpoints: [hwy(shares(0, 0.2), { elevationAngleDegrees: 0.6 })],
      screenshotCount: 2,
    })
    expect(narrative.sentences.map((s) => s.text)).toEqual([
      "Block overlaps EVQO Modification 'M' polygon.",
      'Block likely will not be visible from Hwy 97 due to relatively flat terrain and screening along Hwy 97.',
      'See screenshots below.',
    ])
  })

  it('ML_26_3 has no EVQO overlap, so the note carries no Visuals paragraph', () => {
    const narrative = visualsNarrative({ blockName: 'ML_26_3', overlaps: [], viewpoints: [hwy(shares(0))] })
    expect(narrative.applies).toBe(false)
    expect(narrative.paragraph).toBe('Block does not overlap any EVQO polygon. Block is not visible from Hwy 97.')
  })

  it('reads a partly covered block with a sliver of a stricter class, as the redesigned CHU_26_1 is', () => {
    // The CHU_26_1_4_updated boundary: PR 34% on its south side, an R sliver along the west edge, 97% in view.
    const narrative = visualsNarrative({
      blockName: 'CHU_26_1',
      overlaps: [overlap('PR', 0.34, 'south'), overlap('R', 0.007, 'west', true)],
      viewpoints: [hwy(shares(0.97), { elevationAngleDegrees: 0.1, screeningModelled: false })],
      nearbyRoads: [{ name: 'Davie-Bear Lake FSR', distanceMeters: 17 }],
    })
    expect(narrative.sentences.map((s) => s.text)).toEqual([
      "The southern portion of the block overlaps EVQO Partial Retention 'PR' and Retention 'R' polygons.",
      "The overlap with 'R' is very minor, just around the edges of the block boundary.",
      'Block may be visible from Hwy 97.',
      "It would be a good idea to strategically place a WTRA within the 'PR' overlap as well as pulling back the boundary from the Davie-Bear Lake FSR, leaving a windfirm screen between the block edge and the Davie-Bear Lake FSR.",
      "Do not expand the boundary west into the 'R' polygon.",
      'Complete VIA post layout.',
    ])
  })

  it('says when a landform figure is over the objective', () => {
    const narrative = visualsNarrative({
      blockName: 'X',
      overlaps: [overlap('PR', 1)],
      viewpoints: [hwy(shares(0.5))],
      alteration: { percent: 9.4, objective: 'PR', maxPercent: 7, rangeLabel: '1.6–7%' },
    })
    expect(narrative.paragraph).toContain('block may not meet the requirements for EVQO PR; redesign before layout.')
    expect(narrative.sentences.find((s) => s.id === 'desktop-review')?.basis).toContain('9.4%')
  })

  it('every sentence carries its basis', () => {
    const narrative = visualsNarrative({
      blockName: 'X',
      overlaps: [overlap('M', 1)],
      viewpoints: [hwy(shares(0.2, 0.1, 0.05))],
    })
    for (const sentence of narrative.sentences) expect(sentence.basis.length).toBeGreaterThan(5)
    expect(narrative.sentences[1].basis).toContain('screened by timber 10%')
  })
})

describe('grading', () => {
  it('follows the share thresholds', () => {
    expect(gradeVisibility(shares(0.2))).toBe('will')
    expect(gradeVisibility(shares(0.05))).toBe('may')
    expect(gradeVisibility(shares(0, 0.2))).toBe('screened')
    expect(gradeVisibility(shares(0, 0.2), { flatTerrain: true })).toBe('screened-flat')
    expect(gradeVisibility(shares(0))).toBe('not')
    expect(gradeVisibility(shares(0), { flatTerrain: true })).toBe('not-flat')
    expect(gradeVisibility(shares(0.1, 0, 0.6))).toBe('unknown')
  })

  it('does not claim "will be visible" across flat country without timber in the run', () => {
    expect(gradeVisibility(shares(0.5), { flatTerrain: true, screeningModelled: false })).toBe('may')
    expect(gradeVisibility(shares(0.5), { flatTerrain: false, screeningModelled: false })).toBe('will')
  })
})

describe('facts', () => {
  const block = box(-122.7, 54.5, -122.69, 54.506)

  it('measures each class and the side a partial overlap lies on', () => {
    const east = box(-122.6925, 54.49, -122.68, 54.52)
    const result = evqoOverlaps(block, [{ code: 'M', geometry: east }])
    expect(result).toHaveLength(1)
    expect(result[0].code).toBe('M')
    expect(result[0].share).toBeGreaterThan(0.2)
    expect(result[0].share).toBeLessThan(0.3)
    expect(result[0].side).toBe('east')
    expect(result[0].edgeOnly).toBe(false)
  })

  it('finds a sliver that hugs the boundary', () => {
    const strip = box(-122.6903, 54.49, -122.68, 54.52)
    const [sliver] = evqoOverlaps(block, [{ code: 'PR', geometry: strip }])
    expect(sliver.share).toBeLessThan(0.1)
    expect(sliver.edgeOnly).toBe(true)
  })

  it('counts a sample in two units toward the stricter', () => {
    const result = evqoOverlaps(block, [
      { code: 'M', geometry: box(-123, 54, -122, 55) },
      { code: 'R', geometry: box(-123, 54, -122, 55) },
    ])
    expect(result.map((o) => o.code)).toEqual(['R'])
  })

  it('splits per-sample visibility into seen, screened, hidden and unknown, by class', () => {
    const positions = Float64Array.from([-122.699, 54.501, -122.698, 54.501, -122.691, 54.501, -122.6905, 54.501])
    const target = {
      positions,
      sampleCount: 4,
      anyVisible: Uint8Array.from([1, 0, 0, 2]),
      anyBareEarthVisible: Uint8Array.from([1, 1, 0, 0]),
    }
    const { overall, byCode } = visibilityShares(target, [
      { code: 'PR', geometry: box(-122.692, 54.49, -122.68, 54.52) },
    ])
    expect(overall).toEqual({ visible: 0.25, screened: 0.25, hidden: 0.25, unknown: 0.25 })
    expect(byCode.PR).toEqual({ visible: 0, screened: 0, hidden: 0.5, unknown: 0.5 })
  })

  it('treats a run without the bare-earth record as hidden, never screened', () => {
    const { overall } = visibilityShares({
      positions: Float64Array.from([0, 0]),
      sampleCount: 1,
      anyVisible: Uint8Array.from([0]),
    })
    expect(overall.screened).toBe(0)
    expect(overall.hidden).toBe(1)
  })

  it('measures a road against the block, including a segment passing between vertices', () => {
    expect(
      lineToPolygonMeters(block, [
        [-122.7, 54.507],
        [-122.69, 54.507],
      ]),
    ).toBeGreaterThan(100)
    expect(
      lineToPolygonMeters(block, [
        [-122.7, 54.507],
        [-122.69, 54.507],
      ]),
    ).toBeLessThan(120)
    expect(
      lineToPolygonMeters(block, [
        [-122.71, 54.503],
        [-122.68, 54.503],
      ]),
    ).toBe(0)
  })
})

describe('names and captions', () => {
  it('writes highways the way notes do', () => {
    expect(viewpointLabel('Highway 97')).toBe('Hwy 97')
    expect(viewpointLabel('BC-97')).toBe('Hwy 97')
    expect(viewpointLabel('Davie Lake FSR')).toBe('Davie Lake FSR')
    expect(viewpointKindFromName('John Hart Highway')).toBe('highway')
    expect(viewpointKindFromName('Davie Lake South Rec Site')).toBe('rec-site')
    expect(viewpointKindFromName('Davie Lake FSR')).toBe('road')
  })

  it('captions a drive by its direction, and a look across it by where it looks', () => {
    expect(viewCaption({ viewpointName: 'Highway 97', linear: true, travelBearing: 4, lookBearing: 10 })).toBe(
      'View from Hwy 97 going north.',
    )
    expect(
      viewCaption({
        viewpointName: 'Hwy 97',
        linear: true,
        travelBearing: 2,
        lookBearing: 88,
        targetNames: ['ML_26_4', 'ML_26_5'],
      }),
    ).toBe('View from Hwy 97 looking east toward ML_26_4 and ML_26_5.')
    expect(viewCaption({ viewpointName: 'Davie Lake South Rec Site', linear: false, targetNames: ['CHU_26_2'] })).toBe(
      'View of CHU_26_2 from Davie Lake South Rec Site.',
    )
    expect(compassPoint(-90)).toBe('west')
  })
})

describe('narrativeInputFromScene', () => {
  const blockGeometry = box(-122.7, 54.5, -122.69, 54.506)
  const target = (id: string, role: TargetPolygon['role'], geometry: PolygonGeometry, name = id): TargetPolygon => ({
    id,
    name,
    role,
    objectiveId: 'modification',
    vac: null,
    harvestYear: null,
    clearcutPercent: null,
    geometry,
    source: 'test',
  })
  const block = target('b1', 'block', blockGeometry, 'ML_26_1')
  const landform = target('lf', 'landscape', box(-122.75, 54.45, -122.6, 54.55), 'Face')
  const neighbour = target('h1', 'harvested', box(-122.689, 54.5, -122.685, 54.504), 'DK552')
  const far = target('h2', 'harvested', box(-122.5, 54.5, -122.49, 54.504), 'Far away')
  // Two samples, one seen; the eye 1.6 m over 600 m ground, the block at 700 m about 2 km off.
  const result = {
    settings: { observerHeightMeters: 1.6, screeningEnabled: false },
    stations: [{ lng: -122.725, lat: 54.503, groundElevationMeters: 600, distanceAlongMeters: 0 }],
    assessmentStationIndex: 0,
    activeLandformId: 'lf',
    perspectiveAlteration: { existingPercent: 1, disturbancePercent: 0, proposedPercent: 4, cumulativePercent: 5 },
    targets: [
      {
        targetId: 'b1',
        role: 'block',
        sampleCount: 2,
        positions: Float64Array.from([-122.698, 54.503, -122.692, 54.503]),
        elevations: Float64Array.from([700, 700]),
        anyVisible: Uint8Array.from([1, 0]),
      },
    ],
  } as unknown as AnalysisResult

  it('takes the run viewpoint first, with its class split, angle and the landform figure', () => {
    const input = narrativeInputFromScene({
      block,
      targets: [block, landform, neighbour, far],
      result,
      viewpoint: { name: 'Highway 97', mode: 'corridor' },
      units: [{ code: 'M', geometry: box(-123, 54, -122, 55) }],
      landform,
    })
    expect(input.viewpoints[0]).toMatchObject({ name: 'Hwy 97', kind: 'highway', screeningModelled: false })
    expect(input.viewpoints[0].shares.visible).toBe(0.5)
    expect(input.viewpoints[0].byCode?.M?.visible).toBe(0.5)
    expect(input.viewpoints[0].elevationAngleDegrees).toBeGreaterThan(2)
    expect(input.overlaps.map((o) => o.code)).toEqual(['M'])
    expect(input.adjacentBlocks).toEqual(['DK552'])
    expect(input.alteration).toEqual({ percent: 5, objective: 'M', maxPercent: 18, rangeLabel: '7.1–18%' })
  })

  it('leaves the run out when there is none, and the figure out when another landform was run', () => {
    const none = narrativeInputFromScene({
      block,
      targets: [block],
      result: null,
      viewpoint: { name: 'Highway 97', mode: 'corridor' },
      units: [],
      landform,
    })
    expect(none.viewpoints).toEqual([])
    expect(none.alteration).toBeNull()
    const other = narrativeInputFromScene({
      block,
      targets: [block],
      result: { ...result, activeLandformId: 'another' } as AnalysisResult,
      viewpoint: { name: 'Highway 97', mode: 'corridor' },
      units: [],
      landform,
    })
    expect(other.alteration).toBeNull()
  })
})
