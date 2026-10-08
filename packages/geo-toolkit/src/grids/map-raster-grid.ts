import { TileLayer } from '@deck.gl/geo-layers'
import { PolygonLayer } from '@deck.gl/layers'
import type { PickingInfo } from '@deck.gl/core'
import { decodePngPixels } from './pngPixels.js'
import {
  reconstructImageClassGrid,
  rasterGridCellRing,
  type GridPaletteEntry,
  type RasterClassGrid,
  type RasterGridCell,
} from './rasterClassGrid.js'

export type RasterGridPick = RasterGridCell & {
  longitude: number
  latitude: number
  tile: { x: number; y: number; z: number }
  cellPixels: number
}

export interface RasterGridLayerOptions {
  id: string
  tileUrl: (tile: { x: number; y: number; z: number }) => string
  sourceZoom: number | { min: number; max: number }
  palette: readonly GridPaletteEntry[]
  cellPixels?: number
  colorForValue: (value: number) => [number, number, number, number]
  preserveSourcePixels?: boolean
  opacity?: number
  showGridLines?: boolean
  onHover?: (pick: RasterGridPick | null) => void
  onPick?: (pick: RasterGridPick) => void
  onTileError?: (error: Error) => void
}

/** Compose into an existing deck.gl overlay; one pickable box per inferred cell. */
export function createRasterGridLayer({
  id,
  tileUrl,
  sourceZoom,
  palette,
  cellPixels = 1,
  colorForValue,
  preserveSourcePixels = cellPixels === 1,
  opacity = 1,
  showGridLines = false,
  onHover,
  onPick,
  onTileError,
}: RasterGridLayerOptions) {
  const minZoom = typeof sourceZoom === 'number' ? sourceZoom : sourceZoom.min
  const maxZoom = typeof sourceZoom === 'number' ? sourceZoom : sourceZoom.max
  if (
    ![minZoom, maxZoom].every((z) => Number.isInteger(z) && z >= 0 && z <= 22) ||
    minZoom > maxZoom ||
    ![1, 2, 4, 8, 16, 32, 64].includes(cellPixels)
  ) {
    throw new Error('Expected valid XYZ source zoom bounds and a power-of-two box size')
  }
  if (preserveSourcePixels && cellPixels !== 1) throw new Error('Source preservation requires one box per pixel')
  // deck.gl dispatches events to the outer composite layer, with the source
  // tile populated by TileLayer.getPickingInfo.
  const pick = (
    info: PickingInfo<RasterGridCell> & { tile?: { index: { x: number; y: number; z: number } } },
  ): RasterGridPick | null =>
    info.object && info.coordinate && info.tile
      ? {
          ...info.object,
          longitude: info.coordinate[0],
          latitude: info.coordinate[1],
          tile: info.tile.index,
          cellPixels,
        }
      : null
  return new TileLayer<RasterClassGrid>({
    id,
    minZoom,
    maxZoom,
    // A range follows the same native tile selection as the source bitmap.
    // Fixed-level comparisons wait until the requested level is visible.
    visibleMinZoom: minZoom === maxZoom ? minZoom : undefined,
    extent: [-180, -85, 180, 85],
    tileSize: 256,
    maxRequests: 6,
    // Keep the finest view from retaining millions of individual cell objects.
    maxCacheSize: Math.min(32, 4 * cellPixels ** 2),
    refinementStrategy: 'no-overlap',
    pickable: true,
    opacity,
    updateTriggers: { getTileData: [cellPixels, preserveSourcePixels, JSON.stringify(palette)] },
    onHover: (info) => onHover?.(pick(info)),
    onClick: (info) => {
      const value = pick(info)
      if (value) onPick?.(value)
    },
    getTileData: async ({ index, signal }) => {
      const response = await fetch(tileUrl(index), { signal })
      if (!response.ok || response.headers.get('content-type')?.includes('text/html')) {
        throw new Error(`Saved grid tile ${index.z}/${index.x}/${index.y} unavailable (${response.status})`)
      }
      const { width, height, rgba } = decodePngPixels(await response.arrayBuffer())
      if (width !== 256 || height !== 256) throw new Error('Expected a 256×256 source image tile')
      return reconstructImageClassGrid(rgba, width, height, palette, { cellPixels, preserveSourcePixels })
    },
    onTileError: (error) => onTileError?.(error),
    renderSubLayers: (props) => {
      if (!props.data) return null
      const grid = props.data
      const tile = props.tile.index
      return new PolygonLayer<RasterGridCell>({
        ...props,
        id: `${props.id}-boxes`,
        data: grid.cells,
        pickable: true,
        filled: true,
        stroked: showGridLines,
        getPolygon: (cell) => rasterGridCellRing(cell, grid, tile),
        getFillColor: (cell) => cell.rgba ?? colorForValue(cell.value),
        getLineColor: [40, 40, 40, 90],
        lineWidthUnits: 'pixels',
        getLineWidth: 1,
        updateTriggers: { getFillColor: colorForValue },
      })
    },
  })
}
