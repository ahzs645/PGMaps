import { calculateTravel } from './routing'
import { liveGridBuilder } from './live-grid'
import { makeHeatRaster } from './heat-raster'
import type { HeatGridSpec, HeatTheme, TransitData, TravelOptions, TravelResult } from './types'

let data: TransitData | null = null
let buildGrid: ReturnType<typeof liveGridBuilder> | null = null
let grid: TransitData['grid'] | null = null
let gridKey = ''
let routeKey = ''
let result: TravelResult | null = null
self.onmessage = (
  event: MessageEvent<{
    data?: TransitData
    options?: TravelOptions
    heatGrid?: HeatGridSpec
    max?: number
    theme?: HeatTheme
    id: number
  }>,
) => {
  try {
    if (event.data.data) {
      data = event.data.data
      buildGrid = liveGridBuilder(data)
      grid = null
      gridKey = routeKey = ''
      result = null
    }
    if (data && event.data.options && event.data.heatGrid && buildGrid) {
      const key = JSON.stringify(event.data.heatGrid)
      if (key !== gridKey) {
        grid = buildGrid(event.data.heatGrid)
        gridKey = key
      }
      const nextRouteKey = key + JSON.stringify(event.data.options)
      if (nextRouteKey !== routeKey || !result) {
        result = calculateTravel(data, event.data.options, grid!)
        routeKey = nextRouteKey
      }
      const spec = event.data.heatGrid
      const raster = makeHeatRaster(
        result.grid,
        spec.cols,
        spec.rows,
        event.data.max ?? 45,
        event.data.theme ?? 'light',
      )
      self.postMessage(
        { id: event.data.id, result: { ...result, heatGrid: spec, raster } },
        { transfer: [raster.pixels.buffer] },
      )
    }
  } catch (error) {
    self.postMessage({
      id: event.data.id,
      error: error instanceof Error ? error.message : 'Travel-time calculation failed',
    })
  }
}
