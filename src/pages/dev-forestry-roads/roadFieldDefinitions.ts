export const TEMPLATE_FIELDS = [
  ['leftWidth', 'Left half-width (m)', 0.1, 50],
  ['rightWidth', 'Right half-width (m)', 0.1, 50],
  ['crossfallPercent', 'Crown crossfall (%)', 0, 20],
  ['cutSlope', 'Cut batter (H:V)', 0.1, 10],
  ['fillSlope', 'Fill batter (H:V)', 0.1, 10],
  ['ditchWidth', 'Ditch width (m)', 0, 10],
  ['ditchDepth', 'Ditch depth (m)', 0, 5],
  ['surfaceDepth', 'Surfacing depth (m)', 0, 2],
] as const

export const SAMPLING = [
  [
    'stationInterval',
    'Station spacing (m)',
    2,
    100,
    'Distance between sampled sections. Curve and event stations are added on top.',
  ],
  [
    'crossSectionHalfWidth',
    'Section reach each side (m)',
    5,
    100,
    'How far out from the centreline each section looks for where the cut or fill batter meets the ground. A high fill or deep cut needs more; a station whose batter runs past it is drawn red on the plan and left out of quantities.',
  ],
] as const
export const RATES = [
  ['cutRate', 'Cut ($/m³)'],
  ['fillRate', 'Fill ($/m³)'],
  ['surfacingRate', 'Surfacing ($/m³)'],
  ['clearingRate', 'Clearing ($/m²)'],
  ['shrinkFactor', 'Reusable cut factor'],
] as const

/** The key, label and numeric limits are shared by the ribbon and the detailed storm/flow editor. */
export const DRAINAGE_FIELDS = {
  rainfallMmPerHr: { label: 'Rainfall (mm/h)', min: 1, max: 500, step: 1 },
  runoffCoefficient: { label: 'Runoff C', min: 0.05, max: 1, step: 0.05 },
  manningN: { label: 'Pipe Manning n', min: 0.009, max: 0.05, step: 0.001 },
  streamThresholdHa: { label: 'Stream from (ha)', min: 0.05, max: 500, step: 0.1 },
  bufferM: { label: 'Upslope buffer (m)', min: 20, max: 2000, step: 10 },
}

export const STANDARD_LABELS = {
  maxGradePercent: 'Grade limit (%)',
  minRadius: 'Minimum radius (m)',
  shortPitchGradePercent: 'Short-pitch limit (%)',
  shortPitchMaxLengthM: 'Longest pitch (m)',
  loadedDirection: 'Loaded trucks travel',
  adverseGradePercent: 'Adverse limit (%)',
  runningSurfaceWidthM: 'Running surface (m)',
  maxClearingWidthM: 'Clearing limit (m)',
  designSpeedKmh: 'Design speed (km/h)',
  maxCrossDrainSpacingM: 'Drain spacing (m)',
  designVehicle: 'Design vehicle',
}

export const CURVE_LABELS = {
  curveDesignSpeedKmh: 'Curve design speed (km/h)',
  maxSuperelevationPercent: 'Max superelevation (%)',
  runoffLengthM: 'Runoff (m)',
}

const TERRAIN_LABELS = {
  importDatum: 'Vertical datum',
  cloudSurface: 'Point-cloud surface',
  cloudClass: 'Ground classification',
  preserveCorridorM: 'Corridor each side (m)',
  retainTin: 'Retain source TIN',
}

export type DrainageFieldId = keyof typeof DRAINAGE_FIELDS
export type StandardFieldId = keyof typeof STANDARD_LABELS
export type CurveFieldId = keyof typeof CURVE_LABELS
export type TerrainFieldId = keyof typeof TERRAIN_LABELS
export type TemplateFieldId = (typeof TEMPLATE_FIELDS)[number][0]
export type ProjectFieldId = (typeof SAMPLING)[number][0] | (typeof RATES)[number][0]
export type RibbonFieldId =
  | TemplateFieldId
  | ProjectFieldId
  | TerrainFieldId
  | StandardFieldId
  | DrainageFieldId
  | CurveFieldId
  | 'roadName'

export function fieldIds<T extends object>(fields: T) {
  return Object.keys(fields) as Array<Extract<keyof T, string>>
}

const numericFields = [...TEMPLATE_FIELDS, ...SAMPLING, ...RATES]
export const ribbonFieldLabels: Record<RibbonFieldId, string> = {
  ...(Object.fromEntries(numericFields.map(([id, label]) => [id, label])) as Record<
    TemplateFieldId | ProjectFieldId,
    string
  >),
  ...(Object.fromEntries(fieldIds(DRAINAGE_FIELDS).map((id) => [id, DRAINAGE_FIELDS[id].label])) as Record<
    DrainageFieldId,
    string
  >),
  ...STANDARD_LABELS,
  ...CURVE_LABELS,
  ...TERRAIN_LABELS,
  roadName: 'Road name',
}
export const ribbonFieldIds = fieldIds(ribbonFieldLabels)
