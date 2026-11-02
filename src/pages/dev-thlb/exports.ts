import { multiPolygonToLngLat } from '../dev-avast/projection'
import type { OutputLayer } from '../dev-avast/gdal'
import { THLB_SOURCES } from './sources'
import type { AnalysisResult, Piece, Summary } from './types'

export function summaryRecord(row: Summary) {
  return {
    Area_ID: row.id,
    Gross_ha: row.areaHa,
    Source_coverage_ha: row.coveredHa,
    No_source_ha: row.uncoveredHa,
    Missing_factor_ha: row.unknownFactorHa,
    Official_THLB_ha: row.officialThlbHa,
    Proxy_THLB_ha: row.proxyThlbHa,
    Known_THLB_ha: row.thlbHa,
    Scenario_reduction_ha: row.reductionHa,
    Mature_THLB_ha: row.matureThlbHa,
    Immature_THLB_ha: row.immatureThlbHa,
    Unknown_age_THLB_ha: row.unknownAgeThlbHa,
    In_deferral_THLB_ha: row.deferralThlbHa,
  }
}

export function pieceRecord(piece: Piece) {
  return {
    Area_ID: piece.areaId,
    Source: piece.source,
    Source_kind: piece.kind,
    THLB_factor: piece.factor,
    TSR_year: piece.year,
    Maturity: piece.maturity,
    Deferral: piece.deferral,
    Administrative_area: piece.admin,
    Piece_ha: piece.areaHa,
    Known_THLB_ha: piece.thlbHa,
    Missing_factor_ha: piece.factor === null ? piece.areaHa : 0,
  }
}

/** Rows are stratified together, so age/deferral/admin totals can be reconciled. */
export function breakdown(pieces: Piece[]) {
  const groups = new Map<string, ReturnType<typeof pieceRecord>>()
  for (const piece of pieces) {
    const key = JSON.stringify([
      piece.areaId,
      piece.kind,
      piece.source,
      piece.maturity,
      piece.deferral,
      piece.admin,
      piece.year,
    ])
    const row = groups.get(key)
    if (row) {
      row.Piece_ha += piece.areaHa
      row.Missing_factor_ha += piece.factor === null ? piece.areaHa : 0
      row.Known_THLB_ha =
        row.Known_THLB_ha === null && piece.thlbHa === null ? null : (row.Known_THLB_ha ?? 0) + (piece.thlbHa ?? 0)
    } else groups.set(key, { ...pieceRecord(piece), THLB_factor: null })
  }
  return [...groups.values()]
}

export function resultGeoJson(result: AnalysisResult): GeoJSON.FeatureCollection & { thlb_analysis: unknown[][] } {
  return {
    type: 'FeatureCollection',
    thlb_analysis: methodRows(result),
    features: result.pieces.map((piece) => ({
      type: 'Feature',
      geometry: multiPolygonToLngLat(piece.geometry),
      properties: { ...pieceRecord(piece), Synthetic_example: result.settings.demo },
    })),
  }
}

export function geodatabaseLayers(result: AnalysisResult): OutputLayer[] {
  const feature = (geometry: Piece['geometry'] | null, properties: GeoJSON.GeoJsonProperties): GeoJSON.Feature => ({
    type: 'Feature',
    geometry: geometry ? { type: 'MultiPolygon', coordinates: geometry } : (null as unknown as GeoJSON.Geometry),
    properties: { ...properties, Synthetic_example: result.settings.demo },
  })
  return [
    {
      name: 'Assessment_areas',
      features: result.areas.map((area, i) => feature(area.geometry, summaryRecord(result.rows[i]))),
    },
    { name: 'THLB_pieces', features: result.pieces.map((piece) => feature(piece.geometry, pieceRecord(piece))) },
    {
      name: 'THLB_union_pieces',
      features: result.combinedPieces.map((piece) => feature(piece.geometry, pieceRecord(piece))),
    },
    {
      name: 'THLB_summary',
      table: true,
      features: [...result.rows, result.combined].map((row) => feature(null, summaryRecord(row))),
    },
    {
      name: 'Method_QA',
      table: true,
      features: methodRows(result).map(([topic, detail]) => feature(null, { Topic: topic, Detail: detail })),
    },
  ]
}

export function methodRows(result: AnalysisResult, generatedAt = new Date()): unknown[][] {
  return [
    ['Dataset', result.settings.demo ? 'SYNTHETIC EXAMPLE — NOT REAL FORESTRY DATA' : 'User-supplied local datasets'],
    ['Generated UTC', generatedAt.toISOString()],
    [
      'Area calculation',
      'Planar EPSG:3005 hectares. Sum of intersection area × factor; coordinates read at millimetre precision; no analysis simplification.',
    ],
    [
      'Source precedence',
      'Official polygons first, including zero and missing factors; proxy fills uncovered ground only. Within a source, earlier imported features take precedence.',
    ],
    [
      'Missing values',
      'No source coverage is unknown. Missing official factors are excluded from known totals. Proxy null factors mean zero per catalogue metadata.',
    ],
    ['Combined total', 'Union of assessment polygons; never sum overlapping individual rows.'],
    [
      'Maturity',
      `PROJ_AGE_1 (or selected age field) ≥ ${result.settings.matureAge} years is mature. This threshold is a user assumption; no age projection is performed.`,
    ],
    [
      'Deferral interpretation',
      'Imported deferral polygons are treated as a complete binary mask within the assessment area. This is not an OGMA or a legal harvest prohibition.',
    ],
    [
      'Reduction scenario',
      result.settings.reductionPercent === null
        ? 'Not estimated: affected THLB only.'
        : `${result.settings.reductionPercent}% of known affected THLB. Uniform user assumption, not an AAC or timber volume estimate.`,
    ],
    [
      'Proxy limits',
      'Province-wide strategic estimate derived from a 100 m × 100 m raster, published as vector polygons. Not an operational assessment or equivalent to the official TSR compilation.',
    ],
    ['Proxy catalogue', THLB_SOURCES.proxy.catalogue],
    ['Proxy methodology', THLB_SOURCES.proxy.methodology],
    ['Official catalogue', THLB_SOURCES.official.catalogue],
    ...result.sources.map((source) => [
      'Input',
      `${source.role}: ${source.name} (${source.features} features read near assessment areas)`,
    ]),
    ...result.sources
      .filter((source) => source.fields)
      .map((source) => ['Field mapping', `${source.name}: ${JSON.stringify(source.fields)}`]),
    ...result.warnings.map((warning) => ['QA', warning]),
  ]
}

export async function buildWorkbook(result: AnalysisResult): Promise<ArrayBuffer> {
  const { default: ExcelJS } = await import('exceljs')
  const book = new ExcelJS.Workbook()
  book.creator = 'PG Maps'
  const add = (name: string, records: Record<string, unknown>[]) => {
    const sheet = book.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] })
    const keys = Object.keys(records[0] ?? {})
    sheet.columns = keys.map((key) => ({ header: key, key, width: key === 'Source' ? 44 : 24 }))
    records.forEach((record) => sheet.addRow(record))
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF166534' } }
    keys.forEach((key, index) => {
      if (/_ha$/.test(key)) sheet.getColumn(index + 1).numFmt = '0.0000'
    })
    if (keys.length) sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: keys.length } }
  }
  add('By assessment area', result.rows.map(summaryRecord))
  add('Combined union', [summaryRecord(result.combined)])
  add('Breakdown by area', breakdown(result.pieces))
  add('Breakdown union', breakdown(result.combinedPieces))
  add('Intersect pieces', result.pieces.map(pieceRecord))
  const method = book.addWorksheet('Method and QA')
  method.columns = [{ width: 26 }, { width: 110 }]
  methodRows(result).forEach((row) => {
    const added = method.addRow(row)
    added.alignment = { wrapText: true, vertical: 'top' }
  })
  return (await book.xlsx.writeBuffer()) as ArrayBuffer
}
