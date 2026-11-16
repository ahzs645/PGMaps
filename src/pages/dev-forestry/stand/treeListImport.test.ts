import proj4 from 'proj4'
import { describe, expect, it } from 'vitest'

import { crsDefinition } from '@/lib/geo/projectedCrs'

import {
  GEOMETRY_CROWN_AREA,
  GEOMETRY_X,
  GEOMETRY_Y,
  TREE_LIST_MAX_TREES,
  convertTreeList,
  droppedSummary,
  packImportedTrees,
  readTreeList,
  statedUnits,
  suggestMapping,
  unpackImportedTrees,
  type ImportedTree,
} from './treeListImport'

/** A point near Prince George in a projected system, from proj4 itself. */
function projected(epsg: number, lng: number, lat: number): [number, number] {
  return proj4('EPSG:4326', crsDefinition(epsg)!, [lng, lat]) as [number, number]
}

const M = { height: 'm', diameter: 'cm' } as const

describe('readTreeList: tables', () => {
  it('reads a FUSION CanopyMaxima-like CSV and suggests its columns, stating no CRS', () => {
    const [x, y] = projected(26910, -122.75, 53.91)
    const text = [
      'Index,X,Y,Elevation,Height Above Ground,Max Crown Diameter,Min Crown Diameter',
      `1,${x.toFixed(2)},${y.toFixed(2)},712.4,24.6,5.2,4.1`,
      `2,${(x + 6).toFixed(2)},${(y + 3).toFixed(2)},713.0,18.2,3.9,3.3`,
      `3,${(x + 12).toFixed(2)},${(y - 2).toFixed(2)},713.8,1.1,0.8,0.6`,
    ].join('\n')
    const read = readTreeList({ name: 'maxima.csv', text })
    expect(read.kind).toBe('csv')
    expect(read.columns).toHaveLength(7)
    expect(read.rows).toHaveLength(3)
    expect(read.suggested).toMatchObject({
      x: 'X',
      y: 'Y',
      height: 'Height Above Ground',
      crown: 'Max Crown Diameter',
      crownMeasure: 'width',
      id: 'Index',
      dbh: null,
      species: null,
    })
    // Never guessed: X/Y in metres could be any of several systems.
    expect(read.crsHint).toBeNull()
    expect(statedUnits(read.suggested)).toEqual({ height: null, diameter: null })

    const converted = convertTreeList(read, read.suggested, { epsg: 26910, units: M })
    expect(converted.trees).toHaveLength(2)
    expect(converted.trees[0]).toMatchObject({ id: '1', heightMeters: 24.6, crownWidthMeters: 5.2, dbhCm: null })
    expect(converted.trees[0].lng).toBeCloseTo(-122.75, 6)
    expect(converted.trees[0].lat).toBeCloseTo(53.91, 6)
    expect(converted.dropped).toEqual([{ row: 3, reason: 'not taller than breast height (1.3 m)' }])
    expect(converted.bounds![0]).toBeCloseTo(-122.75, 4)
  })

  it('reads lidR crown_metrics written out (treeID, Z, convhull_area, X, Y) in the UTM zone the person names', () => {
    const [x, y] = projected(32610, -122.6, 54.02)
    const text = [
      'treeID,Z,convhull_area,X,Y',
      `101,31.25,28.27,${x},${y}`,
      `102,22.5,12.57,${x + 4},${y + 4}`,
      `103,,9.0,${x + 8},${y + 8}`,
    ].join('\n')
    const read = readTreeList({ name: 'crowns.csv', text })
    expect(read.suggested).toMatchObject({
      x: 'X',
      y: 'Y',
      height: 'Z',
      crown: 'convhull_area',
      crownMeasure: 'area',
      id: 'treeID',
    })
    expect(read.crsHint).toBeNull()
    const converted = convertTreeList(read, read.suggested, { epsg: 32610, units: M })
    expect(converted.trees.map((tree) => tree.id)).toEqual(['101', '102'])
    // 28.27 m² is a 6 m wide crown.
    expect(converted.trees[0].crownWidthMeters).toBeCloseTo(6, 2)
    expect(converted.trees[0].lng).toBeCloseTo(-122.6, 6)
    expect(converted.dropped).toEqual([{ row: 3, reason: 'no height' }])
  })

  it('takes an EPSG code from a comment line or a crs column as the file stating its system', () => {
    const [x, y] = projected(3005, -122.7, 53.9)
    const commented = readTreeList({ name: 'a.csv', text: `# crs: EPSG:3005\nid,x,y,height\n1,${x},${y},20` })
    expect(commented.crsHint).toEqual({ epsg: 3005, source: 'an EPSG code in the file’s comment lines' })
    const column = readTreeList({ name: 'b.csv', text: `id,x,y,height,crs\n1,${x},${y},20,EPSG:3005` })
    expect(column.crsHint?.epsg).toBe(3005)
    const unsupported = readTreeList({ name: 'c.csv', text: `# EPSG:2263\nid,x,y,height\n1,1,2,20` })
    expect(unsupported.crsHint?.epsg).toBeNull()
    expect(unsupported.problems.join(' ')).toContain('EPSG:2263')
  })

  it('reads longitude/latitude columns, tab-separated, with species codes and diameters in inches and heights in feet', () => {
    const text = [
      'tree_id\tlongitude\tlatitude\theight_ft\tdbh_in\tspecies\tcrown_radius',
      '7\t-122.70000\t53.90000\t82.0\t12.0\tPLI\t9.8',
      '8\t-122.70010\t53.90005\t65.6\t\tSX\t',
      '9\t-122.70020\t53.90010\t50.0\t8\tZZ\t5',
    ].join('\n')
    const read = readTreeList({ name: 'stems.tsv', text })
    expect(read.suggested).toMatchObject({
      x: 'longitude',
      y: 'latitude',
      height: 'height_ft',
      dbh: 'dbh_in',
      species: 'species',
      id: 'tree_id',
      crown: 'crown_radius',
      crownMeasure: 'radius',
    })
    expect(read.crsHint).toEqual({ epsg: 4326, source: 'columns named longitude and latitude' })
    expect(statedUnits(read.suggested)).toEqual({ height: 'ft', diameter: 'in' })
    const converted = convertTreeList(read, read.suggested, { epsg: 4326, units: { height: 'ft', diameter: 'in' } })
    expect(converted.trees).toHaveLength(3)
    const [first, second, third] = converted.trees
    expect(first.heightMeters).toBeCloseTo(82 * 0.3048, 6)
    expect(first.dbhCm).toBeCloseTo(30.48, 6)
    expect(first.crownWidthMeters).toBeCloseTo(2 * 9.8 * 0.3048, 6)
    expect(first.species).toBe('pine')
    expect(second.species).toBe('spruce')
    expect(second.dbhCm).toBeNull()
    expect(second.crownWidthMeters).toBeNull()
    expect(third.species).toBeNull()
    expect(converted.notes.join(' ')).toContain('species not read (ZZ)')
  })

  it('names what is missing: no header row, too few columns, nothing to read', () => {
    const headerless = readTreeList({ name: 'raw.txt', text: '1 2 3\n4 5 6' })
    expect(headerless.columns).toEqual(['column 1', 'column 2', 'column 3'])
    expect(headerless.rows).toHaveLength(2)
    expect(headerless.suggested.x).toBeNull()
    expect(headerless.problems.join(' ')).toContain('no header row')
    const narrow = readTreeList({ name: 'narrow.csv', text: 'x,y\n1,2' })
    expect(narrow.problems.join(' ')).toContain('a tree list needs x, y and height')
    expect(narrow.suggested.height).toBeNull()
    expect(readTreeList({ name: 'empty.csv', text: '\n\n' }).problems.join(' ')).toContain('no rows')
    expect(() => convertTreeList(narrow, narrow.suggested, { epsg: 4326, units: M })).toThrow(/height/)
  })

  it('drops trees outside BC and says the system is probably wrong when none fall inside', () => {
    const [x, y] = projected(26910, -122.75, 53.91)
    const read = readTreeList({ name: 'a.csv', text: `x,y,height\n${x},${y},20\n${x + 5},${y},21` })
    // Read as BC Albers, UTM coordinates land far off in the Pacific.
    const wrong = convertTreeList(read, read.suggested, { epsg: 3005, units: M })
    expect(wrong.trees).toHaveLength(0)
    expect(wrong.dropped.every((entry) => entry.reason.startsWith('outside British Columbia'))).toBe(true)
    expect(wrong.notes.join(' ')).toContain('probably not this one')
    expect(droppedSummary(wrong.dropped)).toBe('2 outside British Columbia (check the coordinate system)')
  })

  it('caps a block at TREE_LIST_MAX_TREES and says how many were left out', () => {
    const lines = ['lon,lat,height']
    const total = TREE_LIST_MAX_TREES + 7
    for (let i = 0; i < total; i += 1) lines.push(`${-122.7 + i * 1e-5},53.9,20`)
    const read = readTreeList({ name: 'many.csv', text: lines.join('\n') })
    const converted = convertTreeList(read, read.suggested, { epsg: 4326, units: M })
    expect(converted.trees).toHaveLength(TREE_LIST_MAX_TREES)
    expect(converted.leftOut).toBe(7)
    expect(converted.notes[0]).toBe('7 trees left out: a block takes at most 25,000, the first in file order.')
  })
})

describe('readTreeList: GeoJSON', () => {
  it('reads Point features as longitude/latitude per RFC 7946', () => {
    const json = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-122.7, 53.9, 24] },
          properties: { treeID: 1, Z: 24 },
        },
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-122.7001, 53.9] },
          properties: { treeID: 2, Z: 9 },
        },
        { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: { treeID: 3, Z: 9 } },
      ],
    }
    const read = readTreeList({ name: 'ttops.geojson', json })
    expect(read.kind).toBe('geojson')
    expect(read.suggested).toMatchObject({ x: GEOMETRY_X, y: GEOMETRY_Y, height: 'Z', id: 'treeID', crown: null })
    expect(read.crsHint).toEqual({
      epsg: 4326,
      source: 'GeoJSON without a crs member is longitude/latitude (RFC 7946)',
    })
    expect(read.problems.join(' ')).toContain('1 feature(s) are not points')
    const converted = convertTreeList(read, read.suggested, { epsg: 4326, units: M })
    expect(converted.trees.map((tree) => [tree.id, tree.lng, tree.heightMeters])).toEqual([
      ['1', -122.7, 24],
      ['2', -122.7001, 9],
    ])
    expect(converted.dropped).toEqual([{ row: 3, reason: 'no coordinates' }])
  })

  it('reads a crs member naming a projected system, and asks when coordinates are not lon/lat and none is named', () => {
    const [x, y] = projected(26910, -122.75, 53.91)
    const feature = { type: 'Feature', geometry: { type: 'Point', coordinates: [x, y] }, properties: { height: 20 } }
    const named = readTreeList({
      name: 'a.json',
      json: {
        type: 'FeatureCollection',
        crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::26910' } },
        features: [feature],
      },
    })
    expect(named.crsHint).toEqual({ epsg: 26910, source: 'the file’s crs member' })
    const unnamed = readTreeList({ name: 'b.json', json: { type: 'FeatureCollection', features: [feature] } })
    expect(unnamed.crsHint).toBeNull()
    expect(unnamed.problems.join(' ')).toContain('choose the system')
  })

  it("reads the PGMaps LiDAR page's crown segmentation: polygon centroid as the stem, crown area as the width", () => {
    // Two square crowns about 4 m and 6 m across, outlines in lon/lat as `tree_isolation.py` writes them.
    const scale = { lng: 1 / (111_195 * Math.cos((53.9 * Math.PI) / 180)), lat: 1 / 111_195 }
    const square = (lng: number, lat: number, side: number) => {
      const dx = (side / 2) * scale.lng
      const dy = (side / 2) * scale.lat
      return {
        type: 'Polygon',
        coordinates: [
          [
            [lng - dx, lat - dy],
            [lng + dx, lat - dy],
            [lng + dx, lat + dy],
            [lng - dx, lat + dy],
            [lng - dx, lat - dy],
          ],
        ],
      }
    }
    const json = {
      schema_version: 1,
      grid: { width: 10, height: 10, bounds: [0, 0, 10, 10], resolution: 1, crs: 'EPSG:3157' },
      crowns: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: square(-122.7, 53.9, 4),
            properties: {
              id: 'tree-1',
              height_m: 21.4,
              crown_area_m2: 16,
              edge: false,
              centre: [-122.7, 53.9],
              runs: [[0, 1, 2]],
            },
          },
          {
            type: 'Feature',
            geometry: square(-122.6999, 53.9, 6),
            properties: { id: 'tree-2', height_m: 1.2, crown_area_m2: 36, edge: true, centre: [-122.6999, 53.9] },
          },
        ],
      },
    }
    const read = readTreeList({ name: 'tree-isolation.json', json })
    expect(read.columns).toContain(GEOMETRY_CROWN_AREA)
    expect(read.crsHint).toEqual({
      epsg: 4326,
      source: 'PGMaps crown segmentation: outlines in longitude/latitude (its grid is EPSG:3157)',
    })
    expect(read.suggested).toMatchObject({
      x: GEOMETRY_X,
      y: GEOMETRY_Y,
      height: 'height_m',
      crown: 'crown_area_m2',
      crownMeasure: 'area',
      id: 'id',
    })
    expect(read.problems.join(' ')).toContain('centre, runs')
    expect(statedUnits(read.suggested)).toEqual({ height: 'm', diameter: null })
    expect(read.rows[0][GEOMETRY_X]).toBeCloseTo(-122.7, 9)

    const fromProperty = convertTreeList(read, read.suggested, { epsg: 4326, units: M })
    expect(fromProperty.trees).toHaveLength(1)
    expect(fromProperty.trees[0]).toMatchObject({ id: 'tree-1', heightMeters: 21.4 })
    expect(fromProperty.trees[0].crownWidthMeters).toBeCloseTo(2 * Math.sqrt(16 / Math.PI), 6)
    expect(fromProperty.dropped).toEqual([{ row: 2, reason: 'not taller than breast height (1.3 m)' }])

    const fromOutline = convertTreeList(
      read,
      { ...read.suggested, crown: GEOMETRY_CROWN_AREA },
      { epsg: 4326, units: M },
    )
    // The 4 m square's own area, 16 m², within the local-scale approximation.
    expect(fromOutline.trees[0].crownWidthMeters).toBeCloseTo(2 * Math.sqrt(16 / Math.PI), 1)
  })
})

describe('suggestMapping', () => {
  it('matches aliases without case or punctuation, preferring a width over a radius over an area', () => {
    expect(
      suggestMapping(['TreeID', 'Easting', 'Northing', 'TREEHEIGHT', 'Crown_Width', 'Crown_Area', 'DBH_cm', 'Spp']),
    ).toEqual({
      x: 'Easting',
      y: 'Northing',
      height: 'TREEHEIGHT',
      crown: 'Crown_Width',
      crownMeasure: 'width',
      dbh: 'DBH_cm',
      species: 'Spp',
      id: 'TreeID',
    })
    expect(statedUnits(suggestMapping(['x', 'y', 'H', 'DBH_cm']))).toEqual({ height: null, diameter: 'cm' })
  })
})

describe('packImportedTrees', () => {
  it('round-trips through JSON to the saved precision', () => {
    const trees: ImportedTree[] = [
      {
        id: '1',
        lng: -122.712345678,
        lat: 53.912345678,
        heightMeters: 24.56,
        crownWidthMeters: 5.23,
        dbhCm: 31.04,
        species: 'pine',
      },
      { id: '2', lng: -122.7, lat: 53.9, heightMeters: 18, crownWidthMeters: null, dbhCm: null, species: null },
      { id: '3', lng: -122.71, lat: 53.91, heightMeters: 30.04, crownWidthMeters: 7, dbhCm: 44.4, species: 'spruce' },
    ]
    const packed = packImportedTrees(trees)
    expect(packed.ids).toBeUndefined()
    expect(packed.species).toEqual(['pine', 'spruce'])
    const back = unpackImportedTrees(JSON.parse(JSON.stringify(packed)))
    expect(back).toEqual([
      {
        id: '1',
        lng: -122.7123457,
        lat: 53.9123457,
        heightMeters: 24.6,
        crownWidthMeters: 5.2,
        dbhCm: 31,
        species: 'pine',
      },
      trees[1],
      { ...trees[2], heightMeters: 30 },
    ])
    expect(unpackImportedTrees(packImportedTrees(back))).toEqual(back)

    const named = packImportedTrees([{ ...trees[0], id: 'tree-9' }])
    expect(named.ids).toEqual(['tree-9'])
    expect(unpackImportedTrees(named)[0].id).toBe('tree-9')
    expect(() => unpackImportedTrees({ ...packed, data: packed.data.slice(1) })).toThrow(/cut short/)
    expect(() => unpackImportedTrees({ ...packed, fields: ['lng'] })).toThrow(/fields/)
  })
})
