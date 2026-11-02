import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import JSZip from 'jszip'
import { fromArrayBuffer } from 'geotiff'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  castorConfig,
  castorCsvRows,
  createExampleProject,
  importCastorFiles,
  importCastorSqlite,
  parseCastorProject,
  projectFromCastorDatabase,
  requireCastorProject,
} from './inputs'
import { CASTOR_SAMPLE_SHA256, castorProjectFromTables, inputNumber, type CastorInputTables } from './inputTables'
import { parseLegacyPredicate } from './legacyPredicates'
import { matchesPredicate } from './constraints'
import { encodeCastorGeoTiff } from './geotiff'
import {
  CASTOR_METRICS,
  castorCsvCell,
  castorGeoTiff,
  castorHtmlReport,
  castorLandingsGeoJson,
  castorReportBundle,
  castorReportCsv,
  castorSpatialGeoJson,
  type CastorMetric,
} from './outputs'
import { CASTOR_MODEL_VERSION, type CastorProject, type CastorResult } from './types'
import { runCastor } from './engine'

const sample = readFileSync(new URL('../../../public/data/forestry-castor/simple_castordb.sqlite', import.meta.url))
const sampleBuffer = () => new Uint8Array(sample).buffer
let sqlite: SqlJsStatic

beforeAll(async () => {
  sqlite = await initSqlJs({
    wasmBinary: new Uint8Array(
      readFileSync(new URL('../../../node_modules/sql.js/dist/sql-wasm.wasm', import.meta.url)),
    ).buffer,
  })
})

function float64Values(value: unknown): number[] {
  expect(value).toBeInstanceOf(Float64Array)
  if (!(value instanceof Float64Array)) throw new Error('Expected a Float64 raster')
  return Array.from(value)
}

function normalizedTables(): CastorInputTables {
  return {
    pixels: castorCsvRows(
      'id,blockId,compartment,areaHa,thlbHa,owned,age,volume,height,eca,distance,salvageVolume,curveId,zone:watershed\n' +
        '7,B1,north,1.5,0.75,true,80,220.125,24,0.1,300,20,natural,upper\n' +
        '9,B2,north,2,0,false,120,310.5,29,0.05,600,0,natural,upper\n',
    ),
    yields: castorCsvRows(
      'curveId,age,volume,height,eca\nnatural,0,0,0,1\nnatural,100,300,30,0.1\nnatural,200,450,40,0.05\n',
    ),
    constraints: castorCsvRows(
      'id,zone,zoneId,type,variable,threshold,percentage,multi_condition,denom\n' +
        'old,watershed,upper,ge,age,100,25,,thlb > 0\n',
    ),
    harvestFlow: castorCsvRows(
      'id,compartment,period,targetM3,type,partition\nf1,north,1,200,live,vol >= 150 AND own = 1\n',
    ),
  }
}

/** Deliberately independent output fixture: arbitrary IDs and noncontiguous cells. */
function spatialFixture(): { project: CastorProject; result: CastorResult } {
  const project = createExampleProject()
  project.name = 'Precision and no-data fixture'
  project.grid = { width: 3, height: 2, originX: 1170000, originY: 844000, cellSize: 100, crs: 'EPSG:3005' }
  project.pixels = project.pixels.slice(0, 3).map((pixel, i) => {
    const gridIndex = [5, 0, 2][i]
    return {
      ...pixel,
      id: [42, 7, 99][i],
      blockId: `B${i}`,
      compartment: 'all',
      gridIndex,
      areaHa: 1,
      thlbHa: 1,
      volume: [1234.5678901234567, 0, 0.000000123456789][i],
      x: 1170000 + ((gridIndex % 3) + 0.5) * 100,
      y: 844000 - (Math.floor(gridIndex / 3) + 0.5) * 100,
      zones: {},
    }
  })
  project.constraints = []
  project.harvestFlows = []
  project.adjacency = []
  project.landings = [{ blockId: 'B0', pixelId: 42 }]
  const config = castorConfig(project, { periods: 1, initializeFromYield: false })
  project.config = config
  const result: CastorResult = {
    modelVersion: CASTOR_MODEL_VERSION,
    scenario: config.scenario,
    config,
    warnings: [],
    assumptions: ['Independent serialization fixture'],
    harvestReport: [],
    growingStockReport: [],
    zoneManagement: [],
    harvestPixelList: [],
    harvestBlockList: [],
    salvageReport: [],
    uncertainty: [],
    landings: [
      { period: 1, year: 2030, elapsedYears: 5, blockId: 'B0', pixelId: 42, x: 1170250, y: 843850, source: 'provided' },
    ],
    finalPixels: structuredClone(project.pixels),
    snapshots: [
      {
        period: 1,
        year: 2030,
        elapsedYears: 5,
        age: [45, 0, 100],
        volume: project.pixels.map((pixel) => pixel.volume),
        height: [15.125, 0, 30.5],
        eca: [0.1, 1, 0.05],
        harvestedYear: [2030, null, 2025],
        harvestedVolumeM3: [300.125, 0, 33.333333333333336],
        constrained: [0, 1, 1],
        constrainedPeriods: [0, 1, 1],
        constrainedYears: [0, 5, 5],
      },
    ],
    summary: {
      initialStockM3: 1500.5,
      finalStockM3: 1234.5678902469135,
      harvestedM3: 333.4583333333333,
      harvestedAreaHa: 2,
      targetM3: 400,
      shortfallM3: 66.54166666666669,
    },
  }
  return { project, result }
}

describe('Castor original SQLite and table import', () => {
  it('reads the exact public 10,000-cell SQLite sample through real SQLite Wasm', async () => {
    expect(sample.byteLength).toBe(696320)
    expect(createHash('sha256').update(sample).digest('hex')).toBe(CASTOR_SAMPLE_SHA256)
    const project = await importCastorSqlite(sampleBuffer(), 'Original sample', sqlite)
    expect(project.pixels).toHaveLength(10000)
    expect(project.yieldCurves).toHaveLength(1)
    expect(project.yieldCurves[0].points).toHaveLength(26)
    expect(project.grid).toEqual({
      width: 100,
      height: 100,
      originX: 1170000,
      originY: 844000,
      cellSize: 100,
      crs: 'EPSG:3005',
    })
    expect(project.pixels[0]).toMatchObject({
      id: 1,
      gridIndex: 0,
      areaHa: 1,
      thlbHa: 1,
      x: 1170050,
      y: 843950,
      age: 141,
      blockId: 'pixel-1',
      curveId: '1',
      zones: { zone1: '1' },
    })
    expect(project.pixels[9999]).toMatchObject({ id: 10000, gridIndex: 9999, x: 1179950, y: 834050 })
    expect(project.constraints[0]).toMatchObject({ variable: 'age', threshold: 140, percentage: 0 })
    expect(project.harvestFlows).toEqual([])
    expect(project.adjacency).toEqual([])
    expect(project.config?.initializeFromYield).toBe(true)
    expect(project.provenance.notes.join(' ')).toMatch(/10000 missing initial volumes/)
    expect(project.provenance.notes.join(' ')).toMatch(/not operational harvest blocks/)
    expect(project.provenance.source).toBe('Local SQLite castordb')
    expect(project.provenance.url).toBeUndefined()
  })

  it('rejects a false header, damaged SQLite body, and changed legacy cell scale', async () => {
    await expect(
      importCastorSqlite(new TextEncoder().encode('not a database').buffer, 'invalid', sqlite),
    ).rejects.toThrow(/SQLite 3/)
    const damaged = sampleBuffer().slice(0, 128)
    await expect(importCastorSqlite(damaged, 'truncated', sqlite)).rejects.toThrow()
    const db = new sqlite.Database(new Uint8Array(sampleBuffer()))
    try {
      db.run('UPDATE raster_info SET xmax=xmin+5000, ymax=ymin+5000')
      expect(() => projectFromCastorDatabase(db, 'wrong scale')).toThrow(/100 m/)
    } finally {
      db.close()
    }
  })

  it('takes the original database through growth and harvest without mutating imported inputs', async () => {
    const project = await importCastorSqlite(sampleBuffer(), 'Original sample integration', sqlite)
    project.harvestFlows = [
      {
        id: 'reviewed-example-flow',
        compartment: 'all',
        period: 1,
        targetM3: 220000,
        type: 'live',
        condition: { field: 'volume', op: 'gt', value: 110 },
      },
    ]
    const before = JSON.stringify(project.pixels)
    const result = runCastor(project, castorConfig(project, { periods: 1 }))
    expect(result.snapshots.map((state) => state.period)).toEqual([0, 1])
    // Independently calculated from the public 140/150-year knots: 885.8 + .1 * 38.4.
    expect(result.snapshots[0].volume[0]).toBeCloseTo(889.64, 10)
    expect(result.snapshots[0].height[0]).toBeCloseTo(36.09, 10)
    expect(result.summary.harvestedM3).toBeGreaterThan(200000)
    expect(result.summary.harvestedM3).toBeLessThanOrEqual(220000)
    expect(result.harvestPixelList.length).toBeGreaterThan(0)
    expect(result.harvestPixelList.every((event) => event.volumeM3 > 0 && event.areaHa === 1)).toBe(true)
    expect(JSON.stringify(project.pixels)).toBe(before)
    const raster = await (
      await fromArrayBuffer(await (await castorGeoTiff(project, result, 1, 'volume')).arrayBuffer())
    ).getImage()
    expect(raster.getBoundingBox()).toEqual([1170000, 834000, 1180000, 844000])
    expect((await raster.readRasters({ interleave: true })).length).toBe(10000)
  })

  it('retains supplied normalized areas, non-integer values, predicates and ownership', () => {
    const project = requireCastorProject(castorProjectFromTables(normalizedTables(), 'CSV inventory'))
    expect(project.grid).toBeUndefined()
    expect(project.pixels[0]).toMatchObject({
      id: 7,
      areaHa: 1.5,
      thlbHa: 0.75,
      volume: 220.125,
      owned: true,
      zones: { watershed: 'upper' },
    })
    expect(project.pixels[1]).toMatchObject({ id: 9, thlbHa: 0, owned: false })
    expect(project.constraints[0].denominator).toEqual({ field: 'thlbHa', op: 'gt', value: 0 })
    expect(matchesPredicate(project.pixels[0], project.harvestFlows[0].condition!)).toBe(true)
    expect(matchesPredicate(project.pixels[1], project.harvestFlows[0].condition!)).toBe(false)
    expect(project.config?.initializeFromYield).toBe(false)
  })

  it('supports quoted multiline CSV and rejects duplicate headers and incomplete rows', () => {
    expect(castorCsvRows('\uFEFFid,note\r\n1,"old, ""retained""\nstand"\r\n')).toEqual([
      { id: '1', note: 'old, "retained"\nstand' },
    ])
    for (const source of ['id,ID\n1,2', 'id,note\n1', 'id,note\n1,"unclosed', 'id,note\n1,"x"oops'])
      expect(() => castorCsvRows(source)).toThrow()
    for (const value of ['', ' ', 'Infinity', '1e999', '0x10', null, false])
      expect(() => inputNumber(value, 'required number')).toThrow()
    expect(inputNumber('0', 'zero')).toBe(0)
    expect(inputNumber('-2.5e-2', 'decimal')).toBe(-0.025)
  })

  it('imports normalized CSV files together without inventing a grid or coordinates', async () => {
    const tables = normalizedTables()
    const inventory = [
      'id,blockId,compartment,areaHa,thlbHa,owned,age,volume,height,eca,distance,salvageVolume,curveId',
      '7,B1,north,1.5,0.75,true,80,220.125,24,0.1,300,20,natural',
    ].join('\n')
    const yields = 'curveId,age,volume,height\nnatural,0,0,0\nnatural,100,300,30'
    const project = await importCastorFiles([new File([inventory], 'inventory.csv'), new File([yields], 'yields.csv')])
    expect(project.pixels[0].volume).toBe(Number(tables.pixels[0].volume))
    expect(project.pixels[0].x).toBeUndefined()
    expect(project.grid).toBeUndefined()
    await expect(
      importCastorFiles([new File([inventory], 'inventory.csv'), new File([inventory], 'pixels.csv')]),
    ).rejects.toThrow(/Duplicate/)
  })

  it('requires actual yield data to initialize missing volume and rejects duplicate pixel IDs', () => {
    const missing = normalizedTables()
    missing.pixels[0].volume = ''
    delete missing.yields
    expect(() => castorProjectFromTables(missing, 'missing values')).toThrow(/observed volume or a valid yield curve/)
    const duplicated = normalizedTables()
    duplicated.pixels[1].id = duplicated.pixels[0].id
    expect(() => requireCastorProject(castorProjectFromTables(duplicated, 'duplicate'))).toThrow(/Duplicate pixel id/)
  })

  it('refuses an active legacy partial treatment without sufficient transition evidence', () => {
    const db = new sqlite.Database(new Uint8Array(sampleBuffer()))
    try {
      db.run('UPDATE pixels SET silvsystem=2, yieldid_trans=NULL WHERE pixelid=1')
      expect(() => projectFromCastorDatabase(db, 'incomplete partial treatment')).toThrow(/partial|transition|curve/i)
    } finally {
      db.close()
    }
  })

  it('validates geography from normalized project JSON as well as GeoJSON imports', () => {
    const project = createExampleProject()
    project.pixels[0].geometry = { type: 'Point', coordinates: [181, 53] }
    expect(() => parseCastorProject(JSON.stringify(project))).toThrow(/geometry|longitude|WGS84|coordinates/i)
  })
})

describe('restricted legacy predicates', () => {
  it('preserves compound logic and translates original Castor field names', () => {
    const predicate = parseLegacyPredicate(
      "(age BETWEEN 40 AND 120 AND own=1) OR (yieldid IN (1, '2') AND NOT vol < 150)",
    )!
    const pixel = spatialFixture().project.pixels[0]
    expect(matchesPredicate({ ...pixel, age: 80, owned: true, curveId: 'other', volume: 0 }, predicate)).toBe(true)
    expect(matchesPredicate({ ...pixel, age: 180, owned: true, curveId: '2', volume: 200 }, predicate)).toBe(true)
    expect(matchesPredicate({ ...pixel, age: 180, owned: false, curveId: '3', volume: 200 }, predicate)).toBe(false)
    expect(parseLegacyPredicate('thlb > 0 AND', true)).toEqual({ field: 'thlbHa', op: 'gt', value: 0 })
  })

  it('rejects arbitrary SQL, function calls, arithmetic and nonfinite constants', () => {
    for (const source of [
      'vol > 1; DROP TABLE pixels',
      'age IN (SELECT age FROM pixels)',
      'sqlite_version() = 1',
      'salvage_vol/(vol+salvage_vol) >= 0.5',
      'age > 0 -- comment',
      '1e999 = 1e999',
    ])
      expect(() => parseLegacyPredicate(source)).toThrow()
  })
})

describe('Castor spatial and complete report exports', () => {
  it('round-trips real Float64 GeoTIFF bytes, grid placement, CRS, extent and no-data', async () => {
    const { project, result } = spatialFixture()
    const blob = await castorGeoTiff(project, result, 1, 'volume')
    const image = await (await fromArrayBuffer(await blob.arrayBuffer())).getImage()
    expect(image.getWidth()).toBe(3)
    expect(image.getHeight()).toBe(2)
    expect(image.getGeoKeys()).toMatchObject({
      GTModelTypeGeoKey: 1,
      GTRasterTypeGeoKey: 1,
      ProjectedCSTypeGeoKey: 3005,
      ProjLinearUnitsGeoKey: 9001,
    })
    expect(image.getBoundingBox()).toEqual([1170000, 843800, 1170300, 844000])
    expect(image.getOrigin()).toEqual([1170000, 844000, 0])
    expect(image.getGDALNoData()).toBe(-9999)
    const values = await image.readRasters({ interleave: true })
    expect(float64Values(values)).toEqual([0, -9999, 0.000000123456789, -9999, -9999, 1234.5678901234567])
    const description = String(image.fileDirectory.ImageDescription).replace(/\0$/, '')
    expect(JSON.parse(description)).toMatchObject({ metric: 'volume', units: 'm³/ha', period: 1 })
  })

  it('keeps unharvested cells no-data while preserving genuine zeros for other metrics', async () => {
    const { project, result } = spatialFixture()
    const image = await (
      await fromArrayBuffer(await (await castorGeoTiff(project, result, 1, 'harvestYear')).arrayBuffer())
    ).getImage()
    expect(float64Values(await image.readRasters({ interleave: true }))).toEqual([
      -9999, -9999, 2025, -9999, -9999, 2030,
    ])
    expect(() => encodeCastorGeoTiff(project.grid!, [1], 'invalid')).toThrow(/match a grid/)
    expect(() => encodeCastorGeoTiff(project.grid!, [1, 2, 3, 4, 5, Number.NaN], 'invalid')).toThrow(/finite/)
    expect(() => encodeCastorGeoTiff({ ...project.grid!, crs: 'EPSG:4326' }, [1, 2, 3, 4, 5, 6], 'invalid')).toThrow(
      /projected/,
    )
  })

  it('exports cell footprints by gridIndex, not pixel IDs, and transforms landings', () => {
    const { project, result } = spatialFixture()
    const spatial = castorSpatialGeoJson(project, result, 1, 'volume')
    expect(spatial.features.map((feature) => feature.id)).toEqual([42, 7, 99])
    expect(spatial.features[0].properties?.value).toBe(1234.5678901234567)
    for (const feature of spatial.features) {
      expect(feature.geometry.type).toBe('Polygon')
      if (feature.geometry.type !== 'Polygon') throw new Error('Expected cell polygon')
      const ring = feature.geometry.coordinates[0]
      expect(ring).toHaveLength(5)
      expect(ring[0]).toEqual(ring[4])
      expect(ring.every(([lon, lat]) => lon > -130 && lon < -115 && lat > 48 && lat < 60)).toBe(true)
    }
    const landings = castorLandingsGeoJson(project, result)
    expect(landings.features).toHaveLength(1)
    expect(landings.features[0].geometry.coordinates[0]).toBeLessThan(-115)
    expect(landings.features[0].properties?.status).toBe('Provided planning landing')
    expect(castorLandingsGeoJson(project, result, 99).features).toHaveLength(0)
  })

  it('never invents a projection for ungeoreferenced inputs or an unknown EPSG code', async () => {
    const { project, result } = spatialFixture()
    delete project.grid
    expect(castorSpatialGeoJson(project, result, 1, 'age').features).toEqual([])
    expect(castorLandingsGeoJson(project, result).features).toEqual([])
    await expect(castorGeoTiff(project, result, 1, 'age')).rejects.toThrow(/regular grid/)
    project.pixels[0].geometry = { type: 'Point', coordinates: [-122.75, 53.91] }
    expect(castorSpatialGeoJson(project, result, 1, 'age').features[0].geometry).toEqual(project.pixels[0].geometry)
    project.grid = { width: 3, height: 2, originX: 0, originY: 200, cellSize: 100, crs: 'EPSG:99999' }
    expect(() => castorSpatialGeoJson(project, result, 1, 'age')).toThrow(/no coordinate definition/)
  })

  it('escapes user text in HTML and spreadsheet formulas without changing numeric cells', () => {
    const { project, result } = spatialFixture()
    const malicious = '<img src=x onerror="alert(1)">'
    project.name = malicious
    project.description = '<script>alert(1)</script>'
    project.provenance.notes.push(malicious)
    result.scenario = malicious
    result.warnings.push(malicious)
    const html = castorHtmlReport(project, result)
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<script')
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(castorCsvCell('=SUM(1,2)')).toBe('"\'=SUM(1,2)"')
    expect(castorCsvCell('-1')).toBe("'-1")
    expect(castorCsvCell(-1)).toBe('-1')
    expect(castorCsvCell('a,"b"')).toBe('"a,""b"""')
    expect(castorReportCsv(result, 'uncertainty')).toContain('p05M3,medianM3,p95M3')
  })

  it('creates a readable ZIP with every report, precision raster, provenance and full snapshots', async () => {
    const { project, result } = spatialFixture()
    const blob = await castorReportBundle(project, result)
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const files = Object.keys(zip.files).filter((name) => !zip.files[name].dir)
    for (const report of ['harvest', 'stock', 'constraints', 'pixels', 'blocks', 'landings', 'salvage', 'uncertainty'])
      expect(files).toContain(`reports/${report}.csv`)
    for (const metric of Object.keys(CASTOR_METRICS) as CastorMetric[]) {
      expect(files).toContain(`rasters/final-${metric}.tif`)
      expect(files).toContain(`spatial/final-${metric}.geojson`)
    }
    expect(JSON.parse(await zip.file('project.json')!.async('string'))).toEqual(JSON.parse(JSON.stringify(project)))
    expect(JSON.parse(await zip.file('result.json')!.async('string')).snapshots).toEqual(result.snapshots)
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'))
    expect(manifest.source).toEqual(project.provenance)
    expect(manifest.snapshotPeriods).toEqual([1])
    expect([...manifest.files].sort()).toEqual(files.sort())
    const raster = await zip.file('rasters/final-volume.tif')!.async('arraybuffer')
    const image = await (await fromArrayBuffer(raster)).getImage()
    expect(float64Values(await image.readRasters({ interleave: true }))[5]).toBe(1234.5678901234567)
  })
})
