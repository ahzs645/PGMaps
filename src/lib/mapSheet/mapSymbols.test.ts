import { describe, expect, it, vi } from 'vitest'
import {
  areaPatternId,
  areaSymbolPaint,
  keepSymbolImages,
  lineMarkerLayers,
  lineSymbolPaint,
  PX_PER_PT,
  symbolImages,
  type SymbolImageMap,
} from './mapSymbols'
import type { AreaSymbol, LineSymbol, PointSymbol } from './symbols'

const reserve: AreaSymbol = {
  kind: 'area',
  label: 'Reserves',
  hatches: [{ angleDeg: 45, spacing: 5, stroke: { color: '#38a800', width: 0.5 } }],
  outline: [{ color: '#38a800', width: 1.2 }],
}
const rail: LineSymbol = {
  kind: 'line',
  label: 'Rail',
  layers: [{ color: '#000000', width: 0.8 }],
  markers: [{ icon: 'tick', spacing: 9, size: 4, color: '#000000' }],
}
const pin: PointSymbol = { kind: 'point', label: 'Pin', icon: 'dot', size: 6, color: '#e11d48' }

describe('MapLibre symbol paints', () => {
  it('converts widths, dashes and offsets from points', () => {
    const [left, right] = lineSymbolPaint({
      kind: 'line',
      label: 'Permit',
      layers: [
        { color: '#e60000', width: 0.8, offset: -1.5, dash: [4, 4] },
        { color: '#e60000', width: 0.8, offset: 1.5 },
      ],
    })
    expect(left['line-width']).toBeCloseTo(0.8 * PX_PER_PT)
    expect(left['line-offset']).toBeCloseTo(-1.5 * PX_PER_PT)
    expect(left['line-dasharray']).toEqual([5, 5])
    expect(right['line-offset']).toBeCloseTo(2)
  })

  it('uses a fill pattern for hatched areas and a plain colour otherwise', () => {
    const hatched = areaSymbolPaint(reserve)
    expect(hatched.fill).toBeNull()
    expect(hatched.pattern).toEqual({ 'fill-pattern': areaPatternId(reserve) })
    expect(hatched.outline[0]['line-width']).toBeCloseTo(1.6)
    const plain = areaSymbolPaint({ kind: 'area', label: 'Private', fill: '#cccccc', outline: [] })
    expect(plain).toMatchObject({ fill: { 'fill-color': '#cccccc', 'fill-opacity': 1 }, pattern: null })
    // The id follows the drawing: another colour is another image.
    const recoloured = { ...reserve, hatches: [{ ...reserve.hatches![0], stroke: { color: '#000000', width: 0.5 } }] }
    expect(areaPatternId(recoloured)).not.toBe(areaPatternId(reserve))
    expect(areaPatternId({ ...reserve, label: 'Renamed' })).toBe(areaPatternId(reserve))
  })

  it('repeats line markers with symbol-placement line at the sheet spacing', () => {
    const [marker] = lineMarkerLayers(rail)
    expect(marker.layout['symbol-placement']).toBe('line')
    expect(marker.layout['symbol-spacing']).toBeCloseTo(9 * PX_PER_PT)
    expect(marker.layout['icon-rotation-alignment']).toBe('map')
    expect(symbolImages(rail, 2).map((image) => image.id)).toEqual([marker.layout['icon-image']])
  })
})

describe('keepSymbolImages', () => {
  function fakeMap() {
    const images = new Map<string, unknown>()
    const listeners = new Set<(event: { id: string }) => void>()
    const map: SymbolImageMap = {
      hasImage: (id) => images.has(id),
      addImage: vi.fn((id: string, image: unknown) => void images.set(id, image)),
      on: (_type, listener) => listeners.add(listener),
      off: (_type, listener) => listeners.delete(listener),
    }
    return { map, images, listeners, missing: (id: string) => listeners.forEach((listener) => listener({ id })) }
  }

  it('adds every image once, and again after a style reload drops them', () => {
    const { map, images, listeners, missing } = fakeMap()
    const stop = keepSymbolImages(map, [reserve, rail, pin], 2)
    expect(images.size).toBe(3)
    expect(map.addImage).toHaveBeenCalledWith(areaPatternId(reserve), expect.anything(), { pixelRatio: 2 })
    keepSymbolImages(map, [reserve], 2)
    expect(map.addImage).toHaveBeenCalledTimes(3)
    // setStyle wipes the images; MapLibre then asks for each one a layer uses.
    images.clear()
    missing(areaPatternId(reserve)!)
    missing('someone-else')
    expect([...images.keys()]).toEqual([areaPatternId(reserve)])
    stop()
    expect(listeners.size).toBe(1)
  })
})
