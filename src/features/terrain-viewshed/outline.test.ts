import { describe, expect, it } from 'vitest'
import { computeViewshed, VIEWSHED_COLORS } from './model'
import { visibilityOutline, visibilityAreas } from './outline'

const result = () =>
  computeViewshed(
    { elevationAt: () => 100 },
    {
      observer: { lng: -122, lat: 54 },
      radiusMeters: 500,
      heightA: 1.2,
      heightB: 1.7,
    },
    30,
    3,
    false,
  )

describe('visibility boundary', () => {
  it('preserves hidden and unknown holes inside visible terrain', () => {
    for (const missing of [1, 5]) {
      const grid = result()
      grid.cells.fill(4)
      grid.cells[4] = missing
      const outline = visibilityOutline(grid, 'standing')
      expect(outline.features).toHaveLength(1)
      const geometry = outline.features[0].geometry as GeoJSON.MultiPolygon
      expect(geometry.coordinates[0]).toHaveLength(2)
      expect(outline.features[0].properties?.color).toBe(VIEWSHED_COLORS.visible)
      for (const polygon of geometry.coordinates)
        for (const ring of polygon)
          for (const [lng, lat] of ring) {
            expect(lng).toBeGreaterThanOrEqual(grid.bounds[0])
            expect(lng).toBeLessThanOrEqual(grid.bounds[2])
            expect(lat).toBeGreaterThanOrEqual(grid.bounds[1])
            expect(lat).toBeLessThanOrEqual(grid.bounds[3])
          }
    }
  })

  it('traces the selected height and comparison colours without including unknown terrain', () => {
    const grid = result()
    grid.cells.fill(2)
    expect(visibilityOutline(grid, 'standing').features).toHaveLength(0)
    expect(visibilityOutline(grid, 'seated').features).toHaveLength(1)
    expect(visibilityOutline(grid, 'compare').features[0].properties?.color).toBe(VIEWSHED_COLORS.aOnly)
    grid.cells.fill(5)
    expect(visibilityOutline(grid, 'compare').features).toHaveLength(0)
  })
})

it('shades unknown terrain separately and includes hidden terrain only when requested', () => {
  const grid = result()
  grid.cells.fill(5)
  expect(visibilityAreas(grid, 'standing', false).features[0].properties?.color).toBe(VIEWSHED_COLORS.unknown)
  grid.cells.fill(1)
  expect(visibilityAreas(grid, 'standing', false).features).toHaveLength(0)
  expect(visibilityAreas(grid, 'standing', true).features[0].properties?.color).toBe(VIEWSHED_COLORS.hidden)
})
