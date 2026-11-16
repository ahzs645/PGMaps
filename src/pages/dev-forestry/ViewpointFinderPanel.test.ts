import { describe, expect, it } from 'vitest'

import type { CandidateArrow, ViewpointCandidate } from './viewpointInventory'
import { facingOptions } from './ViewpointFinderPanel'

const arrow = (id: string, bearing: number, aims: boolean): CandidateArrow => ({
  id,
  bearing,
  offsetDegrees: aims ? 5 : 120,
  lengthMeters: 800,
  aims,
})
const candidate = (arrows: CandidateArrow[]): ViewpointCandidate => ({
  key: 'vli:1',
  kind: 'vli',
  name: 'VLI 1',
  lng: -122.6,
  lat: 53.9,
  distanceMeters: 2000,
  bearingToBlock: 45,
  arrow: arrows[0] ?? null,
  arrows,
  weight: 1,
})

describe("the finder row's facings", () => {
  it('offers the arrows *Add to views* adds by default as a choice of their own', () => {
    const row = candidate([arrow('a', 40, true), arrow('b', 50, true), arrow('c', 200, false)])
    expect(facingOptions(row, ['a', 'b']).map((option) => option.label)).toEqual([
      'The 2 arrows at the block',
      'The block',
      'Arrow 1 · northeast · at the block',
      'Arrow 2 · northeast · at the block',
      'Arrow 3 · south',
    ])
  })
  it('has no default choice of its own when no arrow aims at the block', () => {
    const row = candidate([arrow('c', 200, false)])
    expect(facingOptions(row, []).map((option) => option.key)).toEqual(['block', 'arrow:c'])
  })
})
