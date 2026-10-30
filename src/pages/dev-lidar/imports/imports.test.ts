import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import proj4 from 'proj4'
import { describe, expect, it, vi } from 'vitest'
import { fileLayer, exportProject, restoreProject, checkSession } from './files'
import { featureName, vectorData } from './vector'
import { checkLasBudget, inspectLas, streamingUrl } from './las'
import { loadPointSource, POINT_BUDGET } from './pointSource'
import { rasterValue } from './raster'
import { definition } from './coordinates'
import { emptySession } from './types'

const geojson = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-122.8, 53.9] },
      properties: { candidate_id: 0, model: 'sat', assigned_returns: 2088, reviewed: false },
    },
  ],
}
const jsonFile = (data: unknown, name = 'candidates.geojson') => new File([JSON.stringify(data)], name)
function las(copc = false) {
  const data = new Uint8Array(600),
    view = new DataView(data.buffer),
    encoder = new TextEncoder()
  data.set(encoder.encode('LASF'))
  data[24] = 1
  data[25] = 4
  view.setUint16(94, 375, true)
  view.setUint32(96, 550, true)
  view.setUint32(100, copc ? 2 : 1, true)
  data[104] = copc ? 134 : 6
  view.setBigUint64(247, 1n, true)
  view.setUint16(105, 30, true)
  data.set(encoder.encode('LASF_Projection'), 377)
  view.setUint16(393, 2112, true)
  view.setUint16(395, 1, true)
  if (copc) {
    data.set(encoder.encode('copc'), 432)
    view.setUint16(448, 1, true)
    view.setUint16(450, 0, true)
  }
  return new File([data], copc ? 'test.copc.laz' : 'test.las')
}

describe('local processed layer imports', () => {
  it('preserves candidate zero, all properties, exact compressed bytes and source fingerprint', async () => {
    const bytes = gzipSync(JSON.stringify(geojson)),
      file = new File([bytes], 'sat-candidate-centroids.geojson.gz')
    const layer = await fileLayer(file)
    expect(layer.kind).toBe('vector')
    if (layer.kind !== 'vector') throw Error('Expected vector')
    expect(featureName(layer.data.features[0], 0)).toBe('0')
    expect(layer.data.features[0].properties).toEqual(geojson.features[0].properties)
    expect(new Uint8Array(layer.original)).toEqual(new Uint8Array(bytes))
    expect(layer.source.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(layer.bounds).toEqual([-122.8, 53.9, -122.8, 53.9])
  })
  it('reprojects the BC CRS explicitly and rejects unknown/out-of-map coordinates', () => {
    const native = proj4('EPSG:4326', definition('EPSG:3157'), [-122.8, 53.9])
    const data = structuredClone(geojson)
    data.features[0].geometry.coordinates = native
    const restored = vectorData(data, 'EPSG:3157')
    const result = (restored.data.features[0].geometry as GeoJSON.Point).coordinates
    expect(result[0]).toBeCloseTo(-122.8, 6)
    expect(result[1]).toBeCloseTo(53.9, 6)
    expect(() => vectorData(data)).toThrow(/outside the map/)
    expect(() => vectorData(data, 'EPSG:999999')).toThrow(/Unsupported CRS/)
    expect(() => vectorData({ type: 'FeatureCollection', features: [] })).toThrow(/1–200,000/)
    expect(() =>
      vectorData({
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ],
        ],
      }),
    ).toThrow(/closed/)
  })
  it('loads the source 1 m GeoTIFF, samples native cells and retains NoData', async () => {
    const bytes = readFileSync(new URL('../fixtures/source-height-1m.tif', import.meta.url))
    const layer = await fileLayer(new File([bytes], 'height-1m.tif'))
    expect(layer.kind).toBe('raster')
    if (layer.kind !== 'raster') throw Error('Expected raster')
    expect(layer.source.crs).toBe('EPSG:3157')
    expect(layer.resolution).toEqual([1, -1])
    expect(layer.valid).toBeGreaterThan(0)
    expect(layer.values.length).toBe(layer.width * layer.height)
    for (let i = 0; i < layer.values.length; i++) {
      const x = layer.nativeBounds[0] + ((i % layer.width) + 0.5) * layer.resolution[0]
      const y = layer.nativeBounds[3] + (Math.floor(i / layer.width) + 0.5) * layer.resolution[1]
      const [lon, lat] = proj4(definition(layer.source.crs), 'EPSG:4326', [x, y])
      const expected = !Number.isFinite(layer.values[i]) || layer.values[i] === layer.noData ? null : layer.values[i]
      expect(rasterValue(layer, lon, lat)).toBe(expected)
    }
    expect(rasterValue(layer, 0, 0)).toBeNull()
  })
  it('round-trips original files and layer settings, requiring point source reattachment', async () => {
    const vector = await fileLayer(jsonFile(geojson)),
      bytes = readFileSync(new URL('../fixtures/source-height-1m.tif', import.meta.url))
    const raster = await fileLayer(new File([bytes], 'height.tif'))
    if (vector.kind !== 'vector') throw Error('Expected vector')
    vector.visible = false
    vector.opacity = 0.35
    const project = exportProject({
      layers: [vector, raster],
      point: {
        id: 'secret',
        name: 'cloud.copc.laz',
        kind: 'copc',
        url: 'https://example.org/private.copc.laz?token=private',
      },
      missingPoints: [],
    })
    expect(project).not.toContain('token=private')
    const restored = await restoreProject(new File([project], 'restored.pgmaps.json'))
    expect(restored.point).toBeNull()
    expect(restored.missingPoints).toEqual(['cloud.copc.laz'])
    expect(restored.layers.map((l) => l.source)).toEqual([vector.source, raster.source])
    expect(restored.layers[0].visible).toBe(false)
    expect(restored.layers[0].opacity).toBe(0.35)
    expect(new Uint8Array(restored.layers[1].original)).toEqual(new Uint8Array(raster.original))
    expect(restored.layers[0].kind === 'vector' && restored.layers[0].data).toEqual(vector.data)
    const corrupt = JSON.parse(project)
    corrupt.layers[0].sha256 = '0'.repeat(64)
    await expect(restoreProject(jsonFile(corrupt))).rejects.toThrow(/checksum mismatch/)
    await expect(restoreProject(jsonFile({ schema: 'other' }))).rejects.toThrow(/schema/)
  })
  it('rejects array archives, malformed geometry and oversized sessions', async () => {
    await expect(fileLayer(new File(['raw'], 'labels.npy'))).rejects.toThrow(/source-row|Restore/)
    await expect(fileLayer(jsonFile({ packages: [] }, 'archive-manifest.json'))).rejects.toThrow(/geometry/)
    await expect(fileLayer(new File(['{'], 'bad.geojson'))).rejects.toThrow(/Invalid UTF-8 JSON/)
    const layer = await fileLayer(jsonFile(geojson))
    expect(() => checkSession({ ...emptySession(), layers: Array(11).fill(layer) })).toThrow(/10 processed/)
    const raster = await fileLayer(
      new File([readFileSync(new URL('../fixtures/source-height-1m.tif', import.meta.url))], 'height.tif'),
    )
    if (raster.kind !== 'raster') throw Error('Expected raster')
    expect(() => checkSession({ ...emptySession(), layers: [{ ...raster, width: 5000, height: 5000 }] })).toThrow(
      /20 million/,
    )
  })
})

describe('bounded LiDAR loading', () => {
  it('inspects headers, gates full-file decoding and recognizes COPC', async () => {
    const plain = await inspectLas(las()),
      copc = await inspectLas(las(true))
    expect(plain).toMatchObject({ points: 1, copc: false, hasCRS: true })
    expect(copc.copc).toBe(true)
    expect(() => checkLasBudget(plain, 550572701)).toThrow(/COPC\/EPT conversion/)
    expect(() => checkLasBudget({ ...plain, points: 84608005 }, 100)).toThrow(/84,608,005/)
    expect(() => checkLasBudget(copc, 626000000)).not.toThrow()
    expect(() => checkLasBudget({ ...plain, hasCRS: false }, 600)).toThrow(/embedded CRS/)
    await expect(inspectLas(new File(['LASF'], 'truncated.laz'))).rejects.toThrow(/complete/)
  })
  it('reads LAS 1.4 CRS in extended metadata and rejects truncated uncompressed records', async () => {
    const bytes = new Uint8Array(await las().arrayBuffer()),
      view = new DataView(bytes.buffer)
    view.setUint32(96, 375, true)
    view.setUint32(100, 0, true)
    view.setBigUint64(235, 500n, true)
    view.setUint32(243, 1, true)
    bytes.set(new TextEncoder().encode('LASF_Projection'), 502)
    view.setUint16(518, 2112, true)
    view.setBigUint64(520, 1n, true)
    expect((await inspectLas(new File([bytes], 'extended.las'))).hasCRS).toBe(true)
    view.setBigUint64(520, 1000n, true)
    await expect(inspectLas(new File([bytes], 'bad-extended.las'))).rejects.toThrow(/metadata length/)
    const truncated = new Uint8Array(await las().arrayBuffer())
    new DataView(truncated.buffer).setBigUint64(247, 1000n, true)
    await expect(inspectLas(new File([truncated], 'truncated.las'))).rejects.toThrow(/point records/)
  })
  it('accepts only supported streaming URLs and dispatches native streaming without full-file fallback', async () => {
    expect(streamingUrl('https://example.org/ept.json').kind).toBe('ept')
    expect(streamingUrl('https://example.org/trees.copc.laz?download=1').kind).toBe('copc')
    for (const url of [
      'http://example.org/ept.json',
      'https://name:secret@example.org/ept.json',
      'https://example.org/huge.laz',
    ])
      expect(() => streamingUrl(url)).toThrow()
    const control = { loadPointCloud: vi.fn(), loadPointCloudStreaming: vi.fn(), loadPointCloudEptStreaming: vi.fn() }
    const file = las(true)
    await loadPointSource(control, { id: 'a', name: file.name, kind: 'copc', file })
    await loadPointSource(control, { id: 'b', name: 'EPT', kind: 'ept', url: 'https://example.org/ept.json' })
    expect(control.loadPointCloud).not.toHaveBeenCalled()
    expect(control.loadPointCloudStreaming).toHaveBeenCalledWith(file, {
      pointBudget: POINT_BUDGET,
      maxConcurrentRequests: 3,
    })
    expect(control.loadPointCloudEptStreaming).toHaveBeenCalledWith(
      'https://example.org/ept.json',
      expect.objectContaining({ pointBudget: POINT_BUDGET }),
    )
    const plain = las()
    await loadPointSource(control, { id: 'c', name: plain.name, kind: 'file', file: plain })
    expect(control.loadPointCloud).toHaveBeenCalledWith(plain)
  })
})
