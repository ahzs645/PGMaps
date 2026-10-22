import JSZip from 'jszip'
import { describe, expect, it, vi } from 'vitest'
import {
  createLocalWorkbenchBundle,
  inspectLocalZip,
  readBoundedLocalZip,
  readLocalWorkbenchBundle,
} from './localWorkbenchBundle'
import type { LocalWorkbenchRecord } from './localWorkbench'
import { EMPTY_WORKSPACE, type Workspace } from './workspace'

const timestamp = '2026-10-21T12:00:00.000Z'
const collection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 'original-7',
      properties: { value: 0, flag: false },
      geometry: { type: 'Point', coordinates: [-123, 54] },
    },
  ],
} as const
const record = (
  id: string,
  kind: string,
  data: unknown,
  extra: Partial<LocalWorkbenchRecord> = {},
): LocalWorkbenchRecord => ({
  id,
  kind,
  name: id,
  data,
  createdAt: timestamp,
  updatedAt: timestamp,
  bytes: 0,
  ...extra,
})
const workspace = (): Workspace => ({
  ...EMPTY_WORKSPACE,
  vectors: [
    {
      id: 'map-original',
      name: 'A saved point',
      data: JSON.parse(JSON.stringify(collection)),
      color: '#008877',
      visible: true,
    },
  ],
  tiles: [
    {
      id: 'tile-original',
      name: 'Remote tiles',
      urls: ['https://example.com/{z}/{x}/{y}.png'],
      attribution: 'Fixture',
      visible: true,
    },
  ],
})
describe('portable local workbench bundles', () => {
  it('roundtrips originals, IDs, private provenance, monitoring and relationships without a network request', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network is permitted.'))
    try {
      const records = [
        record(
          'photo',
          'attachment',
          {
            schema: 'nechako-local-attachment-v1',
            relationships: [{ kind: 'submission', id: 'draft', role: 'photo' }],
          },
          {
            blob: new Blob([new Uint8Array([0, 255, 3])]),
            filename: 'original photo.jpg',
            source: { access: 'private', recordId: 'source-42' },
          },
        ),
        record('draft', 'submission', { sourceNoteId: 42, nativeForm: { value: null }, attachmentIds: ['photo'] }),
        record('measurements', 'monitoring', {
          headers: ['date', 'value'],
          records: [{ date: '2026-10-21', value: 0 }],
        }),
        record(
          'gpap',
          'geopaparazzi',
          { noteIds: [42], relationships: [{ kind: 'submission', id: 'draft' }] },
          { blob: new Blob(['SQLite format 3\u0000synthetic bytes']), filename: 'original.gpap' },
        ),
        record('styled', 'style', {
          schema: 'nechako-local-style-v1',
          originalSld: '<StyledLayerDescriptor/>',
          diagnostics: [{ severity: 'warning', message: 'Unsupported rule retained' }],
        }),
        record('subset', 'layer', {
          schema: 'nechako-local-layer-v1',
          data: collection,
          materialization: { status: 'partial', sourceCount: 100 },
        }),
        record('remote', 'layer', { schema: 'nechako-local-layer-v1', materialization: { status: 'descriptor' } }),
      ]
      const bundle = await createLocalWorkbenchBundle({ name: 'Fixture backup', workspace: workspace(), records })
      const preview = await readLocalWorkbenchBundle(bundle.blob)
      expect(preview.records.map((item) => item.id)).toEqual(records.map((item) => item.id))
      expect(preview.records[0].source).toEqual(records[0].source)
      expect(new Uint8Array(await preview.records[0].blob!.arrayBuffer())).toEqual(new Uint8Array([0, 255, 3]))
      expect(await preview.records[3].blob!.text()).toBe('SQLite format 3\u0000synthetic bytes')
      expect(preview.workspace?.vectors[0].data.features[0]).toEqual(collection.features[0])
      expect(preview.manifest.relationships.every((link) => link.included)).toBe(true)
      expect(preview.manifest.completeness).toMatchObject({
        recordCount: 7,
        originalFileCount: 2,
        privateRecordCount: 1,
        partialLayerCount: 1,
        descriptorLayerCount: 1,
        materializedLayerCount: 2,
      })
      expect(preview.manifest.remoteResources.every((resource) => resource.pixelsCached === false)).toBe(true)
      expect(preview.manifest.files.some((file) => file.path.endsWith('.geojson'))).toBe(true)
      expect(preview.manifest.files.some((file) => file.path.endsWith('.sld'))).toBe(true)
      expect(preview.manifest.completeness.warnings.join(' ')).toContain('not a newly authored native SMASH project')
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      fetch.mockRestore()
    }
  })
  it('refuses modified data even when a ZIP is structurally valid and has a fresh CRC', async () => {
    const { blob } = await createLocalWorkbenchBundle({ records: [record('schema', 'schema', { fields: [] })] })
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    zip.file('records/00001.json', JSON.stringify({ ...record('schema', 'schema', {}), name: 'Tampered' }))
    const modified = new Blob([await zip.generateAsync({ type: 'arraybuffer' })])
    await expect(readLocalWorkbenchBundle(modified)).rejects.toThrow('Checksum verification failed')
  })
  it('rejects unlisted files and unsafe paths before restoration', async () => {
    const { blob } = await createLocalWorkbenchBundle({ records: [] })
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    zip.file('unlisted.txt', 'not declared')
    await expect(
      readLocalWorkbenchBundle(new Blob([await zip.generateAsync({ type: 'arraybuffer' })])),
    ).rejects.toThrow('unlisted')
    const unsafe = new JSZip().file('../escape.json', '{}')
    await expect(
      readLocalWorkbenchBundle(new Blob([await unsafe.generateAsync({ type: 'arraybuffer' })])),
    ).rejects.toThrow('unsafe path')
  })
  it('checks declared uncompressed entry sizes before inflation and validates CRC', async () => {
    const zip = new JSZip().file('example.geojson', 'synthetic marker')
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' })
    expect(inspectLocalZip(bytes).entries[0]).toMatchObject({ name: 'example.geojson', uncompressedBytes: 16 })
    expect(() => inspectLocalZip(bytes, { maxFileBytes: 8 })).toThrow('oversized')
    expect(() => inspectLocalZip(bytes, { maxEntries: 0 })).toThrow('oversized')
    const { blob } = await createLocalWorkbenchBundle({
      records: [record('check', 'schema', { text: 'uniquely identifiable payload' })],
    })
    const stored = await JSZip.loadAsync(await blob.arrayBuffer())
    const raw = await stored.generateAsync({ type: 'uint8array', compression: 'STORE' })
    const needle = new TextEncoder().encode('uniquely identifiable payload')
    const offset = raw.findIndex((_, index) => needle.every((value, sub) => raw[index + sub] === value))
    expect(offset).toBeGreaterThan(0)
    raw[offset] = 'X'.charCodeAt(0)
    await expect(readLocalWorkbenchBundle(new Blob([Uint8Array.from(raw).buffer]))).rejects.toThrow(/CRC32/)
  })
  it('stops actual expansion when a compressed entry understates its uncompressed size', async () => {
    const zip = new JSZip().file('forged.geojson', 'x'.repeat(100000))
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const end = bytes.byteLength - 22
    const directory = view.getUint32(end + 16, true)
    view.setUint32(directory + 24, 16, true)
    expect(inspectLocalZip(bytes, { maxFileBytes: 32 }).uncompressedBytes).toBe(16)
    await expect(readBoundedLocalZip(bytes, { maxFileBytes: 32 })).rejects.toThrow('declared expansion bound')
  })
  it('reports missing original files and unresolved local relationships explicitly', async () => {
    const { manifest } = await createLocalWorkbenchBundle({
      records: [record('missing photo', 'attachment', { relationships: [{ kind: 'submission', id: 'absent' }] })],
    })
    expect(manifest.completeness.originalFileCount).toBe(0)
    expect(manifest.relationships[0].included).toBe(false)
    expect(manifest.completeness.warnings.join(' ')).toContain('no original file')
    expect(manifest.completeness.warnings.join(' ')).toContain('not included')
  })
  it('retains native file extensions when long names need safe archive filenames', async () => {
    const map = workspace()
    map.vectors[0].name = 'Long source layer title '.repeat(8)
    const { manifest } = await createLocalWorkbenchBundle({
      records: [
        record(
          'original',
          'attachment',
          {},
          { blob: new Blob(['original']), filename: `${'long-name-'.repeat(20)}.gpap` },
        ),
      ],
      workspace: map,
      gisFormat: 'geojson',
    })
    expect(manifest.records[0].blobPath).toMatch(/\.gpap$/)
    expect(manifest.gisExports?.[0].path).toMatch(/\.geojson$/)
    expect(manifest.files.some((file) => file.path.endsWith('.sld'))).toBe(true)
    await expect(
      createLocalWorkbenchBundle({ records: [], workspace: map, gisFormat: 'kmz', smash: true }),
    ).rejects.toThrow('Choose GeoPackage')
  })
  it('refuses a valid record collection whose manifest would exceed the reader limit', async () => {
    const records = Array.from({ length: 520 }, (_, index) =>
      record(
        `source-${index}`,
        'schema',
        { fields: [] },
        {
          source: { access: 'public', notes: 'Full retained source provenance '.repeat(120) },
        },
      ),
    )
    await expect(createLocalWorkbenchBundle({ records })).rejects.toThrow('manifest exceeds the 2 MiB import limit')
  })
})
