export type SmokeLayerKey = 'modelledSmoke' | 'visibleSmoke'

export type SmokeFeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Geometry, {
  fill?: string
  density?: string
  minPm25?: number
}>

export interface SmokeLayerDefinition {
  key: SmokeLayerKey
  label: string
  fill: string
  opacity: number
  legend: Array<{ label: string; color: string }>
  data: SmokeFeatureCollection
}

export type SmokeLayerDataMap = Record<SmokeLayerKey, SmokeFeatureCollection>

export const SMOKE_LAYERS: SmokeLayerDefinition[] = [
  {
    key: 'modelledSmoke',
    label: 'Modelled Smoke',
    fill: '#5ab0ff',
    opacity: 0.45,
    legend: [
      { label: '5-10 ug m-3', color: '#dedede' },
      { label: '10-25 ug m-3', color: '#bbbbbb' },
      { label: '25-35 ug m-3', color: '#b1e7ff' },
      { label: '35-50 ug m-3', color: '#5ab0ff' },
      { label: '50-75 ug m-3', color: '#bdff7b' },
      { label: '75-100 ug m-3', color: '#5ade5a' },
      { label: '100-200 ug m-3', color: '#ffff5a' },
      { label: '200-300 ug m-3', color: '#ffac5a' },
      { label: '300-500 ug m-3', color: '#c48f5a' },
      { label: '500+ ug m-3', color: '#ffa7ff' },
    ],
    data: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {
            fill: '#b1e7ff',
            minPm25: 25,
          },
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [-126, 50],
              [-118, 50.8],
              [-111, 55],
              [-114, 59],
              [-124, 58],
              [-129, 54],
              [-126, 50],
            ]],
          },
        },
        {
          type: 'Feature',
          properties: {
            fill: '#5ab0ff',
            minPm25: 35,
          },
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [-123.5, 51.2],
              [-116.5, 52],
              [-112, 55.1],
              [-115.8, 57.3],
              [-123, 56.1],
              [-126.5, 53.4],
              [-123.5, 51.2],
            ]],
          },
        },
      ],
    },
  },
  {
    key: 'visibleSmoke',
    label: 'Visible Smoke',
    fill: '#D7FC6B',
    opacity: 0.45,
    legend: [
      { label: 'Light', color: '#8CF183' },
      { label: 'Medium', color: '#D7FC6B' },
      { label: 'Heavy', color: '#E19651' },
    ],
    data: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {
            fill: '#D7FC6B',
            density: 'Medium',
          },
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [-123, 48.8],
              [-116, 49.4],
              [-108, 52.4],
              [-111, 56.2],
              [-120, 55.2],
              [-126, 52.4],
              [-123, 48.8],
            ]],
          },
        },
        {
          type: 'Feature',
          properties: {
            fill: '#E19651',
            density: 'Heavy',
          },
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [-121.7, 49.6],
              [-116.2, 50.4],
              [-111.5, 53.2],
              [-114.4, 55],
              [-119.8, 53.9],
              [-123.1, 51.4],
              [-121.7, 49.6],
            ]],
          },
        },
      ],
    },
  },
]

export const HMS_DENSITY_COLORS: Record<string, string> = {
  Light: '#8CF183',
  Faible: '#8CF183',
  Medium: '#D7FC6B',
  Moyen: '#D7FC6B',
  Heavy: '#E19651',
  Haute: '#E19651',
}

export const SMOKE_FALLBACK_DATA: SmokeLayerDataMap = {
  modelledSmoke: SMOKE_LAYERS[0].data,
  visibleSmoke: SMOKE_LAYERS[1].data,
}
