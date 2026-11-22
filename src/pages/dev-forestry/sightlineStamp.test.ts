import { describe, expect, it } from 'vitest'

import {
  READINESS_NOT_RECORDED,
  SIGHTLINE_NOT_CURRENT,
  captureSightline,
  capturedSightline,
  gapsAsk,
  runFigures,
  type RunFigureSource,
} from './runFigures'
import { restampSightline, withSightlineStamp } from './sightlineStamp'
import type { AlterationBreakdown, RunGap } from './types'

const breakdown = (cumulativePercent: number): AlterationBreakdown => ({
  existingPercent: 1,
  disturbancePercent: 0,
  proposedPercent: cumulativePercent - 1,
  cumulativePercent,
})

const run = (ready: boolean): RunFigureSource => ({
  perspectiveAlteration: breakdown(6),
  planimetricAlteration: breakdown(4),
  perspectiveByStation: [breakdown(5), breakdown(6), null],
  assessmentStationIndex: 1,
  quality: {
    numericalReady: ready,
    warnings: [],
    gaps: ready ? [] : [{ id: 'green-area', text: 'Green-area coverage is unverified.', editor: 'landform' }],
  },
})

const classOf = (percent: number) => (percent < 7 ? 'Partial Retention' : 'Modification')
const same = { runKey: 'scene-a', captureKey: 'scene-a' }

describe('a stamp keeps the run it was read from', () => {
  it('names the run’s scene and the view’s, and a stale run reads out of date', () => {
    expect(captureSightline(runFigures(run(true)), 0, same)).toEqual({
      sightlinePercent: 5,
      sightlineReadiness: 'ready',
      sightlineRunKey: 'scene-a',
      sightlineCaptureKey: 'scene-a',
    })
    const stale = captureSightline(runFigures(null, { stale: true }), 0, { runKey: null, captureKey: 'scene-a' })
    expect(stale.sightlineWithheld).toMatch(/^Out of date/)
    expect(stale.sightlineRunKey).toBeUndefined()
  })

  it('does not pass off a ready figure from another scene’s run as the view’s', () => {
    const elsewhere = captureSightline(runFigures(run(true)), 0, { runKey: 'scene-b', captureKey: 'scene-a' })
    expect(capturedSightline(elsewhere)).toEqual({ percent: null, note: SIGHTLINE_NOT_CURRENT })
    // A stamp saved before the keys were kept reads as it always did.
    expect(capturedSightline({ sightlinePercent: 5, sightlineReadiness: 'ready' })).toEqual({ percent: 5, note: null })
  })
})

describe('recording the run’s figure on a saved view', () => {
  const unrecorded = { sightlinePercent: 5.5 }
  it('stamps a view saved before readiness was recorded from a ready run of its own scene', () => {
    expect(capturedSightline(unrecorded).note).toBe(READINESS_NOT_RECORDED)
    const stamp = restampSightline(unrecorded, runFigures(run(true)), 1, same, classOf)
    expect(stamp).toEqual({
      sightlinePercent: 6,
      sightlineReadiness: 'ready',
      sightlineRunKey: 'scene-a',
      sightlineCaptureKey: 'scene-a',
      sightlineClass: 'Partial Retention',
    })
    expect(capturedSightline(stamp)).toEqual({ percent: 6, note: null })
    // And a view saved while the run was provisional, once it is ready.
    const withheld = captureSightline(runFigures(run(false)), 1, same)
    expect(restampSightline(withheld, runFigures(run(true)), 1, same, classOf)?.sightlinePercent).toBe(6)
  })

  it('offers nothing without a ready run of the same scene, or once the view has its figure', () => {
    expect(restampSightline(unrecorded, runFigures(run(false)), 1, same, classOf)).toBeNull()
    expect(restampSightline(unrecorded, runFigures(null, { stale: true }), 1, same, classOf)).toBeNull()
    expect(
      restampSightline(unrecorded, runFigures(run(true)), 1, { runKey: 'scene-b', captureKey: 'scene-a' }, classOf),
    ).toBeNull()
    const current = captureSightline(runFigures(run(true)), 1, same)
    expect(restampSightline(current, runFigures(run(true)), 1, same, classOf)).toBeNull()
    expect(restampSightline(null, runFigures(run(true)), 1, same, classOf)).toBeNull()
    // A station the run has no complete view from is recorded once, as none, and not offered again.
    const none = restampSightline(unrecorded, runFigures(run(true)), 2, same, classOf)!
    expect(none.sightlinePercent).toBeNull()
    expect(restampSightline(none, runFigures(run(true)), 2, same, classOf)).toBeNull()
  })

  it('replaces a figure’s whole record, leaving none of the old fields behind', () => {
    const figure = {
      viewpoint: 'Road',
      sightlinePercent: null,
      sightlineClass: null,
      sightlineReadiness: 'withheld' as const,
      sightlineWithheld: 'Not run: run visibility in step 3.',
    }
    const stamped = withSightlineStamp(figure, {
      sightlinePercent: 6,
      sightlineClass: 'Partial Retention',
      sightlineReadiness: 'ready',
    })
    expect(stamped).toEqual({
      viewpoint: 'Road',
      sightlinePercent: 6,
      sightlineClass: 'Partial Retention',
      sightlineReadiness: 'ready',
    })
  })
})

describe('a gap a lookup fills', () => {
  it('is offered wherever it stands among the gaps', () => {
    const gaps: RunGap[] = [
      { id: 'no-landform', text: 'No active landform.', editor: 'landform' },
      { id: 'existing-disturbance', text: 'Existing openings not read.', editor: 'run', action: 'lookup-inventory' },
    ]
    expect(gapsAsk(gaps, 'lookup-inventory')).toBe(true)
    expect(gapsAsk(gaps.slice(0, 1), 'lookup-inventory')).toBe(false)
  })
})
