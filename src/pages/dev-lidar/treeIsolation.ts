import type { Feature, FeatureCollection, Polygon, MultiPolygon } from 'geojson'
import type { WorkflowOptions, WorkflowFeature } from './analysisWorkflows'
import { sourceCell } from './sourceGrids'
export interface CrownProperties {
  id: string
  height_m: number
  crown_area_m2: number
  ground_support_m: number
  edge: boolean
  centre: [number, number]
  centre_utm: [number, number]
  ground_m: number
  runs: number[][]
}
export type CrownFeature = Feature<Polygon | MultiPolygon, CrownProperties>
export interface TreeIsolation {
  schema_version: number
  source_sha256: string
  input_sha256: Record<string, string>
  label_grid_sha256: string
  grid: { width: number; height: number; bounds: number[]; resolution: number; crs: string }
  crowns: FeatureCollection<Polygon | MultiPolygon, CrownProperties>
}
export const TREE_COLOURS = ['#16a34a', '#f59e0b', '#06b6d4', '#a855f7', '#ec4899', '#84cc16', '#3b82f6', '#f97316']
export function treeFeatures(data: TreeIsolation, options: WorkflowOptions): WorkflowFeature[] {
  return data.crowns.features
    .filter(
      (f) =>
        f.properties.height_m >= options.treeMinimum &&
        f.properties.crown_area_m2 >= options.treeAreaMinimum &&
        (!options.treeHideEdge || !f.properties.edge),
    )
    .map((f) => {
      const p = Object.fromEntries(Object.entries(f.properties).filter(([key]) => key !== 'runs')) as Omit<
        CrownProperties,
        'runs'
      >
      return {
        ...f,
        properties: {
          ...p,
          focus: p.centre,
          map_value: p.height_m,
          tree_colour: TREE_COLOURS[Number(p.id.split('-')[1]) % TREE_COLOURS.length],
        },
      }
    })
    .sort((a, b) => b.properties.height_m - a.properties.height_m || a.properties.id.localeCompare(b.properties.id))
}
export function crownCells(crown: CrownFeature, grid: TreeIsolation['grid']) {
  const cells = new Set<number>()
  for (const [row, col, length] of crown.properties.runs)
    for (let x = col; x < col + length; x++) cells.add(row * grid.width + x)
  return cells
}
export function belongsToCrown(cells: Set<number>, grid: TreeIsolation['grid'], x: number, y: number) {
  return cells.has(sourceCell(grid, x, y))
}
export interface IsolatedPoint {
  lon: number
  lat: number
  z: number
  height: number
  classification: number
  node: string
  index: number
}
export interface TreeCrop {
  id: string
  points: IsolatedPoint[]
  loaded_points: number
  loaded_nodes: number
  available_nodes: number
  budget_limited: boolean
  withheld_filtered: boolean
  ground_m: number
  centre: [number, number]
  source_sha256: string
}
export function treeCropCSV(crop: TreeCrop) {
  return (
    'longitude,latitude,elevation_cgvd2013_m,height_above_ground_m,classification,ept_node,node_point_index\n' +
    crop.points
      .map((p) =>
        [
          p.lon.toFixed(8),
          p.lat.toFixed(8),
          p.z.toFixed(3),
          p.height.toFixed(3),
          p.classification,
          p.node,
          p.index,
        ].join(','),
      )
      .join('\n')
  )
}
