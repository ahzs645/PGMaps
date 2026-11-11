/**
 * The plan's own tools beside Inspect and Edit: grade-held pegging and point query, with the plan
 * display options they bring (colour by grade class, follow the selected station). The plan keeps
 * only the tool in hand; each tool keeps its own state, so a cursor move redraws the tool and not
 * the plan. Calculation lives in `pegCursor.ts`, `pointQuery.ts`, `gradeClasses.ts` and
 * `followStation.ts`.
 */
import type { SnapLine } from './drawSnap'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import { Footprints, ScanSearch } from 'lucide-react'
import { useMap } from '@/components/ui/map'
import { Button } from '@/components/ui/button'
import { nearestStation } from './engine'
import { followDelay, FOLLOW_HOLD_AFTER_USER_MS, FOLLOW_PAN_MS, outsideFollowBox } from './followStation'
import { PegTool } from './PegTool'
import { PointQueryTool } from './PointQueryTool'
import type { NoteTool } from './PlanNotes'
import type { DrawMode } from './PlanView'
import type { Alignment, Coordinate, RoadAnalysis, RoadProject, RoadStation, TerrainSource } from './types'
import './planTools.css'

export type PlanTool = 'peg' | 'query'

const STORAGE = { gradeColours: 'pgmaps-road-grade-colours', follow: 'pgmaps-road-follow-station' }
function useStoredFlag(key: string): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(() => {
    try {
      return localStorage.getItem(key) === 'on'
    } catch {
      return false
    }
  })
  const set = (next: boolean) => {
    setValue(next)
    try {
      localStorage.setItem(key, next ? 'on' : 'off')
    } catch {
      /* The choice still holds for this session. */
    }
  }
  return [value, set]
}

/**
 * Whether a key belongs to the tool in hand. Keys typed into a field, or pressed on a button, a
 * link or another control, are that control's; so are keys inside a dialog. Escape and Backspace
 * also reach the tool from a button on the plan, such as the one that picked it.
 */
export function isPlanToolKey(event: Pick<KeyboardEvent, 'key' | 'target'>): boolean {
  const target = event.target as Element | null
  if (!target || typeof target.closest !== 'function') return true
  if (
    target.closest(
      'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"], [role="listbox"]',
    )
  )
    return false
  if (target.closest('button, a[href], [role="slider"], [role="tab"]'))
    return (event.key === 'Escape' || event.key === 'Backspace') && !!target.closest('[data-testid="road-plan-view"]')
  return target.tagName === 'BODY' || target.tagName === 'HTML' || !!target.closest('[data-testid="road-plan-view"]')
}

export interface PlanToolsInput {
  project: RoadProject
  /** The active road as the plan shows it. */
  alignment: Alignment
  analysis: RoadAnalysis | undefined
  source: TerrainSource
  station: number
  selectedStation?: RoadStation
  mode: DrawMode
  onMode?: (mode: DrawMode) => void
  noteTool: NoteTool
  onClearNoteTool: () => void
  pourPointPicking?: boolean
  investigation: boolean
  terrainOnly?: boolean
  /** Appends pegs to the active road; without it the peg tool is off. */
  onPeg?: (coordinates: Coordinate[]) => boolean
  /** Roads a straight peg leg snaps onto (`drawSnap.ts`). */
  snapLines?: SnapLine[]
  onStation: (station: number) => void
  onTypeStation?: (station: number) => number
}

/** The plan's tool state, and the pieces the plan places: toolbar, panel slot, map layer, settings rows. */
export function usePlanTools(input: PlanToolsInput) {
  const [tool, setTool] = useState<PlanTool | null>(null)
  const [gradeColoursOn, setGradeColours] = useStoredFlag(STORAGE.gradeColours)
  const [followOn, setFollow] = useStoredFlag(STORAGE.follow)
  const [panelHost, setPanelHost] = useState<HTMLDivElement | null>(null)
  const available = !input.investigation && !input.terrainOnly
  const roadDrawing = !['inspect', 'edit'].includes(input.mode)
  // A road drawing mode, a note tool or a plan pick puts the tool down; so does leaving Inspect.
  const [seenMode, setSeenMode] = useState(input.mode)
  if (seenMode !== input.mode) {
    setSeenMode(input.mode)
    if (input.mode !== 'inspect' && tool) setTool(null)
  }
  const suppressed = !available || roadDrawing || !!input.noteTool || !!input.pourPointPicking
  if (tool && suppressed) setTool(null)
  if (tool === 'peg' && !input.onPeg) setTool(null)
  const pick = (next: PlanTool) => {
    if (tool === next) {
      setTool(null)
      return
    }
    input.onClearNoteTool()
    if (input.mode !== 'inspect') input.onMode?.('inspect')
    setTool(next)
  }
  const active = suppressed ? null : tool
  const toolbar: ReactNode = available ? (
    <PlanToolButtons tool={active} onPick={pick} pegDisabled={!input.onPeg} />
  ) : null
  const panelSlot: ReactNode = active ? (
    <div
      ref={setPanelHost}
      className="absolute bottom-9 left-2 z-30 max-h-[calc(100%-5.5rem)] w-80 max-w-[calc(100%-1rem)] overflow-y-auto overscroll-none"
      data-map-export-ignore
    />
  ) : null
  const mapLayer: ReactNode = (
    <PlanToolLayer
      {...input}
      tool={active}
      onClose={() => setTool(null)}
      panelHost={panelHost}
      followStation={available && followOn}
    />
  )
  const settingsRows: (readonly [string, boolean, (value: boolean) => void])[] = available
    ? [
        ['Colour by grade', gradeColoursOn, setGradeColours],
        ['Follow station', followOn, setFollow],
      ]
    : []
  return { tool: active, gradeColours: available && gradeColoursOn, toolbar, panelSlot, mapLayer, settingsRows }
}

export function PlanToolButtons({
  tool,
  onPick,
  pegDisabled,
}: {
  tool: PlanTool | null
  onPick: (tool: PlanTool) => void
  pegDisabled: boolean
}) {
  const button = (value: PlanTool, label: string, title: string, Icon: typeof Footprints, disabled = false) => (
    <Button
      size="icon"
      variant="outline"
      className={`size-8 shrink-0 shadow-sm ${tool === value ? 'bg-accent text-accent-foreground' : 'bg-background/95'}`}
      aria-label={label}
      aria-pressed={tool === value}
      title={title}
      disabled={disabled}
      onClick={() => onPick(value)}
    >
      <Icon className="size-4" />
    </Button>
  )
  return (
    <div className="flex shrink-0 gap-1" role="group" aria-label="Plan tools">
      {button(
        'peg',
        'Peg at grade',
        pegDisabled
          ? 'Peg at grade · needs a design road you can edit'
          : 'Peg at grade · the cursor aims, each click adds a leg at the target grade',
        Footprints,
        pegDisabled,
      )}
      {button('query', 'Query a point', 'Query a point · station, offset, ground and design levels', ScanSearch)}
    </div>
  )
}

/** The map side of the plan tools: the tool in hand, and the follow-station pan. */
function PlanToolLayer(
  props: PlanToolsInput & {
    tool: PlanTool | null
    onClose: () => void
    panelHost: HTMLElement | null
    followStation: boolean
  },
) {
  const coordinate =
    props.selectedStation?.coordinate ??
    (props.analysis ? nearestStation(props.analysis.stations, props.station)?.coordinate : undefined)
  useFollowStation(props.followStation ? (coordinate ?? null) : null)
  if (props.tool === 'peg' && props.onPeg)
    return (
      <PegTool
        project={props.project}
        alignment={props.alignment}
        source={props.source}
        onPeg={props.onPeg}
        snapLines={props.snapLines}
        onClose={props.onClose}
        panelHost={props.panelHost}
      />
    )
  if (props.tool === 'query')
    return (
      <PointQueryTool
        project={props.project}
        alignment={props.alignment}
        source={props.source}
        onStation={props.onStation}
        onTypeStation={props.onTypeStation}
        onClose={props.onClose}
        panelHost={props.panelHost}
      />
    )
  return null
}

/** Pans the plan to keep `coordinate` in view, by the rules in `followStation.ts`. */
function useFollowStation(coordinate: Coordinate | null) {
  const { map, isLoaded } = useMap()
  const watch = useRef({ lastPanAt: 0, holdUntil: 0, userMoving: false, pointerInPlan: false, timer: 0 })
  useEffect(() => {
    if (!map || !isLoaded) return
    const state = watch.current
    const container = map.getContainer()
    // Only a move the reader made carries the browser event that started it.
    const start = (event: { originalEvent?: unknown }) => {
      if (event.originalEvent) state.userMoving = true
    }
    const end = () => {
      if (!state.userMoving) return
      state.userMoving = false
      state.holdUntil = performance.now() + FOLLOW_HOLD_AFTER_USER_MS
    }
    const enter = () => (state.pointerInPlan = true)
    const leave = () => (state.pointerInPlan = false)
    map.on('movestart', start)
    map.on('moveend', end)
    container.addEventListener('pointerenter', enter)
    container.addEventListener('pointerleave', leave)
    return () => {
      map.off('movestart', start)
      map.off('moveend', end)
      container.removeEventListener('pointerenter', enter)
      container.removeEventListener('pointerleave', leave)
      window.clearTimeout(state.timer)
    }
  }, [map, isLoaded])
  const lng = coordinate?.[0],
    lat = coordinate?.[1]
  useEffect(() => {
    if (!map || !isLoaded || lng === undefined || lat === undefined) return
    const state = watch.current
    const pan = () => {
      state.timer = 0
      const container = map.getContainer()
      const point = map.project([lng, lat])
      if (!outsideFollowBox(point, { width: container.clientWidth, height: container.clientHeight })) return
      const delay = followDelay({ now: performance.now(), ...state })
      if (delay === null) return
      if (delay > 0) {
        state.timer = window.setTimeout(pan, delay)
        return
      }
      state.lastPanAt = performance.now()
      map.easeTo({ center: [lng, lat], duration: FOLLOW_PAN_MS })
    }
    window.clearTimeout(state.timer)
    pan()
  }, [map, isLoaded, lng, lat])
}

const OVERLAY_SOURCE = 'road-plan-tool'
const OVERLAY_LAYERS = ['road-plan-tool-line', 'road-plan-tool-dashed', 'road-plan-tool-point'] as const
const DASHED_ROLES = ['peg-preview', 'query-offset']

/**
 * A tool's own lines and points, drawn above the plan's layers. The plan re-stacks its layers when
 * its data changes, so this lifts the tool's layers back to the top whenever the style changes.
 */
export function usePlanToolOverlay(data: GeoJSON.FeatureCollection) {
  const { map, isLoaded } = useMap()
  useEffect(() => {
    if (!map || !isLoaded) return
    if (!map.getSource(OVERLAY_SOURCE))
      map.addSource(OVERLAY_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    const color = ['coalesce', ['get', 'color'], '#0f172a'] as never
    if (!map.getLayer(OVERLAY_LAYERS[0]))
      map.addLayer({
        id: OVERLAY_LAYERS[0],
        type: 'line',
        source: OVERLAY_SOURCE,
        filter: [
          'all',
          ['==', ['geometry-type'], 'LineString'],
          ['!', ['in', ['get', 'role'], ['literal', DASHED_ROLES]]],
        ],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': color, 'line-width': 4 },
      })
    if (!map.getLayer(OVERLAY_LAYERS[1]))
      map.addLayer({
        id: OVERLAY_LAYERS[1],
        type: 'line',
        source: OVERLAY_SOURCE,
        filter: ['all', ['==', ['geometry-type'], 'LineString'], ['in', ['get', 'role'], ['literal', DASHED_ROLES]]],
        paint: { 'line-color': color, 'line-width': 3, 'line-dasharray': [2, 1.5] },
      })
    if (!map.getLayer(OVERLAY_LAYERS[2]))
      map.addLayer({
        id: OVERLAY_LAYERS[2],
        type: 'circle',
        source: OVERLAY_SOURCE,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-color': ['coalesce', ['get', 'color'], '#ffffff'] as never,
          'circle-radius': 4.5,
          'circle-stroke-color': '#0f172a',
          'circle-stroke-width': 1.5,
        },
      })
    const raise = () => raiseOverlay(map)
    raise()
    map.on('styledata', raise)
    return () => {
      map.off('styledata', raise)
      // The map may already be gone when the plan unmounts.
      try {
        for (const id of OVERLAY_LAYERS) if (map.getLayer(id)) map.removeLayer(id)
        if (map.getSource(OVERLAY_SOURCE)) map.removeSource(OVERLAY_SOURCE)
      } catch {
        /* nothing left to remove */
      }
    }
  }, [map, isLoaded])
  useEffect(() => {
    if (!map || !isLoaded) return
    ;(map.getSource(OVERLAY_SOURCE) as GeoJSONSource | undefined)?.setData(data)
  }, [map, isLoaded, data])
}

function raiseOverlay(map: MapLibreMap) {
  const order = map.getLayersOrder()
  const top = order.slice(-OVERLAY_LAYERS.length)
  if (OVERLAY_LAYERS.every((id, i) => top[i] === id)) return
  for (const id of OVERLAY_LAYERS) if (map.getLayer(id)) map.moveLayer(id)
}
