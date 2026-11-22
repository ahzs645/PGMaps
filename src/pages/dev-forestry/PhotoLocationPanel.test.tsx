import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PhotoLocationPanel } from './PhotoLocationPanel'
import { photoLocationTrials, rankPhotoLocations, type PhotoLocationCandidate } from './photoLocationSearch'
import type { FieldPhotoState, OwnPhoto } from './useFieldPhoto'
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

const own = { id: 'p1', pose: { hfov: 60, lng: null, lat: null } } as unknown as OwnPhoto

let renderer: ReactTestRenderer | undefined
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = undefined
})

function panel(candidates: PhotoLocationCandidate[]) {
  const useLocation = vi.fn()
  const photo = {
    locationSearch: {
      status: 'done',
      ...rankPhotoLocations(candidates),
      sampled: 9,
      basis: { hfov: 60, eyeHeightMeters: 1.6, altitudeMeters: null },
    },
    useLocation,
    findLocation: vi.fn(),
    cancelLocationSearch: vi.fn(),
  } as unknown as FieldPhotoState
  act(() => {
    renderer = create(createElement(PhotoLocationPanel, { own, photo, startPick: vi.fn() }))
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

describe('the photo location panel', () => {
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
    expect(text).toContain('None is offered as a start')
    expect(text).toMatch(/up to \d+ m apart, facing 310° to 40°/)
    // The fits are still listed for the reviewer to look at.
    expect(text).toContain('310.0°')
    expect(text).toContain('40.0°')
  })
})
