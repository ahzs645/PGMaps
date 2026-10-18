import type { Basemap } from './basemaps'
import type { RasterKey } from './types'

export interface ReviewWorkflow {
  id: string
  label: string
  note: string
  basemap: Basemap
  raster: RasterKey
  surfaceVisible: boolean
  surfaceOpacity: number
  trees: boolean
  buildings: boolean
  cloud: boolean
  labels: boolean
  highlight: string | null
}

export const REVIEW_WORKFLOWS: ReviewWorkflow[] = [
  {
    id: 'canopy',
    label: 'Canopy review',
    note: 'Compare green crown markers and height with visible crowns. Hide the surface to check omissions and over-splitting; imagery and LiDAR were acquired at different dates.',
    basemap: 'satellite',
    raster: 'height',
    surfaceVisible: true,
    surfaceOpacity: 0.4,
    trees: true,
    buildings: false,
    cloud: false,
    labels: false,
    highlight: 'High canopy',
  },
  {
    id: 'roofs',
    label: 'Roof review',
    note: 'Check amber patches against roof edges in imagery, then use 3D LiDAR to inspect shape and height. Several patches may belong to one building.',
    basemap: 'satellite',
    raster: 'height',
    surfaceVisible: false,
    surfaceOpacity: 0.4,
    trees: false,
    buildings: true,
    cloud: false,
    labels: false,
    highlight: 'Roof candidates',
  },
  {
    id: 'support',
    label: 'Terrain quality',
    note: 'Larger ground-support distances indicate more interpolated terrain and less direct support for normalized heights. This is not a measured vertical error.',
    basemap: 'vector',
    raster: 'support',
    surfaceVisible: true,
    surfaceOpacity: 0.8,
    trees: false,
    buildings: false,
    cloud: false,
    labels: true,
    highlight: null,
  },
  {
    id: 'structure',
    label: '3D structure',
    note: 'Basemaps, labels, surfaces and crown markers are hidden to isolate the original cloud and roof-patch outlines. Orbit to inspect shapes. Point colours are absolute elevation, not building/vegetation labels.',
    basemap: 'none',
    raster: 'height',
    surfaceVisible: false,
    surfaceOpacity: 0.65,
    trees: false,
    buildings: true,
    cloud: true,
    labels: false,
    highlight: 'Roof candidates',
  },
]
