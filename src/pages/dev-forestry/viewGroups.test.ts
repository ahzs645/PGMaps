import { describe, expect, it } from 'vitest'

import {
  groupIdForName,
  groupLeadOf,
  groupMembers,
  groupSuggestion,
  handOver,
  joinGroup,
  leaveGroup,
  samePerspective,
  SAME_PERSPECTIVE_DEGREES,
} from './viewGroups'
import type { ViewOfInterest } from './viewsOfInterest'

const centre = { lng: -122.595, lat: 53.905 }
const centreOf = (id: string) => (id === 'block-1' ? centre : null)
const destinationPoint = (from: { lng: number; lat: number }, bearing: number, meters: number) => {
  const radians = (bearing * Math.PI) / 180
  const lat = from.lat + (Math.cos(radians) * meters) / 111_320
  return { lat, lng: from.lng + (Math.sin(radians) * meters) / (111_320 * Math.cos((from.lat * Math.PI) / 180)) }
}

/** A view `km` from the block's centre, at `bearing` as the block sees it. */
const view = (id: string, bearing: number, km: number, extra: Partial<ViewOfInterest> = {}): ViewOfInterest => {
  const at = destinationPoint(centre, bearing, km * 1000)
  return {
    id,
    name: `View ${id}`,
    source: { kind: 'map' },
    lng: at.lng,
    lat: at.lat,
    blockId: 'block-1',
    facing: { kind: 'block' },
    focalMm: 50,
    framing: 'landform',
    ...extra,
  }
}

describe('views of interest assessed together', () => {
  it('sees the same perspective within 10° from the block and similar distances, on the same block', () => {
    const a = view('a', 180, 2.1)
    expect(samePerspective(a, view('b', 186, 2.4), centreOf)).toMatchObject({ apartDegrees: expect.closeTo(6, 0) })
    expect(samePerspective(a, view('c', 180 + SAME_PERSPECTIVE_DEGREES + 2, 2.1), centreOf)).toBeNull()
    // The same side, but much nearer: another perspective.
    expect(samePerspective(a, view('d', 181, 1.2), centreOf)).toBeNull()
    expect(samePerspective(a, view('e', 181, 2.1, { blockId: 'block-2' }), centreOf)).toBeNull()
  })

  it('suggests the later view of a pair join the earlier, and nothing once grouped', () => {
    const views = [view('a', 180, 2.1), view('b', 186, 2.4), view('c', 90, 2)]
    expect(groupSuggestion(views[0], views, centreOf)).toBeNull()
    expect(groupSuggestion(views[1], views, centreOf)?.lead.id).toBe('a')
    expect(groupSuggestion(views[2], views, centreOf)).toBeNull()
    const joined = joinGroup(views, 'b', 'a')
    expect(groupSuggestion(joined[1], joined, centreOf)).toBeNull()
  })

  it('leads a group from the view others name, follows chains and ignores a missing or looping lead', () => {
    const views = [view('a', 0, 2), view('b', 0, 2, { assessedWith: 'a' }), view('c', 0, 2, { assessedWith: 'b' })]
    expect(groupLeadOf(views[2], views).id).toBe('a')
    expect(groupMembers('a', views).map((entry) => entry.id)).toEqual(['a', 'b', 'c'])
    expect(groupLeadOf(view('x', 0, 2, { assessedWith: 'gone' }), views).id).toBe('x')
    const loop = [view('p', 0, 2, { assessedWith: 'q' }), view('q', 0, 2, { assessedWith: 'p' })]
    expect(groupLeadOf(loop[0], loop).id).toBe('p')
    expect(groupIdForName(views, 'View c')).toBe('a')
    expect(groupIdForName(views, 'Nowhere')).toBeNull()
  })

  it('joins a lead with its whole group, and hands a group on when its lead leaves or is removed', () => {
    const views = [view('a', 0, 2), view('b', 0, 2, { assessedWith: 'a' }), view('c', 90, 2)]
    const joined = joinGroup(views, 'a', 'c')
    expect(joined.map((entry) => entry.assessedWith)).toEqual(['c', 'c', undefined])

    const member = leaveGroup(views, 'b')
    expect(member.newLeadId).toBeNull()
    expect(member.views[1].assessedWith).toBeUndefined()

    const three = [...views, view('d', 0, 2, { assessedWith: 'a' })]
    const handed = handOver(three, 'a')
    expect(handed.newLeadId).toBe('b')
    expect(handed.views.map((entry) => entry.assessedWith)).toEqual([undefined, undefined, undefined, 'b'])
    expect(handOver(views, 'c').newLeadId).toBeNull()
  })
})
