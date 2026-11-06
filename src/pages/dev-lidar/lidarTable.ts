import { numberColumn, textColumn } from '@/components/map/tableColumns'
import type { MapFeatureTableColumn } from '@/components/map/mapTableModel'
import { defineTableSource, type MapTableSource } from '@/components/map/useMapTable'
import {
  ANALYSIS_MODES,
  featureCentre,
  type AnalysisMode,
  type BuildingModel,
  type WorkflowFeature,
} from './analysisWorkflows'
import { isForestMode } from './forestry'
import { isSpeciesMode } from './species'

/** Tree rows carry the crown's fields as well; `treeFeatures` spreads them in. */
type RowProperties = WorkflowFeature['properties'] & { crown_area_m2?: number; edge?: boolean }
type Row = WorkflowFeature & { properties: RowProperties }
type Column = MapFeatureTableColumn<Row>

const measure = (id: string, header: string, read: (p: RowProperties) => number | null | undefined): Column =>
  numberColumn<Row>(id, header, (row) => read(row.properties))
const yesNo = (id: string, header: string, read: (p: RowProperties) => boolean | null | undefined): Column =>
  textColumn<Row>(id, header, (row) => {
    const value = read(row.properties)
    return value == null ? null : value ? 'Yes' : 'No'
  })

const ID = textColumn<Row>('id', 'ID', (row) => row.properties.id)
const SUPPORT = measure('support', 'Support (%)', (p) => p.support_percent)

const TREE_COLUMNS: Column[] = [
  ID,
  measure('height', 'Height (m)', (p) => p.map_value),
  measure('crown', 'Crown area (m²)', (p) => p.crown_area_m2),
  yesNo('edge', 'At survey edge', (p) => p.edge),
]
const GAP_COLUMNS: Column[] = [
  ID,
  measure('area', 'Area (m²)', (p) => p.area_m2),
  measure('threshold', 'Height threshold (m)', (p) => p.threshold_m),
  measure('edge', 'Canopy edge (%)', (p) => p.canopy_edge_percent),
  yesNo('enclosed', 'Enclosed', (p) => p.enclosed_candidate),
  yesNo('clipped', 'Clipped by boundary', (p) => p.boundary_clipped),
  yesNo('roof', 'Near roof', (p) => p.near_roof),
]
const PLOT_COLUMNS: Column[] = [
  ID,
  measure('size', 'Plot size (m)', (p) => p.size_m),
  SUPPORT,
  measure('mean', 'Mean height (m)', (p) => p.mean_m),
  measure('p95', 'P95 height (m)', (p) => p.p95_m),
  measure('sd', 'Height SD (m)', (p) => p.sd_m),
  measure('above2', 'Above 2 m (%)', (p) => p.above_2m_percent),
  measure('crowns', 'Crown candidates per ha', (p) => p.crown_candidates_per_ha),
]
const CLEARANCE_COLUMNS: Column[] = [
  ID,
  measure('distance', 'Distance (m)', (p) => p.distance_m),
  measure('height', 'Candidate height (m)', (p) => p.candidate_height_m),
  measure('threshold', 'Height threshold (m)', (p) => p.threshold_m),
]
const FOREST_COLUMNS: Column[] = [
  ID,
  measure('value', 'Mapped value', (p) => p.map_value),
  SUPPORT,
  measure('mean', 'Mean height (m)', (p) => p.mean_m),
  measure('p95', 'P95 height (m)', (p) => p.p95_m),
]
const SPECIES_COLUMNS: Column[] = [
  ID,
  textColumn<Row>('stand', 'Stand', (row) => row.properties.stand_id),
  textColumn<Row>('leading', 'Leading species', (row) => row.properties.leading),
  measure('value', 'Mapped value', (p) => p.map_value),
  measure('difference', 'Difference (pp)', (p) => p.difference_pp),
]
const MODEL_COLUMNS: Array<MapFeatureTableColumn<BuildingModel>> = [
  textColumn('id', 'ID', (model) => model.id),
  textColumn('roof', 'Roof type', (model) => model.roof_type),
  numberColumn('area', 'Area (m²)', (model) => model.area_m2),
  numberColumn('planes', 'Roof planes', (model) => model.roof_planes),
  numberColumn('rmse', 'RMSE (m)', (model) => model.rmse_m),
  numberColumn('ground', 'Ground (m)', (model) => model.ground_m),
  textColumn('mode', 'Reconstruction', (model) => model.mode),
]

function columnsFor(mode: AnalysisMode): Column[] | null {
  if (mode === 'trees') return TREE_COLUMNS
  if (mode === 'gaps') return GAP_COLUMNS
  if (mode === 'plots') return PLOT_COLUMNS
  if (mode === 'clearance') return CLEARANCE_COLUMNS
  if (isForestMode(mode)) return FOREST_COLUMNS
  if (isSpeciesMode(mode)) return SPECIES_COLUMNS
  return null
}

/**
 * What the map shows as separate records: one row per crown, gap, plot or species cell,
 * or per building model. Rasters and the point cloud have no rows, so nothing is offered.
 * One id across modes keeps an open table open while the mode changes.
 */
export function lidarTableSources(
  mode: AnalysisMode | null,
  rows: readonly WorkflowFeature[],
  models: readonly BuildingModel[],
): MapTableSource[] {
  if (!mode) return []
  const label = ANALYSIS_MODES.find((item) => item.id === mode)?.label ?? 'Records'
  if (mode === 'models')
    return models.length
      ? [
          defineTableSource<BuildingModel>({
            id: 'records',
            label,
            shape: 'fill',
            rows: [...models],
            columns: MODEL_COLUMNS,
            getRowId: (model) => model.id,
            getRowCenter: (model) => model.centre,
            exportFileName: 'lidar-building-models',
          }),
        ]
      : []
  const columns = columnsFor(mode)
  if (!columns || !rows.length) return []
  return [
    defineTableSource<Row>({
      id: 'records',
      label,
      shape: 'fill',
      rows: [...rows],
      columns,
      getRowId: (row) => row.properties.id,
      getRowCenter: featureCentre,
      exportFileName: `lidar-${mode}`,
    }),
  ]
}
