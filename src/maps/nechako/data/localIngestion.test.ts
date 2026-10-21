import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { attachmentRecord, cacheGisImport, cacheMonitoringCsv } from './localIngestion'
import {
  clearLocalWorkbench,
  getLocalWorkbench,
  importLocalWorkbench,
  listLocalWorkbench,
  saveLocalWorkbench,
} from './localWorkbench'
import { checkedLocalLayer } from './localLayers'
import { checkedCsv, type MonitoringMapping } from './monitoring'
import { convertFiles, createGisExport, gisExportInput } from './conversion'

beforeEach(() => clearLocalWorkbench())

describe('local ingestion persistence', () => {
  it('rejects XML declarations before GDAL, including wide-character XML and archived files', async () => {
    const declaration = '<!DOCTYPE kml [<!ENTITY value "expanded">]><kml>&value;</kml>'
    await expect(convertFiles([new File([declaration], 'field.kml')])).rejects.toThrow('DOCTYPE or entity')
    await expect(
      convertFiles([
        new File([Uint8Array.from([...declaration].flatMap((character) => [character.charCodeAt(0), 0]))], 'wide.gml'),
      ]),
    ).rejects.toThrow('DOCTYPE or entity')
    const { default: JSZip } = await import('jszip')
    const zip = new JSZip()
    zip.file('doc.kml', declaration)
    await expect(
      convertFiles([new File([Uint8Array.from(await zip.generateAsync({ type: 'uint8array' })).buffer], 'field.kmz')]),
    ).rejects.toThrow('DOCTYPE or entity')
  })
  it('preserves arbitrary feature IDs in collision-free typed attributes without changing originals', () => {
    const data: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 0,
          properties: { PGM_ID: 'existing', pgm_idtyp: 0 },
          geometry: { type: 'Point', coordinates: [0, 0] },
        },
        {
          type: 'Feature',
          id: '9007199254740993',
          properties: { flag: false },
          geometry: { type: 'Point', coordinates: [1, 1] },
        },
      ],
    }
    const before = structuredClone(data)
    const output = gisExportInput(data)
    expect(output.data.features[0].properties).toEqual({
      PGM_ID: 'existing',
      pgm_idtyp: 0,
      pgm_id1: '0',
      pgm_idtyp1: 'number',
    })
    expect(output.data.features[1].properties).toEqual({
      flag: false,
      pgm_id1: '9007199254740993',
      pgm_idtyp1: 'string',
    })
    expect(output.warnings.join(' ')).toContain('pgm_id1 and pgm_idtyp1')
    expect(data).toEqual(before)
  })
  it('keeps attachment originals, edited metadata, relationships and distinct original filenames', async () => {
    const first = await attachmentRecord(new File([new Uint8Array([0, 255, 1])], 'photo.bin'), {
      description: 'Original',
      relationships: [{ kind: 'submission', id: 'draft-1' }],
    })
    const renamed = await attachmentRecord(new File([new Uint8Array([0, 255, 1])], 'renamed.bin'))
    expect(first.data.sha256).toBe(renamed.data.sha256)
    expect(first.id).not.toBe(renamed.id)
    await importLocalWorkbench([first, renamed])
    await saveLocalWorkbench({
      id: first.id,
      kind: 'attachment',
      name: first.name,
      data: { ...first.data, description: 'Edited', tags: ['field'] },
    })
    const reloaded = await getLocalWorkbench(first.id)
    expect(reloaded?.data).toMatchObject({
      description: 'Edited',
      tags: ['field'],
      relationships: [{ kind: 'submission', id: 'draft-1' }],
    })
    expect(new Uint8Array(await reloaded!.blob!.arrayBuffer())).toEqual(new Uint8Array([0, 255, 1]))
  })
  it('caches every converted layer and source file and does not repeat an already imported layer batch', async () => {
    const file = new File(
      [
        '{"type":"FeatureCollection","features":[{"type":"Feature","id":9007199254740993,"properties":{"zero":0,"flag":false},"geometry":{"type":"Point","coordinates":[0,0]}}]}',
      ],
      'sample.geojson',
    )
    const converted = await convertFiles([file])
    expect(converted.layers[0].data.features[0].id).toBe('9007199254740993')
    expect(await cacheGisImport([file], converted)).toBe(2)
    const records = await listLocalWorkbench()
    const layer = checkedLocalLayer(records.find((item) => item.kind === 'layer')!.data)
    expect(layer.data?.features[0].properties).toEqual({ zero: 0, flag: false })
    expect(await records.find((item) => item.kind === 'attachment')!.blob!.text()).toBe(await file.text())
    await expect(cacheGisImport([file], converted)).rejects.toMatchObject({ code: 'conflict' })
    expect(await listLocalWorkbench()).toHaveLength(2)
  })
  it('stores invalid monitoring rows and duplicate flags alongside validated zero observations', async () => {
    const file = new File(
      ['time,station,value,unused\n2026-01-01T00:00:00Z,0,0,false\n2026-01-01T00:00:00Z,0,2,keep\nbad,0,3,original\n'],
      'monitor.csv',
    )
    const table = checkedCsv(await file.text())
    const mapping: MonitoringMapping = {
      timestamp: 'time',
      station: 'station',
      primary: 'value',
      secondary: '',
      primaryUnit: 'm',
      secondaryUnit: '',
      timezone: 'embedded',
    }
    const saved = await cacheMonitoringCsv(file, table.headers, table.records, mapping)
    const data = (await getLocalWorkbench(saved.id))!.data as {
      records: unknown[]
      observations: { primary: number; station: string }[]
      validation: { errors: unknown[]; duplicates: number }
    }
    expect(data.records).toEqual(table.records)
    expect(data.observations[0]).toMatchObject({ primary: 0, station: '0' })
    expect(data.validation).toMatchObject({ errors: [{ row: 4 }], duplicates: 1 })
    expect(await (await getLocalWorkbench(saved.id))!.blob!.text()).toBe(await file.text())
  })
  it('returns GeoJSON export bytes without touching an application API and rejects incompatible GPX geometry', async () => {
    const data: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', id: 0, properties: { value: 0 }, geometry: { type: 'Point', coordinates: [0, 0] } },
      ],
    }
    const exported = await createGisExport(data, 'geojson', 'local')
    expect(JSON.parse(await exported.blob.text())).toEqual(data)
    await expect(
      createGisExport(
        {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'Polygon',
                coordinates: [
                  [
                    [0, 0],
                    [1, 0],
                    [1, 1],
                    [0, 0],
                  ],
                ],
              },
            },
          ],
        },
        'gpx',
      ),
    ).rejects.toThrow('GPX supports points and lines')
  })
})
