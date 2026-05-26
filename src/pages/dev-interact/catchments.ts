import type { DischargeType, InteractFeatureProperties, RiskClass, StyleAttribute } from './types'

// =============================================================================
// Sample "sewage spill" catchment grid
// =============================================================================
// A deterministic grid of sub-catchment cells used by the data-driven styling
// scenario. Mirrors how Felt renders a dataset by an attribute (graduated spill
// hours or categorical risk/discharge type) with a matching legend. The grid is
// a stand-in for the binned pollution aggregations shown on Felt's Watershed
// Pollution Map.

/** Bounding box for the sample grid — covers the Prince George demo extent. */
const LNG_MIN = -122.886
const LNG_MAX = -122.626
const LAT_MIN = 53.852
const LAT_MAX = 53.972
const COLS = 6
const ROWS = 5
/** Fraction of each cell left as a gap, so the grid reads as discrete tiles. */
const CELL_INSET = 0.12

/** Ascending numeric breaks for the graduated "spill hours" style. */
export const SPILL_BREAKS = [60, 200, 600] as const
export const SPILL_UNIT = 'hrs'

/** Risk classes align 1:1 with the four spill-hour buckets (low → severe). */
export const RISK_CLASSES: readonly RiskClass[] = ['Low', 'Moderate', 'High', 'Severe']
export const RISK_COLORS: Record<RiskClass, string> = {
  Low: '#16a34a',
  Moderate: '#eab308',
  High: '#f97316',
  Severe: '#dc2626',
}

export const DISCHARGE_TYPES: readonly DischargeType[] = [
  'Storm overflow',
  'Treated effluent',
  'Industrial',
  'Agricultural',
]
export const DISCHARGE_COLORS: Record<DischargeType, string> = {
  'Storm overflow': '#0284c7',
  'Treated effluent': '#7c3aed',
  Industrial: '#db2777',
  Agricultural: '#65a30d',
}

/** Attributes the styling scenario can color the catchment cells by. */
export const STYLE_ATTRIBUTES: readonly StyleAttribute[] = [
  { id: 'spillHours', label: 'Spill hours', kind: 'graduated' },
  { id: 'riskClass', label: 'Risk class', kind: 'categorical' },
  { id: 'dischargeType', label: 'Discharge type', kind: 'categorical' },
]

const ROW_LETTERS = 'ABCDE'

/** Deterministic 0..1 pseudo-random so cell styling is stable across renders. */
function pseudo(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}

export function spillBucketIndex(spillHours: number): number {
  if (spillHours < SPILL_BREAKS[0]) return 0
  if (spillHours < SPILL_BREAKS[1]) return 1
  if (spillHours < SPILL_BREAKS[2]) return 2
  return 3
}

function catchmentCell(row: number, col: number): GeoJSON.Feature<GeoJSON.Polygon, InteractFeatureProperties> {
  const index = row * COLS + col
  const cellW = (LNG_MAX - LNG_MIN) / COLS
  const cellH = (LAT_MAX - LAT_MIN) / ROWS
  const insetX = (cellW * CELL_INSET) / 2
  const insetY = (cellH * CELL_INSET) / 2
  const lng0 = LNG_MIN + col * cellW + insetX
  const lng1 = LNG_MIN + (col + 1) * cellW - insetX
  const lat0 = LAT_MIN + row * cellH + insetY
  const lat1 = LAT_MIN + (row + 1) * cellH - insetY

  const spillHours = Math.round(pseudo(index + 1) ** 3.2 * 1450)
  const bucket = spillBucketIndex(spillHours)
  const riskClass = RISK_CLASSES[bucket]
  const dischargeType = DISCHARGE_TYPES[Math.floor(pseudo(index + 101) * DISCHARGE_TYPES.length) % DISCHARGE_TYPES.length]
  const sampleSites = 2 + Math.floor(pseudo(index + 7) * 6)
  const areaKm2 = (8 + pseudo(index + 13) * 11).toFixed(1)
  const cellName = `${ROW_LETTERS[row]}${col + 1}`
  const id = `catchment-${cellName.toLowerCase()}`

  return {
    type: 'Feature',
    id,
    properties: {
      id,
      name: `Catchment ${cellName}`,
      layer: 'catchments',
      description: `Sub-catchment aggregating outfall monitoring for grid cell ${cellName}.`,
      value: `${spillHours} spill ${SPILL_UNIT}`,
      issuedYear: 2014 + (index % 11),
      cost: 0,
      spillHours,
      riskClass,
      dischargeType,
      properties: [
        { label: 'Risk class', value: riskClass },
        { label: 'Annual spill hours', value: `${spillHours.toLocaleString()} ${SPILL_UNIT}` },
        { label: 'Discharge type', value: dischargeType },
        { label: 'Monitoring sites', value: String(sampleSites) },
        { label: 'Catchment area', value: `${areaKm2} sq km` },
        { label: 'Monitoring', value: 'Active' },
      ],
    },
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [lng0, lat0],
        [lng1, lat0],
        [lng1, lat1],
        [lng0, lat1],
        [lng0, lat0],
      ]],
    },
  }
}

export const catchmentFeatures: GeoJSON.FeatureCollection<GeoJSON.Polygon, InteractFeatureProperties> = {
  type: 'FeatureCollection',
  features: Array.from({ length: ROWS }, (_, row) =>
    Array.from({ length: COLS }, (_, col) => catchmentCell(row, col)),
  ).flat(),
}
