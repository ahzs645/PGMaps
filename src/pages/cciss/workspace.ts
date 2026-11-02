import { DEFAULT_CCISS_SELECTION, normalizeCcissSelection, type CcissLayerSelection } from './layers'
import type { CcissRenderSource } from './mapSources'
export type { CcissRenderSource } from './mapSources'

export type CcissAnalysisMode = 'legacy' | 'report' | 'current' | 'compare' | null
export type CcissTraceMethod = 'grid' | 'pixels'

export interface CcissWorkspace {
  point: [number, number]
  camera: { center: [number, number]; zoom: number }
  selection: CcissLayerSelection
  renderSource: CcissRenderSource
  traceMethod: CcissTraceMethod
  analysis: CcissAnalysisMode
}

const DEFAULT_POINT: [number, number] = [-122.7497, 53.9171]
const number = (params: URLSearchParams, key: string, min: number, max: number): number | null => {
  const raw = params.get(key)
  if (raw == null || raw.trim() === '') return null
  const value = Number(raw)
  return Number.isFinite(value) && value >= min && value <= max ? value : null
}

function coordinates(params: URLSearchParams, longitude: string, latitude: string): [number, number] | null {
  const lng = number(params, longitude, -180, 180)
  const lat = number(params, latitude, -90, 90)
  return lng != null && lat != null ? [lng, lat] : null
}

/** Camera and inspection point are distinct, so panning never changes a shared assessment's location. */
export function readCcissWorkspace(search: string | URLSearchParams): CcissWorkspace {
  const params = new URLSearchParams(search)
  const center = coordinates(params, 'lng', 'lat') ?? [...DEFAULT_POINT]
  const render = params.get('render')
  const analysis = params.get('analysis')
  const field = (key: string) => params.get(key) ?? undefined
  return {
    point: coordinates(params, 'pointLng', 'pointLat') ?? [...center],
    camera: { center, zoom: number(params, 'z', 4, 20) ?? 5.5 },
    selection: normalizeCcissSelection({
      kind: field('kind'),
      period: field('period'),
      edatope: field('edatope'),
      species: field('species'),
      statistic: field('statistic'),
      gcm: field('gcm'),
      byZone: params.get('byZone') === '1',
    } as Partial<CcissLayerSelection>),
    renderSource: render === 'tiles' || render === 'native' || render === 'vector' ? render : 'trace',
    traceMethod: params.get('traceMethod') === 'pixels' ? 'pixels' : 'grid',
    analysis:
      analysis === 'legacy' || analysis === 'report' || analysis === 'current' || analysis === 'compare'
        ? analysis
        : null,
  }
}

/** Preserve other page parameters; no data from an imported file is placed in the URL. */
export function writeCcissWorkspace(
  search: string | URLSearchParams,
  state: Pick<CcissWorkspace, 'point' | 'selection' | 'renderSource' | 'traceMethod' | 'analysis'>,
): URLSearchParams {
  const params = new URLSearchParams(search)
  params.set('pointLng', String(state.point[0]))
  params.set('pointLat', String(state.point[1]))
  for (const key of ['kind', 'period', 'edatope', 'species', 'statistic', 'gcm'] as const) {
    if (state.selection[key] === DEFAULT_CCISS_SELECTION[key]) params.delete(key)
    else params.set(key, state.selection[key])
  }
  if (state.selection.byZone) params.set('byZone', '1')
  else params.delete('byZone')
  params.set('render', state.renderSource)
  if (state.renderSource === 'trace') params.set('traceMethod', state.traceMethod)
  else params.delete('traceMethod')
  if (state.analysis) params.set('analysis', state.analysis)
  else params.delete('analysis')
  return params
}
