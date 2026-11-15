import { describe, expect, it } from 'vitest'
import { symbolStyleFromQml } from './qmlStyle'
import { parseSymbolStyle, symbolStyleForShape } from './symbolStyle'

const qml = (renderer: string, symbolType: string, layers: string) =>
  `<!DOCTYPE qgis><qgis version="3.34"><renderer-v2 type="${renderer}"><symbols>` +
  `<symbol name="0" type="${symbolType}" alpha="1">${layers}</symbol></symbols></renderer-v2></qgis>`
const layer = (className: string, values: Record<string, string>) =>
  `<layer class="${className}" enabled="1"><Option type="Map">${Object.entries(values)
    .map(([name, value]) => `<Option type="QString" name="${name}" value="${value}"/>`)
    .join('')}</Option></layer>`

describe('QGIS style files', () => {
  it('reads a dashed line: colour, width in points, and pen style', () => {
    const look = symbolStyleFromQml(
      qml(
        'singleSymbol',
        'line',
        layer('SimpleLine', {
          line_color: '190,24,93,255,rgb:0.74,0.09,0.36,1',
          line_width: '0.66',
          line_width_unit: 'MM',
          line_style: 'dash',
        }),
      ),
    )
    expect(look.shape).toBe('line')
    expect(look.style).toEqual({ color: '#be185d', width: 1.85, dash: 'dashed' })
    expect(look.notes).toEqual([])
    // What comes out is a look the project file accepts.
    expect(parseSymbolStyle(look.style)).toEqual(look.style)
  })

  it('reads a ground width and a custom dash counted in line widths', () => {
    const look = symbolStyleFromQml(
      qml(
        'singleSymbol',
        'line',
        layer('SimpleLine', {
          line_color: '0,0,0,255',
          line_width: '1',
          line_width_unit: 'MM',
          use_custom_dash: '1',
          customdash: '5;2',
          customdash_unit: 'MM',
        }),
      ),
    )
    expect(look.style).toMatchObject({ dash: 'custom', dashPattern: [5, 2] })
    const ground = symbolStyleFromQml(
      qml('singleSymbol', 'line', layer('SimpleLine', { line_width: '8', line_width_unit: 'RenderMetersInMapUnits' })),
    )
    expect(ground.style).toEqual({ widthM: 8 })
  })

  it('reads a hatched polygon as an outline with a pattern, and a hollow one as its outline colour', () => {
    const hatched = symbolStyleFromQml(
      qml(
        'singleSymbol',
        'fill',
        layer('SimpleFill', {
          color: '180,83,9,128',
          style: 'b_diagonal',
          outline_color: '180,83,9,255',
          outline_width: '0.26',
          outline_style: 'solid',
        }),
      ),
    )
    expect(hatched.shape).toBe('area')
    expect(hatched.style).toMatchObject({
      color: '#b45309',
      opacity: 0.5,
      pattern: 'diagonal',
      noFill: true,
      dash: 'solid',
    })
    const hollow = symbolStyleFromQml(
      qml(
        'singleSymbol',
        'fill',
        layer('SimpleFill', { color: '255,255,0,255', style: 'no', outline_color: '0,0,0,255' }),
      ),
    )
    expect(hollow.style).toMatchObject({ noFill: true, color: '#000000' })
  })

  it('reads the older prop form, a marker, and says what it left out', () => {
    const old =
      '<qgis><renderer-v2 type="categorizedSymbol"><symbols><symbol type="marker" name="0">' +
      '<layer class="SimpleMarker"><prop k="color" v="4,120,87,255"/><prop k="size" v="4"/>' +
      '<prop k="size_unit" v="MM"/><prop k="name" v="star"/></layer>' +
      '<layer class="SimpleMarker"><prop k="color" v="0,0,0,255"/></layer></symbol></symbols></renderer-v2></qgis>'
    const look = symbolStyleFromQml(old)
    expect(look.shape).toBe('point')
    expect(look.style).toEqual({ color: '#047857', size: 11 })
    expect(look.notes).toHaveLength(3)
    expect(look.notes.join(' ')).toMatch(/first symbol.*2 layers.*"star"/)
  })

  it('refuses a file with no symbol, and keeps only what the layer’s shape can show', () => {
    expect(() => symbolStyleFromQml('<qgis><renderer-v2 type="singleSymbol"/></qgis>')).toThrow('no QGIS symbol')
    expect(() => symbolStyleFromQml('not xml at all')).toThrow('no QGIS symbol')
    const area = { color: '#b45309', pattern: 'grid', noFill: true, dash: 'dotted', width: 2 } as const
    expect(symbolStyleForShape(area, 'line')).toEqual({ color: '#b45309', dash: 'dotted', width: 2 })
    expect(symbolStyleForShape(area, 'point')).toEqual({ color: '#b45309' })
    expect(symbolStyleForShape({ dash: 'custom', marker: 'arrow' }, 'area')).toEqual({})
  })
})
