/**
 * The reader on small self-authored files shaped like ones ArcGIS Pro writes (a FileGDB point layer
 * with a curve-ring marker, a unique-value line layer drawn with arrowhead font glyphs, Pro's own
 * class breaks), so foreign files are read, refused and reported the way real ones are.
 */
import { describe, expect, it } from 'vitest'
import { ruleFor } from '../model'
import { readArcgisFile } from './read'

const rgb = (r: number, g: number, b: number, a = 100) => ({ type: 'CIMRGBColor', values: [r, g, b, a] })
const fill = (color: unknown) => ({
  type: 'CIMPolygonSymbol',
  symbolLayers: [{ type: 'CIMSolidFill', enable: true, color }],
})
const stroke = (width: number, color: unknown) => ({
  type: 'CIMSolidStroke',
  enable: true,
  capStyle: 'Round',
  joinStyle: 'Round',
  lineStyle3D: 'Strip',
  miterLimit: 10,
  width,
  color,
})
const featureLayer = (name: string, renderer: unknown, extra: Record<string, unknown> = {}) => ({
  type: 'CIMFeatureLayer',
  name,
  uRI: `CIMPATH=map1/${name.toLowerCase()}.xml`,
  visibility: true,
  featureTable: {
    type: 'CIMFeatureTable',
    dataConnection: {
      type: 'CIMStandardDataConnection',
      workspaceConnectionString: 'DATABASE=..\\Sample.gdb',
      workspaceFactory: 'FileGDB',
      dataset: name,
      datasetType: 'esriDTFeatureClass',
    },
  },
  renderer,
  ...extra,
})
const layerDocument = (layer: { uRI: string }) =>
  JSON.stringify({
    type: 'CIMLayerDocument',
    version: '2.4.0',
    build: 19233,
    layers: [layer.uRI],
    layerDefinitions: [layer],
  })

describe('reading files shaped like the ones Pro writes', () => {
  it('reads a FileGDB point layer whose marker is a curve-ring circle: an error, a plain dot standing in', () => {
    const marker = {
      type: 'CIMVectorMarker',
      enable: true,
      anchorPointUnits: 'Relative',
      size: 4,
      frame: { xmin: -2, ymin: -2, xmax: 2, ymax: 2 },
      markerGraphics: [
        {
          type: 'CIMMarkerGraphic',
          geometry: { curveRings: [[[0, 2], { a: [[0, 2], [0, 0], 0, 1] }]] },
          symbol: {
            type: 'CIMPolygonSymbol',
            symbolLayers: [stroke(0.7, rgb(0, 0, 0)), fill(rgb(30.86, 81.91, 140.25)).symbolLayers[0]],
          },
        },
      ],
      respectFrame: true,
    }
    const layer = featureLayer(
      'Fire_Stations',
      {
        type: 'CIMSimpleRenderer',
        patch: 'Default',
        symbol: { type: 'CIMSymbolReference', symbol: { type: 'CIMPointSymbol', symbolLayers: [marker] } },
      },
      {
        labelClasses: [
          {
            type: 'CIMLabelClass',
            expression: '$feature.STATION',
            expressionEngine: 'Arcade',
            textSymbol: {
              type: 'CIMSymbolReference',
              symbol: { type: 'CIMTextSymbol', fontFamilyName: 'Tahoma', height: 10, symbol: fill(rgb(0, 0, 0)) },
            },
            visibility: true,
          },
        ],
      },
    )
    const read = readArcgisFile('Fire_Stations.lyrx', layerDocument(layer))
    expect(read.layers).toHaveLength(1)
    expect(read.layers[0]).toMatchObject({
      id: 'Fire_Stations',
      geometry: 'point',
      label: { field: 'STATION', size: 10, color: '#000000', placement: 'point' },
    })
    expect(read.layers[0].rules[0].symbol).toMatchObject({ kind: 'point', icon: 'dot' })
    const errors = read.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)
    expect(errors).toEqual([
      'A vector marker was drawn in ArcGIS, not a PGMaps icon; choose a PGMaps icon.',
      'Nothing in the symbol could be read; a plain dot stands in for it.',
    ])
    expect(read.diagnostics.some((d) => /FileGDB/.test(d.message))).toBe(true)
  })

  it('reads a unique-value line layer drawn with font glyphs as its values, glyphs refused', () => {
    const glyph = (index: number, color: unknown) => ({
      type: 'CIMSymbolReference',
      symbol: {
        type: 'CIMLineSymbol',
        symbolLayers: [
          {
            type: 'CIMCharacterMarker',
            enable: true,
            size: 12,
            markerPlacement: {
              type: 'CIMMarkerPlacementAlongLineSameSize',
              angleToLine: true,
              endings: 'WithHalfGap',
              placementTemplate: [60],
            },
            characterIndex: index,
            fontFamilyName: 'ESRI Arrowhead',
            symbol: {
              type: 'CIMPolygonSymbol',
              symbolLayers: [stroke(0.5, rgb(0, 0, 0)), fill(color).symbolLayers[0]],
            },
          },
        ],
      },
    })
    const cls = (value: string, symbol: unknown) => ({
      type: 'CIMUniqueValueClass',
      label: value,
      symbol,
      values: [{ type: 'CIMUniqueValue', fieldValues: [value] }],
      visible: true,
    })
    const layer = featureLayer('FlowLines', {
      type: 'CIMUniqueValueRenderer',
      defaultLabel: '<all other values>',
      defaultSymbol: {
        type: 'CIMSymbolReference',
        symbol: { type: 'CIMLineSymbol', symbolLayers: [stroke(1, rgb(130, 130, 130))] },
      },
      fields: ['CalculatedFlow'],
      groups: [
        {
          type: 'CIMUniqueValueGroup',
          classes: [cls('Against', glyph(196, rgb(230, 0, 0))), cls('With', glyph(68, rgb(76, 230, 0)))],
          heading: 'CalculatedFlow',
        },
      ],
      useDefaultSymbol: true,
    })
    const read = readArcgisFile('FlowLines.lyrx', layerDocument(layer))
    const rules = read.layers[0].rules
    expect(rules.map((r) => [r.label, r.filter])).toEqual([
      ['Against', { field: 'CalculatedFlow', op: 'eq', value: 'Against' }],
      ['With', { field: 'CalculatedFlow', op: 'eq', value: 'With' }],
      ['<all other values>', null],
    ])
    expect(rules[2].symbol).toEqual({
      kind: 'line',
      label: '<all other values>',
      layers: [{ color: '#828282', width: 1, cap: 'round', join: 'round' }],
    })
    const fonts = read.diagnostics.filter((d) => /symbol font/.test(d.message))
    expect(fonts.map((d) => [d.severity, d.subject])).toEqual([
      ['error', 'FlowLines: Against'],
      ['error', 'FlowLines: With'],
    ])
    expect(fonts[0].message).toMatch(/ESRI Arrowhead #196/)
  })

  it("reads Pro's class breaks, which include their upper value, exactly", () => {
    const symbol = (r: number) => ({
      type: 'CIMSymbolReference',
      symbol: { type: 'CIMLineSymbol', symbolLayers: [stroke(1, rgb(r, 0, 0))] },
    })
    const layer = featureLayer('Hotspots', {
      type: 'CIMClassBreaksRenderer',
      classBreakType: 'GraduatedColor',
      field: 'Gi_Bin',
      minimumBreak: -3,
      breaks: [-3, -2, 0, 3].map((upperBound, i) => ({
        type: 'CIMClassBreak',
        label: String(upperBound),
        symbol: symbol(i * 50),
        upperBound,
      })),
    })
    const read = readArcgisFile('Hotspots.lyrx', layerDocument(layer))
    const rules = read.layers[0]
    const classOf = (value: number) => ruleFor(rules, { Gi_Bin: value })?.label
    expect([-4, -3, -2.5, -2, -1, 0, 0.5, 3, 3.1].map(classOf)).toEqual([
      undefined,
      '-3',
      '-2',
      '-2',
      '0',
      '0',
      '3',
      '3',
      undefined,
    ])
    expect(read.diagnostics.filter((d) => d.severity !== 'info')).toEqual([])
  })

  it('refuses what is not an ArcGIS file', () => {
    expect(() => readArcgisFile('x.lyrx', 'not json')).toThrow(/not JSON/)
    expect(() => readArcgisFile('x.json', '{"type":"FeatureCollection"}')).toThrow(/not an ArcGIS Pro/)
    expect(() => readArcgisFile('x.stylx', new Uint8Array(4))).toThrow(/needs sql\.js/)
  })
})
