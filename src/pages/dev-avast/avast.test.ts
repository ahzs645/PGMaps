import { describe, expect, it } from 'vitest'
import { clusterBoxes, multiPolygonArea, rectangle } from './geometry'
import { candidatesFromGeoJson, guessCandidateFields, guessProjectName } from './inputs'
import { buildDensityIndex, overlayCandidate } from './overlay'
import { calibrate, coverageClass, DEFAULT_SETTINGS, summarize, COVERAGE_NOTES } from './report'
import { classifySlope, slopeClassPolygons, slopeGrid } from './slope'
import { runOverlay } from './run'
import { blockRow, blockRowsTsv, duplicateCheckFormula, reportedVolumeFormula } from './workbookRows'
import { buildWorkbook } from './excel'
import { geodatabaseLayers } from './outputs'
import { detectDatasets, layerGeoJson } from './gdal'
import type { AvastSettings, Candidate, CandidateRaw, DensityFeature, MultiPolygonCoords } from './types'

const box = (minX: number, minY: number, maxX: number, maxY: number): MultiPolygonCoords => [rectangle(minX, minY, maxX, maxY)]
const HA = 100 // a 100 m × 100 m square is one hectare

function candidate(key: string, geometry: MultiPolygonCoords, extra: Partial<Candidate> = {}): Candidate {
  const xs = geometry.flatMap((polygon) => polygon[0].map((point) => point[0]))
  const ys = geometry.flatMap((polygon) => polygon[0].map((point) => point[1]))
  return {
    key, id: key, operatingArea: 'Collins Davis', sourceType: '', fieldHa: null,
    geometryHa: multiPolygonArea(geometry) / 10_000, geometry,
    bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], sourceName: 'test.shp', ...extra,
  }
}

function density(fid: number, geometry: MultiPolygonCoords, value: number | null, extra: Partial<DensityFeature> = {}): DensityFeature {
  const xs = geometry.flatMap((polygon) => polygon[0].map((point) => point[0]))
  const ys = geometry.flatMap((polygon) => polygon[0].map((point) => point[1]))
  return {
    fid, density: value, slopePercent: null, operatingArea: 'Collins Davis', layerIndex: 0, geometry,
    bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], ...extra,
  }
}

const geometrySettings = { ...DEFAULT_SETTINGS, slopeSource: 'none' as const }

describe('Part 1 — AVAST volume', () => {
  // The SOP's CD_PB_01: 8.42 ha at 145, 12.67 ha at 178 and 4.15 ha at 210 m³/ha.
  const block = candidate('CD_PB_01', box(0, 0, 2524, 100))
  const avast = buildDensityIndex([
    density(1, box(0, 0, 842, 100), 145),
    density(2, box(842, 0, 2109, 100), 178),
    density(3, box(2109, 0, 2524, 100), 210),
    density(4, box(5000, 0, 6000, 100), 999), // elsewhere: must not be counted
  ])

  it('sums piece area × density, never one density × gross area', () => {
    const { raw, avastPieces } = overlayCandidate(block, avast, null, { source: 'none' }, geometrySettings)
    expect(avastPieces.map((piece) => Number(piece.areaHa.toFixed(2)))).toEqual([8.42, 12.67, 4.15])
    expect(avastPieces.map((piece) => Number(piece.volume.toFixed(1)))).toEqual([1220.9, 2255.3, 871.5])
    expect(raw.avast.coveredHa).toBeCloseTo(25.24, 6)
    expect(raw.avast.volume).toBeCloseTo(4347.7, 1)
  })

  it('reports the area-weighted density, not a simple mean', () => {
    const mixed = candidate('MIX', box(0, 0, 101 * HA, HA))
    const index = buildDensityIndex([density(1, box(0, 0, HA, HA), 300), density(2, box(HA, 0, 101 * HA, HA), 150)])
    const { raw } = overlayCandidate(mixed, index, null, { source: 'none' }, geometrySettings)
    const summary = summarize([mixed], new Map([[mixed.key, raw]]), { ...DEFAULT_SETTINGS, vphDecimals: 2 }, { avastLayerNames: ['AVAST'], lidarLayerNames: [], slopeAssessed: false })
    expect(summary.candidates[0].weightedAvastM3ha).toBeCloseTo(15_300 / 101, 6)
    expect(summary.candidates[0].preferredVph).toBe(151.49)
  })

  it('counts ground two AVAST sources share once, keeping the first', () => {
    const shared = candidate('EDGE', box(0, 0, 2 * HA, HA))
    const index = buildDensityIndex([
      density(1, box(0, 0, 2 * HA, HA), 100, { layerIndex: 0 }),
      density(1, box(HA, 0, 3 * HA, HA), 500, { layerIndex: 1 }),
    ])
    const { raw } = overlayCandidate(shared, index, null, { source: 'none' }, geometrySettings)
    expect(raw.avast.coveredHa).toBeCloseTo(2, 6)
    expect(raw.avast.volume).toBeCloseTo(200, 6)
    expect(raw.overlapHa).toBeCloseTo(1, 6)
  })

  it('classes coverage with the workbook wording', () => {
    expect(coverageClass(91, DEFAULT_SETTINGS)).toBe('good')
    expect(coverageClass(74.1, DEFAULT_SETTINGS)).toBe('moderate')
    expect(coverageClass(56.4, DEFAULT_SETTINGS)).toBe('low')
    expect(coverageClass(4.3, DEFAULT_SETTINGS)).toBe('none')
    expect(COVERAGE_NOTES.good).toBe('Good AVAST coverage. Volume estimate is considered suitable for first-pass screening.')
  })
})

describe('Part 2 — LiDAR factor', () => {
  it('derives the aggregate factor, weighting blocks by volume', () => {
    const a = candidate('A', box(0, 0, HA, HA))
    const b = candidate('B', box(2 * HA, 0, 3 * HA, HA))
    const raws = new Map<string, CandidateRaw>([
      ['A', { key: 'A', avast: { coveredHa: 1, volume: 10_000, pieceCount: 1, nullDensityHa: 0, byClass: null, operatingArea: '', layers: [0] }, lidar: null, common: { areaHa: 1, avastVolume: 10_000, lidarVolume: 7_800 }, overlapHa: 0, warnings: [] }],
      ['B', { key: 'B', avast: { coveredHa: 1, volume: 50_000, pieceCount: 1, nullDensityHa: 0, byClass: null, operatingArea: '', layers: [0] }, lidar: null, common: { areaHa: 1, avastVolume: 50_000, lidarVolume: 41_000 }, overlapHa: 0, warnings: [] }],
    ])
    const result = calibrate([a, b], raws, { calibrationMinCoveragePct: 95, calibrationOperatingAreas: [] })
    expect(result.factor).toBeCloseTo(48_800 / 60_000, 10)
    expect(result.factor).not.toBeCloseTo(0.8, 3)
  })

  it('adjusts AVAST blocks, uses LiDAR directly where it covers, and never adjusts LiDAR', () => {
    const covered = candidate('BW1702', box(0, 0, HA, HA), { operatingArea: 'Blackwater' })
    const uncovered = candidate('CD_PB_01', box(10 * HA, 0, 11 * HA, HA))
    const avast = buildDensityIndex([density(1, box(0, 0, HA, HA), 250), density(2, box(10 * HA, 0, 11 * HA, HA), 200)])
    const lidar = buildDensityIndex([density(7, box(0, 0, HA, HA), 203)])
    const raws = new Map<string, CandidateRaw>()
    for (const block of [covered, uncovered]) raws.set(block.key, overlayCandidate(block, avast, lidar, { source: 'none' }, geometrySettings).raw)
    const settings: AvastSettings = { ...DEFAULT_SETTINGS, lidarMode: 'factor', lidarFactor: 0.8093 }
    const summary = summarize([covered, uncovered], raws, settings, { avastLayerNames: ['AVAST'], lidarLayerNames: ['LiDAR'], slopeAssessed: false })
    const [direct, adjusted] = summary.candidates
    expect(direct.volumeSource).toBe('LiDAR')
    expect(direct.finalVolume).toBeCloseTo(203, 6)
    expect(direct.avastRawVolume).toBeCloseTo(250, 6)
    expect(adjusted.volumeSource).toBe('AVAST - LiDAR Adjusted')
    expect(adjusted.finalVolume).toBeCloseTo(200 * 0.8093, 6)
    // The factor changes volume, never area.
    expect(adjusted.avastCoveredHa).toBeCloseTo(1, 6)
  })

  it('compares AVAST and LiDAR over exactly the same footprint', () => {
    const block = candidate('BW', box(0, 0, 4 * HA, HA))
    const avast = buildDensityIndex([density(1, box(0, 0, 4 * HA, HA), 200)])
    const lidar = buildDensityIndex([density(1, box(0, 0, 3 * HA, HA), 160)]) // LiDAR misses a quarter
    const { raw } = overlayCandidate(block, avast, lidar, { source: 'none' }, geometrySettings)
    expect(raw.common?.areaHa).toBeCloseTo(3, 6)
    expect(raw.common!.lidarVolume / raw.common!.avastVolume).toBeCloseTo(0.8, 10)
  })
})

describe('Part 3 — slope classes', () => {
  it('puts 35% and 45% in the middle class, as the SOP documents', () => {
    expect(classifySlope(34.99, [35, 45])).toBe(1)
    expect(classifySlope(35, [35, 45])).toBe(2)
    expect(classifySlope(45, [35, 45])).toBe(2)
    expect(classifySlope(45.01, [35, 45])).toBe(3)
  })

  it('measures percent rise on a plane and polygonises the classes', () => {
    const grid = slopeGrid([0, 0, 400, 200], 20, (x) => 0.4 * x, [35, 45])
    expect(grid.percent[5]).toBeCloseTo(40, 6)
    const classes = slopeClassPolygons(grid)
    expect(multiPolygonArea(classes[2])).toBeCloseTo(400 * 200, 3)
    expect(classes[1]).toEqual([])
  })

  it('splits volume by DEM class and reconciles to the total', async () => {
    // Gentle on the west half, steep on the east: z = 0.1x, then 0.6x.
    const block = candidate('S1', box(0, 0, 400, 200))
    const surface = (x: number) => (x < 200 ? 0.1 * x : 20 + 0.6 * (x - 200))
    const results: CandidateRaw[] = []
    await runOverlay({
      candidates: [block],
      avast: [density(1, box(0, 0, 400, 200), 150)],
      lidar: [],
      settings: { ...geometrySettings, slopeSource: 'dem', slopeCellMeters: 20 },
      elevation: async () => ({ elevationAt: (x) => surface(x), missingTiles: 0 }),
      onCandidate: ({ overlay }) => { results.push(overlay.raw) },
    })
    const totals = results[0].avast.byClass!
    expect(totals.volume.reduce((sum, value) => sum + value, 0) + totals.unclassifiedVolume).toBeCloseTo(results[0].avast.volume, 3)
    expect(totals.areaHa[0]).toBeGreaterThan(3.5)
    expect(totals.areaHa[2]).toBeGreaterThan(3.5)
  })

  it('applies the factor per class and reports the <35% portion when asked', () => {
    const block = candidate('S2', box(0, 0, 2 * HA, HA))
    const avast = buildDensityIndex([
      density(1, box(0, 0, HA, HA), 100, { slopePercent: 20 }),
      density(2, box(HA, 0, 2 * HA, HA), 300, { slopePercent: 60 }),
    ])
    const { raw } = overlayCandidate(block, avast, null, { source: 'attribute' }, { ...geometrySettings, slopeSource: 'attribute' })
    const settings: AvastSettings = { ...DEFAULT_SETTINGS, lidarMode: 'factor', lidarFactor: 0.5, volumeBasis: 'class1' }
    const [row] = summarize([block], new Map([[block.key, raw]]), settings, { avastLayerNames: ['AVAST'], lidarLayerNames: [], slopeAssessed: true }).candidates
    expect(row.classVolume).toEqual([50, 0, 150])
    expect(row.reportedVolume).toBe(50)
    expect(row.preferredVph).toBe(50)
  })
})

describe('inputs and outputs', () => {
  it('guesses the Dunkley shapefile fields', () => {
    const fields = ['FID_blocks', 'OBJECTID', 'LICENSEE', 'BLOCK_ID', 'MERCH_AREA', 'BCTS_OPER', 'OPERATING_']
    expect(guessCandidateFields(fields)).toEqual({ idField: 'BLOCK_ID', operatingAreaField: 'OPERATING_', areaField: 'MERCH_AREA', sourceTypeField: null })
    expect(guessProjectName(['Dunkley_PG.shp', 'Dunkley_Tsn.shp'])).toBe('Dunkley')
    expect(guessCandidateFields(['Shape_Leng', 'Shape_Area', 'Blob_ID', 'OA', 'Gross_Ha']).idField).toBe('Blob_ID')
    expect(guessCandidateFields(['Shape_Leng', 'OBJECTID', 'Unit']).idField).toBe('Unit')
  })

  it('drops non-positive merch areas so the polygon area is used', () => {
    const { candidates } = candidatesFromGeoJson({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', id: 3, properties: { BLOCK_ID: 'CH1', MERCH_AREA: 0 }, geometry: { type: 'Polygon', coordinates: box(0, 0, HA, HA)[0] } }],
    }, { idField: 'BLOCK_ID', operatingAreaField: null, areaField: 'MERCH_AREA', sourceTypeField: null }, 'b.shp', 'b')
    expect(candidates[0].fieldHa).toBeNull()
    expect(candidates[0].geometryHa).toBeCloseTo(1, 6)
  })

  it('merges overlapping read boxes', () => {
    expect(clusterBoxes([[0, 0, 10, 10], [15, 0, 20, 10], [100, 100, 110, 110]], 5)).toHaveLength(2)
  })

  it('writes the sheet formulas for the rows a paste lands on', () => {
    expect(reportedVolumeFormula(63)).toBe('IF(F63<>"",F63,IF(AND(ISNUMBER(D63),ISNUMBER(E63)),D63*E63,""))')
    expect(duplicateCheckFormula(63)).toBe('IF(B63="","",IF(COUNTIF($B$6:B63,B63)>1,"DUPLICATE","OK"))')
    const tsv = blockRowsTsv([
      { operatingArea: 'Buffalohead', blockId: 'BH1432', merchHa: 36.681302, avastHa: 35.010844, preferredVph: 278, directVolume: 9745.776890, estimateSource: 'AVAST estimate', notes: 'Good\tcoverage', avastReference: 9745.776890 },
    ], { startRow: 63, formulas: true })
    const cells = tsv.split('\t')
    expect(cells).toHaveLength(11)
    expect(cells[6]).toBe('=IF(F63<>"",F63,IF(AND(ISNUMBER(D63),ISNUMBER(E63)),D63*E63,""))')
    expect(cells[8]).toBe('Good coverage')
  })

  it('builds the workbook in the Dunkley layout and the geodatabase layers', async () => {
    const blocks = [candidate('BH1432', box(0, 0, 2 * HA, HA), { operatingArea: 'Buffalohead', fieldHa: 2.1 }), candidate('BH1432', box(5 * HA, 0, 6 * HA, HA), { key: 'dup', operatingArea: 'Buffalohead' })]
    const index = buildDensityIndex([density(1, box(0, 0, 6 * HA, HA), 278)])
    const overlays = blocks.map((block) => overlayCandidate(block, index, null, { source: 'none' }, geometrySettings))
    const raws = new Map(overlays.map((overlay) => [overlay.raw.key, overlay.raw]))
    const settings = { ...DEFAULT_SETTINGS, projectName: 'Dunkley', slopeSource: 'none' as const }
    const summary = summarize(blocks, raws, settings, { avastLayerNames: ['PG_Avast'], lidarLayerNames: [], slopeAssessed: false })
    expect(summary.totals.blocks).toBe(1)
    expect(summary.qa.join(' ')).toMatch(/Duplicate Block IDs/)
    const buffer = await buildWorkbook(summary, settings, {
      projectName: 'Dunkley', candidateSources: ['test.shp'], avastLayerNames: ['PG_Avast'], lidarLayerNames: [], densityField: 'CMM_m3ha',
      lidarDensityField: null, slopeDescription: null, generatedAt: new Date('2026-10-19T12:00:00Z'),
      avastPieces: overlays.flatMap((overlay) => overlay.avastPieces), candidateIds: new Map(blocks.map((block) => [block.key, { id: block.id, operatingArea: block.operatingArea }])),
    })
    const { default: ExcelJS } = await import('exceljs')
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer)
    expect(workbook.worksheets.map((sheet) => sheet.name).slice(0, 3)).toEqual(['Management Summary', 'Block Volume Inputs', 'Method & QA'])
    const inputs = workbook.getWorksheet('Block Volume Inputs')!
    expect(inputs.getRow(5).values).toEqual([undefined, 'Operating Area', 'Block ID', 'Merch Area (ha)', 'AVAST Area (ha)', 'Preferred VPH (m³/ha)', 'Direct Est. Vol (m³)', 'Reported Gross Vol (m³)', 'Estimate Source', 'Constraints / Planning Notes', 'AVAST-only Ref. (m³)', 'Duplicate Check'])
    expect(inputs.getCell('B6').value).toBe('BH1432')
    expect(inputs.getCell('C6').value).toBe(2.1)
    expect(inputs.getCell('F6').value).toBeCloseTo(556, 6)
    expect((inputs.getCell('K7').value as { formula: string }).formula).toBe(duplicateCheckFormula(7))
    const management = workbook.getWorksheet('Management Summary')!
    expect(management.getCell('A6').value).toBe('Buffalohead')
    expect((management.getCell('C6').value as { formula: string }).formula).toContain('SUMIFS(\'Block Volume Inputs\'!$G$6')
    expect(blockRow(summary.candidates[0]).blockId).toBe('BH1432')

    const layers = geodatabaseLayers({ project: 'Dunkley', candidates: blocks, summary, pieces: { avastPieces: overlays.flatMap((overlay) => overlay.avastPieces), avastSlopePieces: [], lidarPieces: [], lidarSlopePieces: [], commonPieces: [], slopeClasses: new Map() }, settings, densityField: 'CMM_m3ha', lidarDensityField: null, avastLayerNames: ['PG_Avast'], lidarLayerNames: [] })
    expect(layers.map((layer) => layer.name)).toEqual(['Dunkley_Candidates', 'Dunkley_AVAST_Volume_Intersect'])
    expect(layers[1].features[0].properties).toMatchObject({ Candidate_ID: 'BH1432', CMM_m3ha: 278, Piece_HA: 2 })
  })

  it('types geodatabase columns from the values, not the first row', () => {
    const json = layerGeoJson({ name: 'T', integers: ['AVAST_FID'], features: [
      { type: 'Feature', geometry: null as never, properties: { AVAST_FID: 3, VPH: 278, Factor: null, Empty: null } },
      { type: 'Feature', geometry: null as never, properties: { AVAST_FID: 4, VPH: 12.5, Factor: 0.8093, Empty: null } },
    ] })
    expect(json).toContain('"AVAST_FID":3,')
    expect(json).toContain('"VPH":278.0')
    expect(json).not.toContain('Empty')
  })

  it('finds .gdb folders and shapefiles in a picked folder, skipping other deliverables', () => {
    const file = (path: string) => ({ path, file: new File([], path.split('/').pop()!) })
    const datasets = detectDatasets([
      file('New Folder/PG_Avast_June30_2026.gdb/a00000001.gdbtable'),
      file('New Folder/PG_Avast_June30_2026.gdb/gdb'),
      file('New Folder/AvastData_TPG_June30.xlsx'),
      file('New Folder/TPG_AVAST_Results_June2026.pbix'),
      file('dunkley/Dunkley_PG.shp'),
      file('dunkley/Dunkley_PG.dbf'),
      file('dunkley/Dunkley_PG.shx'),
      file('dunkley/Dunkley_PG.shp.LOBBCTSPNG55.11740.10600.sr.lock'),
    ], 't')
    expect(datasets.map((dataset) => [dataset.kind, dataset.label, dataset.files.length])).toEqual([
      ['gdb', 'PG_Avast_June30_2026.gdb', 2],
      ['shapefile', 'Dunkley_PG.shp', 3],
    ])
  })

  it('folds the audit-adjusted VRI fill into Direct Est. Vol and hides zeros', async () => {
    const block = candidate('BH1432', box(0, 0, 2 * HA, HA), { operatingArea: 'Buffalohead' })
    const empty = candidate('BH1499', box(5 * HA, 0, 6 * HA, HA), { operatingArea: 'Buffalohead' })
    const index = buildDensityIndex([density(1, box(0, 0, HA, HA), 278)])
    const overlays = [block, empty].map((item) => overlayCandidate(item, index, null, { source: 'none' }, geometrySettings))
    const settings = { ...DEFAULT_SETTINGS, projectName: 'Dunkley', slopeSource: 'none' as const }
    const summary = summarize([block, empty], new Map(overlays.map((overlay) => [overlay.raw.key, overlay.raw])), settings, { avastLayerNames: ['PG_Avast'], lidarLayerNames: [], slopeAssessed: false })
    const buffer = await buildWorkbook(summary, settings, {
      projectName: 'Dunkley', candidateSources: [], avastLayerNames: ['PG_Avast'], lidarLayerNames: [], densityField: 'CMM_m3ha',
      lidarDensityField: null, slopeDescription: null, generatedAt: new Date('2026-10-19T12:00:00Z'), avastPieces: overlays.flatMap((overlay) => overlay.avastPieces),
      candidateIds: new Map([block, empty].map((item) => [item.key, { id: item.id, operatingArea: item.operatingArea }])),
      vri: { rows: new Map([[block.key, { avastVolume: 278, withVriAudit: 467 }]]), description: 'Test rules.' },
    })
    const { default: ExcelJS } = await import('exceljs')
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer)
    const inputs = workbook.getWorksheet('Block Volume Inputs')!
    expect(inputs.getCell('L5').value).toBeNull()
    expect(inputs.getCell('F6').value).toBeCloseTo(467, 6)
    expect(inputs.getCell('J6').value).toBeCloseTo(278, 6)
    expect(inputs.getCell('E6').value).toBe(234)
    expect(String(inputs.getCell('H6').value)).toContain('VRI fill (audit-adjusted)')
    // The empty block keeps its 0 values but shows them blank.
    expect(inputs.getCell('F7').value).toBe(0)
    expect(inputs.getCell('F7').numFmt).toBe('#,##0;-#,##0;')
    const management = workbook.getWorksheet('Management Summary')!
    expect((management.getCell('C6').value as { result: number }).result).toBeCloseTo(467, 6)
  })
})
