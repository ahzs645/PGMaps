import { describe, expect, it, vi } from 'vitest'
import { buildRegrowthStands, forestHistoryBounds, type ForestHistoryRecord } from './regrowth'
import { fetchForestHistory, parseForestHistory } from './bcForestHistory'
import { placeTrees } from './forest'
import { createRoadsideDriveScene } from './driveScenario'
import { parsePreview, serializePreview } from './previewState'

const geometry: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [-122.65, 53.85],
      [-122.55, 53.85],
      [-122.55, 53.95],
      [-122.65, 53.95],
      [-122.65, 53.85],
    ],
  ],
}
const options = { year: 2026, growthMetersPerYear: 0.35, regenerationLagYears: 2, matureHeightMeters: 28 }
const harvest: ForestHistoryRecord = {
  id: 'harvest',
  kind: 'harvest',
  geometry,
  year: 2020,
  heightMeters: null,
  speciesCode: null,
  clearcutPercent: 100,
}
const trees = (inventory: ReturnType<typeof buildRegrowthStands>['stands'], clearings: GeoJSON.Polygon[] = []) =>
  placeTrees({
    stands: [],
    clearings,
    inventory,
    centre: { lng: -122.6, lat: 53.9 },
    radiusMeters: 100,
    spacingMeters: 8,
    heightMeters: 28,
  })

describe('dynamic existing forest', () => {
  it('uses recorded heights over older planting/harvest, and newer harvest over stale heights', () => {
    const height: ForestHistoryRecord = {
      ...harvest,
      id: 'height',
      kind: 'height',
      year: 2024,
      heightMeters: 4.8,
      speciesCode: 'PL',
    }
    const recent = buildRegrowthStands([harvest, height], options)
    expect(recent.stands[0].basis).toBe('recorded')
    expect(trees(recent.stands).every((t) => t.heightMeters <= 4.8 * 1.3)).toBe(true)
    const felled = buildRegrowthStands([harvest, { ...height, year: 2010, heightMeters: 25 }], options)
    expect(felled.stands[0].basis).toBe('harvest estimate')
    expect(felled.stands[0].heightMeters).toBeCloseTo(1.7)
    expect(trees(felled.stands).every((t) => t.heightMeters < 2.3)).toBe(true)
  })
  it('projects an old seedling height explicitly, retains its source, and never shrinks a tall recorded stand', () => {
    const seedling = { ...harvest, kind: 'height' as const, heightMeters: 0.3, year: 2005 }
    const projected = buildRegrowthStands([seedling], { ...options, projectRecordedHeights: true }).stands[0]
    expect(projected).toMatchObject({ basis: 'height projection', recordedHeightMeters: 0.3, referenceYear: 2005 })
    expect(projected.heightMeters).toBeCloseTo(7.65)
    expect(buildRegrowthStands([seedling], options).stands[0].heightMeters).toBe(0.3)
    expect(
      buildRegrowthStands([{ ...seedling, heightMeters: 40 }], { ...options, projectRecordedHeights: true }).stands[0]
        .heightMeters,
    ).toBe(40)
    expect(
      buildRegrowthStands([{ ...seedling, year: null }], { ...options, projectRecordedHeights: true }).stands[0].basis,
    ).toBe('recorded')
  })

  it('uses planting completion without a harvest lag and keeps partial-harvest retention', () => {
    const planted = buildRegrowthStands([{ ...harvest, id: 'plant', kind: 'planting', year: 2021 }], options)
    expect(planted.stands[0].heightMeters).toBeCloseTo(2.05)
    const partial = buildRegrowthStands([{ ...harvest, clearcutPercent: 40 }], options)
    const stems = trees(partial.stands)
    expect(stems.some((t) => t.heightMeters < 3)).toBe(true)
    expect(stems.some((t) => t.heightMeters > 15)).toBe(true)
    expect(trees(planted.stands, [geometry])).toHaveLength(0) // proposed harvest/road still wins
  })
  it('keeps a new clearcut bare during the assumed regeneration lag; never invents dates', () => {
    expect(trees(buildRegrowthStands([{ ...harvest, year: 2026 }], options).stands)).toHaveLength(0)
    const unknown = buildRegrowthStands(
      [
        { ...harvest, year: null },
        { ...harvest, id: 'unknown-share', clearcutPercent: null },
        { ...harvest, id: 'future', year: 2030 },
      ],
      options,
    )
    expect(unknown.unknown).toBe(2)
    expect(unknown.stands).toHaveLength(0)
  })
  it('only applies a planting height inside its treatment polygon', () => {
    const smaller: GeoJSON.Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [-122.65, 53.85],
          [-122.6, 53.85],
          [-122.6, 53.95],
          [-122.65, 53.95],
          [-122.65, 53.85],
        ],
      ],
    }
    const stand = buildRegrowthStands([{ ...harvest, kind: 'planting', geometry: smaller }], options)
    const stems = trees(stand.stands)
    expect(stems.filter((t) => t.lng < -122.6).every((t) => t.heightMeters < 4)).toBe(true)
    expect(stems.filter((t) => t.lng > -122.6).every((t) => t.heightMeters > 15)).toBe(true)
  })
  it('parses completion dates, zero/null heights, and duplicate planting rows without duplicating a stand', () => {
    const payload = {
      features: [
        {
          geometry,
          properties: {
            ACTIVITY_TREATMENT_UNIT_ID: 42,
            ATU_COMPLETION_DATE: Date.UTC(2016, 5, 1),
            SILV_TREE_SPECIES_CODE: 'PL',
            NUMBER_PLANTED: 100,
          },
        },
        {
          geometry,
          properties: {
            ACTIVITY_TREATMENT_UNIT_ID: 42,
            ATU_COMPLETION_DATE: Date.UTC(2016, 5, 1),
            SILV_TREE_SPECIES_CODE: 'SX',
            NUMBER_PLANTED: 500,
          },
        },
      ],
    }
    const rows = parseForestHistory(payload, 'planting')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ year: 2016, speciesCode: 'SX' })
    expect(
      parseForestHistory({ features: [{ geometry, properties: { ATU_COMPLETION_DATE: null } }] }, 'planting')[0].year,
    ).toBeNull()
  })
  it('bounds requests around route and target geometry with a foreground margin', () => {
    const b = forestHistoryBounds(
      [
        [-122.6, 53.9],
        [-122.58, 53.9],
      ],
      [geometry],
    )!
    expect(b[0]).toBeLessThan(-122.65)
    expect(b[2]).toBeGreaterThan(-122.55)
    expect(forestHistoryBounds([], [])).toBeNull()
  })
  it('keeps successful sources on partial failure and identifies raw record caps before deduplication', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/20/')
          ? new Response('', { status: 503 })
          : Response.json({
              features: url.includes('/4/')
                ? Array.from({ length: 1000 }, () => ({ geometry, properties: { OBJECTID: 1 } }))
                : [],
            }),
      ),
    )
    try {
      const data = await fetchForestHistory([-122.65, 53.85, -122.55, 53.95], new AbortController().signal)
      expect(data.issues.some((i) => i.includes('1,000'))).toBe(true)
      expect(data.issues.some((i) => i.includes('planting unavailable'))).toBe(true)
      expect(data.records).toHaveLength(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it('preserves regrowth assumptions when a comparison is downloaded and reopened', () => {
    const view = {
      id: 'view',
      name: 'Regrowth',
      positionMeters: 600,
      lookAtTargetId: null,
      yaw: 0,
      tilt: 0,
      treeHeightMeters: 28,
      roadClearWidthMeters: 20,
      harvestPhase: 'after' as const,
      existingForest: true,
      growthMetersPerYear: 0.5,
      projectRecordedHeights: true,
      regenerationLagYears: 3,
    }
    const restored = parsePreview(JSON.parse(serializePreview(createRoadsideDriveScene(), [view])))!
    expect(restored.views[0]).toMatchObject({
      growthMetersPerYear: 0.5,
      regenerationLagYears: 3,
      existingForest: true,
      projectRecordedHeights: true,
    })
  })
})
