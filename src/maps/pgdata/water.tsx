// Entry point for the drinking water module. Implementation lives in ./water/.
export { WATER_TIMELINE_WINDOW_OPTIONS } from './water/constants'
export { useWaterData } from './water/useWaterData'
export type { WaterState } from './water/useWaterData'
export { WaterLayerControls, WaterLegend, WaterSourceNotes } from './water/WaterControls'
export { WaterLayer } from './water/WaterLayer'
export { WaterSidebar } from './water/WaterSidebar'
