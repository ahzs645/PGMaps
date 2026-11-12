import type { RibbonTool } from '../components/interfaces/ribbonToolCatalog'
import type { WorkflowEditor } from '../components/interfaces/workspaceLayouts'

/** Only differences from the original capture belong here. Keys are stable Capture Studio step IDs. */
export type RibbonAction = {
  tool?: RibbonTool
  editor?: WorkflowEditor
  value?: string
  answer?: string
  instruction?: string
  thenShared?: boolean
}
type Changes = Record<string, RibbonAction | 'skip'>
export const ribbonRoutes: Record<string, Changes> = {
  'sketch-road': { sketch: { tool: 'sketch' }, road: { tool: 'roadName', value: 'Sketched road 3' } },
  terrain: {
    'terrain-tab': 'skip',
    datum: { tool: 'importDatum', value: '', answer: 'Synthetic training metres' },
    import: { tool: 'import', instruction: 'Choose training-slope.tif from the terrain guide.' },
    source: { tool: 'terrainSource', value: 'training-slope.tif · 20 m resolution' },
  },
  'import-line': {
    import: { tool: 'importAlignment', instruction: 'Choose training-spur.geojson from the guide.' },
    road: { tool: 'roadName', value: 'Training spur' },
    profile: { tool: 'profile', thenShared: true },
  },
  'station-200': {
    station: { tool: 'plan', thenShared: true },
    profile: { tool: 'profile', thenShared: true },
    depth: { tool: 'crossSection', thenShared: true },
  },
  'vertical-profile': {
    vertical: { editor: 'design', thenShared: true },
    formation: { tool: 'crossSection', thenShared: true },
  },
  'road-section': {
    'section-tab': 'skip',
    width: { tool: 'leftWidth', value: '3', answer: '4' },
    widths: { tool: 'crossSection', thenShared: true },
  },
  'stream-crossing': { engineering: { editor: 'engineering' } },
  'compare-roads': {
    compare: { tool: 'compare' },
    selected: { tool: 'roadName', value: 'Contour alternative · training' },
  },
  'quantities-cost': {
    engineering: 'skip',
    breakdown: {
      tool: 'quantities',
      instruction: 'Use the Cost view in Engineering quantities to see the itemized estimate.',
    },
  },
  'review-design': { review: { tool: 'review' } },
  'save-project': {
    save: { tool: 'saveProject', instruction: 'Keep the downloaded .road.json file to reopen this project.' },
    project: 'skip',
    open: { tool: 'open', instruction: 'Choose the .road.json file you saved.' },
    reopened: { tool: 'roadName', value: 'Hillside access · training' },
  },
  'export-stations': { save: { tool: 'export' } },
}
