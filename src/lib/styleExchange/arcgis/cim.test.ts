import { describe, expect, it } from 'vitest'
import { catalogueSymbolLibrary } from '@/lib/forestry/blockSheet/symbolLibrary'
import type { AreaSymbol, LineSymbol, PointSymbol } from '@/lib/mapSheet/symbols'
import { cimSymbol, sheetSymbolFromCim } from './cim'
import { colorFromCim } from './cimCommon'
import { canonicalSymbol } from './testCanonical'

type Layer = Record<string, unknown>
const layersOf = (symbol: Record<string, unknown>) => symbol.symbolLayers as Layer[]

describe('CIM symbols', () => {
  const library = catalogueSymbolLibrary()

  it.each(['cim', 'compact'] as const)('writes and reads back every catalogue symbol (%s colours)', (colors) => {
    for (const item of library.symbols) {
      const written = cimSymbol(item.symbol, { colors })
      const read = sheetSymbolFromCim(JSON.parse(JSON.stringify(written.symbol)), { label: item.name })
      expect(
        read.diagnostics.filter((d) => d.severity !== 'info'),
        item.id,
      ).toEqual([])
      expect(read.symbol?.kind === 'class' || read.symbol?.kind === item.symbol.kind, item.id).toBe(true)
      expect(canonicalSymbol(read.symbol!), item.id).toEqual(canonicalSymbol(item.symbol))
    }
  })

  it('puts the top layer first, flips offsets to CIM left-positive and moves an inner casing inward', () => {
    const line: LineSymbol = {
      kind: 'line',
      label: 'Offset',
      layers: [
        { color: '#000000', width: 4 },
        { color: '#ff0000', width: 1, offset: 2, dash: [3, 2] },
      ],
    }
    const out = layersOf(cimSymbol(line).symbol)
    expect(out.map((l) => l.width)).toEqual([1, 4])
    expect(out[0].effects).toEqual([
      { type: 'CIMGeometricEffectOffset', method: 'Mitered', offset: -2, option: 'Accurate' },
      {
        type: 'CIMGeometricEffectDashes',
        dashTemplate: [3, 2],
        lineDashEnding: 'NoConstraint',
        offsetAlongLine: 0,
        controlPointEnding: 'NoConstraint',
      },
    ])
    expect(out[0].color).toEqual({ type: 'CIMRGBColor', values: [255, 0, 0, 100] })
    const area: AreaSymbol = {
      kind: 'area',
      label: 'Casing',
      fill: '#00ff00',
      fillOpacity: 0.5,
      hatches: [{ angleDeg: 45, spacing: 6, stroke: { color: '#0000ff', width: 1 }, phase: 3 }],
      outline: [{ color: '#000000', width: 3, inside: true }],
    }
    const written = cimSymbol(area, { colors: 'compact' })
    const polygon = layersOf(written.symbol)
    expect(polygon.map((l) => l.type)).toEqual(['CIMSolidStroke', 'CIMHatchFill', 'CIMSolidFill'])
    expect((polygon[0].effects as Layer[])[0].offset).toBe(-1.5)
    expect(polygon[1]).toMatchObject({ rotation: 45, separation: 6, offsetY: -3 })
    expect(polygon[2].color).toEqual([0, 255, 0, 128])
    expect(written.diagnostics.map((d) => d.severity)).toEqual(['info'])
  })

  it('names every icon part so the reader recognises it, halo layers under the body', () => {
    const point: PointSymbol = {
      kind: 'point',
      label: 'Culvert',
      icon: 'culvert',
      size: 10,
      color: '#e60000',
      halo: { color: '#ffffff', width: 1 },
    }
    const names = layersOf(cimSymbol(point).symbol).map((l) => l.primitiveName)
    expect(names).toEqual([
      'pgmaps-icon:culvert:1',
      'pgmaps-icon:culvert:0',
      'pgmaps-icon-halo:culvert:1',
      'pgmaps-icon-halo:culvert:0',
    ])
  })

  it('reads lyrx (0–100) and stylx (0–255) colour encodings alike', () => {
    expect(colorFromCim({ type: 'CIMRGBColor', values: [10, 20, 30, 50] })?.color).toEqual({
      r: 10,
      g: 20,
      b: 30,
      a: 0.5,
    })
    expect(colorFromCim([10, 20, 30, 51])?.color).toEqual({ r: 10, g: 20, b: 30, a: 0.2 })
    expect(colorFromCim({ type: 'CIMCMYKColor', values: [0, 0, 0, 100, 100] })?.approximate).toMatch(/CMYK/)
  })

  it('refuses font glyphs and foreign markers, never extracting them, and stands in a dot only when asked', () => {
    const font = {
      type: 'CIMPointSymbol',
      symbolLayers: [
        {
          type: 'CIMCharacterMarker',
          enable: true,
          characterIndex: 33,
          fontFamilyName: 'ESRI Default Marker',
          size: 12,
          symbol: {
            type: 'CIMPolygonSymbol',
            symbolLayers: [{ type: 'CIMSolidFill', enable: true, color: [0, 112, 255, 255] }],
          },
        },
      ],
    }
    const refused = sheetSymbolFromCim(font)
    expect(refused.symbol).toBeUndefined()
    expect(refused.diagnostics[0]).toMatchObject({ severity: 'error' })
    expect(refused.diagnostics[0].message).toMatch(/symbol font \(ESRI Default Marker #33\); choose a PGMaps icon/)
    const stood = sheetSymbolFromCim(font, { substitute: true, label: 'Hydrant' })
    expect(stood.symbol).toMatchObject({ kind: 'point', icon: 'dot', size: 12 })
    expect(stood.diagnostics.some((d) => /plain dot stands in/.test(d.message))).toBe(true)

    const foreign = {
      type: 'CIMLineSymbol',
      symbolLayers: [
        {
          type: 'CIMVectorMarker',
          enable: true,
          size: 6,
          markerPlacement: { type: 'CIMMarkerPlacementAlongLineSameSize', placementTemplate: [60] },
          frame: { xmin: -5, ymin: -5, xmax: 5, ymax: 5 },
          markerGraphics: [
            {
              type: 'CIMMarkerGraphic',
              geometry: {
                rings: [
                  [
                    [0, 0],
                    [1, 0],
                    [0, 1],
                    [0, 0],
                  ],
                ],
              },
            },
          ],
        },
        { type: 'CIMSolidStroke', enable: true, width: 1, color: { type: 'CIMRGBColor', values: [0, 0, 0, 100] } },
      ],
    }
    const line = sheetSymbolFromCim(foreign)
    expect(line.symbol).toMatchObject({ kind: 'line', layers: [{ color: '#000000', width: 1 }] })
    expect(line.symbol && 'markers' in line.symbol).toBe(false)
    expect(line.diagnostics.map((d) => d.severity)).toEqual(['error'])
  })

  it('warns when a PGMaps icon was reshaped in ArcGIS and errors when its parts were split up', () => {
    const point: PointSymbol = { kind: 'point', label: 'Dot', icon: 'diamond', size: 8, color: '#123456' }
    const written = cimSymbol(point).symbol
    const layers = layersOf(written)
    const graphic = (layers[0].markerGraphics as Layer[])[0]
    graphic.geometry = {
      rings: [
        [
          [0, 0],
          [9, 0],
          [9, 9],
          [0, 0],
        ],
      ],
    }
    expect(
      sheetSymbolFromCim(written).diagnostics.some((d) => d.severity === 'warning' && /edited/.test(d.message)),
    ).toBe(true)
    const split = { ...written, symbolLayers: layers.slice(0, 1) }
    if (layers.length > 1) expect(sheetSymbolFromCim(split).diagnostics.some((d) => d.severity === 'error')).toBe(true)
  })

  it('reads a class colour back as a class, and a picture fill as an error', () => {
    const cls = cimSymbol({ kind: 'class', label: 'Class', color: '#336699', opacity: 0.4 }).symbol
    expect(sheetSymbolFromCim(cls).symbol).toEqual({ kind: 'class', label: 'Symbol', color: '#336699', opacity: 0.4 })
    const picture = {
      type: 'CIMPolygonSymbol',
      symbolLayers: [{ type: 'CIMPictureFill', enable: true, url: 'data:,' }],
    }
    const read = sheetSymbolFromCim(picture)
    expect(read.symbol).toBeUndefined()
    expect(read.diagnostics[0].message).toMatch(/picture fill/)
  })
})
