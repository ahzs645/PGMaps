import { describe, expect, it } from 'vitest'
import { referenceLegend, referencePlanData } from './ReferenceLayer'
import type { ReferenceFeature } from './referenceFeatures'
import {
  keepReferenceStyles,
  parseReferenceStyles,
  referenceDefaultColor,
  referenceLayerColor,
  referencePatternSymbols,
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
    const symbols = referencePatternSymbols([area, line], styles)
    expect(symbols).toHaveLength(1)
    expect(styled.pattern).toMatch(/^sheet-pattern-/)
    expect(styled.fillOpacity).toBe(0.3)
    const entry = referenceLegend([area], styles)[0].entries[0]
    expect(entry.sheetSymbol).toMatchObject({ kind: 'area', fillOpacity: 0.3 })
    // A pattern on a layer with no area needs no tile; a plain tint needs none either.
    expect(referencePatternSymbols([line], [{ layer: 'survey/boundary.kml', pattern: 'grid' }])).toEqual([])
    expect(referencePatternSymbols([area], [{ layer: 'lease.geojson', color: '#111827' }])).toEqual([])
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
})
