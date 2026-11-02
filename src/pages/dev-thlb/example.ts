import { parsePolygons, guessFields } from './inputs'
import type { AnalysisInput, InputRole } from './types'

export function exampleInput(): AnalysisInput {
  const x = 1_210_000,
    y = 960_000
  const rectangle = (dx: number, width: number, properties: GeoJSON.GeoJsonProperties): GeoJSON.Feature => ({
    type: 'Feature',
    properties,
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [x + dx, y],
          [x + dx + width, y],
          [x + dx + width, y + 100],
          [x + dx, y + 100],
          [x + dx, y],
        ],
      ],
    },
  })
  const raw: Record<InputRole, GeoJSON.Feature[]> = {
    areas: [rectangle(0, 400, { AREA_ID: 'Example WHA A' }), rectangle(300, 200, { AREA_ID: 'Example WHA B' })],
    official: [rectangle(0, 200, { thlb_fact: 0.75, tsr_report_year: 2024, TSA_NAME: 'Example TSA' })],
    proxy: [rectangle(0, 400, { pthlb_fact: 0.5 })],
    vri: [rectangle(0, 250, { PROJ_AGE_1: 100 }), rectangle(250, 150, { PROJ_AGE_1: 40 })],
    deferral: [rectangle(0, 100, {})],
    admin: [],
  }
  const input: AnalysisInput = { areas: [], official: [], proxy: [], vri: [], deferral: [], admin: [] }
  for (const role of Object.keys(raw) as InputRole[]) {
    const collection: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: raw[role] }
    const fields = guessFields(role, Object.keys(raw[role][0]?.properties ?? {}))
    input[role] = parsePolygons(collection, role, fields, `Synthetic ${role}`)
  }
  return input
}
