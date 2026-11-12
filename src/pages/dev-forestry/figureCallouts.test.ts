import { describe, expect, it } from 'vitest'
import { blockCallouts, calloutStatus, GLIMPSE_PERCENT, type BlockSight } from './figureCallouts'

/** A flat projector: longitude and latitude straight to pixels, behind the camera south of 0. */
const project = (lng: number, lat: number): [number, number] | null => (lat < 0 ? null : [lng, lat])

const block = (id: string, states: number[][], positions: number[]): BlockSight => ({
  id,
  name: id,
  positions,
  elevations: positions.map(() => 0),
  sampleCount: positions.length / 2,
  visibleByStation: states.flat(),
  interior: { lng: 50, lat: 50, elevation: 0 },
})

describe('figure callouts from the run', () => {
  it('reads the status from the station’s own share of samples', () => {
    expect(calloutStatus(0, 0)).toBe('not visible')
    expect(calloutStatus(0, 10)).toBe('unknown')
    expect(calloutStatus(GLIMPSE_PERCENT - 0.1, 0)).toBe('possible glimpses')
    expect(calloutStatus(GLIMPSE_PERCENT, 0)).toBe('visible')
  })

  it('anchors a seen block at its visible samples and a hidden one at its footprint', () => {
    const positions = [10, 10, 20, 10, 30, 40, 40, 40]
    const seen = block(
      '1',
      [
        [0, 0, 0, 0],
        [1, 1, 0, 0],
      ],
      positions,
    )
    const hidden = block(
      '2',
      [
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
      positions,
    )
    const callouts = blockCallouts([seen, hidden], 1, project, { width: 100, height: 100 })
    expect(callouts[0]).toMatchObject({ title: 'Block 1', body: 'Visible', anchor: [15, 10], visiblePercent: 50 })
    expect(callouts[1]).toMatchObject({ title: 'Block 2', body: 'Likely Not Visible', anchor: [50, 50] })
    // At station 0 nothing is seen, so both point at their footprints.
    expect(blockCallouts([seen], 0, project, { width: 100, height: 100 })[0].anchor).toEqual([50, 50])
  })

  it('leaves out blocks outside the frame, and keeps a name that already says Block', () => {
    const away = { ...block('Block 7', [[0]], [500, 500]), interior: { lng: 500, lat: 500, elevation: 0 } }
    expect(blockCallouts([away], 0, project, { width: 100, height: 100 })).toEqual([])
    const named = block('Block 7', [[1]], [5, 5])
    expect(blockCallouts([named], 0, project, { width: 100, height: 100 })[0].title).toBe('Block 7')
    const behind = { ...block('3', [[1]], [5, -5]), interior: null }
    expect(blockCallouts([behind], 0, project, { width: 100, height: 100 })).toEqual([])
  })
})
