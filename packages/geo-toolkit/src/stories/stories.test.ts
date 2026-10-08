import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { StoryCover } from './components/StoryCover.js'
import { CategoryDotDiagram } from './diagrams/CategoryDotDiagram.js'
import { ancestorIds, radialHierarchyLayout, selectedDots } from './diagrams/storyDiagrams.js'
import { parseEditorialDocument, validateEditorialDocument } from './model/validate.mjs'
import type { NativeEditorialDocument } from './model/types.js'
import { buildLegend, paneZoomOffset, resolveLayer } from './storyScene.js'

/** An independent organization supplies content; no PGMaps fixtures or catalogs. */
function document(): NativeEditorialDocument {
  return {
    schema: 'pgmaps-editorial-v1',
    title: 'Community garden access',
    categories: [{ id: 'garden', label: 'Community garden', color: '#008866' }],
    maps: {
      access: {
        attribution: 'Example community survey',
        layers: [
          {
            id: 'locations',
            data: 'https://example.org/gardens.geojson',
            geometry: 'point',
            idProperty: 'id',
            labelProperty: 'name',
            fillColor: '#008866',
            fillOpacity: 1,
            lineColor: '#ffffff',
            lineOpacity: 1,
            lineWidth: 1,
          },
        ],
      },
    },
    views: { overview: { mapId: 'access', camera: { center: [10, 40], zoom: 9 }, visibleLayerIds: ['locations'] } },
    diagrams: {},
    actions: { overview: { type: 'set-map-view', targetId: 'garden-map', viewId: 'overview' } },
    chapters: [
      {
        id: 'intro',
        title: 'Nearby gardens',
        blocks: [
          { id: 'garden-map', type: 'map', mapId: 'access', viewId: 'overview' },
          { id: 'explanation', type: 'paragraph', text: [{ text: 'Show all gardens', actionId: 'overview' }] },
        ],
      },
    ],
  }
}

describe('portable story authoring', () => {
  it('validates unrelated source data and rejects incompatible view targets before rendering', () => {
    const authored = document()
    expect(validateEditorialDocument(authored)).toEqual([])
    expect(parseEditorialDocument(authored)).toBe(authored)
    authored.views.overview.mapId = 'unknown'
    expect(validateEditorialDocument(authored).join(' ')).toContain('unknown reference unknown')
    expect(() => parseEditorialDocument(authored)).toThrow(/unknown reference unknown/)
  })

  it('rejects executable URLs and malformed nested values', () => {
    const authored = document()
    authored.chapters[0].blocks.push({ id: 'unsafe', type: 'image', src: 'javascript:alert(1)', alt: 'Image' })
    expect(validateEditorialDocument(authored).join(' ')).toMatch(/safe src/)
    expect(validateEditorialDocument({ ...document(), chapters: [null] }).length).toBeGreaterThan(0)
  })

  it('derives map paint and matching legend categories from one authored definition', () => {
    const layer = document().maps.access.layers[0]
    layer.category = { property: 'access', colors: { Open: '#008866', Closed: '#995533' }, fallback: '#888888' }
    const resolved = resolveLayer(layer, 'Gardens', undefined, '#008866')
    expect(resolved.fillColor).toEqual(['match', ['get', 'access'], 'Open', '#008866', 'Closed', '#995533', '#888888'])
    expect(buildLegend(undefined, [resolved], new Set(['locations']), '#008866')).toEqual([
      { key: 'locations-Open', label: 'Open', color: '#008866', layerId: 'locations' },
      { key: 'locations-Closed', label: 'Closed', color: '#995533', layerId: 'locations' },
    ])
    expect(
      buildLegend(undefined, [resolved], new Set(['locations']), '#008866', () => [
        { label: 'Host scale', color: '#112233' },
      ]),
    ).toEqual([{ key: 'locations-0', label: 'Host scale', color: '#112233', layerId: 'locations' }])
    expect(paneZoomOffset({ width: 500, height: 700 })).toBe(-1)
  })
})

describe('portable story diagrams', () => {
  it('preserves stable geometry, ancestor paths and authored coordinates under combined filters', () => {
    const tree = [
      { id: 'root', label: 'Access' },
      { id: 'leaf', parentId: 'root', label: 'Garden', categoryId: 'garden' },
    ]
    expect(radialHierarchyLayout(tree)).toEqual(radialHierarchyLayout(tree))
    expect(ancestorIds(tree, 'leaf')).toEqual(new Set(['leaf', 'root']))
    const points = [
      { id: 'one', x: 0.5, y: 0.5, categoryId: 'garden' },
      { id: 'two', x: 0.5, y: 0.5, categoryId: 'other' },
      { id: 'three', x: 1, y: 1, categoryId: 'garden' },
    ]
    const before = structuredClone(points)
    expect(
      selectedDots(points, {
        id: 'nearby',
        label: 'Nearby',
        categoryIds: ['garden'],
        region: { x: 0.5, y: 0.5, radius: 0.2 },
      }),
    ).toEqual([points[0]])
    expect(points).toEqual(before)
  })

  it('retains the step denominator when a category is highlighted', () => {
    const markup = renderToStaticMarkup(
      createElement(CategoryDotDiagram, {
        diagram: {
          type: 'category-dots',
          title: 'Access',
          description: 'Survey locations',
          mode: 'measured',
          unit: 'locations',
          points: [
            { id: 'one', x: 0, y: 0, categoryId: 'garden' },
            { id: 'two', x: 1, y: 1, categoryId: 'other' },
          ],
          steps: [],
        },
        categories: [
          { id: 'garden', label: 'Garden', color: '#008866' },
          { id: 'other', label: 'Other', color: '#995533' },
        ],
        selectedCategory: 'garden',
        onSelect: () => {},
      }),
    )
    expect(markup).toContain('2 / 2 dots')
    expect(markup).toContain('Measured data')
    expect(markup).toContain('opacity="0.15"')
  })

  it('renders an authored cover in a server-rendered website', () => {
    expect(
      renderToStaticMarkup(createElement(StoryCover, { title: 'Community gardens', summary: 'Public access' })),
    ).toContain('Community gardens')
  })
})
