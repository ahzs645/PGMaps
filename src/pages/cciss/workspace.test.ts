import { describe, expect, it } from 'vitest'
import { DEFAULT_CCISS_SELECTION } from './layers'
import { readCcissWorkspace, writeCcissWorkspace } from './workspace'

describe('CCISS workspace links', () => {
  it('restores camera independently from the point being assessed and retains all map choices', () => {
    const state = readCcissWorkspace(
      '?lng=-125&lat=55&z=8&pointLng=-122.7497&pointLat=53.9171&kind=bgc&period=2081_2100&gcm=MIROC6&byZone=1&render=tiles&analysis=current',
    )
    expect(state.point).toEqual([-122.7497, 53.9171])
    expect(state.camera).toEqual({ center: [-125, 55], zoom: 8 })
    expect(state.selection).toMatchObject({ kind: 'bgc', period: '2081_2100', gcm: 'MIROC6', byZone: false })
    expect(state.analysis).toBe('current')
    const query = writeCcissWorkspace('?lng=-125&lat=55&z=8&embed=1', state)
    expect(query.get('embed')).toBe('1')
    expect(readCcissWorkspace(query)).toEqual(state)
  })

  it('keeps old camera-only links working and ignores malformed options and coordinates', () => {
    expect(readCcissWorkspace('?lng=-123&lat=49&analysis=legacy').point).toEqual([-123, 49])
    const state = readCcissWorkspace(
      '?lng=&lat=NaN&pointLng=999&pointLat=90&z=999&kind=nope&period=evil&analysis=other',
    )
    expect(state.point).toEqual([-122.7497, 53.9171])
    expect(state.selection).toEqual(DEFAULT_CCISS_SELECTION)
    expect(state.analysis).toBeNull()
    expect(state.camera.zoom).toBe(5.5)
  })

  it('clears closed dialogs and irrelevant reconstruction parameters without losing the selected point', () => {
    const state = { ...readCcissWorkspace('?analysis=report'), analysis: null, renderSource: 'tiles' as const }
    const params = writeCcissWorkspace('?analysis=report&traceMethod=pixels&lng=-124&lat=54', state)
    expect(params.has('analysis')).toBe(false)
    expect(params.has('traceMethod')).toBe(false)
    expect(readCcissWorkspace(params).point).toEqual(state.point)
    expect(params.get('lng')).toBe('-124')
  })

  it('opens the comparison workspace without putting saved results in the shared link', () => {
    const state = readCcissWorkspace('?analysis=compare&lng=-123&lat=49')
    expect(state.analysis).toBe('compare')
    const params = writeCcissWorkspace('?analysis=current&embed=1', state)
    expect(params.get('analysis')).toBe('compare')
    expect(params.get('embed')).toBe('1')
    expect(params.has('snapshots')).toBe(false)
    expect(readCcissWorkspace(params).point).toEqual([-123, 49])
  })
})
