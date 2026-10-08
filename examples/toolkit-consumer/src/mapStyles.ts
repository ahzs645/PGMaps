import type { StyleSpecification } from 'maplibre-gl'

const light: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e5eef0' } }],
}
const dark: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#182939' } }],
}
export const styles = { light, dark }
