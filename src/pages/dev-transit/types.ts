export type Point = [number, number]
export type HeatTheme = 'light' | 'dark'
export type Access = [node: number, meters: number] | null
export type HeatGridSpec = { bbox: [number, number, number, number]; cols: number; rows: number }
export type HeatRaster = { width: number; height: number; pixels: Uint8ClampedArray }
export type Connection = [
  from: number,
  to: number,
  departure: number,
  arrival: number,
  trip: number,
  sequence: number,
  pickup: boolean,
  dropoff: boolean,
]
export type TransitData = {
  schema: 'pg-travel-time-v1'
  meta: {
    referenceDate: string
    feedStart: string
    feedEnd: string
    sourceUrl: string
    walkMetersPerSecond: number
    streetSnapMeters?: number
    markerAccessMeters?: number
    gridAccessMeters?: number
    bbox: [number, number, number, number]
  }
  routes: { id: string; number: string; name: string; color: string }[]
  stops: { id: string; name: string; point: Point; access: Access }[]
  patterns: { route: number; headsign: string; points: Point[]; stops: number[]; shapeIndices: number[] }[]
  trips: { id: string; pattern: number }[]
  connections: Connection[]
  walkNodes: Point[]
  /** Preferred vertices in the main connected city street network. */
  streetAccessNodes?: number[]
  walkEdges: [number, number][][]
  transfers: [number, number][][]
  grid: { cols: number; rows: number; cells: Access[] }
}
export type TravelOptions = { from: Point; to: Point | null; departure: number; bus: boolean; heatFrom: 'from' | 'to' }
export type Leg = {
  kind: 'walk' | 'bus'
  from: string
  to: string
  departure: number
  arrival: number
  points: Point[]
  route?: string
  color?: string
  headsign?: string
  wait?: number
}
export type TravelResult = {
  grid: number[]
  heatGrid?: HeatGridSpec
  raster?: HeatRaster
  stopMinutes: (number | null)[]
  reachableStops: number
  journey: { minutes: number; arrival: number; legs: Leg[] } | null
  originOnNetwork: boolean
  originIsolated?: boolean
  destinationOnNetwork: boolean
}
