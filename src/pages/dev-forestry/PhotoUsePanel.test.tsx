import { createElement } from 'react'
import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PhotoAcceptPanel, PhotoUsePanel } from './PhotoAcceptPanel'
import { acceptPreview } from './photoAcceptPreview'
import type { PoseSource } from './exifPose'
import type { FieldPhotoState } from './useFieldPhoto'

const pose = { lng: -122, lat: 54, altitudeMeters: null, bearing: 0, pitch: 0, roll: 0, hfov: 60 }
let renderer: ReactTestRenderer | undefined
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = undefined
})

function words(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === 'string' ? child : words(child))).join('')
}

function panels(headingSource: PoseSource) {
  const ensureAccepted = vi.fn(() => ({ ok: true as const }))
  const setJob = vi.fn()
  const makeViewpoint = vi.fn(() => ({ ok: true as const, viewId: 'new-view', added: true }))
  const onAccept = vi.fn()
  const photo = {
    own: { id: 'photo', recordId: 'photo', name: 'photo.png', sources: { heading: headingSource }, uses: [] },
    acceptanceState: () => 'none',
    makeViewpoint,
    ensureAccepted,
    setJob,
  } as unknown as FieldPhotoState
  const preview = acceptPreview({
    pose,
    chosen: null,
    rows: [],
    headingSource,
    checkedPose: null,
    initials: '',
    note: '',
    photoWidth: 1050,
  })
  act(() => {
    renderer = create(
      createElement(
        'div',
        null,
        createElement(PhotoAcceptPanel, {
          photo,
          preview,
          initials: '',
          note: '',
          onInitials: vi.fn(),
          onNote: vi.fn(),
          onAccept,
          acceptError: null,
        }),
        createElement(PhotoUsePanel, { photo, preview }),
      ),
    )
  })
  const root = renderer!.root
  const button = (text: string) => root.findAllByType('button').find((node) => words(node).trim() === text)!
  const job = (text: string) =>
    root
      .findAllByType('label')
      .find((node) => words(node).startsWith(text))!
      .findByType('input')
  return { button, job, makeViewpoint, ensureAccepted, setJob, onAccept }
}

describe('using a photo from the actual Camera and Use controls', () => {
  it('cannot turn a preview’s 0° into camera-bearing jobs, but still keeps ground evidence', () => {
    const { button, job, ensureAccepted, setJob } = panels('default')
    expect(button('Accept camera').props.disabled).toBe(true)
    expect(button('Make a viewpoint').props.disabled).toBe(true)
    for (const label of ['A viewpoint', 'The before image', 'A check of the drawn forest'])
      expect(job(label).props.disabled).toBe(true)
    const ground = job('Ground conditions')
    expect(ground.props.disabled).toBe(false)
    act(() => ground.props.onChange({ target: { checked: true } }))
    expect(setJob).toHaveBeenCalledWith('photo', 'ground', true, null)
    expect(ensureAccepted).not.toHaveBeenCalled()
  })

  it('preserves one-click viewpoint creation for a reviewer-set true north', () => {
    const { button, job, makeViewpoint } = panels('reviewer')
    expect(button('Accept camera').props.disabled).toBe(false)
    expect(job('A viewpoint').props.disabled).toBe(false)
    act(() => job('A viewpoint').props.onChange({ target: { checked: true } }))
    expect(makeViewpoint).toHaveBeenCalledWith('photo', { initials: '', note: '' })
  })
})
