import { describe, expect, it } from 'vitest'
import { referenceLegend, referenceLineDash, referenceLineWidth, referencePlanData } from './ReferenceLayer'
import type { ReferenceFeature } from './referenceFeatures'
import {
  keepReferenceStyles,
  parseReferenceStyles,
  referenceDefaultColor,
  referenceLayerColor,
  referenceCustomDashes,
  referenceStyleSymbols,
  withReferenceStyle,
  type ReferenceLayerStyle,
} from './referenceStyles'

const line: ReferenceFeature = {
  id: 'l1',
  name: 'Boundary',
  source: 'survey/boundary.kml',
  geometry: {
    type: 'LineString',
    coordinates: [
      [-122.7, 53.9],
      [-122.6, 53.9],
    ],
  },
}
const area: ReferenceFeature = {
  id: 'a1',
  name: 'Lease',
  source: 'lease.geojson',
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [-122.7, 53.9],
        [-122.6, 53.9],
        [-122.6, 54],
        [-122.7, 53.9],
      ],
    ],
  },
}
const propertiesOf = (features: ReferenceFeature[], styles?: ReferenceLayerStyle[]) =>
  referencePlanData(features, styles).features.map(({ properties }) => properties!)

describe('reference layer looks', () => {
  it('draws a layer with no look exactly as before', () => {
    const [plain] = propertiesOf([line])
    expect(plain.layerColor).toBe(referenceDefaultColor('survey/boundary.kml'))
    for (const key of ['lineWidth', 'lineDash', 'fillOpacity', 'pattern']) expect(plain).not.toHaveProperty(key)
    expect(propertiesOf([line], [])).toEqual(propertiesOf([line]))
    expect(referenceLegend([line])[0].entries[0]).not.toHaveProperty('sheetSymbol')
  })

  it('adds only what the person set, to that layer only', () => {
    const styles: ReferenceLayerStyle[] = [{ layer: 'survey/boundary.kml', color: '#be185d', dash: 'solid', width: 3 }]
    const [styledLine, otherArea] = propertiesOf([line, area], styles)
    expect(styledLine).toMatchObject({ layerColor: '#be185d', lineDash: 'solid', lineWidth: 4 })
    expect(styledLine).not.toHaveProperty('pattern')
    expect(otherArea.layerColor).toBe(referenceDefaultColor('lease.geojson'))
    expect(otherArea).not.toHaveProperty('lineDash')
    expect(referenceLayerColor('survey/boundary.kml', styles)).toBe('#be185d')
  })

  it('gives a patterned area its tile, and the legend the same symbol', () => {
    const styles: ReferenceLayerStyle[] = [{ layer: 'lease.geojson', pattern: 'crosshatch', opacity: 0.3 }]
    const [styled] = propertiesOf([area], styles)
    const symbols = referenceStyleSymbols([area, line], styles)
    expect(symbols).toHaveLength(1)
    expect(styled.pattern).toMatch(/^sheet-pattern-/)
    expect(styled.fillOpacity).toBe(0.3)
    const entry = referenceLegend([area], styles)[0].entries[0]
    expect(entry.sheetSymbol).toMatchObject({ kind: 'area', fillOpacity: 0.3 })
    // A pattern on a layer with no area needs no tile; a plain tint needs none either.
    expect(referenceStyleSymbols([line], [{ layer: 'survey/boundary.kml', pattern: 'grid' }])).toEqual([])
    expect(referenceStyleSymbols([area], [{ layer: 'lease.geojson', color: '#111827' }])).toEqual([])
  })

  it('replaces one layer’s look and removes it when everything is back to the default', () => {
    const first = withReferenceStyle(undefined, 'lease.geojson', { color: '#111827' })
    const second = withReferenceStyle(first, 'survey/boundary.kml', { dash: 'dotted' })
    expect(second).toHaveLength(2)
    expect(withReferenceStyle(second, 'lease.geojson', { pattern: 'dots' })).toContainEqual({
      layer: 'lease.geojson',
      pattern: 'dots',
    })
    expect(withReferenceStyle(second, 'lease.geojson', {})).toEqual([{ layer: 'survey/boundary.kml', dash: 'dotted' }])
  })

  it('forgets the look of a layer that is gone, and refuses a file it cannot read', () => {
    const styles = parseReferenceStyles([
      { layer: 'lease.geojson', color: '#111827' },
      { layer: 'removed.kml', dash: 'solid' },
    ])
    expect(keepReferenceStyles(styles, [area])).toEqual([{ layer: 'lease.geojson', color: '#111827' }])
    expect(() => parseReferenceStyles([{ color: '#111827' }])).toThrow('needs its layer')
    expect(() => parseReferenceStyles([{ layer: 'a', pattern: 'zigzag' }])).toThrow('unknown pattern')
    expect(() => parseReferenceStyles([{ layer: 'a' }, { layer: 'a' }])).toThrow('one look')
    expect(() => parseReferenceStyles({})).toThrow('must be a list')
  })

  it('draws a ground width to scale at the feature’s latitude, and a pixel width as itself', () => {
    const [metres] = propertiesOf([line], [{ layer: 'survey/boundary.kml', widthM: 10 }])
    // 53.9° N: Web Mercator stretches the ground by 1 / cos(latitude), about 1.7.
    expect(metres.lineWidthM).toBeCloseTo(10 / Math.cos((53.9 * Math.PI) / 180), 6)
    expect(metres).not.toHaveProperty('lineWidth')
    const width = referenceLineWidth(2.25, 'l1') as unknown[]
    expect(width.slice(0, 4)).toEqual(['interpolate', ['exponential', 2], ['zoom'], 0])
    expect(width[5]).toBe(24)
    // Pixels a metre at zoom 0 and zoom 24 differ by exactly 2^24, so the interpolation is exact.
    const perMetre = (stop: unknown) => (((stop as unknown[])[2] as unknown[])[2] as unknown[])[2] as number
    expect(perMetre(width[6]) / perMetre(width[4])).toBe(2 ** 24)
    expect(JSON.stringify(width[4])).toContain('"l1"')
  })

  it('carries a custom dash by key and maps the key back to its lengths', () => {
    const styles: ReferenceLayerStyle[] = [{ layer: 'survey/boundary.kml', dash: 'custom', dashPattern: [6, 2, 1, 2] }]
    const [styled] = propertiesOf([line], styles)
    expect(styled.lineDash).toBe('custom:6,2,1,2')
    const dashes = referenceCustomDashes(styles)
    expect([...dashes]).toEqual([['custom:6,2,1,2', [6, 2, 1, 2]]])
    const expression = JSON.stringify(referenceLineDash(dashes))
    expect(expression).toContain('"custom:6,2,1,2",["literal",[6,2,1,2]]')
    expect(expression).toContain('"solid",["literal",[1,0]]')
    expect(() => parseReferenceStyles([{ layer: 'a', dash: 'custom' }])).toThrow('no dash')
  })

  it('gives a line its marks, a point its shape, and an outline-only area no tint', () => {
    const point: ReferenceFeature = {
      id: 'p1',
      name: 'Landing',
      source: 'landings.csv',
      geometry: { type: 'Point', coordinates: [-122.7, 53.9] },
    }
    const styles: ReferenceLayerStyle[] = [
      { layer: 'survey/boundary.kml', marker: 'arrow' },
      { layer: 'landings.csv', icon: 'tree', size: 14 },
      { layer: 'lease.geojson', noFill: true, pattern: 'diagonal', patternColor: '#111827' },
    ]
    const [styledLine, styledArea, styledPoint] = propertiesOf([line, area, point], styles)
    expect(styledLine.lineMarker).toMatch(/^sheet-marker-/)
    expect(styledPoint.pointIcon).toMatch(/^sheet-point-/)
    expect(styledArea.fillOpacity).toBe(0)
    const symbols = referenceStyleSymbols([line, area, point], styles)
    expect(symbols.map(({ kind }) => kind).sort()).toEqual(['area', 'line', 'point'])
    const areaSymbol = symbols.find(({ kind }) => kind === 'area')
    expect(areaSymbol).toMatchObject({ fillOpacity: 0, hatches: [{ stroke: { color: '#111827' } }] })
    // A point with only a colour keeps the ringed dot: no image, no icon property.
    expect(propertiesOf([point], [{ layer: 'landings.csv', color: '#111827' }])[0]).not.toHaveProperty('pointIcon')
    expect(referenceStyleSymbols([point], [{ layer: 'landings.csv', color: '#111827' }])).toEqual([])
  })
})
