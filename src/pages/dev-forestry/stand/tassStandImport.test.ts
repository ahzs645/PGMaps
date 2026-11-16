import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { metersPerDegree } from '../visibility'
import {
  BUNDLED_TASS_STEMS_COLUMNS,
  TassReadError,
  isTassColumnFile,
  isTassStemTable,
  placeTassPlot,
  readTassStemTable,
  tassConditionCounts,
  tassLiveSummary,
  tassPlacementLabel,
} from './tassStandImport'
import { IMPORTED_TREE_FIELDS, TREE_LIST_MAX_TREES, packImportedTrees, unpackImportedTrees } from './treeListImport'

/** A `.tcl` in PLOTSY's layout from a column list. */
function columnFile(columns: ReadonlyArray<readonly [string, string]>, extra = ''): string {
  const rows = columns.map(([name, units], index) => `${index}\t${name}\t${units}\t2\t${name}\t6\t-1`)
  return ["'TASS III", '*COLUMNS', "'ID\tName\tUnits\tDecimal\tDescription\tWidth\tHeaderId", ...rows, extra].join(
    '\r\n',
  )
}

type Row = {
  id: number
  x: number
  y: number
  condition: 'Live' | 'Snag' | 'CWD'
  height: number
  width?: number
  base?: number
  species?: string
}

/** One 28-field data row in TASS 4.3.1.2's stem layout. Values are made up for the test. */
function dataRow(row: Row): string {
  const live = row.condition === 'Live'
  const dash = '--'
  return [
    '60',
    String(row.id),
    row.x.toFixed(1),
    row.y.toFixed(1),
    row.species ?? 'Pli',
    '60',
    '20.00',
    row.height.toFixed(2),
    '0.300',
    '0.030',
    '0.9',
    row.condition,
    live ? '6.0' : dash,
    live ? (row.height - (row.base ?? 0)).toFixed(2) : dash,
    live ? '30.000' : dash,
    live ? (row.width ?? 3).toFixed(3) : dash,
    live ? ((row.width ?? 3) / 2).toFixed(3) : dash,
    live ? '1.20' : dash,
    live ? (row.base ?? 0).toFixed(3) : dash,
    live ? '1.000' : dash,
    live ? dash : 'SmCrown',
    live ? dash : row.condition === 'Snag' ? 'Standing' : 'Down',
    live ? dash : '50',
    dash,
    dash,
    dash,
    dash,
    'Planted',
  ].join('\t')
}

function stemTable(rows: Row[], plot = '20.00m x 10.00m'): string {
  return [
    '*AppType',
    'Tass_Stems',
    '',
    '*RUN',
    'File:\ttest.t3d',
    `Plot size:\t${plot}`,
    '*HEADER',
    'Notes:',
    '*DATA',
    ...rows.map(dataRow),
    '',
  ].join('\r\n')
}

const ROWS: Row[] = [
  { id: 1, x: 2, y: 1, condition: 'Live', height: 20, width: 3, base: 14 },
  { id: 2, x: 15, y: 8, condition: 'Live', height: 18, width: 2.5, base: 12 },
  { id: 3, x: 6, y: 4, condition: 'Snag', height: 15 },
  { id: 4, x: 9, y: 2, condition: 'CWD', height: 12 },
  { id: 5, x: 11, y: 6, condition: 'Live', height: 1.1, width: 0.4, base: 0.3 },
]
const TCL = columnFile(BUNDLED_TASS_STEMS_COLUMNS)

/** A square block, `side` metres, centred at (lng, lat). */
function squareBlock(lng: number, lat: number, side: number): GeoJSON.Polygon {
  const scale = metersPerDegree(lat)
  const dx = side / 2 / scale.lng
  const dy = side / 2 / scale.lat
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

const CENTRE = { lng: -122.8, lat: 54.0 }
const SCALE = metersPerDegree(CENTRE.lat)
/** A tree's offset from the block centre, metres east and north. */
const offset = (tree: { lng: number; lat: number }) => ({
  east: (tree.lng - CENTRE.lng) * SCALE.lng,
  north: (tree.lat - CENTRE.lat) * SCALE.lat,
})

describe('readTassStemTable', () => {
  it('reads stems by column name, splitting live, snag and down wood', () => {
    const table = readTassStemTable({ name: 'a.tdt', text: stemTable(ROWS), schema: { name: 'a.tcl', text: TCL } })
    expect(table.schema).toEqual({ source: 'file', name: 'a.tcl' })
    expect(table.plotMeters).toEqual({ width: 20, length: 10 })
    expect(table.standAge).toBe(60)
    expect(tassConditionCounts(table)).toEqual({ live: 3, snag: 1, down: 1, unknown: 0 })
    const first = table.stems[0]
    expect(first).toMatchObject({ id: '1', x: 2, y: 1, species: 'pine', heightMeters: 20, crownWidthMeters: 3 })
    expect(first.crownBaseMeters).toBe(14)
    // Dead stems never carry a live crown.
    expect(table.stems[2]).toMatchObject({ condition: 'snag', crownWidthMeters: null, crownBaseMeters: null })
    expect(table.stems[3]).toMatchObject({ condition: 'down', crownWidthMeters: null, crownBaseMeters: null })
    expect(tassLiveSummary(table).crownBaseShare).toBeCloseTo(12 / 18, 6)
  })

  it('assumes the bundled layout only when every row has its 28 fields, and says so', () => {
    const table = readTassStemTable({ name: 'a.tdt', text: stemTable(ROWS) })
    expect(table.schema).toEqual({ source: 'assumed' })
    expect(table.notes.join(' ')).toMatch(/assumed from TASS 4\.3\.1\.2/)
    const short = stemTable(ROWS).replace('\tPlanted\r\n', '\r\n')
    expect(() => readTassStemTable({ name: 'a.tdt', text: short })).toThrow(/27 fields.*add the export/)
  })

  it('refuses a remapped, mis-united or incomplete column file', () => {
    const text = stemTable(ROWS)
    expect(() =>
      readTassStemTable({ name: 'a.tdt', text, schema: { name: 'b.tcl', text: TCL + '\r\n*ColID\r\n0\t3' } }),
    ).toThrow(/remaps its columns/)
    const inches = columnFile(BUNDLED_TASS_STEMS_COLUMNS.map(([n, u]) => [n, n === 'DBH' ? 'in' : u] as const))
    expect(() => readTassStemTable({ name: 'a.tdt', text, schema: { name: 'b.tcl', text: inches } })).toThrow(
      /"DBH" is in in/,
    )
    const noHeight = columnFile(
      BUNDLED_TASS_STEMS_COLUMNS.map(([n, u]) => [n === 'Total Height' ? 'Height' : n, u] as const),
    )
    expect(() => readTassStemTable({ name: 'a.tdt', text, schema: { name: 'b.tcl', text: noHeight } })).toThrow(
      /no "Total Height"/,
    )
  })

  it('tells its files apart from other text', () => {
    expect(isTassStemTable(stemTable(ROWS))).toBe(true)
    expect(isTassStemTable('x,y,height\n1,2,3')).toBe(false)
    expect(isTassColumnFile(TCL)).toBe(true)
    expect(isTassColumnFile(stemTable(ROWS))).toBe(false)
    expect(() => readTassStemTable({ name: 'a.csv', text: 'x,y\n1,2' })).toThrow(TassReadError)
  })

  it('skips a repeated tree ID rather than drawing it twice', () => {
    const table = readTassStemTable({ name: 'a.tdt', text: stemTable([...ROWS, { ...ROWS[0], x: 3 }]) })
    expect(table.stems).toHaveLength(ROWS.length)
    expect(table.skipped).toEqual([{ line: expect.any(Number), reason: 'tree ID 1 again' }])
  })
})

describe('placeTassPlot', () => {
  const table = readTassStemTable({ name: 'a.tdt', text: stemTable(ROWS) })
  const block = squareBlock(CENTRE.lng, CENTRE.lat, 200)

  it('draws live stems over breast height only, with their crown base', () => {
    const placed = placeTassPlot(table, block, { axes: 'xy', bearingDegrees: 0, repeat: false })
    expect(placed.trees.map((tree) => tree.id)).toEqual(['1', '2'])
    expect(placed.shortLive).toBe(1)
    expect(placed.trees[0].crownBaseMeters).toBe(14)
    expect(placed.copies).toBe(1)
    // A 20 × 10 m plot over a 200 m square.
    expect(placed.coveredShare).toBeCloseTo(200 / 40_000, 2)
  })

  it('puts an asymmetric tree where each corner convention says', () => {
    // Tree 1 is at (2, 1) in a 20 × 10 m plot.
    const xy = offset(placeTassPlot(table, block, { axes: 'xy', bearingDegrees: 0, repeat: false }).trees[0])
    expect(xy.east).toBeCloseTo(2 - 10, 1)
    expect(xy.north).toBeCloseTo(1 - 5, 1)
    // Row 2 south of the north edge, column 1 east of the west edge.
    const rowColumn = offset(
      placeTassPlot(table, block, { axes: 'rowColumn', bearingDegrees: 0, repeat: false }).trees[0],
    )
    expect(rowColumn.east).toBeCloseTo(1 - 10, 1)
    expect(rowColumn.north).toBeCloseTo(5 - 2, 1)
  })

  it('turns the plot clockwise by its bearing', () => {
    const turned = offset(placeTassPlot(table, block, { axes: 'xy', bearingDegrees: 90, repeat: false }).trees[0])
    // Plot east (−8) now points south; plot north (−4) now points east.
    expect(turned.east).toBeCloseTo(-4, 1)
    expect(turned.north).toBeCloseTo(8, 1)
  })

  it('repeats the plot across the block with an ID per copy', () => {
    const placed = placeTassPlot(table, block, { axes: 'xy', bearingDegrees: 0, repeat: true })
    // 200 × 200 m holds the area of 10 × 20 copies of a 20 × 10 m plot, two drawn trees each; copies
    // cut by the block's edge still count when one of their trees falls inside.
    expect(placed.trees).toHaveLength(400)
    expect(placed.copies).toBeGreaterThanOrEqual(200)
    expect(new Set(placed.trees.map((tree) => tree.id)).size).toBe(400)
    expect(placed.trees[0].id).toMatch(/^[12]@-?\d+,-?\d+$/)
    expect(placed.coveredShare).toBe(1)
  })

  it('past the tree limit, keeps the copies nearest the block centre', () => {
    const big = squareBlock(CENTRE.lng, CENTRE.lat, 2_400)
    const placed = placeTassPlot(table, big, { axes: 'xy', bearingDegrees: 0, repeat: true })
    expect(placed.trees).toHaveLength(TREE_LIST_MAX_TREES)
    expect(placed.leftOut).toBeGreaterThan(0)
    // 25,000 trees at two per 200 m² cover about 250 ha, a patch round the centre well inside the 576 ha block.
    const reach = Math.max(...placed.trees.map((tree) => Math.hypot(offset(tree).east, offset(tree).north)))
    expect(reach).toBeLessThan(1_000)
    // Only copies with a tree drawn are counted: 25,000 trees from copies of two trees each.
    expect(placed.copies).toBeGreaterThanOrEqual(12_500)
    expect(placed.copies).toBeLessThan(13_000)
  })

  it('names the placement in the source line', () => {
    expect(tassPlacementLabel(table, { axes: 'rowColumn', bearingDegrees: 15, repeat: true })).toBe(
      'TASS plot (trial; stand age 60, row south, column east, from the north-west corner, turned 15°, repeated across the block)',
    )
  })
})

describe('imported crown base packing', () => {
  const base = { lng: -122.8, lat: 54, heightMeters: 20, crownWidthMeters: 3, dbhCm: 25, species: 'pine' as const }

  it('packs exactly as before when no tree has a crown base', () => {
    const packed = packImportedTrees([{ id: '1', ...base }])
    expect(packed.fields).toEqual([...IMPORTED_TREE_FIELDS])
    expect(unpackImportedTrees(packed)[0]).not.toHaveProperty('crownBaseMeters')
  })

  it('carries a crown base through a save', () => {
    const packed = packImportedTrees([
      { id: '1', ...base, crownBaseMeters: 14.26 },
      { id: '2', ...base, crownBaseMeters: null },
    ])
    expect(packed.fields).toEqual([...IMPORTED_TREE_FIELDS, 'crownBaseMeters'])
    const trees = unpackImportedTrees(packed)
    expect(trees.map((tree) => tree.crownBaseMeters)).toEqual([14.3, null])
  })
})

// TASS 4.3.1.2's bundled sample (Plotsy2/samples/Tass_Stems_Stand.tdt with Plotsy2/Tass_Stems.tcl),
// read from a local folder: the ministry's sample files are never committed.
const SAMPLES = process.env.TASS_SAMPLES
const stemsPath = SAMPLES ? join(SAMPLES, 'Tass_Stems_Stand.tdt') : ''
describe.skipIf(!SAMPLES || !existsSync(stemsPath))('TASS bundled sample (TASS_SAMPLES)', () => {
  it('reads all 1,600 stems and places the live ones', () => {
    const text = readFileSync(stemsPath, 'latin1')
    const schema = { name: 'Tass_Stems.tcl', text: readFileSync(join(SAMPLES!, 'Tass_Stems.tcl'), 'latin1') }
    const table = readTassStemTable({ name: 'Tass_Stems_Stand.tdt', text, schema })
    expect(tassConditionCounts(table)).toEqual({ live: 1082, snag: 38, down: 480, unknown: 0 })
    expect(table.plotMeters).toEqual({ width: 100, length: 100 })
    expect(table.standAge).toBe(120)
    expect(table.stems.find((stem) => stem.id === '2')).toMatchObject({
      heightMeters: 25.66,
      crownWidthMeters: 4.411,
      crownBaseMeters: 18.281,
    })
    expect(tassLiveSummary(table).crownBaseShare).toBeCloseTo(0.7338, 3)
    // Read without the .tcl, the bundled layout gives the same stems.
    expect(readTassStemTable({ name: 'Tass_Stems_Stand.tdt', text }).stems).toEqual(table.stems)
    const placed = placeTassPlot(table, squareBlock(CENTRE.lng, CENTRE.lat, 100), {
      axes: 'xy',
      bearingDegrees: 0,
      repeat: false,
    })
    // One hectare over a one-hectare block: every live stem over breast height.
    expect(placed.trees.length).toBe(table.stems.filter((s) => s.condition === 'live' && s.heightMeters > 1.3).length)
  })
})
