import { ANALYSIS_MODES, type AnalysisMode } from './analysisWorkflows'

export const LIDAR_BASE = '/dev/lidar/'
export type LidarToolId = 'canopy' | 'trees' | 'forestry' | 'species' | 'buildings' | 'transects' | 'compare' | 'volume'
export interface LidarTool {
  id: LidarToolId
  title: string
  description: string
  outputs: string
  modes: AnalysisMode[]
  defaultMode: AnalysisMode | null
}
export const LIDAR_TOOLS: LidarTool[] = [
  {
    id: 'volume',
    title: 'Forest volume',
    description: 'Open a completed volume example, learn the methods, or calibrate your BC tile.',
    outputs: 'Completed Québec example · timber volume practices · local calibration',
    modes: [],
    defaultMode: null,
  },
  {
    id: 'compare',
    title: 'Compare models',
    description: 'Compare executed model variants on linked maps and review their performance.',
    outputs: 'LiDAR labels · RGB masks · 3D shape review · model status',
    modes: [],
    defaultMode: null,
  },
  {
    id: 'canopy',
    title: 'Canopy',
    description: 'Explore canopy height, density and vertical layers.',
    outputs: 'Heatmaps · 1 m detail · height profiles',
    modes: ['canopy-height', 'canopy-density', 'strata'],
    defaultMode: 'canopy-height',
  },
  {
    id: 'trees',
    title: 'Trees',
    description: 'Isolate crown candidates and inspect the original returns.',
    outputs: 'Side profiles · point editing · method comparisons',
    modes: ['trees'],
    defaultMode: 'trees',
  },
  {
    id: 'forestry',
    title: 'Forestry',
    description: 'Review openings, plot statistics and stand structure.',
    outputs: 'Gaps · plots · texture · edges · vegetation proximity',
    modes: ['gaps', 'plots', 'texture', 'edges', 'clearance'],
    defaultMode: 'gaps',
  },
  {
    id: 'species',
    title: 'Species',
    description: 'Compare recorded species composition and experimental models.',
    outputs: 'Inventory · held-out estimates · field review',
    modes: ANALYSIS_MODES.filter((m) => m.id.startsWith('species')).map((m) => m.id),
    defaultMode: 'species',
  },
  {
    id: 'buildings',
    title: 'Buildings',
    description: 'Inspect roof candidates and reconstructed building models.',
    outputs: 'Roof sections · LoD2.2 models · review exports',
    modes: ['models'],
    defaultMode: 'models',
  },
  {
    id: 'transects',
    title: 'Transects',
    description: 'Draw cross-sections through the original point cloud.',
    outputs: 'Terrain-normalized sections · point CSV · cut lines',
    modes: [],
    defaultMode: null,
  },
]
export const toolForMode = (mode: string) => LIDAR_TOOLS.find((tool) => tool.modes.includes(mode as AnalysisMode))
export const toolPath = (id?: LidarToolId, mode?: AnalysisMode | null) => {
  const tool = LIDAR_TOOLS.find((t) => t.id === id)
  return `${LIDAR_BASE}${tool ? `${tool.id}/` : ''}${mode && mode !== tool?.defaultMode ? `?view=${mode}` : ''}`
}
export function resolveLidarRoute(pathname: string, search: string) {
  const params = new URLSearchParams(search),
    legacy = params.get('view')
  const atRoot = pathname === '/' || pathname.replace(/\/$/, '') === '/dev/lidar'
  const segment = pathname.startsWith(LIDAR_BASE) ? pathname.slice(LIDAR_BASE.length).replace(/\/$/, '') : ''
  let tool = atRoot ? undefined : LIDAR_TOOLS.find((t) => t.id === segment)
  if (atRoot && legacy)
    tool =
      toolForMode(legacy) ??
      LIDAR_TOOLS.find(
        (t) =>
          t.id ===
          ({ inspection: 'buildings', context: 'canopy', analysis: 'forestry' } as Record<string, string>)[legacy],
      )
  const mode = tool?.modes.includes(legacy as AnalysisMode) ? (legacy as AnalysisMode) : (tool?.defaultMode ?? null)
  const panel = legacy === 'inspection' || params.get('panel') === 'roofs' ? 'buildings' : null
  const valid = atRoot || !!tool
  const canonical = `${toolPath(tool?.id, mode)}${panel && tool?.id === 'buildings' ? `${mode !== tool.defaultMode ? '&' : '?'}panel=roofs` : ''}`
  return { tool, mode, panel, valid, canonical }
}
