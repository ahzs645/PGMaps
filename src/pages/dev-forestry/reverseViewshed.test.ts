import { describe, expect, it } from 'vitest'

import { buildCanopyGrid } from './canopy'
import {
  DEFAULT_REVERSE_SETTINGS,
  computeReverseViewshed,
  reverseStationsToGeoJson,
  type ReverseRoad,
} from './reverseViewshed'
import type { ElevationSource } from './terrain'

/** Terrain that varies with longitude only, so a ridge can be placed exactly. */
function profile(elevationForLng: (lng: number) => number): ElevationSource {
  return { elevationAt: (lng) => elevationForLng(lng) }
}

const FLAT = profile(() => 0)

function box(minLng: number, minLat: number, maxLng: number, maxLat: number): GeoJSON.Polygon {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [minLng, minLat],
        [maxLng, minLat],
        [maxLng, maxLat],
        [minLng, maxLat],
        [minLng, minLat],
      ],
    ],
  }
}

const BLOCK = box(0.02, -0.004, 0.028, 0.004)

function road(id: string, coordinates: Array<[number, number]>, name = id): ReverseRoad {
  return { id, name, roadClass: 'tertiary', coordinates }
}

/** A short north–south road at a given longitude. */
const northSouth = (id: string, lng: number) =>
  road(id, [
    [lng, -0.006],
    [lng, 0.006],
  ])

const SETTINGS = { ...DEFAULT_REVERSE_SETTINGS, stationSpacingMeters: 200, sampleBudget: 60 }

describe('computeReverseViewshed', () => {
  it('finds the road that sees the block across open ground', () => {
    const result = computeReverseViewshed(FLAT, [BLOCK], [northSouth('near', 0.012)], SETTINGS)

    expect(result.roads).toHaveLength(1)
    expect(result.roads[0].maxVisiblePercent).toBeGreaterThan(90)
    expect(result.roads[0].seeingStationCount).toBeGreaterThan(0)
    expect(result.roads[0].exposedLengthFraction).toBeGreaterThan(0.5)
    expect(result.sampleCount).toBeGreaterThan(10)
  })

  it('ranks a road behind a ridge below one with a clear view', () => {
    // A ridge at 0.016° blocks anything west of it from seeing the block.
    const ridge = profile((lng) => (lng > 0.015 && lng < 0.017 ? 400 : 0))
    const result = computeReverseViewshed(
      ridge,
      [BLOCK],
      [northSouth('behind-ridge', 0.008), northSouth('clear', 0.033)],
      SETTINGS,
    )

    expect(result.roads[0].roadId).toBe('clear')
    expect(result.roads[0].maxVisiblePercent).toBeGreaterThan(50)
    const blocked = result.roads.find((entry) => entry.roadId === 'behind-ridge')!
    expect(blocked.maxVisiblePercent).toBe(0)
    expect(blocked.seeingStationCount).toBe(0)
  })

  it('drops a road that sits beyond the view distance without walking it', () => {
    const result = computeReverseViewshed(FLAT, [BLOCK], [northSouth('far', 0.4)], {
      ...SETTINGS,
      maxViewDistanceMeters: 5000,
    })
    expect(result.roads).toHaveLength(0)
    expect(result.outOfRangeRoadCount).toBe(1)
    expect(result.stations).toHaveLength(0)
  })

  it('reports how much of a road is exposed, not just whether it is', () => {
    // A ridge covering the northern half hides the block from that stretch.
    const halfBlocked = computeReverseViewshed(
      { elevationAt: (lng, lat) => (lat > 0 && lng > 0.014 && lng < 0.016 ? 400 : 0) },
      [BLOCK],
      [northSouth('partly', 0.01)],
      SETTINGS,
    )
    const entry = halfBlocked.roads[0]
    expect(entry.exposedLengthFraction).toBeGreaterThan(0.2)
    expect(entry.exposedLengthFraction).toBeLessThan(0.8)
    // Averaging only over the stations that see anything keeps the mean honest.
    expect(entry.meanVisiblePercentWhereSeen).toBeGreaterThan(0)
  })

  it('takes screening timber into account like the forward run does', () => {
    const bounds: [number, number, number, number] = [0, -0.01, 0.04, 0.01]
    const screen = box(0.015, -0.006, 0.018, 0.006)
    const canopy = buildCanopyGrid([{ geometry: screen, heightMeters: 30, crownClosurePercent: 70 }], bounds)

    const open = computeReverseViewshed(FLAT, [BLOCK], [northSouth('road', 0.01)], SETTINGS)
    const screened = computeReverseViewshed(FLAT, [BLOCK], [northSouth('road', 0.01)], SETTINGS, canopy)

    expect(open.roads[0].maxVisiblePercent).toBeGreaterThan(50)
    expect(screened.roads[0].maxVisiblePercent).toBeLessThan(open.roads[0].maxVisiblePercent)
  })

  it('returns nothing for an empty request', () => {
    expect(computeReverseViewshed(FLAT, [], [northSouth('a', 0.01)], SETTINGS).roads).toHaveLength(0)
    expect(computeReverseViewshed(FLAT, [BLOCK], [], SETTINGS).roads).toHaveLength(0)
  })
})

describe('reverseStationsToGeoJson', () => {
  it('tags each station with whether it sees the block', () => {
    const result = computeReverseViewshed(FLAT, [BLOCK], [northSouth('near', 0.012)], SETTINGS)
    const collection = reverseStationsToGeoJson(result)

    expect(collection.features.length).toBe(result.stations.length)
    expect(collection.features.every((feature) => feature.geometry.type === 'Point')).toBe(true)
    expect(collection.features.some((feature) => feature.properties?.seen === 1)).toBe(true)
    expect(new Set(collection.features.map((feature) => feature.id)).size).toBe(collection.features.length)
  })

  it('is empty without a result', () => {
    expect(reverseStationsToGeoJson(null).features).toHaveLength(0)
  })
})
