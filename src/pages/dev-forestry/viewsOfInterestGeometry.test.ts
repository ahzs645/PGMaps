import { describe, expect, it } from 'vitest'
import { bearingDegrees } from './visibility'
import { blockCentre, lensHfovDeg, viewAtPoint, type ViewOfInterest } from './viewsOfInterest'
import {
  chosenArrowCollection,
  VIEW_CONE_DEFAULT_METERS,
  VIEW_CONE_MAX_METERS,
  VIEW_CONE_MIN_METERS,
  viewConeLengthMeters,
  viewsOfInterestPlan,
} from './viewsOfInterestGeometry'

const block = {
  id: 'block-1',
  name: 'Block A',
  geometry: {
    type: 'Polygon' as const,
    coordinates: [
      [
        [-122.6, 53.9],
        [-122.59, 53.9],
        [-122.59, 53.91],
        [-122.6, 53.91],
        [-122.6, 53.9],
      ],
    ],
  },
}

// About 3 km west of the block.
const west = viewAtPoint({ lng: -122.64, lat: 53.905 }, block, [])
const arrowView: ViewOfInterest = {
  ...west,
  id: 'arrow-view',
  source: { kind: 'vli', key: 'vli:1' },
  facing: { kind: 'bearing', degrees: 100, arrowId: 'a1' },
  focalMm: 24,
}

/** The compass bearing halfway between the cone's two edges, from its apex. */
function coneAxis(feature: GeoJSON.Feature): number {
  const ring = (feature.geometry as GeoJSON.Polygon).coordinates[0]
  const apex = { lng: ring[0][0], lat: ring[0][1] }
  const edge = (point: number[]) => bearingDegrees(apex, { lng: point[0], lat: point[1] })
  const left = edge(ring[1])
  const right = edge(ring[ring.length - 2])
  return (left + ((((right - left) % 360) + 360) % 360) / 2) % 360
}

describe('viewsOfInterestPlan', () => {
  it('numbers the views in list order and faces a block view at its centre', () => {
    const { marks, cones } = viewsOfInterestPlan([west, arrowView], [block], 'arrow-view')
    expect(marks.map((mark) => [mark.number, mark.open])).toEqual([
      [1, false],
      [2, true],
    ])
    expect(cones.features).toHaveLength(2)
    const toBlock = bearingDegrees(west, blockCentre(block.geometry)!)
    expect(marks[0].bearing).toBeCloseTo(toBlock, 6)
    expect(coneAxis(cones.features[0])).toBeCloseTo(toBlock, 0)
    expect(cones.features[1].properties).toMatchObject({ id: 'arrow-view', number: 2, open: 1, included: 1 })
  })

  it('faces a bearing view along its bearing, as wide as its lens', () => {
    const { cones } = viewsOfInterestPlan([arrowView], [block], null)
    const cone = cones.features[0]
    expect(coneAxis(cone)).toBeCloseTo(100, 0)
    const ring = (cone.geometry as GeoJSON.Polygon).coordinates[0]
    const apex = { lng: ring[0][0], lat: ring[0][1] }
    const left = bearingDegrees(apex, { lng: ring[1][0], lat: ring[1][1] })
    const right = bearingDegrees(apex, { lng: ring[ring.length - 2][0], lat: ring[ring.length - 2][1] })
    expect(right - left).toBeCloseTo(lensHfovDeg(24), 0)
  })

  it('keeps a view whose block is gone as a mark, with no cone when it faces the block', () => {
    const { marks, cones } = viewsOfInterestPlan([west, { ...arrowView, blockId: 'gone' }], [], null)
    expect(marks.map((mark) => mark.bearing)).toEqual([null, 100])
    expect(cones.features.map((feature) => feature.properties?.id)).toEqual(['arrow-view'])
  })

  it('marks a view left out of exports', () => {
    const { marks, cones } = viewsOfInterestPlan([{ ...west, include: false }], [block], null)
    expect(marks[0].included).toBe(false)
    expect(cones.features[0].properties?.included).toBe(0)
  })
})

describe('viewConeLengthMeters', () => {
  it('reaches just past the block centre, within bounds', () => {
    const length = viewConeLengthMeters(west, block)
    expect(length).toBeGreaterThan(2500)
    expect(length).toBeLessThan(3500)
    expect(viewConeLengthMeters({ ...west, lng: -122.595, lat: 53.905 }, block)).toBe(VIEW_CONE_MIN_METERS)
    expect(viewConeLengthMeters({ ...west, lng: -123.5 }, block)).toBe(VIEW_CONE_MAX_METERS)
    expect(viewConeLengthMeters(west, null)).toBe(VIEW_CONE_DEFAULT_METERS)
  })
})

describe('chosenArrowCollection', () => {
  const arrow = (id: string): GeoJSON.Feature => ({
    type: 'Feature',
    id: `arrow:${id}`,
    properties: { id: `arrow:${id}`, arrowId: id },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [0, 1],
          [0, 0],
        ],
      ],
    },
  })
  const arrows: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: ['a1', 'a2', 'a3'].map(arrow) }

  it('keeps the arrows views face and the finder previews, marking which is which', () => {
    const chosen = chosenArrowCollection(arrows, [west, arrowView], ['a2', 'a1'], 'arrow-view')
    expect(chosen.features.map((feature) => feature.properties)).toEqual([
      { id: 'arrow:a1', arrowId: 'a1', preview: 0, open: 1 },
      { id: 'arrow:a2', arrowId: 'a2', preview: 1, open: 0 },
    ])
  })

  it('is empty when nothing is chosen', () => {
    expect(chosenArrowCollection(arrows, [west], [], null).features).toEqual([])
  })
})
