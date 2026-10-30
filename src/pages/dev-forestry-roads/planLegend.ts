/** Legend entries derived from the same visible GeoJSON collections used by the plan renderer. */
import type { Alignment, ContextFeature } from './types'

export type PlanLegendShape = 'line' | 'dashed-line' | 'circle' | 'square' | 'area'
export interface PlanLegendEntry {
  id: string
  label: string
  color: string
  shape: PlanLegendShape
  symbol?: string
}
export interface PlanLegendSection {
  id: string
  title: string
  entries: PlanLegendEntry[]
}
export interface PlanLegendSources {
  roads: GeoJSON.FeatureCollection
  context: GeoJSON.FeatureCollection
  corridor: GeoJSON.FeatureCollection
  formation: GeoJSON.FeatureCollection
  edges: GeoJSON.FeatureCollection
  ditches: GeoJSON.FeatureCollection
  cable: GeoJSON.FeatureCollection
  structures: GeoJSON.FeatureCollection
  draft: GeoJSON.FeatureCollection
  section: GeoJSON.FeatureCollection
  ticks: GeoJSON.FeatureCollection
  overlay?: GeoJSON.FeatureCollection
  drainage?: GeoJSON.FeatureCollection
}

export const PLAN_CONTEXT_STYLES: Record<ContextFeature['kind'], { label: string; color: string }> = {
  stream: { label: 'Streams', color: '#0284c7' },
  'existing-road': { label: 'Existing roads', color: '#52525b' },
  harvest: { label: 'Harvest areas', color: '#15803d' },
  avoid: { label: 'Review areas', color: '#be123c' },
}
export const PLAN_DRAINAGE_STYLES: Record<string, { label: string; color: string; shape: PlanLegendShape }> = {
  'stream-existing': { label: 'Existing-ground drainage', color: '#38bdf8', shape: 'dashed-line' },
  'stream-design': { label: 'Design-surface drainage', color: '#0369a1', shape: 'line' },
  diversion: { label: 'Redirected flow', color: '#dc2626', shape: 'line' },
  pond: { label: 'New ponding', color: '#2563eb', shape: 'circle' },
  'low-point': { label: 'Unrelieved low point', color: '#f59e0b', shape: 'circle' },
  catchment: { label: 'Selected upstream catchment', color: '#0891b2', shape: 'area' },
  watershed: { label: 'D8 watershed partitions', color: '#7c3aed', shape: 'area' },
  'pour-point': { label: 'Snapped drainage pour point', color: '#0891b2', shape: 'circle' },
}

function geometryShape(feature: GeoJSON.Feature): PlanLegendShape | null {
  const geometry = feature.geometry
  if (geometry.type === 'LineString' && geometry.coordinates.length >= 2) return 'dashed-line'
  if (geometry.type === 'MultiLineString' && geometry.coordinates.some((line) => line.length >= 2)) return 'dashed-line'
  if (geometry.type === 'Point' && geometry.coordinates.length >= 2) return 'circle'
  if (geometry.type === 'MultiPoint' && geometry.coordinates.length > 0) return 'circle'
  return null
}

function overlayLabel(feature: GeoJSON.Feature, shape: PlanLegendShape): string {
  const p = feature.properties ?? {}
  switch (p.kind) {
    case 'complete-cost-path':
      return p.pathRole === 'loaded'
        ? 'Loaded material haul'
        : p.pathRole === 'return'
          ? 'Empty return route'
          : 'Reused access route'
    case 'reviewed-existing-road':
      return `Reviewed road${typeof p.label === 'string' ? ` · ${p.label}` : ''}`
    case 'fsr-target':
      return 'FSR connection target'
    case 'live-route-preview':
      return 'Live route preview'
    case 'peg-preview':
      return shape === 'circle' ? 'Proposed peg' : 'Proposed peg line'
    case 'radial-center':
      return 'Landing'
    case 'radial-spoke':
      if (shape === 'circle') return 'Selected spoke position'
      return p.status === 'clear'
        ? 'Landing spoke · sufficient clearance'
        : p.status === 'conflict'
          ? 'Landing spoke · clearance conflict'
          : 'Landing spoke · incomplete terrain'
    default:
      return typeof p.label === 'string' ? p.label : typeof p.name === 'string' ? p.name : 'Planning overlay'
  }
}

export function buildPlanLegend({
  sources,
  alignments,
  maxGradePercent,
  terrainOnly,
  showEarthwork,
  selection = false,
  draftPoints = false,
  editing = false,
  insertControls = false,
  crossingMarkers = false,
  curveLabels = false,
  cableCursor = false,
  cableSupports = false,
}: {
  sources: PlanLegendSources
  alignments: readonly Alignment[]
  maxGradePercent: number
  terrainOnly: boolean
  showEarthwork: boolean
  selection?: boolean
  draftPoints?: boolean
  editing?: boolean
  insertControls?: boolean
  crossingMarkers?: boolean
  curveLabels?: boolean
  cableCursor?: boolean
  cableSupports?: boolean
}): PlanLegendSection[] {
  const sections: PlanLegendSection[] = []
  const section = (id: string, title: string) => {
    const entries = new Map<string, PlanLegendEntry>()
    return {
      add: (entry: PlanLegendEntry) => entries.set(entry.id, entry),
      finish: () => {
        if (entries.size) sections.push({ id, title, entries: [...entries.values()] })
      },
    }
  }
  const roads = section('roads', 'Roads')
  for (const feature of sources.roads.features) {
    if (geometryShape(feature) !== 'dashed-line') continue
    const p = feature.properties ?? {}
    if (p.selected) {
      const color = String(p.color)
      roads.add({
        id: `active-${color}`,
        color,
        shape: 'line',
        label: terrainOnly
          ? 'Terrain transect'
          : color === '#dc2626'
            ? `Over ${maxGradePercent}% grade`
            : color === '#9ca3af'
              ? 'No terrain under it'
              : 'Within the grade limit',
      })
    } else {
      const alignment = alignments.find((road) => road.id === p.id)
      if (alignment)
        roads.add({
          id: `alternative-${alignment.id}`,
          color: alignment.color,
          shape: 'line',
          label: `Alternative · ${alignment.name}`,
        })
    }
  }
  roads.finish()
  const context = section('context', 'Map context')
  for (const feature of sources.context.features) {
    const kind = feature.properties?.kind as ContextFeature['kind']
    const style = PLAN_CONTEXT_STYLES[kind]
    if (!style) continue
    const area = feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon'
    context.add({
      id: `context-${kind}-${area ? 'area' : 'line'}`,
      label: style.label,
      color: style.color,
      shape: area ? 'area' : 'dashed-line',
    })
  }
  context.finish()
  const earthwork = section('earthwork', 'Earthwork')
  if (showEarthwork && !terrainOnly) {
    for (const feature of sources.corridor.features) {
      const beyond = feature.properties?.beyond === true
      const color = String(feature.properties?.color)
      earthwork.add({
        id: beyond ? 'reach' : `corridor-${color}`,
        color,
        shape: beyond ? 'dashed-line' : 'square',
        label: beyond ? 'Batter past section reach' : color === '#d97706' ? 'Mostly cut' : 'Mostly fill',
      })
    }
    if (sources.formation.features.length)
      earthwork.add({ id: 'formation', label: 'Formation surface', color: '#fef3c7', shape: 'square' })
    if (sources.edges.features.length)
      earthwork.add({ id: 'edge', label: 'Formation edge', color: '#78716c', shape: 'dashed-line' })
    if (sources.ditches.features.length)
      earthwork.add({ id: 'ditch', label: 'Ditch bottom', color: '#0369a1', shape: 'dashed-line' })
  }
  earthwork.finish()
  const structures = section('structures', 'Structures & cables')
  for (const feature of sources.structures.features) {
    const color = String(feature.properties?.color)
    structures.add({
      id: `culvert-${color}`,
      label: feature.properties?.selected
        ? 'Selected culvert'
        : color === '#d97706'
          ? 'Culvert · review flags'
          : 'Culvert',
      color,
      shape: 'line',
      symbol: 'Ø',
    })
  }
  if (sources.cable.features.length)
    structures.add({ id: 'cable', label: 'D-line / cable', color: '#7c3aed', shape: 'dashed-line' })
  if (cableSupports)
    structures.add({ id: 'cable-support', label: 'Yarder / tailhold', color: '#7c3aed', shape: 'square', symbol: 'Y' })
  if (cableCursor) structures.add({ id: 'cable-cursor', label: 'D-line position', color: '#6d28d9', shape: 'circle' })
  structures.finish()
  const drainage = section('drainage', 'Drainage analysis')
  for (const feature of sources.drainage?.features ?? []) {
    const role = feature.properties?.role
    const shape =
      (role === 'catchment' || role === 'watershed') && ['Polygon', 'MultiPolygon'].includes(feature.geometry.type)
        ? 'area'
        : geometryShape(feature)
    if (!shape) continue
    const style =
      PLAN_DRAINAGE_STYLES[String(role)] ??
      (shape === 'circle'
        ? role === 'pond'
          ? PLAN_DRAINAGE_STYLES.pond
          : role === 'low-point'
            ? PLAN_DRAINAGE_STYLES['low-point']
            : { label: 'Drainage review point', color: '#dc2626', shape: 'circle' as const }
        : role === 'stream-existing'
          ? PLAN_DRAINAGE_STYLES['stream-existing']
          : role === 'diversion'
            ? PLAN_DRAINAGE_STYLES.diversion
            : role === 'stream-design'
              ? PLAN_DRAINAGE_STYLES['stream-design']
              : { label: 'Drainage flow', color: '#0369a1', shape: 'line' as const })
    drainage.add({ id: `drainage-${role}-${shape}`, ...style })
  }
  drainage.finish()
  const overlays = section('overlays', 'Planning overlays')
  for (const feature of sources.overlay?.features ?? []) {
    const shape = geometryShape(feature)
    if (!shape) continue
    const color = typeof feature.properties?.color === 'string' ? feature.properties.color : '#7c3aed'
    const label = overlayLabel(feature, shape)
    overlays.add({ id: JSON.stringify([label, color, shape]), label, color, shape })
  }
  overlays.finish()
  const controls = section('controls', 'Stations & controls')
  if (sources.section.features.length)
    controls.add({ id: 'station', label: 'Selected station / cross-section', color: '#e11d48', shape: 'line' })
  if (sources.ticks.features.length)
    controls.add({ id: 'ticks', label: 'Station ticks & chainage labels', color: '#1c1917', shape: 'line' })
  if (selection) controls.add({ id: 'selection', label: 'Selected road feature', color: '#e11d48', shape: 'line' })
  if (crossingMarkers)
    controls.add({ id: 'crossing', label: 'Stream crossing review', color: '#0284c7', shape: 'square', symbol: '≈' })
  if (curveLabels)
    controls.add({
      id: 'curve-label',
      label: 'Horizontal curve radius',
      color: '#7c3aed',
      shape: 'square',
      symbol: 'R',
    })
  if (editing)
    controls.add({ id: 'controls', label: 'Horizontal control points', color: '#d97706', shape: 'circle', symbol: '1' })
  if (insertControls)
    controls.add({ id: 'insert', label: 'Insert horizontal control', color: '#2563eb', shape: 'circle', symbol: '+' })
  if (draftPoints || sources.draft.features.length)
    controls.add({
      id: 'draft',
      label: 'Drawing preview',
      color: '#0d9488',
      shape: sources.draft.features.length ? 'dashed-line' : 'circle',
    })
  controls.finish()
  return sections
}
