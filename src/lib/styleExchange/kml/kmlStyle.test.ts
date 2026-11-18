import { describe, expect, it } from 'vitest'
import { CONSTRAINT_AREA, OTHER_BLOCK, proposedRoad } from '@/lib/forestry/blockSheet/styles'
import { PX_PER_PT } from '@/lib/mapSheet/symbolRaster'
import { kmlDotIconRgba, kmlStyleForSymbol, KML_ICON_PX, KML_MIN_ICON_SCALE } from './kmlStyle'

describe('KML styles from PGMaps symbols', () => {
  it('draws a line as its widest stroke and reports the strokes and dashes it leaves out', () => {
    const { style, diagnostics } = kmlStyleForSymbol(proposedRoad('#d97706', 'detail'), 'Roads')
    expect(style).toEqual({ lineColor: '#d97706', lineWidth: Number((2.5 * PX_PER_PT).toFixed(2)) })
    expect(diagnostics.map((d) => d.message)).toEqual([
      '1 more stroke left out; KML draws one line, the widest stroke (#d97706).',
    ])
    expect(diagnostics[0]).toMatchObject({ format: 'kml', subject: 'Roads', severity: 'warning' })
    const dashed = kmlStyleForSymbol(
      { kind: 'line', label: 'Trail', layers: [{ color: 'rgba(0, 0, 255, 0.5)', width: 1, dash: [2, 2] }] },
      'Trails',
    )
    expect(dashed.style).toMatchObject({ lineColor: '#0000ff', lineOpacity: 0.5 })
    expect(dashed.diagnostics.map((d) => d.message)).toEqual(['Dashes left out; the line is drawn solid.'])
  })

  it('draws a hatch as a fill of its colour at the share its lines ink, and keeps the outline', () => {
    const { style, diagnostics } = kmlStyleForSymbol(CONSTRAINT_AREA, 'Constraints')
    // 0.5 pt lines every 5 pt ink a tenth of the area.
    expect(style).toMatchObject({ fillColor: '#e60000', fillOpacity: 0.1, lineColor: '#a80000' })
    expect(diagnostics[0].message).toMatch(/^Hatch drawn as a 10% fill/)
    const outlineOnly = kmlStyleForSymbol(OTHER_BLOCK, 'Blocks')
    expect(outlineOnly.style).toMatchObject({ fillOpacity: 0, lineColor: '#000000' })
    expect(outlineOnly.diagnostics).toEqual([])
  })

  it('draws a point as the given icon in its colour, never smaller than half the client’s icon', () => {
    const dot = kmlStyleForSymbol(
      { kind: 'point', label: 'Station', icon: 'dot', size: 2.5, color: '#1c1917' },
      'Stations',
      { iconHref: 'icons/dot.png' },
    )
    expect(dot.style).toEqual({ iconColor: '#1c1917', iconScale: KML_MIN_ICON_SCALE, iconHref: 'icons/dot.png' })
    expect(dot.diagnostics.map((d) => d.severity)).toEqual(['info'])
    const large = kmlStyleForSymbol(
      { kind: 'point', label: 'Pin', icon: 'diamond', size: 36, color: '#ff0000', halo: { color: '#fff', width: 1 } },
      'Pins',
      { iconHref: 'icons/dot.png' },
    )
    expect(large.style.iconScale).toBeCloseTo((36 * PX_PER_PT) / KML_ICON_PX, 3)
    expect(large.diagnostics.map((d) => d.message)).toEqual([
      'The "diamond" icon is drawn as a dot in its colour.',
      'The halo round the icon left out.',
    ])
  })

  it('makes a white disc that a KML client tints', () => {
    const rgba = kmlDotIconRgba(32)
    const at = (x: number, y: number) => rgba[(y * 32 + x) * 4 + 3]
    expect(at(16, 16)).toBe(255)
    expect(at(0, 0)).toBe(0)
    expect(rgba[(16 * 32 + 16) * 4]).toBe(255)
  })
})
