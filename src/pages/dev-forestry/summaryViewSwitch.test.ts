import { describe, expect, it } from 'vitest'

import { currentPlannedView, steppedView, viewForBlockHere, viewPosition } from './summaryViewSwitch'
import { metersPerDegree } from './visibility'
import type { ViewOfInterest } from './viewsOfInterest'

const PLACE = { lng: -122.5, lat: 54.1 }
const m = metersPerDegree(PLACE.lat)
/** A point `east` and `north` metres from PLACE. */
const near = (east: number, north = 0): [number, number] => [PLACE.lng + east / m.lng, PLACE.lat + north / m.lat]

function view(id: string, patch: Partial<ViewOfInterest> = {}): ViewOfInterest {
  return {
    id,
    name: id,
    source: { kind: 'map' },
    lng: PLACE.lng,
    lat: PLACE.lat,
    blockId: 'b1',
    facing: { kind: 'block' },
    focalMm: 50,
    framing: 'landform',
    ...patch,
  }
}

const elsewhere = (id: string) => {
  const [lng, lat] = near(400)
  return view(id, { lng, lat })
}

describe('the planned view the reviewer stands at', () => {
  it('is none when the reviewer is not standing anywhere, or stands away from every view', () => {
    const views = [view('a'), elsewhere('b')]
    expect(currentPlannedView(views, null)).toBeNull()
    expect(currentPlannedView(views, near(30))).toBeNull()
  })

  it('is the one view within a metre of where the reviewer stands', () => {
    const views = [elsewhere('b'), view('a')]
    expect(currentPlannedView(views, near(0.6))?.id).toBe('a')
    expect(currentPlannedView(views, near(1.5))).toBeNull()
  })

  it('takes the facing that matches the road view when views share a place', () => {
    const views = [
      view('arrow-1', { facing: { kind: 'bearing', degrees: 40 } }),
      view('arrow-2', { facing: { kind: 'bearing', degrees: 95 } }),
      view('block-2', { blockId: 'b2' }),
    ]
    const here = near(0)
    expect(currentPlannedView(views, here, { look: { targetId: null, bearing: 95.4 } })?.id).toBe('arrow-2')
    expect(currentPlannedView(views, here, { look: { targetId: 'b2', bearing: null } })?.id).toBe('block-2')
    // A look that matches nothing falls back to the summary's block, then the first listed.
    expect(currentPlannedView(views, here, { look: { targetId: null, bearing: 200 }, blockId: 'b2' })?.id).toBe(
      'block-2',
    )
    expect(currentPlannedView(views, here, { look: { targetId: null, bearing: 200 } })?.id).toBe('arrow-1')
  })

  it("reads a view facing its block by the block's centre", () => {
    const views = [view('north', { blockId: 'b1' }), view('east', { blockId: 'b2' })]
    const centres: Record<string, { lng: number; lat: number }> = {
      b1: { lng: near(0, 2000)[0], lat: near(0, 2000)[1] },
      b2: { lng: near(2000, 0)[0], lat: near(2000, 0)[1] },
    }
    const pick = (bearing: number) =>
      currentPlannedView(views, near(0), {
        look: { targetId: null, bearing },
        centreOf: (id) => centres[id] ?? null,
      })?.id
    expect(pick(0.3)).toBe('north')
    expect(pick(90)).toBe('east')
  })
})

describe('stepping through the planned views', () => {
  const views = [view('a'), elsewhere('b'), view('c')]

  it('steps both ways and wraps at the ends', () => {
    expect(steppedView(views, 'a', 1)?.id).toBe('b')
    expect(steppedView(views, 'c', 1)?.id).toBe('a')
    expect(steppedView(views, 'a', -1)?.id).toBe('c')
  })

  it('starts from either end when no planned view is current', () => {
    expect(steppedView(views, null, 1)?.id).toBe('a')
    expect(steppedView(views, null, -1)?.id).toBe('c')
    expect(steppedView(views, 'gone', 1)?.id).toBe('a')
  })

  it('has nowhere to step with no views, or with only the current one', () => {
    expect(steppedView([], null, 1)).toBeNull()
    expect(steppedView([view('a')], 'a', 1)).toBeNull()
    expect(steppedView([view('a')], null, 1)?.id).toBe('a')
  })

  it('says where the current view sits in the list', () => {
    expect(viewPosition(views, 'b')).toBe('2 of 3')
    expect(viewPosition(views, null)).toBe('3 planned')
  })
})

describe('switching the block at a place', () => {
  it("finds the view planned at the reviewer's place for that block", () => {
    const views = [view('a'), view('b2-here', { blockId: 'b2' }), { ...elsewhere('b2-there'), blockId: 'b2' }]
    expect(viewForBlockHere(views, near(0.4), 'b2')?.id).toBe('b2-here')
    expect(viewForBlockHere(views, near(0.4), 'b3')).toBeNull()
    expect(viewForBlockHere(views, null, 'b2')).toBeNull()
  })
})
