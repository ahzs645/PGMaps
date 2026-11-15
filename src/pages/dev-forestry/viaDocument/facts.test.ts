import { describe, expect, it } from 'vitest'

import { FIGURE_CLASS } from '@/lib/forestry/viaFigure/composeFigure'

import type { SavedFigure } from '../FigureSheetPanel'
import { documentFacts, lensMmForHfov, viewpointPlace } from './facts'
import { formatForSource } from './formats'
import { resolveViaDocument } from './resolve'

/** A 10 × 10 class pass: 80 landform pixels, 4 proposed, 16 private land. */
function figure(stationIndex: number): SavedFigure {
  const codes = new Uint8Array(100)
  for (let i = 0; i < 80; i++) codes[i] = FIGURE_CLASS.landform
  for (let i = 0; i < 4; i++) codes[i] = FIGURE_CLASS.proposedIn
  for (let i = 4; i < 20; i++) codes[i] = FIGURE_CLASS.privateIn
  return {
    classes: { width: 10, height: 10, codes },
    callouts: [
      { blockId: 'block-x1', title: 'Block X1', anchor: [1, 1], status: 'visible', visiblePercent: 30 },
      { blockId: 'E1', title: 'E1', anchor: [2, 2], status: 'visible', visiblePercent: 10, secondary: true },
    ],
    stationIndex,
    sightlinePercent: 4.8,
    sightlineClass: 'Partial retention',
    lens: '50 mm',
    distanceKm: 3.4,
    hfovDeg: 39.6,
    facts: [],
    rating: { vsu: '12', vsc: '2', vac: 'M', evc: 'R', vqo: 'PR' },
    area: 'Landform 1',
    viewpoint: `View of the block from station ${stationIndex}`,
    place: 'Lakeshore',
    hidden: [{ blockId: 'block-x9', title: 'Block X9', anchor: [0, 0], status: 'not visible', visiblePercent: 0 }],
    camera: {
      frames: 1,
      focalMm: 50,
      fovDeg: 39.6,
      observerHeightM: 1.6,
      above: 'ground',
      lng: -122.5,
      lat: 53.9,
      elevationM: 700,
      azimuthDeg: 90,
      maxTreeHeightM: 30,
      renderedOn: new Date(0),
    },
    splitFailed: false,
  }
}

describe('document facts from saved views', () => {
  const facts = documentFacts({
    project: 'Block X1',
    objective: 'PR',
    views: [
      { name: 'a', figure: figure(3) },
      { name: 'b', figure: figure(7) },
    ],
    assessmentStation: 7,
    review: { ocular: { visibleness: 'easy' }, rationale: 'Screened by the near ridge.' },
    assessment: null,
    breakdown: null,
  })

  it("reads each view's class pass and callouts, leaving existing openings' callouts out of the blocks", () => {
    const [first] = facts.viewpoints
    expect(first.areas).toEqual({ landform: 80, proposed: 4, nonVeg: 0, privateLand: 16, rock: 0 })
    // Blocks by the name the sheet prints, unseen ones included; the place, not the saved view's name.
    expect(first.blocks).toEqual([
      { id: 'X1', status: 'visible', visiblePercent: 30 },
      { id: 'X9', status: 'not visible', visiblePercent: 0 },
    ])
    // Both views stand on the same road: each takes its "place, km along" line, or its number.
    expect(first.name).toBe('Lakeshore (1)')
    expect(first.lngLat).toEqual([-122.5, 53.9])
    expect(first.lensMm).toBeCloseTo(50, 0)
    expect(lensMmForHfov(39.6)).toBeCloseTo(50, 0)
    // A three-frame panorama of 59 mm frames is a 59 mm lens, not the 15 mm its 102° span would give.
    const wide = figure(1)
    const panorama = documentFacts({
      project: 'X',
      objective: 'PR',
      views: [{ name: 'p', figure: { ...wide, hfovDeg: 102, camera: { ...wide.camera!, frames: 3, focalMm: 59 } } }],
      assessmentStation: null,
      review: null,
      assessment: null,
      breakdown: null,
    })
    expect(panorama.viewpoints[0].lensMm).toBe(59)
  })

  it("gives the reviewer's judgements to the assessment station's view only", () => {
    expect(facts.viewpoints[0].review).toBeUndefined()
    expect(facts.viewpoints[1].review).toEqual({ visibility: 'Easy to see', rationale: 'Screened by the near ridge.' })
  })

  it('fills one format per set of facts, the net-of-private figure from the same pixels', () => {
    const gross = resolveViaDocument(formatForSource('23')!, facts)
    const net = resolveViaDocument(formatForSource('22')!, facts)
    expect(gross.viewpoints[0].printed?.percent).toBe('5.00')
    expect(net.viewpoints[0].printed?.percent).toBe('6.25')
    // Both views see X1 equally: it is discussed once, from the first (its key viewpoint), and nowhere else.
    expect(net.viewpoints[0].sentences.find((s) => s.id === 'key-viewpoint')?.text).toBe(
      'This viewpoint was chosen for the detailed assessment because it sees 30% of the block’s ground, as much as any other viewpoint assessed (next, Lakeshore (2) at 30%), so the block is most visible and most directly in view from here.',
    )
    expect(net.viewpoints[1].sentences.some((s) => s.about === 'Block X1')).toBe(false)
  })
})

describe('blocks of another sale and viewpoint names', () => {
  const withBlocks = (stationIndex: number): SavedFigure => ({
    ...figure(stationIndex),
    place: '',
    viewpoint: 'View of the block from Ruby Lake 2A (VP14)',
    callouts: [
      { blockId: 'b1', title: 'Block X1', anchor: [1, 1], status: 'visible', visiblePercent: 30 },
      { blockId: 'b5', title: 'Block X5 (S33, other planned)', anchor: [2, 1], status: 'visible', visiblePercent: 20 },
      { blockId: 'b7', title: 'Block X7', anchor: [3, 1], status: 'visible', visiblePercent: 10 },
    ],
    hidden: [],
  })
  const facts = documentFacts({
    project: 'X1',
    objective: 'PR',
    views: [{ name: 'a', figure: withBlocks(2) }],
    assessmentStation: null,
    review: null,
    assessment: null,
    breakdown: null,
    otherPlanned: ['b7'],
  })

  it('flag a block the scene marks, or whose name says so, as other planned; the rest stay plain', () => {
    expect(facts.viewpoints[0].blocks).toEqual([
      { id: 'X1', status: 'visible', visiblePercent: 30 },
      { id: 'X5', status: 'visible', visiblePercent: 20, proposed: false, plannedUnder: 'S33' },
      { id: 'X7', status: 'visible', visiblePercent: 10, proposed: false },
    ])
  })

  it('name a viewpoint by its place, never by the "view of the block from" line around it', () => {
    expect(facts.viewpoints[0].name).toBe('Ruby Lake 2A (VP14)')
    expect(viewpointPlace('View from Lakeshore')).toBe('Lakeshore')
    expect(viewpointPlace('Lakeshore')).toBe('Lakeshore')
  })
})
