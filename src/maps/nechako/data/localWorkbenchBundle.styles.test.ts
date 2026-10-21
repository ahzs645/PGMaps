import type { FeatureCollection } from 'geojson'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import type { LocalWorkbenchRecord } from './localWorkbench'
import { createLocalWorkbenchBundle, readLocalWorkbenchBundle } from './localWorkbenchBundle'
import { DEFAULT_STYLE_SYMBOL, type VectorStyle } from './vectorRules'
import { EMPTY_WORKSPACE, type VectorData } from './workspace'

const timestamp = '2026-10-21T12:00:00.000Z'
const features = (): FeatureCollection => ({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 0,
      properties: { code: 0, 'Water temperature': 0 },
      geometry: { type: 'Point', coordinates: [-123, 54] },
    },
    {
      type: 'Feature',
      id: 'line-source',
      properties: { code: '0', 'Water temperature': 8 },
      geometry: {
        type: 'LineString',
        coordinates: [
          [-123, 54],
          [-124, 55],
        ],
      },
    },
    {
      type: 'Feature',
      id: 'polygon-source',
      properties: { code: null, 'Water temperature': null },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-123, 54],
            [-123, 55],
            [-124, 55],
            [-123, 54],
          ],
        ],
      },
    },
  ],
})
const vector = (presentation: Partial<VectorData> = {}): VectorData => ({
  id: 'vector-source-9',
  name: 'Source layer',
  data: features(),
  color: '#aa7722',
  visible: true,
  ...presentation,
})
const record = (id: string, kind: string, data: unknown): LocalWorkbenchRecord => ({
  id,
  kind,
  name: id,
  data,
  createdAt: timestamp,
  updatedAt: timestamp,
  bytes: 0,
})
const typedStyle = (): VectorStyle => ({
  schema: 'nechako-vector-style-v1',
  mode: 'rules',
  geometry: 'any',
  base: {
    ...DEFAULT_STYLE_SYMBOL,
    fillColor: '#123456',
    strokeColor: '#654321',
    pointRadius: 3.5,
    strokeWidth: 5.5,
    fillOpacity: 0,
  },
  rules: [
    {
      id: 'zero-rule',
      name: 'Numeric zero',
      enabled: true,
      condition: { property: 'code', operator: 'eq', value: 0 },
      symbol: {
        ...DEFAULT_STYLE_SYMBOL,
        fillColor: '#abcdef',
        strokeColor: '#fedcba',
        pointRadius: 0,
        pointStrokeWidth: 0,
      },
    },
  ],
})
const conflictingPresentation = {
  color: '#ff0000',
  fillOpacity: 1,
  lineOpacity: 1,
  lineWidth: 19,
  pointRadius: 29,
  style: {
    schema: 'nechako-vector-style-v1',
    mode: 'single',
    geometry: 'any',
    base: { ...DEFAULT_STYLE_SYMBOL, fillColor: '#ff0000', strokeColor: '#ff0000', pointRadius: 29 },
  },
}
const legacyPresentation = {
  color: '#09abce',
  fillOpacity: 0,
  lineOpacity: 0.4,
  lineWidth: 7.25,
  pointRadius: 0,
}
async function archiveText(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path)
  if (!file) throw new Error('Expected archive file: ' + path)
  return file.async('string')
}
async function openBundle(bundle: Awaited<ReturnType<typeof createLocalWorkbenchBundle>>) {
  const zip = await JSZip.loadAsync(await bundle.blob.arrayBuffer())
  const xml = await Promise.all(
    bundle.manifest.files
      .filter((file) => file.role === 'style' && file.path.startsWith('gis/') && file.path.endsWith('.sld'))
      .map((file) => archiveText(zip, file.path)),
  )
  return { zip, xml, restored: await readLocalWorkbenchBundle(bundle.blob) }
}
function geometryXml(xml: string[], geometry: 'Point' | 'Line' | 'Polygon'): string {
  const matching = xml.filter((value) => value.includes('<sld:' + geometry + 'Symbolizer>'))
  expect(matching).toHaveLength(1)
  return matching[0]
}
function expectLegacyPaint(xml: string[]) {
  expect(xml).toHaveLength(3)
  expect(geometryXml(xml, 'Point')).toContain('<sld:Size>0</sld:Size>')
  expect(geometryXml(xml, 'Line')).toContain('<sld:CssParameter name="stroke-width">7.25</sld:CssParameter>')
  expect(geometryXml(xml, 'Polygon')).toContain('<sld:CssParameter name="fill-opacity">0</sld:CssParameter>')
  for (const sidecar of xml) expect(sidecar).toContain('<sld:CssParameter name="stroke-opacity">0.4</sld:CssParameter>')
}

describe('local bundle GIS style fidelity', () => {
  it('keeps mixed geometry data while emitting only the explicitly selected point symbolizer', async () => {
    const data = features()
    data.features = data.features.filter((feature) => feature.geometry?.type !== 'LineString')
    const layer = vector({
      data,
      style: {
        schema: 'nechako-vector-style-v1',
        mode: 'single',
        geometry: 'point',
        base: { ...DEFAULT_STYLE_SYMBOL, pointRadius: 4 },
      },
    })
    const bundle = await createLocalWorkbenchBundle({
      records: [],
      workspace: { ...EMPTY_WORKSPACE, vectors: [layer] },
      gisFormat: 'geojson',
    })
    const { zip, xml, restored } = await openBundle(bundle)
    expect(xml).toHaveLength(1)
    expect(xml[0]).toContain('<sld:PointSymbolizer>')
    expect(xml[0]).toContain('<sld:Size>8</sld:Size>')
    expect(xml[0]).not.toContain('PolygonSymbolizer')
    expect(bundle.manifest.gisExports).toHaveLength(1)
    const exported = bundle.manifest.gisExports![0]
    expect(exported.featureCount).toBe(2)
    expect(JSON.parse(await archiveText(zip, exported.path))).toEqual(data)
    const warning = exported.warnings.join(' ')
    expect(warning).toMatch(/point.*polygon/i)
    expect(warning).toMatch(/remain.*GIS data/i)
    expect(restored.workspace?.vectors[0]).toMatchObject({ data, style: layer.style })
  })

  it('exports real GIS data when an unsupported SLD field needs typed and original style preservation', async () => {
    const style: VectorStyle = {
      schema: 'nechako-vector-style-v1',
      mode: 'gradient',
      geometry: 'any',
      base: { ...DEFAULT_STYLE_SYMBOL },
      property: 'Water temperature',
      channel: 'both',
      stops: [
        { value: 0, color: '#0000ff' },
        { value: 10, color: '#ff0000' },
      ],
    }
    const originalSld =
      '<?xml version="1.0"?>\r\n<StyledLayerDescriptor><!-- original style bytes --></StyledLayerDescriptor>\r\n'
    const styleSource = {
      format: 'sld' as const,
      original: originalSld,
      diagnostics: ['Original retained for review.'],
    }
    const records = [
      record('cached-temperature', 'layer', vector({ style, styleSource })),
      record('library-temperature', 'style', {
        schema: 'nechako-local-style-v1',
        style,
        originalSld,
        diagnostics: [{ severity: 'warning', message: 'Original retained for review.' }],
      }),
    ]
    const bundle = await createLocalWorkbenchBundle({ records, gisFormat: 'geojson', gisScope: 'all' })
    const { zip, xml, restored } = await openBundle(bundle)
    expect(xml).toEqual([])
    expect(bundle.manifest.gisExports).toHaveLength(1)
    const exported = bundle.manifest.gisExports![0]
    expect(JSON.parse(await archiveText(zip, exported.path))).toEqual(features())
    expect(exported.warnings.join(' ')).toMatch(/SLD sidecar.*omitted/i)
    expect(exported.warnings.join(' ')).toMatch(/field names containing spaces/i)
    expect(exported.warnings.join(' ')).toMatch(/style metadata remain.*GIS features were retained/i)
    const retainedSld = bundle.manifest.files.filter((file) => file.role === 'style' && file.path.endsWith('.sld'))
    expect(retainedSld).toHaveLength(1)
    expect(await archiveText(zip, retainedSld[0].path)).toBe(originalSld)
    expect(restored.records.map((item) => item.data)).toEqual(records.map((item) => item.data))
  })

  it('uses a direct cached vector’s current typed style instead of its conflicting original', async () => {
    const style = typedStyle()
    const saved = record('typed-vector', 'layer', vector({ style, original: conflictingPresentation }))
    const bundle = await createLocalWorkbenchBundle({ records: [saved], gisFormat: 'geojson', gisScope: 'all' })
    const { xml, restored } = await openBundle(bundle)
    expect(xml).toHaveLength(3)
    for (const sidecar of xml) {
      expect(sidecar).toContain('<ogc:PropertyName>code</ogc:PropertyName>')
      expect(sidecar).toContain('<ogc:Literal>0</ogc:Literal>')
      expect(sidecar).toContain('<sld:ElseFilter></sld:ElseFilter>')
      expect(sidecar).toContain('#fedcba')
      expect(sidecar).not.toContain('#ff0000')
    }
    expect(geometryXml(xml, 'Point')).toContain('<sld:Size>0</sld:Size>')
    expect(geometryXml(xml, 'Point')).toContain('<sld:Size>7</sld:Size>')
    expect(geometryXml(xml, 'Point')).toContain('<sld:CssParameter name="stroke-width">0</sld:CssParameter>')
    expect(geometryXml(xml, 'Line')).toContain('<sld:CssParameter name="stroke-width">5.5</sld:CssParameter>')
    expect(geometryXml(xml, 'Polygon')).toContain('<sld:CssParameter name="fill-opacity">0</sld:CssParameter>')
    expect(restored.records[0].data).toEqual(saved.data)
  })

  it('uses direct cached legacy color, opacity, radius and width instead of conflicting original values', async () => {
    const saved = record('legacy-vector', 'layer', vector({ ...legacyPresentation, original: conflictingPresentation }))
    const bundle = await createLocalWorkbenchBundle({ records: [saved], gisFormat: 'geojson', gisScope: 'all' })
    const { xml, restored } = await openBundle(bundle)
    expectLegacyPaint(xml)
    for (const sidecar of xml) {
      expect(sidecar).toContain('<sld:CssParameter name="stroke">#09abce</sld:CssParameter>')
      expect(sidecar).not.toContain('#ff0000')
    }
    expect(restored.records[0].data).toEqual(saved.data)
  })

  it('keeps direct cached legacy categories, typed zero/null values and paint sizes', async () => {
    const categories = {
      property: 'code',
      fallback: '#112233',
      rules: [
        { value: 0, color: '#00ff00' },
        { value: '0', color: '#0000ff' },
        { value: null, color: '#ff00ff' },
      ],
    }
    const saved = record(
      'categorized-vector',
      'layer',
      vector({
        ...legacyPresentation,
        categories,
        original: conflictingPresentation,
      }),
    )
    const bundle = await createLocalWorkbenchBundle({ records: [saved], gisFormat: 'geojson', gisScope: 'all' })
    const { xml, restored } = await openBundle(bundle)
    expectLegacyPaint(xml)
    for (const sidecar of xml) {
      expect(sidecar).toContain('<ogc:PropertyIsNull><ogc:PropertyName>code</ogc:PropertyName></ogc:PropertyIsNull>')
      expect(sidecar).toContain('<sld:ElseFilter></sld:ElseFilter>')
      for (const color of ['#00ff00', '#0000ff', '#ff00ff', '#112233']) expect(sidecar).toContain(color)
      expect(sidecar).not.toContain('#ff0000')
    }
    expect(restored.records[0].data).toEqual(saved.data)
  })

  it('takes canonical cached layer presentation from original instead of incidental top-level paint', async () => {
    const saved = record('canonical-layer', 'layer', {
      schema: 'nechako-local-layer-v1',
      kind: 'local',
      name: 'Canonical source layer',
      data: features(),
      materialization: { status: 'complete', basis: 'imported-file', countVerified: false, notes: [] },
      ...conflictingPresentation,
      original: legacyPresentation,
    })
    const bundle = await createLocalWorkbenchBundle({ records: [saved], gisFormat: 'geojson', gisScope: 'all' })
    const { xml, restored } = await openBundle(bundle)
    expectLegacyPaint(xml)
    for (const sidecar of xml) {
      expect(sidecar).toContain('<sld:CssParameter name="stroke">#09abce</sld:CssParameter>')
      expect(sidecar).not.toContain('#ff0000')
    }
    expect(restored.records[0].data).toEqual(saved.data)
  })
})
