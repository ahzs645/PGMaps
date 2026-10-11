import { describe, expect, it } from 'vitest'
import { nechakoBoundary } from './boundary'
import { EMPTY_WORKSPACE, importWorkspace } from './workspace'

const feature = (id: number, name: string): GeoJSON.Feature<GeoJSON.Polygon> => ({
  type: 'Feature',
  id,
  properties: { namedWatershedId: id, name, areaKm2: 47257.951 },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [-127, 53],
        [-123, 53],
        [-123, 56],
        [-127, 53],
      ],
    ],
  },
})

describe('EchoScreen Nechako boundary reuse', () => {
  it('selects identity 8886 and retains geometry, properties, styling and provenance across save/restore', () => {
    const nechako = feature(8886, 'Nechako River')
    const { vector, bounds } = nechakoBoundary({
      type: 'FeatureCollection',
      features: [feature(11541, 'Fraser River'), nechako],
    })
    expect(vector.data.features).toEqual([nechako])
    expect(bounds).toEqual([-127, 53, -123, 56])
    expect(vector).toMatchObject({ color: '#0891b2', fillOpacity: 0.14, lineOpacity: 1, lineWidth: 2.2 })
    expect(importWorkspace(JSON.parse(JSON.stringify({ ...EMPTY_WORKSPACE, vectors: [vector] }))).vectors).toEqual([
      vector,
    ])
  })
  it('fails when the identity is missing, rather than using a similarly named polygon', () => {
    expect(() => nechakoBoundary({ type: 'FeatureCollection', features: [feature(11541, 'Nechako River')] })).toThrow(
      'not found',
    )
  })
  it('rejects unsupported workspace paint values', () => {
    const { vector } = nechakoBoundary({ type: 'FeatureCollection', features: [feature(8886, 'Nechako River')] })
    for (const style of [
      { fillOpacity: 2 },
      { lineOpacity: 2 },
      { lineWidth: -1 },
      { lineWidth: '2' },
      { fillOpacity: NaN },
    ])
      expect(() => importWorkspace({ ...EMPTY_WORKSPACE, vectors: [{ ...vector, ...style }] })).toThrow('style')
  })
})
