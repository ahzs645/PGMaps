/** Fixtures for the GIS writers' tests. No DOM or network access. */
import type { ShapeLayer } from './shapefile'

/** Shaped like the road designer's `roadShapefileLayers`: a centreline and its stations. */
export const ROAD_SHAPE_LAYERS: ShapeLayer[] = [
  {
    name: 'road_centrelines',
    type: 'polyline',
    fields: [
      { name: 'NAME', type: 'C', length: 80 },
      { name: 'LENGTH_M', type: 'N', length: 12, decimals: 2 },
      { name: 'COST_CAD', type: 'N', length: 14, decimals: 0 },
    ],
    features: [
      {
        parts: [
          [
            [-122.8, 53.9],
            [-122.797, 53.902],
          ],
        ],
        attributes: { NAME: 'Spur road · été', LENGTH_M: 300.12, COST_CAD: 41_500 },
      },
    ],
  },
  {
    name: 'road_stations',
    type: 'point',
    fields: [
      { name: 'STATION_M', type: 'N', length: 12, decimals: 2 },
      { name: 'FLAGS', type: 'C', length: 200 },
    ],
    features: [
      { point: [-122.8, 53.9], attributes: { STATION_M: 0, FLAGS: '' } },
      { point: [-122.7985, 53.901], attributes: { STATION_M: 150, FLAGS: 'steep; cut > 2 m' } },
    ],
  },
  {
    name: 'context_areas',
    type: 'polygon',
    fields: [{ name: 'NAME', type: 'C', length: 80 }],
    features: [
      {
        parts: [
          [
            [-122.81, 53.9],
            [-122.8, 53.9],
            [-122.8, 53.91],
            [-122.81, 53.91],
          ],
        ],
        attributes: { NAME: 'Block A' },
      },
    ],
  },
]
