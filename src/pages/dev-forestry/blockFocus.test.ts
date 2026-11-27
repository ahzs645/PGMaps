import { describe, expect, it } from 'vitest'

import { BLOCK_LIST_FOLD_ABOVE, blocksOutsideAssessment, reviewerBlockId, splitBlockList } from './blockFocus'
import { metersPerDegree } from './visibility'

// Made-up geometry near 54° N: squares placed by their distance east of the origin.
const LAT = 54
const LNG = -123
const scale = metersPerDegree(LAT)
const square = (eastMeters: number, sizeMeters = 200, northMeters = 0): GeoJSON.Polygon => {
  const w = LNG + eastMeters / scale.lng,
    e = LNG + (eastMeters + sizeMeters) / scale.lng,
    s = LAT + northMeters / scale.lat,
    n = LAT + (northMeters + sizeMeters) / scale.lat
  return {
    type: 'Polygon',
    coordinates: [
      [
        [w, s],
        [e, s],
        [e, n],
        [w, n],
        [w, s],
      ],
    ],
  }
}
const at = (eastMeters: number, northMeters = 0): [number, number] => [
  LNG + eastMeters / scale.lng,
  LAT + northMeters / scale.lat,
]

describe('reviewerBlockId', () => {
  const blockIds = ['p1', 'p2', 'p3']
  it('takes the selected block', () => {
    expect(reviewerBlockId({ blockIds, selectedId: 'p2', assessedViewBlockId: 'p3' })).toBe('p2')
  })
  it('falls to the assessed view when the selection is not a block (an adopted landform)', () => {
    expect(reviewerBlockId({ blockIds, selectedId: 'landform', assessedViewBlockId: 'p3', viewBlockIds: ['p2'] })).toBe(
      'p3',
    )
  })
  it('keeps the block last selected once a landform takes the selection, before the views and the first block', () => {
    expect(reviewerBlockId({ blockIds, selectedId: 'landform', lastSelectedBlockId: 'p3', viewBlockIds: ['p2'] })).toBe(
      'p3',
    )
    expect(reviewerBlockId({ blockIds, selectedId: null, lastSelectedBlockId: 'gone' })).toBe('p1')
  })
  it('then to the first view of interest whose block exists, then the first block', () => {
    expect(reviewerBlockId({ blockIds, selectedId: null, viewBlockIds: ['gone', 'p2'] })).toBe('p2')
    expect(reviewerBlockId({ blockIds, selectedId: null })).toBe('p1')
    expect(reviewerBlockId({ blockIds: [], selectedId: 'p1' })).toBeNull()
  })
})

describe('splitBlockList', () => {
  const many = Array.from({ length: BLOCK_LIST_FOLD_ABOVE + 3 }, (_, i) => ({ id: `b${i}` }))
  it('folds nothing in a short list', () => {
    const few = many.slice(0, BLOCK_LIST_FOLD_ABOVE)
    expect(splitBlockList(few, { selectedId: 'b1' })).toEqual({ shown: few, folded: [] })
  })
  it('shows the selected, reviewer and assessed blocks first, in the list order', () => {
    const { shown, folded } = splitBlockList(many, {
      selectedId: 'b9',
      reviewerId: 'b2',
      assessedIds: new Set(['b5', 'b2']),
    })
    expect(shown.map((block) => block.id)).toEqual(['b2', 'b5', 'b9'])
    expect(folded).toHaveLength(many.length - 3)
    expect(folded.some((block) => ['b2', 'b5', 'b9'].includes(block.id))).toBe(false)
  })
})

describe('blocksOutsideAssessment', () => {
  const blocks = [
    { id: 'near', geometry: square(5_000) },
    { id: 'edge', geometry: square(11_900) }, // its west edge is 11.9 km from the spot
    { id: 'far', geometry: square(20_000) },
    { id: 'faced', geometry: square(30_000) },
    { id: 'onLandform', geometry: square(40_000) },
  ]
  const landform = square(39_900, 400)
  it('removes only blocks beyond the view distance that no view faces and that miss the landform', () => {
    expect(
      blocksOutsideAssessment({
        blocks,
        viewpoints: [[at(0)]],
        maxViewDistanceMeters: 12_000,
        landforms: [landform],
        keepIds: new Set(['faced']),
      }),
    ).toEqual(['far'])
  })
  it('measures from every part of a road and from each view of interest', () => {
    const road = [at(0), at(18_000, 5_000)]
    expect(
      blocksOutsideAssessment({
        blocks,
        viewpoints: [road, [at(25_000, 1_000)]],
        maxViewDistanceMeters: 12_000,
      }),
    ).toEqual(['onLandform'])
  })
  it('keeps a block a viewpoint stands inside, and removes nothing without a viewpoint', () => {
    expect(
      blocksOutsideAssessment({ blocks: [blocks[2]], viewpoints: [[at(20_100, 100)]], maxViewDistanceMeters: 10 }),
    ).toEqual([])
    expect(blocksOutsideAssessment({ blocks, viewpoints: [], maxViewDistanceMeters: 12_000 })).toEqual([])
  })
})
