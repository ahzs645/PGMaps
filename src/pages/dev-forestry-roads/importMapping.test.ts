import { describe, expect, it } from 'vitest'
import { parseHarvestEvidence } from '@/lib/forestry/bcHarvest'
import {
  applyImportMapping,
  fieldMatches,
  fieldNames,
  guessImportMapping,
  mappingKey,
  mappingSummary,
  mapRows,
  parseSavedMappings,
  rememberMapping,
  yearOf,
  type ImportMapping,
} from './importMapping'
import type { SpatialFile } from './spatialImport'
import { applyLayerImport } from './referenceImport'
import { createDemoProject } from './terrain'

const square: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [-121.5, 54],
      [-121.49, 54],
      [-121.49, 54.01],
      [-121.5, 54],
    ],
  ],
}
const file = (fileName: string, rows: Record<string, unknown>[]): SpatialFile => ({
  fileName,
  format: 'shapefile',
  crs: 'EPSG:3005',
  collection: {
    type: 'FeatureCollection',
    features: rows.map((properties) => ({ type: 'Feature', properties, geometry: square })),
  },
})

// Made-up plan: a block id on a few rows, an operating area (DBF-cut to ten characters) on most.
const plan = file('Plan/Area_plan.shp', [
  { Block_ID: '', Operating_: 'North' },
  { Block_ID: '', Operating_: 'North' },
  { Block_ID: 'SO_1', name: 'SO_1', Operating_: 'South' },
  { Block_ID: '', Operating_: 'South' },
  { Block_ID: '', Operating_: '' },
])

describe('guessing a mapping', () => {
  it('takes the block id, then the repeated operating area its DBF name was cut from', () => {
    expect(fieldMatches('Operating_', ['operating_area'])).toBe(true)
    expect(fieldMatches('Operating', ['operating_area'])).toBe(false)
    expect(guessImportMapping(plan, 'planned-block')).toEqual({ nameFields: ['Block_ID'], groupField: 'Operating_' })
  })

  it('finds a block status, its harvested values, a year and an opening ID', () => {
    const blocks = file('blocks.shp', [
      { BLOCK_NO: 'A1', BLK_STATUS: 'Harvested', HARV_YEAR: 2019, OPENING_ID: 1234 },
      { BLOCK_NO: 'A2', BLK_STATUS: 'Not harvested', HARV_YEAR: null, OPENING_ID: null },
      { BLOCK_NO: 'A3', BLK_STATUS: 'Proposed', HARV_YEAR: null, OPENING_ID: null },
      { BLOCK_NO: 'A4', BLK_STATUS: 'Logged', HARV_YEAR: '2021-08-03', OPENING_ID: 99 },
    ])
    expect(guessImportMapping(blocks, 'planned-block')).toEqual({
      nameFields: ['BLOCK_NO'],
      groupField: null,
      status: { field: 'BLK_STATUS', harvested: ['Harvested', 'Logged'] },
      yearField: 'HARV_YEAR',
      openingIdField: 'OPENING_ID',
    })
    // A road or a reference layer has nowhere to keep a status, a year or an opening.
    expect(guessImportMapping(blocks, 'reference')).toEqual({ nameFields: ['BLOCK_NO'], groupField: null })
  })

  it('keeps a lone text attribute the reader named features by, and a real `name` field', () => {
    const lots = file('lots.shp', [
      { LOT: 'Lot 4', name: 'Lot 4' },
      { LOT: 'Lot 5', name: 'Lot 5' },
    ])
    expect(guessImportMapping(lots, 'reference').nameFields).toEqual(['LOT'])
    const roads = file('roads.shp', [{ name: 'Main', CLASS: 'A' }])
    expect(fieldNames(roads)).toEqual(['name', 'CLASS'])
    expect(guessImportMapping(roads, 'proposed-road').nameFields).toEqual(['name'])
  })

  it('reads years from numbers, dates and DBF dates, and nothing else', () => {
    expect([2019, '2019', '2019-07-01', '20190701', '2019/7/1', 'later', 19, '201907'].map(yearOf)).toEqual([
      2019,
      2019,
      2019,
      2019,
      2019,
      null,
      null,
      null,
    ])
  })
})

describe('what a mapping makes', () => {
  it('numbers blank names within their group, and the rest by the file', () => {
    const names = mapRows(plan, guessImportMapping(plan, 'planned-block'), 'planned-block').map((row) => row.name)
    expect(names).toEqual(['North 1', 'North 2', 'SO_1', 'South 1', 'Area_plan 1'])
    expect(mapRows(plan, { nameFields: [], groupField: null }, 'reference').map((row) => row.name)).toEqual([
      'Area_plan 1',
      'Area_plan 2',
      'Area_plan 3',
      'Area_plan 4',
      'Area_plan 5',
    ])
  })

  it('tries name fields in order', () => {
    const roads = file('roads.shp', [
      { ROAD_ID: 'R1', ALT: 'x' },
      { ROAD_ID: '', ALT: 'Spur' },
    ])
    expect(
      mapRows(roads, { nameFields: ['ROAD_ID', 'ALT'], groupField: null }, 'proposed-road').map((r) => r.name),
    ).toEqual(['R1', 'Spur'])
  })

  it('imports only the rows kept, numbering within what is kept', () => {
    const mapping: ImportMapping = {
      ...guessImportMapping(plan, 'planned-block'),
      keep: { field: 'Operating_', values: ['South'] },
    }
    const rows = mapRows(plan, mapping, 'planned-block')
    expect(rows.map((row) => [row.index, row.name])).toEqual([
      [2, 'SO_1'],
      [3, 'South 1'],
    ])
    expect(mappingSummary(rows, 5)).toMatchObject({ kept: 2, leftOut: 3, numbered: [['South', 1]], repeated: 0 })
  })

  it('writes harvest evidence the project accepts, and keeps the source attributes as read', () => {
    const blocks = file('blocks.shp', [
      { BLOCK_NO: 'A1', BLK_STATUS: 'Harvested', HARV_YEAR: 2019, OPENING_ID: 1234 },
      { BLOCK_NO: 'A2', BLK_STATUS: 'Harvested', HARV_YEAR: null, OPENING_ID: null },
      { BLOCK_NO: 'A3', BLK_STATUS: 'Proposed', HARV_YEAR: 2030, OPENING_ID: null },
    ])
    const mapped = applyImportMapping(blocks, guessImportMapping(blocks, 'planned-block'), 'planned-block')
    const evidence = mapped.collection.features.map((f) => f.properties!.harvestEvidence)
    expect(evidence).toEqual([
      { source: 'user', status: 'harvested', endYear: 2019, yearMethod: 'reported-year', openingId: '1234' },
      { source: 'user', status: 'harvested', yearMethod: 'unknown' },
      // A proposed block carries no year, whatever the file says.
      { source: 'user', status: 'proposed', yearMethod: 'unknown' },
    ])
    for (const item of evidence) expect(() => parseHarvestEvidence(item)).not.toThrow()
    expect(mapped.collection.features[0].properties).toMatchObject({
      name: 'A1',
      sourceAttributes: { BLOCK_NO: 'A1', BLK_STATUS: 'Harvested', HARV_YEAR: 2019, OPENING_ID: 1234 },
    })
    expect(
      mappingSummary(mapRows(blocks, guessImportMapping(blocks, 'planned-block'), 'planned-block'), 3),
    ).toMatchObject({
      harvested: 2,
      harvestedWithoutYear: 1,
    })
  })

  it('does not keep the reader’s copied name as a source attribute', () => {
    const mapped = applyImportMapping(plan, guessImportMapping(plan, 'reference'), 'reference')
    expect(mapped.collection.features[2].properties).toEqual({
      Block_ID: 'SO_1',
      Operating_: 'South',
      name: 'SO_1',
      sourceAttributes: { Block_ID: 'SO_1', Operating_: 'South' },
    })
  })
})

describe('saved mappings', () => {
  const guess = guessImportMapping(plan, 'planned-block')
  const key = mappingKey(plan, 'planned-block')
  const changed: ImportMapping = { ...guess, nameFields: [], keep: { field: 'Operating_', values: ['North'] } }

  it('are found by role, shape and the file’s field names, whatever their case or order', () => {
    expect(key).toBe('planned-block|polygon|block_id,operating_')
    const reordered = file('Next year.shp', [{ OPERATING_: 'East', BLOCK_ID: 'E1' }])
    expect(mappingKey(reordered, 'planned-block')).toBe(key)
    expect(mappingKey(plan, 'reference')).not.toBe(key)
  })

  it('save a mapping that differs from the guess, without the rows kept, and nothing when it equals it', () => {
    expect(
      rememberMapping([], { key, fileName: plan.fileName, mapping: guess, guess }, '2026-11-24T00:00:00Z'),
    ).toEqual([])
    const saved = rememberMapping([], { key, fileName: plan.fileName, mapping: changed, guess }, '2026-11-24T00:00:00Z')
    expect(saved).toEqual([
      {
        key,
        fileName: plan.fileName,
        mapping: { nameFields: [], groupField: 'Operating_' },
        savedAt: '2026-11-24T00:00:00Z',
        usedAt: '2026-11-24T00:00:00Z',
      },
    ])
    // Used again unchanged: kept, its saved date kept, marked used.
    const again = rememberMapping(
      saved,
      { key, fileName: plan.fileName, mapping: changed, guess },
      '2026-11-25T00:00:00Z',
    )
    expect(again[0]).toMatchObject({ savedAt: '2026-11-24T00:00:00Z', usedAt: '2026-11-25T00:00:00Z' })
  })

  it('read back from storage, leaving out an entry that does not read', () => {
    const saved = rememberMapping([], { key, fileName: plan.fileName, mapping: changed, guess }, '2026-11-24T00:00:00Z')
    const stored = JSON.parse(JSON.stringify([...saved, { key: 'x' }, 'junk']))
    expect(parseSavedMappings(stored)).toEqual(saved)
    expect(parseSavedMappings('nope')).toEqual([])
  })

  it('keep the 50 most recently used', () => {
    let saved = rememberMapping([], { key, fileName: 'a', mapping: changed, guess }, '2026-01-01T00:00:00Z')
    for (let i = 0; i < 60; i++)
      saved = rememberMapping(
        saved,
        { key: `k${i}`, fileName: 'b', mapping: changed, guess },
        `2026-02-${String((i % 28) + 1).padStart(2, '0')}T00:00:${String(i % 60).padStart(2, '0')}Z`,
      )
    expect(saved).toHaveLength(50)
    expect(saved.some((item) => item.key === key)).toBe(false)
  })
})

describe('importing a mapped block layer', () => {
  it('adds proposed blocks and past harvests, each with its name, year and opening', () => {
    const blocks = file('Plan/blocks.shp', [
      { BLOCK_NO: 'A1', BLK_STATUS: 'Harvested', HARV_YEAR: 2019, OPENING_ID: 1234 },
      { BLOCK_NO: 'A2', BLK_STATUS: 'Proposed', HARV_YEAR: null, OPENING_ID: null },
    ])
    const mapped = applyImportMapping(blocks, guessImportMapping(blocks, 'planned-block'), 'planned-block')
    let n = 0
    const { project } = applyLayerImport(
      createDemoProject(),
      [{ file: mapped, role: 'planned-block' }],
      () => `id-${++n}`,
    )
    const added = project.context.filter((feature) => feature.layerSource === 'Plan/blocks.shp')
    expect(
      added.map((feature) => [
        feature.name,
        feature.harvestEvidence?.status,
        feature.harvestEvidence?.endYear,
        feature.harvestEvidence?.openingId,
      ]),
    ).toEqual([
      ['A1', 'harvested', 2019, '1234'],
      ['A2', 'proposed', undefined, undefined],
    ])
  })
})
