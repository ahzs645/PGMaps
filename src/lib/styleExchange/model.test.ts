import { describe, expect, it } from 'vitest'
import { catalogueSymbolLibrary } from '@/lib/forestry/blockSheet/symbolLibrary'
import { FIXTURE_DATA, FIXTURE_DOCUMENT } from './fixtures'
import { iconFromSvg, iconShapes, iconSvg } from './iconGeometry'
import { parseColor, toHexAlpha } from './color'
import { documentProblems, ruleFor } from './model'

describe('style exchange model', () => {
  it('accepts the fixture and draws each fixture feature with the rule named after it', () => {
    expect(documentProblems(FIXTURE_DOCUMENT)).toEqual([])
    const roads = FIXTURE_DOCUMENT.layers.find((l) => l.id === 'road_centrelines')!
    const labels = FIXTURE_DATA.road_centrelines.features.map((f) => ruleFor(roads, f.properties!)?.label)
    expect(labels).toEqual(['Main line', 'Spur A / Spur B', 'Steep (12 % and over)', 'Proposed road'])
  })
  it('refuses an else rule that is not last and a filter on a missing field', () => {
    const layer = FIXTURE_DOCUMENT.layers[0]
    const broken = {
      ...FIXTURE_DOCUMENT,
      layers: [
        {
          ...layer,
          rules: [layer.rules[5], { ...layer.rules[0], filter: { field: 'NOPE', op: 'eq' as const, value: 1 } }],
        },
      ],
    }
    expect(documentProblems(broken)).toHaveLength(2)
  })
  it('reads the colour forms symbols use', () => {
    expect(parseColor('#abc')).toEqual({ r: 170, g: 187, b: 204, a: 1 })
    expect(toHexAlpha(parseColor('rgba(255, 0, 0, 0.5)')!)).toBe('#ff000080')
    expect(parseColor('nonsense')).toBeNull()
  })
  it('marks icon SVGs so a reader recognises them, and closes icon polygons', () => {
    const { svg, side } = iconSvg('culvert', 10, { primary: '#e60000' }, { color: '#ffffff', width: 1 })
    expect(iconFromSvg(svg)).toBe('culvert')
    expect(side).toBeGreaterThan(10)
    for (const shape of iconShapes('diamond', { primary: '#000000' }).filter((s) => s.kind === 'polygon'))
      expect(shape.points[0]).toEqual(shape.points[shape.points.length - 1])
  })
  it('lists every catalogue symbol in the library', () => {
    const library = catalogueSymbolLibrary()
    expect(library.symbols.length).toBeGreaterThan(100)
    expect(new Set(library.symbols.map((s) => s.id)).size).toBe(library.symbols.length)
  })
})
