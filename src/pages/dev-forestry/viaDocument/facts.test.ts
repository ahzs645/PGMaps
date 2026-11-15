import { describe, expect, it } from 'vitest'

import { FIGURE_CLASS } from '@/lib/forestry/viaFigure/composeFigure'

import type { SavedFigure } from '../FigureSheetPanel'
import { documentFacts, lensMmForHfov, offAxisDegrees, viewpointPlace } from './facts'
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
    // Blocks by the name the sheet prints, unseen ones included; the place, not the saved view's name. A seen block
    // carries how far its callout lies off the centre line: column 1 of 10 across 39.6° is atan(-0.8 tan 19.8°).
    expect(first.blocks).toEqual([
      { id: 'X1', status: 'visible', visiblePercent: 30, offAxisDeg: -16.1 },
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
      { id: 'X1', status: 'visible', visiblePercent: 30, offAxisDeg: -16.1 },
      { id: 'X5', status: 'visible', visiblePercent: 20, proposed: false, plannedUnder: 'S33', offAxisDeg: -12.2 },
      { id: 'X7', status: 'visible', visiblePercent: 10, proposed: false, offAxisDeg: -8.2 },
    ])
  })

  it('read how far a point lies off the centre line, frame by frame across a panorama', () => {
    // One 39.6° frame: the centre is 0°, the edges ±19.8°.
    expect(offAxisDegrees(5, 10, 39.6)).toBeCloseTo(0, 6)
    expect(offAxisDegrees(10, 10, 39.6)).toBeCloseTo(19.8, 6)
    // Three frames of 34° across 102°: the middle of the right frame is 34° right, its edge the panorama's.
    expect(offAxisDegrees(250, 300, 102, 3)).toBeCloseTo(34, 6)
    expect(offAxisDegrees(300, 300, 102, 3)).toBeCloseTo(51, 6)
    expect(offAxisDegrees(0, 0, 39.6)).toBeNull()
  })

  it('name a viewpoint by its place, never by the "view of the block from" line around it', () => {
    expect(facts.viewpoints[0].name).toBe('Ruby Lake 2A (VP14)')
    expect(viewpointPlace('View from Lakeshore')).toBe('Lakeshore')
    expect(viewpointPlace('Lakeshore')).toBe('Lakeshore')
  })
})

describe("the reviewer's Table 3 and key viewpoints, per saved view", () => {
  const facts = documentFacts({
    project: 'Block X1',
    objective: 'PR',
    views: [
      { name: 'a', figure: { ...figure(3), place: 'Bay' } },
      { name: 'b', figure: { ...figure(7), place: 'Ferry' } },
    ],
    assessmentStation: 7,
    review: {
      ocular: { visibleness: 'easy' },
      viewpointRecords: {
        a: {
          significance: 'High (5)',
          reason: 'High boat traffic',
          experience: 'Sustained focal views',
          duration: 'Sustained',
        },
        b: { significance: 'Low to Moderate (2)' },
        gone: { significance: 'Moderate (3)' },
      },
      keyViewpoints: { blocks: { X1: { view: 'a', reason: 'Most used' }, X9: { view: 'not saved' } } },
    },
    assessment: null,
    breakdown: null,
  })

  it('gives every view its own Table 3 entry, and the step 4 judgements to the assessment station only', () => {
    const [bay, ferry] = facts.viewpoints
    expect(bay.review).toEqual({
      importance: 'High (5)',
      selectionReason: 'High boat traffic',
      viewingExperience: 'Sustained focal views',
      duration: 'Sustained',
    })
    expect(bay.atAssessment).toBe(false)
    expect(ferry.review).toEqual({ importance: 'Low to Moderate (2)', visibility: 'Easy to see' })
    expect(ferry.atAssessment).toBe(true)
    expect(bay.appendix1).toBeUndefined()
  })

  it('carries the key viewpoints by the names the document gives the views, dropping a view it does not hold', () => {
    expect(facts.keyViewpoints).toEqual({ blocks: { X1: { viewpoint: 'Bay', reason: 'Most used' } } })
    const chosen = resolveViaDocument(formatForSource('22')!, facts)
    expect(chosen.keyViewpoints?.choice.byBlock.get('X1')).toBe(0)
    expect(chosen.viewpoints[0].sentences.find((s) => s.id === 'key-viewpoint')?.text).toBe(
      'The reviewer chose this viewpoint for the detailed assessment: most used.',
    )
  })
})

describe('the viewpoint’s camera and each block’s own distance', () => {
  it('carries the eye elevation of a framed view, the view’s bearing, and a block’s distance from its callout', () => {
    const framed: SavedFigure = {
      ...figure(3),
      frameImage: { dataUrl: 'data:,', width: 10, height: 10, caption: 'x' },
      callouts: [{ ...figure(3).callouts[0], distanceKm: 2.2 } as SavedFigure['callouts'][number]],
    }
    const [vp] = documentFacts({
      project: 'x',
      objective: 'PR',
      views: [{ name: 'a', figure: framed }],
      assessmentStation: null,
      review: null,
      assessment: null,
      breakdown: null,
    }).viewpoints
    expect(vp).toMatchObject({ elevationM: 700, bearingDeg: 90 })
    expect(vp.blocks[0]).toMatchObject({ id: 'X1', distanceKm: 2.2 })
    // An unframed view's camera prints 0 m when no eye was known: its elevation is not a fact.
    const [unframed] = documentFacts({
      project: 'x',
      objective: 'PR',
      views: [{ name: 'a', figure: figure(3) }],
      assessmentStation: null,
      review: null,
      assessment: null,
      breakdown: null,
    }).viewpoints
    expect(unframed.elevationM).toBeNull()
    expect(unframed.blocks[0].distanceKm).toBeUndefined()
  })
})

describe('the with-timber pixel figure', () => {
  const base = { project: 'x', objective: 'PR' as const, assessmentStation: null, review: null, assessment: null }
  const timberClasses = () => {
    // Two of the four proposed pixels seen past the timber; the other two read as the landform in front.
    const codes = new Uint8Array(figure(3).classes.codes)
    codes[2] = codes[3] = FIGURE_CLASS.landform
    return { width: 10, height: 10, codes }
  }

  it('carries PGMaps’ measure as a second set of areas, and resolves it on the format’s rule', () => {
    const facts = documentFacts({
      ...base,
      breakdown: null,
      views: [
        {
          name: 'a',
          figure: figure(3),
          timber: { kind: 'measured', classes: timberClasses(), proposedPx: 4, seenPx: 2 },
        },
      ],
    })
    expect(facts.viewpoints[0].withTimber).toMatchObject({ source: 'pgmaps', areas: { landform: 80, proposed: 2 } })
    // The ground pass's areas are unchanged beside it.
    expect(facts.viewpoints[0].areas).toMatchObject({ landform: 80, proposed: 4 })
    const resolved = resolveViaDocument(formatForSource('22')!, facts).viewpoints[0]
    expect(resolved.printed?.percent).not.toBe((resolved.withTimber as { percent: string }).percent)
    expect(Number((resolved.withTimber as { percent: string }).percent)).toBeCloseTo(
      Number(resolved.printed!.percent) / 2,
      1,
    )
  })

  it('says why when there was no before render, never 0, and takes an engine’s screened pass', () => {
    const [vp] = documentFacts({ ...base, breakdown: null, views: [{ name: 'a', figure: figure(3) }] }).viewpoints
    expect(vp.withTimber).toEqual({ absent: 'no before-harvest render of this view' })
    const [engine] = documentFacts({
      ...base,
      breakdown: null,
      views: [{ name: 'a', figure: { ...figure(3), screened: timberClasses() } }],
    }).viewpoints
    expect(engine.withTimber).toMatchObject({ source: 'engine', areas: { proposed: 2 } })
  })
})

describe('a framed panorama’s bearing', () => {
  it('prints in [0, 360): a centre line of 372.5° is 12.5°, -10° is 350°', () => {
    const at = (azimuthDeg: number) =>
      documentFacts({
        project: 'x',
        objective: 'PR',
        views: [{ name: 'a', figure: { ...figure(3), camera: { ...figure(3).camera!, azimuthDeg } } }],
        assessmentStation: null,
        review: null,
        assessment: null,
        breakdown: null,
      }).viewpoints[0].bearingDeg
    expect(at(372.5)).toBeCloseTo(12.5)
    expect(at(-10)).toBeCloseTo(350)
    expect(at(90)).toBe(90)
  })
})

describe('a partial cut in the document facts', () => {
  /** Figure 3 with a partial cut, block P1: 10 pixels of the landform, called out beside block X1. */
  function withPartialCut(): SavedFigure {
    const base = figure(3)
    const codes = new Uint8Array(base.classes.codes)
    for (let i = 20; i < 30; i++) codes[i] = FIGURE_CLASS.partialIn
    return {
      ...base,
      classes: { ...base.classes, codes },
      hidden: [],
      callouts: [
        { ...base.callouts[0], apparent: 3 } as SavedFigure['callouts'][number],
        { blockId: 'P1', title: 'Block P1', anchor: [3, 3], status: 'visible', visiblePercent: 80, apparent: 9 },
      ],
      partialCuts: [
        {
          id: 'P1',
          name: 'P1',
          visible: true,
          equivalentPercent: 0.8,
          volumeRemovedPercent: 10,
          residualHeightMeters: 27.5,
        },
      ],
    }
  }
  const facts = (view: SavedFigure) =>
    documentFacts({
      project: 'x',
      objective: 'PR',
      views: [{ name: 'a', figure: view }],
      assessmentStation: null,
      review: null,
      assessment: null,
      breakdown: null,
    }).viewpoints[0]

  it('states its pixels apart from the proposed (cleared-ground) ones and gives it no share of them', () => {
    const vp = facts(withPartialCut())
    expect(vp.areas).toEqual({ landform: 80, proposed: 4, nonVeg: 0, privateLand: 16, rock: 0, partialCut: 10 })
    const [clear, partial] = vp.blocks
    // The clearcut block holds the whole proposed figure; the partial cut none, however much of it is seen.
    expect(clear.share).toBe(1)
    expect(partial).toMatchObject({ id: 'P1', partialCut: true })
    expect(partial.share).toBeUndefined()
  })

  it('leaves the figure the same as a scene where the partial cut was never drawn', () => {
    const vp = facts(withPartialCut())
    const plain = facts(figure(3))
    const format = formatForSource('23')!
    const a = resolveViaDocument(format, { project: 'x', viewpoints: [vp] }).viewpoints[0]
    const b = resolveViaDocument(format, { project: 'x', viewpoints: [plain] }).viewpoints[0]
    expect(a.printed?.percent).toBe('5.00')
    expect(a.printed?.percent).toBe(b.printed?.percent)
    expect(plain.areas).not.toHaveProperty('partialCut')
  })
})
