/** Legend entries derived from the same visible GeoJSON collections used by the plan renderer. */
import { symbolKeyColor, type SheetSymbol } from '@/lib/mapSheet/symbols'
import { PLAN_SHEET_SYMBOLS, type PlanSheetKey } from './planSheetSymbols'
import { shortRoadNames } from './roadNames'
import { RIPARIAN_MAP_COLORS } from './riparian'
import type { Alignment, ContextFeature } from './types'

export type PlanLegendShape = 'line' | 'dashed-line' | 'circle' | 'square' | 'area'
export interface PlanLegendEntry {
  id: string
  label: string
  color: string
  shape: PlanLegendShape
  symbol?: string
  /** Dash and gap in line widths, matching the map's `line-dasharray`. */
  dash?: [number, number]
  /** A block sheet symbol: the legend draws its swatch with the sheet's own renderer. */
  sheetSymbol?: SheetSymbol
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
  swept?: GeoJSON.FeatureCollection
}

/** Dashed lines close in colour keep different patterns. Stream and road context differ in hue. */
export const PLAN_LINE_DASHES: Record<'context' | 'ditch' | 'cable' | 'overlay', [number, number]> = {
  context: [3, 2],
  ditch: [1, 1.5],
  cable: [2, 2],
  overlay: [3, 1],
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
  sheetSymbols = false,
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
  /** The context is drawn with the block sheet's symbols, so the legend lists those. */
  sheetSymbols?: boolean
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
  const names = new Map(shortRoadNames(alignments.map((road) => road.name)).map((name, i) => [alignments[i].id, name]))
  for (const feature of sources.roads.features) {
    if (geometryShape(feature) !== 'dashed-line') continue
    const p = feature.properties ?? {}
    if (p.selected) {
      const color = String(p.color)
      roads.add({
        id: `active-${color}`,
        color,
        shape: 'line',
        // A segment that names its own class (the plan coloured by grade) keeps that label.
        label: p.legendLabel
          ? String(p.legendLabel)
          : terrainOnly
            ? 'Terrain transect'
            : color === '#dc2626'
              ? `Over ${maxGradePercent}% grade`
              : color === '#9ca3af'
                ? 'No terrain under it'
                : 'Active road, within grade',
      })
    } else {
      const alignment = alignments.find((road) => road.id === p.id)
      if (alignment)
        roads.add({
          id: `alternative-${alignment.id}`,
          color: String(p.color),
          shape: 'line',
          label: names.get(alignment.id)!,
        })
    }
  }
  roads.finish()
  const context = section('context', 'Map context')
  const sheetEntry = (key: PlanSheetKey) => {
    const symbol = PLAN_SHEET_SYMBOLS[key]
    context.add({
      id: `sheet-${key}`,
      label: symbol.label,
      color: symbolKeyColor(symbol),
      shape: symbol.kind === 'area' ? 'area' : 'line',
      sheetSymbol: symbol,
    })
  }
  for (const feature of sources.context.features) {
    const sheetKey = feature.properties?.sheetKey as PlanSheetKey | null | undefined
    if (sheetSymbols && sheetKey && PLAN_SHEET_SYMBOLS[sheetKey]) {
      sheetEntry(sheetKey)
      if (feature.properties?.sheetDeactivated === true) sheetEntry('deactivated')
      continue
    }
    const band = feature.properties?.riparianBand as keyof typeof RIPARIAN_MAP_COLORS | undefined
    if (band && RIPARIAN_MAP_COLORS[band]) {
      context.add({
        id: `riparian-${band}`,
        label:
          band === 'uncertain'
            ? 'Riparian extent unresolved · horizontal screen'
            : `Riparian ${band} · preliminary horizontal screen`,
        color: RIPARIAN_MAP_COLORS[band],
        shape: 'area',
      })
      continue
    }
    const kind = feature.properties?.kind as ContextFeature['kind']
    const style = PLAN_CONTEXT_STYLES[kind]
    if (!style) continue
    const area = feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon'
    const history = feature.properties
    if (typeof history?.historyKey === 'string' && typeof history.historyColor === 'string') {
      const dash: [number, number] =
        Array.isArray(history.historyDash) &&
        history.historyDash.length === 2 &&
        history.historyDash.every((value: unknown) => typeof value === 'number' && Number.isFinite(value))
          ? [history.historyDash[0], history.historyDash[1]]
          : PLAN_LINE_DASHES.context
      context.add({
        id: `history-${kind}-${history.historyKey}`,
        label: String(history.historyLabel),
        color: history.historyColor,
        shape: area ? 'area' : dash[1] === 0 ? 'line' : 'dashed-line',
        ...(area ? {} : { dash }),
      })
      continue
    }
    context.add({
      id: `context-${kind}-${area ? 'area' : 'line'}`,
      label: style.label,
      color: style.color,
      shape: area ? 'area' : 'dashed-line',
      dash: PLAN_LINE_DASHES.context,
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
      earthwork.add({ id: 'edge', label: 'Formation edge', color: '#78716c', shape: 'line' })
    if (sources.ditches.features.length)
      earthwork.add({
        id: 'ditch',
        label: 'Ditch bottom',
        color: '#0f766e',
        shape: 'dashed-line',
        dash: PLAN_LINE_DASHES.ditch,
      })
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
    structures.add({
      id: 'cable',
      label: 'D-line / cable',
      color: '#7c3aed',
      shape: 'dashed-line',
      dash: PLAN_LINE_DASHES.cable,
    })
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
  const swept = section('swept', 'Design vehicle swept path')
  const roles = new Set((sources.swept?.features ?? []).map((f) => String(f.properties?.role)))
  if (roles.has('swept-wheels'))
    swept.add({ id: 'swept-wheels', label: 'Outer wheel paths', color: '#ea580c', shape: 'line' })
  if (roles.has('swept-body'))
    swept.add({ id: 'swept-body', label: 'Body and load overhang', color: '#7c3aed', shape: 'dashed-line' })
  if (roles.has('swept-deficit'))
    swept.add({
      id: 'swept-deficit',
      label: 'Wheels outside formation less clearance',
      color: '#dc2626',
      shape: 'line',
    })
  if (roles.has('swept-area')) swept.add({ id: 'swept-area', label: 'Swept area', color: '#7c3aed', shape: 'area' })
  if (roles.has('vehicle-outline'))
    swept.add({ id: 'vehicle-outline', label: 'Design vehicle', color: '#0f172a', shape: 'line' })
  if (roles.has('vehicle-trace'))
    swept.add({ id: 'vehicle-trace', label: 'Steer path and traced points', color: '#0891b2', shape: 'line' })
  if (roles.has('vehicle-template'))
    swept.add({ id: 'vehicle-template', label: 'Turning template circles', color: '#475569', shape: 'dashed-line' })
  if (roles.has('vehicle-lock'))
    swept.add({ id: 'vehicle-lock', label: 'Beyond the steering lock', color: '#dc2626', shape: 'line' })
  swept.finish()
  const overlays = section('overlays', 'Planning overlays')
  for (const feature of sources.overlay?.features ?? []) {
    const shape = geometryShape(feature)
    if (!shape) continue
    const color = typeof feature.properties?.color === 'string' ? feature.properties.color : '#7c3aed'
    const label = overlayLabel(feature, shape)
    overlays.add({ id: JSON.stringify([label, color, shape]), label, color, shape, dash: PLAN_LINE_DASHES.overlay })
  }
  overlays.finish()
  const controls = section('controls', 'Stations & controls')
  if (sources.section.features.length)
    controls.add({ id: 'station', label: 'Selected station', color: '#e11d48', shape: 'line' })
  if (sources.ticks.features.length)
    controls.add({ id: 'ticks', label: 'Station ticks', color: '#1c1917', shape: 'line' })
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
    controls.add({ id: 'insert', label: 'Drag to bend the road', color: '#2563eb', shape: 'circle', symbol: '+' })
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
