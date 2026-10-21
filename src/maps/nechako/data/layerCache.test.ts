import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { clearLocalWorkbench, saveLocalWorkbench } from './localWorkbench'
import { materializeLayer, parseLayerCatalogue } from './localLayers'
import { localLayerCacheId, saveLayerAsset } from './layerCache'
beforeEach(async () => {
  await clearLocalWorkbench()
})
const descriptor = () => parseLayerCatalogue([{ id: 15, schema: 'Source station' }], 'schema')[0]
describe('layer cache provenance', () => {
  it('keeps original filename, bytes, URL, notes and private label through an ordinary save', async () => {
    const asset = materializeLayer(descriptor(), { type: 'FeatureCollection', features: [] })
    const previous = await saveLocalWorkbench({
      id: localLayerCacheId(asset),
      kind: 'layer',
      name: asset.name,
      data: asset,
      blob: new Blob(['original']),
      filename: 'authorized-export.geojson',
      source: {
        access: 'private',
        url: 'https://source.example/export',
        notes: 'Authorized source copy',
        importedAt: '2026-01-01T00:00:00Z',
      },
    })
    const saved = await saveLayerAsset({ asset, id: previous.id, access: 'unknown' })
    expect(saved.filename).toBe('authorized-export.geojson')
    expect(await saved.blob!.text()).toBe('original')
    expect(saved.source).toMatchObject(previous.source!)
    expect(saved.createdAt).toBe(previous.createdAt)
  })
  it('never replaces materialized geometry with a descriptor during catalogue races', async () => {
    const asset = materializeLayer(descriptor(), {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', id: 0, properties: { value: 0 }, geometry: { type: 'Point', coordinates: [0, 0] } },
      ],
    })
    await saveLayerAsset({ asset, access: 'public', blob: new Blob(['original']), filename: 'original.geojson' })
    const saved = await saveLayerAsset({ asset: descriptor(), access: 'unknown' })
    expect(saved.data).toMatchObject({ data: { features: [{ id: 0 }] } })
    expect(saved.filename).toBe('original.geojson')
  })
  it('keeps an imported unknown-access layer separate from a public catalogue entry', async () => {
    await saveLayerAsset({ asset: descriptor(), access: 'public' })
    const other = parseLayerCatalogue([{ id: 16, schema: 'Authorized other export' }], 'schema')[0]
    const saved = await saveLayerAsset({ asset: other, access: 'unknown' })
    expect(saved.source?.access).toBe('unknown')
  })
})
