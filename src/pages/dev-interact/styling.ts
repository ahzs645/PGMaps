import { COLOR_SCALES, NULL_COLOR } from '@/components/ui/map-styles'
import {
  DISCHARGE_COLORS,
  DISCHARGE_TYPES,
  RISK_CLASSES,
  RISK_COLORS,
  SPILL_BREAKS,
  SPILL_UNIT,
  spillBucketIndex,
} from './catchments'
import type { GraduatedRampName, InteractFeatureProperties, LegendItem, StyleAttributeId } from './types'

// =============================================================================
// Data-driven catchment styling
// =============================================================================
// Turns an attribute + ramp choice into a MapLibre data-driven paint expression
// plus a legend with live feature counts — the core of how Felt "draws" a
// dataset by one of its columns.

// MapLibre style expressions are loosely typed arrays; keep them as unknown and
// let MapFillLayer accept them via its `string | expression` prop.
type StyleExpression = unknown
type CatchmentFeature = GeoJSON.Feature<GeoJSON.Polygon, InteractFeatureProperties>

export interface CatchmentStyle {
  fillColor: StyleExpression
  lineColor: string
  legend: LegendItem[]
}

export interface GraduatedRamp {
  id: GraduatedRampName
  label: string
  colors: [string, string, string, string]
}

/** Pick four well-separated stops from a five-stop sequential scale. */
function rampColors(ramp: GraduatedRampName): [string, string, string, string] {
  const scale = COLOR_SCALES[ramp]
  return [scale[1], scale[2], scale[3], scale[4]]
}

/** Ramp options offered for graduated (numeric) styling. */
export const GRADUATED_RAMPS: GraduatedRamp[] = [
  { id: 'red', label: 'Red', colors: rampColors('red') },
  { id: 'amber', label: 'Amber', colors: rampColors('amber') },
  { id: 'blue', label: 'Blue', colors: rampColors('blue') },
]

const SPILL_BUCKET_LABELS = [
  `0–${SPILL_BREAKS[0]}`,
  `${SPILL_BREAKS[0]}–${SPILL_BREAKS[1]}`,
  `${SPILL_BREAKS[1]}–${SPILL_BREAKS[2]}`,
  `${SPILL_BREAKS[2]}+`,
]

export function buildCatchmentStyle(
  features: CatchmentFeature[],
  attribute: StyleAttributeId,
  ramp: GraduatedRampName,
): CatchmentStyle {
  if (attribute === 'spillHours') {
    const colors = rampColors(ramp)
    const counts = [0, 0, 0, 0]
    for (const feature of features) {
      counts[spillBucketIndex(feature.properties.spillHours ?? 0)] += 1
    }
    const fillColor = [
      'step',
      ['get', 'spillHours'],
      colors[0],
      SPILL_BREAKS[0], colors[1],
      SPILL_BREAKS[1], colors[2],
      SPILL_BREAKS[2], colors[3],
    ]
    const legend: LegendItem[] = colors.map((color, index) => ({
      key: SPILL_BUCKET_LABELS[index],
      color,
      label: `${SPILL_BUCKET_LABELS[index]} ${SPILL_UNIT}`,
      count: counts[index],
    }))
    return { fillColor, lineColor: '#0f172a', legend }
  }

  const categories = attribute === 'riskClass' ? RISK_CLASSES : DISCHARGE_TYPES
  const colorMap: Record<string, string> = attribute === 'riskClass' ? RISK_COLORS : DISCHARGE_COLORS
  const counts = new Map<string, number>()
  for (const feature of features) {
    const value = String(feature.properties[attribute] ?? '')
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }

  const fillColor: unknown[] = ['match', ['get', attribute]]
  for (const category of categories) {
    fillColor.push(category, colorMap[category])
  }
  fillColor.push(NULL_COLOR)

  const legend: LegendItem[] = categories.map((category) => ({
    key: category,
    color: colorMap[category],
    label: category,
    count: counts.get(category) ?? 0,
  }))
  return { fillColor, lineColor: '#0f172a', legend }
}
