import { describe, expect, it } from 'vitest'
import { EXPORT_ITEMS } from './exportCatalog'
import {
  blockSheetWrites,
  DOWNLOAD_ONLY_EXPORTS,
  exportBasename,
  exportFileType,
  saveAsFileType,
  saveAsOffered,
  savedNotice,
} from './exportFiles'

describe('export file names', () => {
  it('names files from the project name, at most 70 characters', () => {
    expect(exportBasename('Spur 7 — Willow Creek')).toBe('Spur-7-Willow-Creek')
    expect(exportBasename('***')).toBe('forest-road')
    expect(exportBasename('x'.repeat(90))).toHaveLength(70)
  })

  // The names Download has always written: the end-to-end suites read several of them.
  it('keeps every output’s file name', () => {
    const names = Object.fromEntries(
      EXPORT_ITEMS.map((item) => [
        item.kind,
        exportFileType(item.kind, 'Job', { blockSheetKind: 'field', dLineName: 'Line A / 2' }, 'Job road').name,
      ]),
    )
    expect(names).toEqual({
      project: 'Job.road.json',
      notes: 'Job-notes.geojson',
      'report-pdf': 'Job-report.pdf',
      'report-package': 'Job-report-package.pdf',
      'estimate-pdf': 'Job-preliminary-estimate.pdf',
      report: 'Job-report.html',
      'map-pdf': 'Job-map.pdf',
      'block-sheet-pdf': 'Job-field.pdf',
      'dline-sheet-pdf': 'Job-Line-A-2-sheet.pdf',
      'plotbook-pdf': 'Job-plot-book.pdf',
      plotbook: 'Job-plot-book.html',
      geojson: 'Job.geojson',
      shapefile: 'Job-shapefiles.zip',
      geopackage: 'Job.gpkg',
      kmz: 'Job.kmz',
      'qgis-project': 'Job-qgis-project.zip',
      'arcgis-pro': 'Job-arcgis-pro.zip',
      'web-map-style': 'Job-web-map-style.zip',
      'symbol-library': 'Job-symbol-library.zip',
      csv: 'Job-stations.csv',
      'streams-csv': 'Job-streams.csv',
      'culvert-schedule-csv': 'Job-culverts.csv',
      'provincial-evidence': 'Job-provincial-stream-evidence.geojson',
      landxml: 'Job.xml',
      'subgrade-landxml': 'Job-subgrade-surface.xml',
      'finished-surface-landxml': 'Job-finished-surface.xml',
      'design-model': 'Job-design-surfaces.glb',
      roadeng: 'Job.dsnx',
      'roadeng-project': 'Job road.zip',
      dxf: 'Job.dxf',
      stakeout: 'Job-stakeout.csv',
      'softree-location-ascii': 'Job-location.txt',
      'mass-haul-csv': 'Job-mass-haul.csv',
      'optimal-haul-csv': 'Job-optimal-haul.csv',
      'optimal-areas-csv': 'Job-optimal-areas.csv',
      'optimal-inputs': 'Job-optimal-inputs.zip',
      'terrain-landxml': 'Job-terrain.xml',
      'terrain-ascii': 'Job-terrain.asc',
      'softree-terrain-ascii': 'Job-terrain.txt',
    })
    expect(exportFileType('design-model', 'Job', { modelFormat: 'obj' }).name).toBe('Job-design-surfaces.zip')
    expect(exportFileType('design-model', 'Job', { modelFormat: 'stl' }).name).toBe('Job-design-surfaces.stl')
  })

  it('names the block sheet by what its output settings write', () => {
    const name = (output: Parameters<typeof blockSheetWrites>[0], blocks = 3) =>
      exportFileType('block-sheet-pdf', 'Job', {
        blockSheetKind: 'field-layout',
        blockSheet: blockSheetWrites(output, blocks),
      })
    const one = { series: false, bundle: 'pdf' as const }
    expect(name({ ...one, format: 'pdf' })).toEqual({
      name: 'Job-field-layout.pdf',
      mime: 'application/pdf',
      extension: '.pdf',
    })
    expect(name({ ...one, format: 'svg' })).toEqual({
      name: 'Job-field-layout.svg',
      mime: 'image/svg+xml',
      extension: '.svg',
    })
    expect(name({ ...one, format: 'png' })).toEqual({
      name: 'Job-field-layout.png',
      mime: 'image/png',
      extension: '.png',
    })
    // A series: one PDF only for PDF pages bundled as one; anything else is a ZIP of one file a block.
    const series = { series: true }
    expect(name({ ...series, format: 'pdf', bundle: 'pdf' })).toEqual({
      name: 'Job-field-layout-series.pdf',
      mime: 'application/pdf',
      extension: '.pdf',
    })
    for (const [format, bundle] of [
      ['pdf', 'zip'],
      ['svg', 'pdf'],
      ['svg', 'zip'],
      ['png', 'pdf'],
      ['png', 'zip'],
    ] as const)
      expect(name({ ...series, format, bundle })).toEqual({
        name: 'Job-field-layout-series.zip',
        mime: 'application/zip',
        extension: '.zip',
      })
    // With fewer than two blocks there is no series: the sheet is written alone, in its format.
    expect(blockSheetWrites({ series: true, format: 'svg', bundle: 'zip' }, 1)).toEqual({ series: false, file: 'svg' })
    expect(name({ series: true, format: 'png', bundle: 'zip' }, 1).name).toBe('Job-field-layout.png')
    expect(name({ series: true, format: 'pdf', bundle: 'pdf' }, 0).name).toBe('Job-field-layout.pdf')
    // Save as offers each with a type the dialog accepts.
    expect(saveAsFileType('block-sheet-pdf', name({ series: true, format: 'png', bundle: 'zip' }))).toEqual({
      mime: 'application/zip',
      extension: '.zip',
      description: 'Block map sheet',
    })
  })

  it('offers Save as for every output but the report package, which is a PDF or a ZIP', () => {
    expect(Object.keys(DOWNLOAD_ONLY_EXPORTS).sort()).toEqual(['report-package'])
    expect(saveAsOffered('map-pdf')).toBe(true)
    for (const item of EXPORT_ITEMS) expect(saveAsOffered(item.kind)).toBe(!(item.kind in DOWNLOAD_ONLY_EXPORTS))
  })

  it('gives the save dialog a type it accepts', () => {
    expect(saveAsFileType('csv', exportFileType('csv', 'Job'))).toEqual({
      mime: 'text/csv',
      extension: '.csv',
      description: 'Station CSV',
    })
    // The dialog's filter is one extension; the name keeps `.road.json`.
    expect(exportFileType('project', 'Job')).toMatchObject({ name: 'Job.road.json', extension: '.json' })
    for (const item of EXPORT_ITEMS) {
      const type = saveAsFileType(item.kind, exportFileType(item.kind, 'Job'))
      expect(type.mime).toMatch(/^[a-z]+\/[a-z0-9.+-]+$/)
      expect(type.extension).toMatch(/^\.[a-z0-9]+$/)
    }
  })

  it('rewords a download’s notice for a file saved where the person chose', () => {
    expect(savedNotice('GeoPackage downloaded: 5 layers.', 'saved', 'Job.gpkg')).toBe(
      'GeoPackage saved as Job.gpkg: 5 layers.',
    )
    expect(savedNotice('Map notes exported.', 'saved', 'Job-notes.geojson')).toBe(
      'Saved as Job-notes.geojson. Map notes exported.',
    )
    expect(savedNotice('Export downloaded.', 'downloaded', 'Job.xml')).toBe('Export downloaded.')
  })
})
