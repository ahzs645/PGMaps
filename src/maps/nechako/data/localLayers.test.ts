import { describe, expect, it } from 'vitest'
import type { FeatureCollection } from 'geojson'
import {
  checkedLocalLayer,
  localLayerVector,
  materializeLayer,
  materializeWfs,
  parseLayerCatalogue,
  readGeojsonFile,
} from './localLayers'
const collection = (start: number, count: number): FeatureCollection => ({
  type: 'FeatureCollection',
  features: Array.from({ length: count }, (_, index) => ({
    type: 'Feature',
    id: start + index,
    properties: { value: index ? null : 0, flag: false },
    geometry: { type: 'Point', coordinates: [-123, 54] },
  })),
})
function wfs(total = 1001, change?: (body: Record<string, unknown>, offset: number, call: number) => void) {
  const offsets: number[] = []
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    const offset = Number(url.searchParams.get('startIndex'))
    offsets.push(offset)
    expect(url.searchParams.get('version')).toBe('2.0.0')
    expect(url.searchParams.get('count')).toBe('500')
    expect(init?.credentials).toBe('omit')
    const count = Math.min(500, Math.max(0, total - offset))
    const body: Record<string, unknown> = { ...collection(offset, count), numberMatched: total, numberReturned: count }
    change?.(body, offset, offsets.length)
    return Response.json(body)
  }) as typeof fetch
  return { fetcher, offsets }
}
const options = { url: 'https://example.test/wfs', typeName: 'source:observations' }
describe('source catalogues and materialized layers', () => {
  it('preserves schema, submission and shared native IDs and source metadata', () => {
    const schema = parseLayerCatalogue(
      { success: true, attributes: [{ id: 15, schema: 'air_temp', geometryType: 'Point', has_style: true }] },
      'schema',
    )[0]
    expect(schema.schemaId).toBe('15')
    expect(schema.materialization.status).toBe('descriptor')
    expect(() => localLayerVector(schema)).toThrow('geometry')
    const layer = parseLayerCatalogue(
      [{ layer_id: 386, layer_name: 'Stations', form_submission_id: 1477, schema_id: 13 }],
      'submission',
    )[0]
    expect(layer).toMatchObject({ sourceId: '386', schemaId: '13', submissionId: '1477' })
    expect(parseLayerCatalogue([{ layer_id: 9, layer_name: 'watershed' }], 'shared')[0].sourceId).toBe('9')
    expect(schema.original).toMatchObject({ has_style: true })
  })
  it('rejects denied catalogues, duplicate IDs and nonnative identifiers', () => {
    expect(() =>
      parseLayerCatalogue({ success: true, status: 'failure', error: 'Not allowed', attributes: [] }, 'submission'),
    ).toThrow('Not allowed')
    expect(() => parseLayerCatalogue({ success: true, status: 'failure', error: 'Not allowed' }, 'submission')).toThrow('Not allowed')
    expect(() =>
      parseLayerCatalogue(
        [
          { id: '15', schema: 'A' },
          { id: 15, schema: 'B' },
        ],
        'schema',
      ),
    ).toThrow('repeats')
    expect(() => parseLayerCatalogue([{ layer_id: 'table;drop', layer_name: 'A' }], 'shared')).toThrow('native')
  })
  it('materializes full file contents without claiming source-count verification', () => {
    const descriptor = parseLayerCatalogue([{ id: 15, schema: 'air_temp' }], 'schema')[0]
    const asset = materializeLayer(descriptor, {
      geojson: JSON.stringify(collection(0, 2)),
      Attributes: { station_id: 15 },
    })
    expect(asset.materialization).toMatchObject({ status: 'complete', featureCount: 2, countVerified: false })
    expect(asset.data?.features[0]).toMatchObject({ id: 0, properties: { value: 0, flag: false } })
    expect(localLayerVector(asset).original).toMatchObject({ sourceId: '15' })
    expect(checkedLocalLayer(asset).data?.features).toHaveLength(2)
    expect(() =>
      checkedLocalLayer({ ...asset, materialization: { ...asset.materialization, countVerified: true } }),
    ).toThrow('advertised total')
  })
  it('detects source HTML errors and safely reads one-feature-file ZIP exports', async () => {
    await expect(readGeojsonFile(new Blob(['<b>Server error</b>']))).rejects.toThrow('did not return GeoJSON')
    const { default: JSZip } = await import('jszip')
    const zip = new JSZip().file('source.geojson', JSON.stringify(collection(0, 2)))
    expect(await readGeojsonFile(new Blob([await zip.generateAsync({ type: 'arraybuffer' })]))).toMatchObject({
      type: 'FeatureCollection',
    })
    zip.file('second.geojson', '{}')
    await expect(readGeojsonFile(new Blob([await zip.generateAsync({ type: 'arraybuffer' })]))).rejects.toThrow(
      'one GeoJSON',
    )
  })
})
describe('count-verified WFS materialization', () => {
  it('downloads every page, checks boundaries and the empty terminal page', async () => {
    const mock = wfs()
    const asset = await materializeWfs({ ...options, fetcher: mock.fetcher })
    expect(mock.offsets).toEqual([0, 500, 1000, 0, 1000, 1001])
    expect(asset.data?.features).toHaveLength(1001)
    expect(asset.materialization).toMatchObject({ status: 'complete', expectedFeatures: 1001, countVerified: true })
    expect(asset.original).toMatchObject({ wfs: { featureIdsChecked: true, atomicSnapshot: false } })
  })
  it('labels a user limit as partial with source total retained', async () => {
    const mock = wfs()
    const asset = await materializeWfs({ ...options, maxFeatures: 600, fetcher: mock.fetcher })
    expect(mock.offsets).toEqual([0, 500])
    expect(asset.materialization).toMatchObject({
      status: 'partial',
      featureCount: 600,
      expectedFeatures: 1001,
      countVerified: false,
    })
  })
  it('verifies an empty dataset', async () => {
    const asset = await materializeWfs({ ...options, fetcher: wfs(0).fetcher })
    expect(asset.materialization).toMatchObject({ status: 'complete', featureCount: 0, countVerified: true })
  })
  it('rejects unknown totals, changing totals and short pages', async () => {
    await expect(
      materializeWfs({
        ...options,
        fetcher: wfs(1001, (body) => {
          body.numberMatched = 'unknown'
        }).fetcher,
      }),
    ).rejects.toThrow('verifiable total')
    await expect(
      materializeWfs({
        ...options,
        fetcher: wfs(1001, (body, offset) => {
          if (offset === 500) body.numberMatched = 1002
        }).fetcher,
      }),
    ).rejects.toThrow('total changed')
    await expect(
      materializeWfs({
        ...options,
        fetcher: wfs(1001, (body, offset) => {
          if (offset === 500) {
            body.features = collection(500, 2).features
            body.numberReturned = 2
          }
        }).fetcher,
      }),
    ).rejects.toThrow('short or missing')
  })
  it('rejects repeated pages and duplicate source feature IDs', async () => {
    await expect(
      materializeWfs({
        ...options,
        fetcher: wfs(1001, (body, offset) => {
          if (offset === 500) body.features = collection(0, 500).features
        }).fetcher,
      }),
    ).rejects.toThrow('repeated a page')
    await expect(
      materializeWfs({
        ...options,
        fetcher: wfs(1001, (body, offset) => {
          if (offset === 500) (body.features as FeatureCollection['features'])[0].id = 0
        }).fetcher,
      }),
    ).rejects.toThrow('repeated a feature ID')
  })
  it('rejects changed boundaries and data beyond the advertised total', async () => {
    await expect(
      materializeWfs({
        ...options,
        fetcher: wfs(1001, (body, offset, call) => {
          if (offset === 0 && call > 1)
            (body.features as FeatureCollection['features'])[0].properties = { changed: true }
        }).fetcher,
      }),
    ).rejects.toThrow('first WFS page changed')
    await expect(
      materializeWfs({
        ...options,
        fetcher: wfs(1001, (body, offset) => {
          if (offset === 1001) {
            body.features = collection(1001, 1).features
            body.numberReturned = 1
          }
        }).fetcher,
      }),
    ).rejects.toThrow('beyond the advertised')
  })
  it('honors cancellation and refuses credential URLs before fetching', async () => {
    const abort = new AbortController()
    abort.abort()
    await expect(materializeWfs({ ...options, signal: abort.signal, fetcher: wfs().fetcher })).rejects.toThrow()
    await expect(
      materializeWfs({ ...options, url: `${options.url}?token=private`, fetcher: wfs().fetcher }),
    ).rejects.toThrow('without credentials')
  })
})
