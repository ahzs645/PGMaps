import { describe, expect, it } from 'vitest'

import type { AcceptancePose } from './photoAcceptance'
import { acceptPreview, type AcceptPreviewInput } from './photoAcceptPreview'
import type { PhotoOption } from './photoOptions'

// A made-up camera.
const pose: AcceptancePose = { lng: -121, lat: 52, altitudeMeters: 1400, bearing: 120, pitch: -8, roll: 1, hfov: 60 }
const winner: PhotoOption = {
  id: 'winner',
  kind: 'winner',
  label: 'Skyline: best fit',
  pose,
  evidence: { settled: false, skyColumns: 40 },
  warnings: [],
}
const base: AcceptPreviewInput = {
  pose,
  chosen: null,
  headingSource: 'skyline',
  rows: [winner],
  checkedPose: pose,
  initials: 'AB',
  note: '',
  photoWidth: 1050,
}

describe('acceptPreview', () => {
  it('takes the method and evidence from the row the camera is', () => {
    const preview = acceptPreview(base)
    expect(preview.row?.id).toBe('winner')
    expect(preview.method).toBe('skyline')
    expect(preview.evidence.skyColumns).toBe(40)
  })

  it('lets a camera be accepted with no note, no initials and no checks drawn', () => {
    expect(acceptPreview(base).gate).toEqual({ ok: true })
    expect(acceptPreview({ ...base, initials: '', checkedPose: null }).gate).toEqual({ ok: true })
    expect(acceptPreview({ ...base, checkedPose: { ...pose, bearing: 125 } }).gate).toEqual({ ok: true })
  })

  it('falls back to where the heading came from when no row is this camera', () => {
    const moved = { ...pose, bearing: 200 }
    const preview = acceptPreview({ ...base, pose: moved, checkedPose: moved, headingSource: 'reviewer', note: 'x' })
    expect(preview.row).toBeNull()
    expect(preview.method).toBe('typed')
    expect(preview.gate).toEqual({ ok: true })
  })

  it('never carries the last row’s evidence to a camera that has moved off it', () => {
    const chosen = { rowId: 'gone', kind: 'winner' as const, pose, evidence: { settled: true, skyColumns: 90 } }
    // Still that camera: its evidence stands even though the row has gone.
    expect(acceptPreview({ ...base, rows: [], chosen }).evidence.skyColumns).toBe(90)
    // Moved: nothing measured for this camera.
    const moved = { ...pose, bearing: 200 }
    const preview = acceptPreview({
      ...base,
      rows: [],
      chosen,
      pose: moved,
      checkedPose: moved,
      headingSource: 'reviewer',
    })
    expect(preview.evidence).toEqual({})
    expect(preview.method).toBe('typed')
  })

  it('needs a place before anything', () => {
    expect(acceptPreview({ ...base, pose: null }).gate.ok).toBe(false)
  })
})
