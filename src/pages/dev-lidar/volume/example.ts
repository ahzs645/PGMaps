import type { FeatureCollection, Point, Polygon } from 'geojson'
export interface ExampleCell {
  id: string
  volume_m3_ha: number | null
  status: string
  height_p95_m: number
}
export interface ExampleReference {
  id: string
  observed_m3_ha: number
  cv_m3_ha: number
  fold: number
  zq95_m: number
  zskew: number
  returns_above_2m_percent: number
}
export interface VolumeExample {
  schema_version: number
  dataset: string
  target: string
  source: {
    repository: string
    commit: string
    tutorial: string
    attribution: string
    input_sha256: Record<string, string>
    input_paths: Record<string, string>
    note: string
  }
  model: {
    formula: string
    coefficients: number[]
    training_n: number
    diagnostics: {
      method: string
      rmse_m3_ha: number
      bias_m3_ha: number
      r2: number
      folds: {
        fold: number
        train_n: number
        test_n: number
        test_ids: string[]
        rmse_m3_ha: number
        bias_m3_ha: number
        r2: number
      }[]
    }
  }
  map: {
    centre: [number, number]
    crs: number
    native_cell_m: number
    cell_area_ha: number
    subset_m2: number
    forest_mask_rule: string
    exclusions: Record<string, number>
    supported_cells: number
    supported_area_ha: number
    modelled_merchantable_m3: number
    mean_m3_ha: number
    cells: FeatureCollection<Polygon, ExampleCell>
  }
  references: FeatureCollection<Point, ExampleReference>
  limitations: string[]
}
export const VOLUME_STEPS = [
  { minimum: 0, colour: '#f0fdf4', label: '0–50' },
  { minimum: 50, colour: '#bbf7d0', label: '50–100' },
  { minimum: 100, colour: '#4ade80', label: '100–200' },
  { minimum: 200, colour: '#16a34a', label: '200–300' },
  { minimum: 300, colour: '#166534', label: '300+' },
]
export const HEIGHT_STEPS = VOLUME_STEPS.map((step, i) => ({
  ...step,
  minimum: i * 5,
  label: i === 4 ? '20+' : `${i * 5}–${(i + 1) * 5}`,
}))
export function volumeExampleColour(value: number | null, layer = 'volume') {
  const steps = layer === 'height' ? HEIGHT_STEPS : VOLUME_STEPS
  return value === null ? '#94a3b8' : ([...steps].reverse().find((s) => value >= s.minimum)?.colour ?? '#94a3b8')
}
export function checkVolumeExample(data: VolumeExample) {
  if (
    data.schema_version !== 1 ||
    data.source.commit !== '20ee19167c317e2f7209bf2f61170bf71f4a8148' ||
    data.model.training_n !== data.references.features.length ||
    data.map.native_cell_m !== 20 ||
    data.map.cell_area_ha !== 0.04
  )
    throw Error('Volume example source or spatial support mismatch')
  const supported = data.map.cells.features.filter((f) => f.properties.volume_m3_ha !== null)
  if (
    supported.length !== data.map.supported_cells ||
    supported.some((f) => !Number.isFinite(f.properties.volume_m3_ha) || f.properties.volume_m3_ha! < 0)
  )
    throw Error('Invalid volume example predictions')
  const volume = supported.reduce((sum, f) => sum + f.properties.volume_m3_ha! * data.map.cell_area_ha, 0)
  if (
    Math.abs(volume - data.map.modelled_merchantable_m3) > 0.01 ||
    Math.abs(supported.length * 0.04 - data.map.supported_area_ha) > 1e-6
  )
    throw Error('Volume example area or total mismatch')
  return data
}
export function recoveredExampleVolume(merchantableM3: number, retainedPercent: number, recoveryPercent: number) {
  if (
    [merchantableM3, retainedPercent, recoveryPercent].some((v) => !Number.isFinite(v)) ||
    merchantableM3 < 0 ||
    retainedPercent < 0 ||
    retainedPercent > 100 ||
    recoveryPercent < 0 ||
    recoveryPercent > 100
  )
    throw Error('Invalid volume scenario')
  return (merchantableM3 * (1 - retainedPercent / 100) * recoveryPercent) / 100
}
