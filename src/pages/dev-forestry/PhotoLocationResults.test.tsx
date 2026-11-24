import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LocationResults } from './PhotoLocationResults'
import {
  photoLocationTrials,
  rankPhotoLocations,
  type PhotoLocationCandidate,
  type PhotoLocationSearch,
} from './photoLocationSearch'
import type { WideSearchResult } from './wideOrientation'

const centre = { lng: -122.75, lat: 53.9 }
const fit = (meanLoss: number, bearing: number) =>
  ({
    bearing,
    pitch: 0,
    roll: 0,
    meanLoss,
    ambiguous: false,
    runnerUp: null,
    fit: { trustworthy: true, agreeing: 50, agreement: 0.8 },
  }) as unknown as WideSearchResult

let renderer: ReactTestRenderer | undefined
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = undefined
})

function panel(candidates: PhotoLocationCandidate[], quiet = false) {
  const useLocation = vi.fn()
  const search: PhotoLocationSearch = {
    status: 'done',
    ...rankPhotoLocations(candidates),
    sampled: 9,
    basis: { hfov: 60, eyeHeightMeters: 1.6, altitudeMeters: null },
  }
  act(() => {
    renderer = create(createElement(LocationResults, { search, onUse: useLocation, quiet }))
  })
  const root = renderer!.root
  const startButtons = root.findAll(
    (node: ReactTestInstance) =>
      node.type === 'button' && String(node.props['aria-label'] ?? '').includes('as a starting camera'),
  )
  const text = (node: ReactTestInstance): string =>
    node.children.map((child) => (typeof child === 'string' ? child : text(child))).join('')
  return { startButtons, text: text(root), useLocation }
}

describe('a location search’s results', () => {
  const places = photoLocationTrials(centre)

  it('offers a clear winner as a start', () => {
    const { startButtons } = panel([
      { ...places[0], fit: fit(0.2, 40) },
      { ...places[1], fit: fit(0.6, 90) },
    ])
    expect(startButtons).toHaveLength(2)
  })

  it('lists a near tie without any action and names how far apart its fits are', () => {
    const { startButtons, text } = panel([
      { ...places[0], fit: fit(0.45, 40) },
      { ...places[3], fit: fit(0.47, 310) },
    ])
    expect(startButtons).toHaveLength(0)
    expect(text).toContain('none is offered as a start')
    expect(text).toMatch(/up to \d+ m apart and facing 310° to 40°/)
    // The fits are still listed for the reviewer to look at.
    expect(text).toContain('310°')
    expect(text).toContain('40°')
  })

  it('says nothing of a clear winner from the background search, which is already a row in the options', () => {
    const { startButtons, text } = panel(
      [
        { ...places[0], fit: fit(0.2, 40) },
        { ...places[1], fit: fit(0.6, 90) },
      ],
      true,
    )
    expect(startButtons).toHaveLength(0)
    expect(text).toBe('')
  })

  it('still names a tie from the background search', () => {
    const { text } = panel(
      [
        { ...places[0], fit: fit(0.45, 40) },
        { ...places[3], fit: fit(0.47, 310) },
      ],
      true,
    )
    expect(text).toContain('Several places fit about as well')
  })
})
