import { describe, expect, it } from 'vitest'

import {
  findLandCheck,
  LAND_CHECKS,
  landCheckBounds,
  landCheckMetrics,
  landCheckSummary,
  landCheckUrl,
  measureLandCheck,
  parseLandFeatures,
  runLandCheck,
  type LandCheckState,
} from './landStatusChecks'
import type { PolygonGeometry } from './visibility'

/** A square of `size` degrees at (lng, lat), south-west corner. */
const square = (lng: number, lat: number, size: number): PolygonGeometry => ({
  type: 'Polygon',
  coordinates: [
    [
      [lng, lat],
      [lng + size, lat],
      [lng + size, lat + size],
      [lng, lat + size],
      [lng, lat],
    ],
  ],
})

// About 650 m × 1100 m at 54° N.
const block = { name: 'PL-1', geometry: square(-122.5, 54, 0.01) }
const landform = square(-122.52, 53.98, 0.05)

describe('land status checks', () => {
  it('asks DataBC for the box in CQL, longitude first, with the geometry field named', () => {
    const url = new URL(landCheckUrl(findLandCheck('treaty'), [-122.6, 53.9, -122.4, 54.1]))
    expect(url.searchParams.get('typeNames')).toBe('WHSE_LEGAL_ADMIN_BOUNDARIES.FNT_TREATY_LAND_SP')
    expect(url.searchParams.get('CQL_FILTER')).toBe("BBOX(GEOMETRY,-122.6,53.9,-122.4,54.1,'EPSG:4326')")
    expect(url.searchParams.get('propertyName')?.split(',')).toContain('GEOMETRY')
    expect(url.searchParams.has('bbox')).toBe(false)
  })

  it("keeps a layer's own condition beside the box", () => {
    const url = new URL(landCheckUrl(findLandCheck('private'), [-122.6, 53.9, -122.4, 54.1]))
    expect(url.searchParams.get('CQL_FILTER')).toMatch(/^OWNER_TYPE='Private' AND BBOX\(SHAPE,/)
  })

  it('names every layer once', () => {
    const ids = LAND_CHECKS.map((check) => check.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('reads polygons and their names, and says when the answer was cut short', () => {
    const payload = {
      numberMatched: 3,
      features: [
        { geometry: square(-122.5, 54, 0.01), properties: { ENGLISH_NAME: 'FORT GEORGE 1' } },
        { geometry: { type: 'Point', coordinates: [-122.5, 54] }, properties: {} },
      ],
    }
    const { features, truncated } = parseLandFeatures(findLandCheck('reserve'), payload)
    expect(features.map((feature) => feature.name)).toEqual(['Fort George 1'])
    expect(truncated).toBe(true)
  })

  it('measures the hectares of each block over a layer, and the landform beside it', () => {
    // Half the block, west side.
    const feature = { name: 'Fort George 1', geometry: square(-122.505, 54, 0.01) }
    const result = measureLandCheck('reserve', [feature], [block], landform)
    expect(result.blocks).toHaveLength(1)
    expect(result.blocks[0].features).toEqual(['Fort George 1'])
    const blockHa = result.blocks[0].areaHa
    expect(blockHa).toBeGreaterThan(20)
    expect(blockHa).toBeLessThan(45)
    expect(result.landformHa).toBeGreaterThan(blockHa)
  })

  it('counts a layer in the landform but clear of the blocks as the landform only', () => {
    const feature = { name: 'Private parcel', geometry: square(-122.515, 53.985, 0.005) }
    const result = measureLandCheck('private', [feature], [block], landform)
    expect(result.blocks).toEqual([])
    expect(result.landformFeatures).toEqual(['Private parcel'])
    expect(landCheckSummary(findLandCheck('private'), { status: 'ready', result }).value).toMatch(/^In the landform/)
  })

  it('ignores slivers where boundaries drawn at different scales touch', () => {
    // A strip about 0.5 m wide along the block's east edge.
    const sliver = { name: 'Park', geometry: square(-122.49 - 0.000005, 54, 0.000005) }
    expect(measureLandCheck('park', [sliver], [block], null).blocks).toEqual([])
  })

  it('words an overlap as hectares in the block, with why it matters', () => {
    const feature = { name: 'Fort George 1', geometry: square(-122.505, 54, 0.01) }
    const state: LandCheckState = {
      status: 'ready',
      result: measureLandCheck('reserve', [feature], [block], null),
    }
    const summary = landCheckSummary(findLandCheck('reserve'), state)
    expect(summary.value).toMatch(/^\d+ ha in PL-1$/)
    expect(summary.tone).toBe('warning')
    expect(summary.note).toContain('outside provincial forest tenure')
  })

  it('sums the checks in one card and keeps each check as its own', () => {
    const clear: LandCheckState = { status: 'ready', result: measureLandCheck('treaty', [], [block], landform) }
    const states = Object.fromEntries(LAND_CHECKS.map((check) => [check.id, clear]))
    const all = landCheckMetrics(states, { unchecked: null })
    expect(all[0]).toMatchObject({ key: 'checks', value: 'Clear', tone: 'success' })
    expect(all.slice(1).map((row) => row.key)).toEqual(LAND_CHECKS.map((check) => `check-${check.id}`))

    const overlap = measureLandCheck('reserve', [{ name: 'R', geometry: block.geometry }], [block], null)
    const flagged = landCheckMetrics(
      { ...states, reserve: { status: 'ready', result: overlap }, park: { status: 'error', error: 'timed out' } },
      { unchecked: null },
    )
    expect(flagged[0]).toMatchObject({ value: '1 to review', tone: 'warning' })
    expect(flagged.find((row) => row.key === 'check-park')?.value).toBe('Not read')

    const loading = landCheckMetrics({}, { unchecked: null })
    expect(loading[0].value).toBe('Checking…')
  })

  it('says why nothing was checked', () => {
    const rows = landCheckMetrics({}, { unchecked: 'Add a cutblock to check the land under it.' })
    expect(rows).toEqual([expect.objectContaining({ key: 'checks', value: 'Not checked' })])
  })

  it('reads the blocks alone when the landform is too wide for one query', () => {
    const wide = square(-123, 53.5, 1)
    const close = (box: number[] | null, expected: number[]) =>
      expected.forEach((value, i) => expect(box?.[i]).toBeCloseTo(value, 9))
    close(landCheckBounds([block.geometry], wide), [-122.5, 54, -122.49, 54.01])
    close(landCheckBounds([block.geometry], landform), [-122.52, 53.98, -122.47, 54.03])
  })

  it('runs one check through the fetch it is given', async () => {
    const fetcher = (async () =>
      new Response(
        JSON.stringify({
          numberMatched: 1,
          features: [{ geometry: block.geometry, properties: { PROTECTED_LANDS_NAME: 'TABOR MOUNTAIN PARK' } }],
        }),
      )) as unknown as typeof fetch
    const result = await runLandCheck(findLandCheck('park'), [-122.6, 53.9, -122.4, 54.1], [block], null, fetcher)
    expect(result.blocks[0].features).toEqual(['Tabor Mountain Park'])
  })
})
