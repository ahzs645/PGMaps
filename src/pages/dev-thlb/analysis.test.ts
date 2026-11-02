import { describe, expect, it } from 'vitest'
import { analyze } from './analysis'
import { exampleInput } from './example'
import { breakdown, buildWorkbook, resultGeoJson } from './exports'
import { guessFields, parsePolygons } from './inputs'
import type { AnalysisInput, InputRole, Settings } from './types'

const SETTINGS: Settings = { matureAge: 80, reductionPercent: null, demo: false }
function polygons(role: InputRole, specs: Array<[number, number, Record<string, unknown>]>) {
  const collection: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: specs.map(([x, width, properties]) => ({
      type: 'Feature',
      properties,
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [x, 0],
            [x + width, 0],
            [x + width, 100],
            [x, 100],
            [x, 0],
          ],
        ],
      },
    })),
  }
  return parsePolygons(collection, role, guessFields(role, Object.keys(specs[0]?.[2] ?? {})), role)
}
function input(): AnalysisInput {
  return {
    areas: polygons('areas', [[0, 400, { AREA_ID: 'A' }]]),
    official: [],
    proxy: [],
    vri: [],
    admin: [],
    deferral: [],
  }
}

describe('THLB weighted overlay', () => {
  it('weights exact partial areas and reports gaps rather than counting source polygon totals', () => {
    const data = input()
    data.official = polygons('official', [
      [-50, 100, { thlb_fact: 0.75 }],
      [50, 150, { thlb_fact: 0.2 }],
    ])
    const result = analyze(data, SETTINGS)
    expect(result.combined.areaHa).toBe(4)
    expect(result.combined.thlbHa).toBeCloseTo(0.675, 9)
    expect(result.combined.coveredHa).toBe(2)
    expect(result.combined.uncoveredHa).toBe(2)
    expect(result.combined.reductionHa).toBeNull()
  })

  it('gives official zero and unknown factors precedence over proxy', () => {
    const data = input()
    data.official = polygons('official', [
      [0, 100, { thlb_fact: 0 }],
      [100, 100, { thlb_fact: null }],
    ])
    data.proxy = polygons('proxy', [[0, 400, { pthlb_fact: 0.5 }]])
    const row = analyze(data, SETTINGS).combined
    expect(row.thlbHa).toBe(1)
    expect(row.proxyThlbHa).toBe(1)
    expect(row.unknownFactorHa).toBe(1)
    expect(row.uncoveredHa).toBe(0)
  })

  it('deduplicates overlaps within a source and notes which feature wins', () => {
    const data = input()
    data.official = polygons('official', [
      [0, 300, { thlb_fact: 0.5 }],
      [100, 300, { thlb_fact: 1 }],
    ])
    const result = analyze(data, SETTINGS)
    expect(result.combined.thlbHa).toBe(2.5)
    expect(result.combined.coveredHa).toBe(4)
    expect(result.warnings.join(' ')).toContain('Overlapping official')
  })

  it('splits ages, deferrals and administrative areas without counting overlapping deferrals twice', () => {
    const data = input()
    data.official = polygons('official', [[0, 400, { thlb_fact: 0.5 }]])
    data.vri = polygons('vri', [
      [0, 100, { PROJ_AGE_1: 80 }],
      [100, 100, { PROJ_AGE_1: 79 }],
    ])
    data.deferral = polygons('deferral', [
      [0, 200, {}],
      [100, 200, {}],
    ])
    data.admin = polygons('admin', [
      [0, 200, { NAME: 'West' }],
      [200, 200, { NAME: 'East' }],
    ])
    const result = analyze(data, SETTINGS)
    expect(result.combined.matureThlbHa).toBe(0.5)
    expect(result.combined.immatureThlbHa).toBe(0.5)
    expect(result.combined.unknownAgeThlbHa).toBe(1)
    expect(result.combined.deferralThlbHa).toBe(1.5)
    const rows = breakdown(result.combinedPieces)
    expect(
      rows.filter((row) => row.Administrative_area === 'West').reduce((sum, row) => sum + (row.Known_THLB_ha ?? 0), 0),
    ).toBe(1)
    expect(result.combinedPieces.reduce((sum, piece) => sum + piece.areaHa, 0)).toBe(4)
  })

  it('separates per-WHA rows from the union total and applies only an explicit reduction scenario', () => {
    const result = analyze(exampleInput(), { ...SETTINGS, reductionPercent: 25 })
    expect(result.rows.map((row) => row.thlbHa)).toEqual([2.5, 0.5])
    expect(result.combined.thlbHa).toBe(2.5)
    expect(result.combined.areaHa).toBe(5)
    expect(result.combined.reductionHa).toBe(0.625)
    expect(result.combined.uncoveredHa).toBe(1)
    expect(result.warnings.join(' ')).toContain('Assessment areas overlap')
  })

  it('distinguishes a supplied empty deferral mask from no assessment', () => {
    const data = input()
    data.official = polygons('official', [[0, 400, { thlb_fact: 1 }]])
    expect(analyze(data, SETTINGS).combined.deferralThlbHa).toBeNull()
    data.assessedRoles = ['areas', 'official', 'deferral']
    expect(analyze(data, SETTINGS).combined.deferralThlbHa).toBe(0)
  })

  it('retains no-coverage rows when the supplied source has no nearby features', () => {
    const data = input()
    data.assessedRoles = ['areas', 'official']
    const row = analyze(data, SETTINGS).combined
    expect(row.thlbHa).toBe(0)
    expect(row.uncoveredHa).toBe(4)
  })

  it('subtracts holes and preserves small slivers', () => {
    const data = input()
    data.official = polygons('official', [[0, 400, { thlb_fact: 1 }]])
    const hole: [number, number][] = [
      [100, 20],
      [200, 20],
      [200, 80],
      [100, 80],
      [100, 20],
    ]
    data.areas[0].geometry[0].push(hole)
    expect(analyze(data, SETTINGS).combined.thlbHa).toBeCloseTo(3.4, 9)
    data.areas = polygons('areas', [[0, 0.0001, { AREA_ID: 'sliver' }]])
    expect(analyze(data, SETTINGS).combined.thlbHa).toBeCloseTo(0.000001, 12)
  })

  it('rejects duplicate IDs and invalid scenario assumptions', () => {
    const data = exampleInput()
    data.areas[1].id = data.areas[0].id
    expect(() => analyze(data, SETTINGS)).toThrow('Duplicate assessment ID')
    expect(() => analyze(exampleInput(), { ...SETTINGS, reductionPercent: 101 })).toThrow('between 0 and 100')
  })
})

describe('THLB input and export semantics', () => {
  it('recognizes pthlb_fact and follows its documented null-as-zero rule', () => {
    expect(polygons('proxy', [[0, 100, { pthlb_fact: null }]])[0].factor).toBe(0)
    expect(polygons('official', [[0, 100, { thlb_fact: null }]])[0].factor).toBeNull()
    for (const value of [-1, 75, 'bad'])
      expect(() => polygons('proxy', [[0, 100, { pthlb_fact: value }]])).toThrow('fraction')
  })

  it('exports geographic pieces with numeric factors, source provenance and a synthetic marker', () => {
    const result = analyze(exampleInput(), { ...SETTINGS, demo: true })
    const output = resultGeoJson(result)
    expect(output.features.length).toBeGreaterThan(0)
    expect(output.features[0].properties).toMatchObject({
      Source_kind: 'official',
      THLB_factor: 0.75,
      Synthetic_example: true,
    })
    const geometry = output.features[0].geometry as GeoJSON.MultiPolygon
    expect(geometry.coordinates[0][0][0][0]).toBeGreaterThan(-140)
    expect(geometry.coordinates[0][0][0][0]).toBeLessThan(-110)
  })

  it('writes reconcilable Excel numbers and records assumptions, missing data and source limits', async () => {
    const { default: ExcelJS } = await import('exceljs')
    const result = analyze(exampleInput(), { ...SETTINGS, demo: true })
    const book = new ExcelJS.Workbook()
    await book.xlsx.load(await buildWorkbook(result))
    const combined = book.getWorksheet('Combined union')!
    expect(combined.getRow(1).values).toContain('Known_THLB_ha')
    expect(combined.getCell('H2').value).toBe(2.5)
    expect(combined.getCell('I2').value).toBeNull()
    const method = book.getWorksheet('Method and QA')!
    expect(method.getCell('B1').value).toContain('SYNTHETIC EXAMPLE')
    expect(method.getCell('B3').value).toContain('EPSG:3005')
  })
})
