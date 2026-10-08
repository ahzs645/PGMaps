import { scoreRecords } from '@pgmaps/geo-toolkit/calculations/scoring'
import { resolvePaletteScale, createScaleLegend } from '@pgmaps/geo-toolkit/scales'
import {
  reconstructImageClassGrid,
  rasterGridCellRing,
  GRID_NO_DATA,
  GRID_UNCERTAIN,
} from '@pgmaps/geo-toolkit/grids/rasterClassGrid'
import type { FeatureCollection, Polygon, Point } from 'geojson'
import type { PieClusterPointProperties } from '@pgmaps/geo-toolkit/map'

// Entirely fictional data. A consumer supplies its own observations and geometry.
export const districts = [
  { id: 'riverside', label: 'Riverside', values: { parkAccess: 85, shade: 32 }, bounds: [-4.8, 50.5, -3.5, 51.4] },
  { id: 'hilltop', label: 'Hilltop', values: { parkAccess: 55, shade: 75 }, bounds: [-3.4, 50.5, -2.1, 51.4] },
  { id: 'harbour', label: 'Harbour', values: { parkAccess: 30, shade: 45 }, bounds: [-2.0, 50.5, -0.7, 51.4] },
]

export const scoreScale = resolvePaletteScale({
  domain: [0, 1],
  colors: ['#f4e7c5', '#21918c', '#133c55'],
  classes: 4,
  missingColor: '#a0a0a0',
})
export const scoreLegend = createScaleLegend(scoreScale, { title: 'Outdoor access index', unit: 'score' })

export function calculateIndex(accessWeight: number) {
  return scoreRecords(districts, {
    metrics: [
      {
        key: 'parkAccess',
        label: 'Park access',
        weight: accessWeight,
        normalization: { method: 'minMax', min: 0, max: 100 },
      },
      {
        key: 'shade',
        label: 'Tree shade',
        weight: 100 - accessWeight,
        normalization: { method: 'minMax', min: 0, max: 100 },
      },
    ],
    aggregation: { method: 'additive' },
  })
}

export function districtGeometry(
  results: readonly { record: Pick<(typeof districts)[number], 'id' | 'label' | 'bounds'>; score: number }[],
): FeatureCollection<Polygon> {
  return {
    type: 'FeatureCollection',
    features: results.map(({ record, score }) => {
      const [west, south, east, north] = record.bounds
      return {
        type: 'Feature',
        id: record.id,
        properties: { id: record.id, label: record.label, score, color: scoreScale.colorForValue(score) },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [west, south],
              [east, south],
              [east, north],
              [west, north],
              [west, south],
            ],
          ],
        },
      }
    }),
  }
}

export const habitatCategories = [
  { id: 'woodland', label: 'Woodland', color: '#21918c', rgb: [33, 145, 140] as const },
  { id: 'meadow', label: 'Meadow', color: '#f4c46b', rgb: [244, 196, 107] as const },
  { id: 'wetland', label: 'Wetland', color: '#7387dc', rgb: [115, 135, 220] as const },
]
export const habitatCounts = [7, 5, 2]
// A 4 × 4 classified source includes one disputed observation and one absent cell.
const sourceClasses = [0, 0, 1, 1, 0, 2, 1, 1, 0, 2, 0, 1, 0, 0, GRID_UNCERTAIN, GRID_NO_DATA]
const rgba = new Uint8ClampedArray(
  sourceClasses.flatMap((value) =>
    value === GRID_NO_DATA
      ? [0, 0, 0, 0]
      : value === GRID_UNCERTAIN
        ? [255, 0, 255, 255]
        : [...habitatCategories[value].rgb, 255],
  ),
)
export const habitatGrid = reconstructImageClassGrid(
  rgba,
  4,
  4,
  habitatCategories.map((category, value) => ({ value, rgb: category.rgb })),
  { cellPixels: 1, preserveSourcePixels: true },
)
export const gridGeometry: FeatureCollection<Polygon> = {
  type: 'FeatureCollection',
  features: habitatGrid.cells.map((cell, index) => {
    const ring = rasterGridCellRing(cell, habitatGrid, { x: 31, y: 21, z: 6 })
    return {
      type: 'Feature',
      id: String(index),
      properties: {
        id: String(index),
        value: cell.value,
        agreement: cell.agreement,
        label:
          cell.value === GRID_NO_DATA
            ? 'No observation'
            : cell.value === GRID_UNCERTAIN
              ? 'Uncertain observation'
              : habitatCategories[cell.value].label,
        color:
          cell.value === GRID_NO_DATA
            ? '#667085'
            : cell.value === GRID_UNCERTAIN
              ? '#df91b9'
              : habitatCategories[cell.value].color,
      },
      geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] },
    }
  }),
}
export const habitatPoints: FeatureCollection<Point, PieClusterPointProperties & { id: string; label: string }> = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-2.8, 51.0] },
      properties: { id: 'all-habitats', label: 'Habitat observations', count: 14, bandCounts: habitatCounts },
    },
  ],
}
