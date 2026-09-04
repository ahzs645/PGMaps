import type MapLibreGL from 'maplibre-gl'
import {
  Check,
  Copy,
  Crosshair,
  Download,
  FileJson,
  FileUp,
  Hexagon,
  Link2,
  MapPin,
  Plus,
  RotateCcw,
  Route as RouteIcon,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { MAP_SIDEBAR_CLASS, MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { Button } from '@/components/ui/button'
import { Map, MapControls, useMap, type MapRef } from '@/components/ui/map'
import { MapCircleLayer, MapFillLayer, MapLineLayer, MapPmtilesFillLayer } from '@/components/ui/map-layers'
import { MapSidebarShell, SidebarSection } from '@/components/ui/map-panels'
import { BC_CENTER } from '@/components/ui/map-styles'
import { escapeHtml } from '@/lib/escapeHtml'
import { fetchJson } from '@/lib/fetchJson'
import {
  AREA_KINDS,
  AREA_KIND_LABELS,
  ROUTE_KINDS,
  ROUTE_KIND_LABELS,
  WAYPOINT_KINDS,
  WAYPOINT_KIND_LABELS,
  createEmptyPlan,
  createWaypointId,
  decodeOutdoorsPlanToken,
  encodeOutdoorsPlanToken,
  normalizeOutdoorsPlan,
  parseOutdoorsPlanFile,
  planFileName,
  planToGeoJson,
  roundCoordinate,
  serializeOutdoorsPlan,
  type AreaKind,
  type OutdoorsPlan,
  type PlanActivity,
  type PlanArea,
  type PlanRoute,
  type PlanWaypoint,
  type RouteKind,
  type WaypointKind,
} from '@/maps/outdoors/plan'

const OUTDOORS_CATALOG_URL = '/data/bc/outdoors/r2/pmtiles-catalog.json'
const WMU_SOURCE_LAYER = 'wildlife_management_units'
const WMU_ID_PROPERTY = 'managementUnitId'
const LOCAL_STORAGE_KEY = 'pgmaps.bc-outdoors-plan.v1'

const ACTIVITY_LABELS: Record<PlanActivity, string> = {
  hunt: 'Hunting',
  fish: 'Fishing',
  scout: 'Scouting',
}

const WAYPOINT_COLORS: Record<WaypointKind, string> = {
  camp: '#f59e0b',
  access: '#0ea5e9',
  launch: '#14b8a6',
  site: '#8b5cf6',
  hazard: '#ef4444',
  note: '#64748b',
}

const AREA_COLORS: Record<AreaKind, string> = {
  closure: '#ef4444',
  'hunt-area': '#16a34a',
  water: '#38bdf8',
  area: '#64748b',
}

const ROUTE_COLORS: Record<RouteKind, string> = {
  corridor: '#f97316',
  'access-route': '#06b6d4',
  'water-route': '#0ea5e9',
  travel: '#8b5cf6',
  route: '#64748b',
}

function kindColorExpression(colors: Record<string, string>, fallback: string) {
  return ['match', ['get', 'kind'], ...Object.entries(colors).flat(), fallback]
}

const WAYPOINT_COLOR_EXPRESSION = kindColorExpression(WAYPOINT_COLORS, WAYPOINT_COLORS.note)
const AREA_COLOR_EXPRESSION = kindColorExpression(AREA_COLORS, AREA_COLORS.area)
const ROUTE_COLOR_EXPRESSION = kindColorExpression(ROUTE_COLORS, ROUTE_COLORS.route)

type OutdoorsPmtilesCatalog = {
  storage?: { version?: string }
  sourceManifest?: { layers?: Array<{ id?: string; sourceLastModifiedAt?: string }> }
  archives?: Array<{ id?: string; publicUrl?: string }>
}

type WmuLayerInfo = {
  pmtilesUrl: string
  version: string | null
  sourceUpdated: string | null
}

type DrawMode = 'waypoint' | 'route' | 'area'
type PlanStage = 'eligibility' | 'access' | 'field-plan'

const PLAN_STAGES: Array<{ id: PlanStage; shortLabel: string; title: string; description: string }> = [
  {
    id: 'eligibility',
    shortLabel: '1 · Hunt',
    title: 'Can I hunt here?',
    description: 'Set the trip context, select management units, and review hunt-area geometry.',
  },
  {
    id: 'access',
    shortLabel: '2 · Access',
    title: 'How can I reach it?',
    description: 'Review closures, corridors, water routes, launches, and candidate access.',
  },
  {
    id: 'field-plan',
    shortLabel: '3 · Field',
    title: 'What is my field plan?',
    description: 'Keep camps, personal routes, travel ranges, notes, and shareable trip details.',
  },
]

function waypointIsInStage(waypoint: PlanWaypoint, stage: PlanStage): boolean {
  if (stage === 'access') return ['access', 'launch', 'site', 'hazard'].includes(waypoint.kind)
  if (stage === 'field-plan') return ['camp', 'note'].includes(waypoint.kind)
  return false
}

function routeIsInStage(route: PlanRoute, stage: PlanStage): boolean {
  if (stage === 'access') return ['corridor', 'access-route', 'water-route'].includes(route.kind)
  if (stage === 'field-plan') return ['travel', 'route'].includes(route.kind)
  return false
}

function areaIsInStage(area: PlanArea, stage: PlanStage): boolean {
  if (stage === 'eligibility') return area.kind === 'hunt-area'
  if (stage === 'access') return ['closure', 'water'].includes(area.kind)
  return area.kind === 'area'
}

type SelectedFeature = { type: 'waypoint' | 'route' | 'area'; id: string } | null

const INPUT_CLASS =
  'h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

const KIND_SELECT_CLASS =
  'h-7 rounded-md border border-border bg-background px-1.5 text-[11px] text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

const ICON_BUTTON_CLASS =
  'rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'

function loadStoredPlan(): OutdoorsPlan | null {
  try {
    const stored = window.localStorage.getItem(LOCAL_STORAGE_KEY)
    return stored ? normalizeOutdoorsPlan(JSON.parse(stored)) : null
  } catch {
    return null
  }
}

function downloadTextFile(fileName: string, text: string, mimeType: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  // Revoking synchronously can cancel the download in WebKit and embedded
  // Chromium shells before they have consumed the object URL.
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function planBounds(plan: OutdoorsPlan): [[number, number], [number, number]] | null {
  const lngs: number[] = []
  const lats: number[] = []
  const collect = ([lng, lat]: [number, number]) => {
    lngs.push(lng)
    lats.push(lat)
  }
  plan.waypoints.forEach((waypoint) => collect([waypoint.lng, waypoint.lat]))
  plan.routes.forEach((route) => route.coordinates.forEach(collect))
  plan.areas.forEach((area) => area.rings.forEach((ring) => ring.forEach(collect)))
  if (lngs.length === 0) return null
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ]
}

function coordinateBounds(coordinates: Array<[number, number]>): [[number, number], [number, number]] {
  const lngs = coordinates.map(([lng]) => lng)
  const lats = coordinates.map(([, lat]) => lat)
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ]
}

function importSummary(fileName: string, plan: OutdoorsPlan, skippedCount: number): string {
  const parts = [
    plan.waypoints.length && `${plan.waypoints.length} waypoints`,
    plan.routes.length && `${plan.routes.length} routes`,
    plan.areas.length && `${plan.areas.length} areas`,
  ].filter(Boolean)
  const skipped = skippedCount > 0 ? ` (${skippedCount} unsupported features skipped)` : ''
  return `Imported ${parts.join(', ')} from ${fileName}${skipped}`
}

/** Forwards map clicks to the active draw mode. */
function MapClickCapture({
  active,
  onMapClick,
}: {
  active: boolean
  onMapClick: (lngLat: { lng: number; lat: number }) => void
}) {
  const { map, isLoaded } = useMap()
  const activeRef = useRef(active)
  const onMapClickRef = useRef(onMapClick)

  useEffect(() => {
    activeRef.current = active
    if (map) map.getCanvas().style.cursor = active ? 'crosshair' : ''
  }, [active, map])

  useEffect(() => {
    onMapClickRef.current = onMapClick
  }, [onMapClick])

  useEffect(() => {
    if (!isLoaded || !map) return
    const handleClick = (event: MapLibreGL.MapMouseEvent) => {
      if (!activeRef.current) return
      onMapClickRef.current({ lng: event.lngLat.lng, lat: event.lngLat.lat })
    }
    map.on('click', handleClick)
    return () => {
      map.off('click', handleClick)
      map.getCanvas().style.cursor = ''
    }
  }, [isLoaded, map])

  return null
}

function FeatureRow({
  color,
  name,
  namePlaceholder,
  kind,
  kinds,
  kindLabels,
  detail,
  notes,
  selected,
  onNameChange,
  onKindChange,
  onNotesChange,
  onSelect,
  onZoom,
  onDelete,
}: {
  color: string
  name: string
  namePlaceholder: string
  kind: string
  kinds: readonly string[]
  kindLabels: Record<string, string>
  detail: string
  notes?: string
  selected: boolean
  onNameChange: (name: string) => void
  onKindChange: (kind: string) => void
  onNotesChange: (notes: string) => void
  onSelect: () => void
  onZoom: () => void
  onDelete: () => void
}) {
  return (
    <li className={`rounded-md border p-2 ${selected ? 'border-primary/60 bg-accent/40' : 'border-border'}`}>
      <div className="flex items-center gap-1.5">
        <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
        <input
          className={INPUT_CLASS}
          placeholder={namePlaceholder}
          value={name}
          onFocus={onSelect}
          onChange={(event) => onNameChange(event.target.value)}
        />
        <button type="button" onClick={onZoom} className={ICON_BUTTON_CLASS} title="Zoom to feature">
          <MapPin className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
          title="Delete feature"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <select
          className={KIND_SELECT_CLASS}
          value={kind}
          aria-label="Feature kind"
          onChange={(event) => onKindChange(event.target.value)}
        >
          {kinds.map((option) => (
            <option key={option} value={option}>
              {kindLabels[option]}
            </option>
          ))}
        </select>
        <span className="text-[11px] tabular-nums text-muted-foreground">{detail}</span>
      </div>
      {selected && (
        <textarea
          className="mt-2 min-h-14 w-full rounded-md border border-border bg-background px-2 py-1.5 text-[11px] leading-4 text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          placeholder="Verification, access, or field notes…"
          value={notes ?? ''}
          onChange={(event) => onNotesChange(event.target.value)}
        />
      )}
    </li>
  )
}

function DevOutdoors() {
  const [searchParams] = useSearchParams()
  const initialShareTokenValue = searchParams.get('s')
  const initialShareToken = useRef(initialShareTokenValue)
  const lastEncodedShareToken = useRef<string | null>(initialShareTokenValue)

  const [plan, setPlan] = useState<OutdoorsPlan>(() =>
    initialShareTokenValue ? createEmptyPlan() : (loadStoredPlan() ?? createEmptyPlan()),
  )
  const [planReady, setPlanReady] = useState(() => !initialShareTokenValue)
  const [activeStage, setActiveStage] = useState<PlanStage>('eligibility')
  const [wmuLayer, setWmuLayer] = useState<WmuLayerInfo | null>(null)
  const [wmuLayerError, setWmuLayerError] = useState<string | null>(null)
  const [drawMode, setDrawMode] = useState<DrawMode | null>(null)
  const [draftVertices, setDraftVertices] = useState<Array<[number, number]>>([])
  const [selectedFeature, setSelectedFeature] = useState<SelectedFeature>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  const mapRef = useRef<MapRef>(null)
  const drawModeRef = useRef(drawMode)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const viewportRef = useRef<{ center: [number, number]; zoom: number } | null>(null)
  const viewportCommitTimer = useRef<number | null>(null)

  useEffect(() => {
    drawModeRef.current = drawMode
  }, [drawMode])

  // Restore from a shared link; without one the state initializers above have
  // already loaded the local autosave.
  useEffect(() => {
    const token = initialShareToken.current
    if (!token) return
    let cancelled = false
    decodeOutdoorsPlanToken(token)
      .then((decoded) => {
        if (cancelled) return
        if (decoded) {
          setPlan(decoded)
        } else {
          const stored = loadStoredPlan()
          if (stored) setPlan(stored)
          setStatusMessage('The shared link could not be read; starting from your last saved plan.')
        }
        setPlanReady(true)
      })
      .catch(() => {
        if (cancelled) return
        setPlanReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    fetchJson<OutdoorsPmtilesCatalog>(OUTDOORS_CATALOG_URL, controller.signal)
      .then((catalog) => {
        const regulatory = catalog.archives?.find((archive) => archive.id === 'regulatory')
        if (!regulatory?.publicUrl) throw new Error('No regulatory archive in the outdoors catalog')
        const wmuSource = catalog.sourceManifest?.layers?.find((layer) => layer.id === WMU_SOURCE_LAYER)
        setWmuLayer({
          pmtilesUrl: regulatory.publicUrl,
          version: catalog.storage?.version ?? null,
          sourceUpdated: wmuSource?.sourceLastModifiedAt?.slice(0, 10) ?? null,
        })
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setWmuLayerError(
          'Wildlife Management Unit tiles are unavailable. Run `npm run data:sync-from-bcdatamapper` to restore the outdoors catalog.',
        )
      })
    return () => controller.abort()
  }, [])

  // Keep the share URL and the local autosave in step with the plan.
  useEffect(() => {
    if (!planReady) return
    let cancelled = false
    try {
      window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(plan))
    } catch {
      // Autosave is best-effort; private browsing can reject writes.
    }
    encodeOutdoorsPlanToken(plan)
      .then((token) => {
        if (cancelled || token === lastEncodedShareToken.current) return
        const url = new URL(window.location.href)
        url.searchParams.set('s', token)
        window.history.replaceState(null, '', url)
        lastEncodedShareToken.current = token
      })
      .catch(() => {
        if (cancelled) return
        // The plan has outgrown a link. Drop the stale token so the address
        // bar never shares an older version of the plan.
        const url = new URL(window.location.href)
        if (url.searchParams.has('s')) {
          url.searchParams.delete('s')
          window.history.replaceState(null, '', url)
        }
        lastEncodedShareToken.current = null
      })
    return () => {
      cancelled = true
    }
  }, [plan, planReady])

  const commitViewportToPlan = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    setPlan((current) => {
      const previous = current.viewport
      if (
        previous &&
        previous.center[0] === viewport.center[0] &&
        previous.center[1] === viewport.center[1] &&
        previous.zoom === viewport.zoom
      ) {
        return current
      }
      return { ...current, viewport }
    })
  }, [])

  const handleViewportChange = useCallback(
    (next: { center: [number, number]; zoom: number }) => {
      viewportRef.current = {
        center: [roundCoordinate(next.center[0]), roundCoordinate(next.center[1])],
        zoom: Math.round(next.zoom * 100) / 100,
      }
      if (viewportCommitTimer.current != null) window.clearTimeout(viewportCommitTimer.current)
      viewportCommitTimer.current = window.setTimeout(commitViewportToPlan, 600)
    },
    [commitViewportToPlan],
  )

  useEffect(
    () => () => {
      if (viewportCommitTimer.current != null) window.clearTimeout(viewportCommitTimer.current)
    },
    [],
  )

  const handleWmuClick = useCallback((id: string, _event: unknown, properties: Record<string, unknown>) => {
    if (drawModeRef.current) return
    setPlan((current) => {
      if (current.wmus.some((wmu) => wmu.id === id)) {
        return { ...current, wmus: current.wmus.filter((wmu) => wmu.id !== id) }
      }
      const name = typeof properties.boundaryName === 'string' ? properties.boundaryName : undefined
      return { ...current, wmus: [...current.wmus, { id, ...(name ? { name } : {}) }] }
    })
  }, [])

  // --- drawing ---------------------------------------------------------------

  const handleDrawClick = useCallback(
    (lngLat: { lng: number; lat: number }) => {
      const point: [number, number] = [roundCoordinate(lngLat.lng), roundCoordinate(lngLat.lat)]
      if (drawModeRef.current === 'waypoint') {
        const waypoint: PlanWaypoint = {
          id: createWaypointId(),
          name: '',
          kind: activeStage === 'access' ? 'access' : 'note',
          lng: point[0],
          lat: point[1],
        }
        setPlan((current) => ({ ...current, waypoints: [...current.waypoints, waypoint] }))
        setSelectedFeature({ type: 'waypoint', id: waypoint.id })
        return
      }
      setDraftVertices((current) => [...current, point])
    },
    [activeStage],
  )

  const startDraw = useCallback((mode: DrawMode) => {
    setDrawMode((current) => (current === mode ? null : mode))
    setDraftVertices([])
  }, [])

  const cancelDraw = useCallback(() => {
    setDrawMode(null)
    setDraftVertices([])
  }, [])

  const finishDraft = useCallback(() => {
    const mode = drawModeRef.current
    if (mode === 'route' && draftVertices.length >= 2) {
      const route: PlanRoute = {
        id: createWaypointId(),
        name: '',
        kind: activeStage === 'access' ? 'access-route' : 'route',
        coordinates: draftVertices,
      }
      setPlan((current) => ({ ...current, routes: [...current.routes, route] }))
      setSelectedFeature({ type: 'route', id: route.id })
    } else if (mode === 'area' && draftVertices.length >= 3) {
      const area: PlanArea = {
        id: createWaypointId(),
        name: '',
        kind: activeStage === 'eligibility' ? 'hunt-area' : activeStage === 'access' ? 'closure' : 'area',
        rings: [[...draftVertices, draftVertices[0]]],
      }
      setPlan((current) => ({ ...current, areas: [...current.areas, area] }))
      setSelectedFeature({ type: 'area', id: area.id })
    }
    setDrawMode(null)
    setDraftVertices([])
  }, [activeStage, draftVertices])

  // Layer clicks pass through to the map while drawing; ignore them so a draw
  // click never also changes the selection.
  const selectFeature = useCallback((type: 'waypoint' | 'route' | 'area', id: string) => {
    if (drawModeRef.current) return
    setSelectedFeature({ type, id })
  }, [])

  // --- feature edits ---------------------------------------------------------

  const updateWaypoint = useCallback((id: string, patch: Partial<PlanWaypoint>) => {
    setPlan((current) => ({
      ...current,
      waypoints: current.waypoints.map((waypoint) => (waypoint.id === id ? { ...waypoint, ...patch } : waypoint)),
    }))
  }, [])

  const updateRoute = useCallback((id: string, patch: Partial<PlanRoute>) => {
    setPlan((current) => ({
      ...current,
      routes: current.routes.map((route) => (route.id === id ? { ...route, ...patch } : route)),
    }))
  }, [])

  const updateArea = useCallback((id: string, patch: Partial<PlanArea>) => {
    setPlan((current) => ({
      ...current,
      areas: current.areas.map((area) => (area.id === id ? { ...area, ...patch } : area)),
    }))
  }, [])

  const removeFeature = useCallback((type: 'waypoint' | 'route' | 'area', id: string) => {
    setPlan((current) => ({
      ...current,
      waypoints: type === 'waypoint' ? current.waypoints.filter((f) => f.id !== id) : current.waypoints,
      routes: type === 'route' ? current.routes.filter((f) => f.id !== id) : current.routes,
      areas: type === 'area' ? current.areas.filter((f) => f.id !== id) : current.areas,
    }))
    setSelectedFeature((current) => (current?.id === id ? null : current))
  }, [])

  const zoomToWaypoint = useCallback((waypoint: PlanWaypoint) => {
    setSelectedFeature({ type: 'waypoint', id: waypoint.id })
    const map = mapRef.current
    if (!map) return
    map.flyTo({ center: [waypoint.lng, waypoint.lat], zoom: Math.max(map.getZoom(), 11) })
  }, [])

  const zoomToBounds = useCallback((bounds: [[number, number], [number, number]]) => {
    mapRef.current?.fitBounds(bounds, { padding: 80, maxZoom: 13 })
  }, [])

  // --- save & share ----------------------------------------------------------

  const handleCopyLink = useCallback(async () => {
    try {
      const token = await encodeOutdoorsPlanToken(plan)
      const url = new URL(window.location.href)
      url.searchParams.set('s', token)
      window.history.replaceState(null, '', url)
      lastEncodedShareToken.current = token
      await navigator.clipboard.writeText(url.toString())
      setCopyState('copied')
      setStatusMessage(null)
    } catch {
      setCopyState('failed')
      setStatusMessage('This plan is too large for a link (drawn geometry adds up) — use Export plan instead.')
    }
    window.setTimeout(() => setCopyState('idle'), 2000)
  }, [plan])

  const handleExportPlan = useCallback(() => {
    downloadTextFile(planFileName(plan, 'plan.json'), serializeOutdoorsPlan(plan), 'application/json')
  }, [plan])

  const handleExportGeoJson = useCallback(() => {
    downloadTextFile(
      planFileName(plan, 'geojson'),
      `${JSON.stringify(planToGeoJson(plan), null, 2)}\n`,
      'application/geo+json',
    )
  }, [plan])

  const applyLoadedPlan = useCallback(
    (loaded: OutdoorsPlan) => {
      setPlan(loaded)
      setSelectedFeature(null)
      cancelDraw()
      const map = mapRef.current
      if (!map) return
      if (loaded.viewport) {
        map.jumpTo({ center: loaded.viewport.center, zoom: loaded.viewport.zoom })
      } else {
        const bounds = planBounds(loaded)
        if (bounds) map.fitBounds(bounds, { padding: 80, maxZoom: 12 })
      }
    },
    [cancelDraw],
  )

  const handleImportFile = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return
      const result = parseOutdoorsPlanFile(await file.text())
      if (!result) {
        setStatusMessage(`Could not read ${file.name}: expected an exported plan or plan GeoJSON.`)
        return
      }
      applyLoadedPlan(result.plan)
      setStatusMessage(
        result.source === 'geojson'
          ? importSummary(file.name, result.plan, result.skippedCount)
          : `Loaded plan from ${file.name}`,
      )
    },
    [applyLoadedPlan],
  )

  const handleLoadSample = useCallback(async () => {
    try {
      const module = await import('@/maps/outdoors/sample-plan-mu-7-42.json')
      const sample = normalizeOutdoorsPlan(module.default)
      if (!sample) throw new Error('Invalid sample plan')
      applyLoadedPlan(sample)
      setStatusMessage(
        `Loaded the MU 7-42 sample: ${sample.waypoints.length} waypoints, ` +
          `${sample.routes.length} routes, and ${sample.areas.length} areas converted from a real planning KML.`,
      )
    } catch {
      setStatusMessage('The sample plan could not be loaded.')
    }
  }, [applyLoadedPlan])

  const handleNewPlan = useCallback(() => {
    setPlan(createEmptyPlan())
    setSelectedFeature(null)
    cancelDraw()
    setStatusMessage(null)
  }, [cancelDraw])

  // --- derived map data --------------------------------------------------------

  const wmuIds = useMemo(() => plan.wmus.map((wmu) => wmu.id), [plan.wmus])
  const activeStageInfo = PLAN_STAGES.find((stage) => stage.id === activeStage) ?? PLAN_STAGES[0]
  const visibleWaypoints = useMemo(
    () => plan.waypoints.filter((waypoint) => waypointIsInStage(waypoint, activeStage)),
    [activeStage, plan.waypoints],
  )
  const visibleRoutes = useMemo(
    () => plan.routes.filter((route) => routeIsInStage(route, activeStage)),
    [activeStage, plan.routes],
  )
  const visibleAreas = useMemo(
    () => plan.areas.filter((area) => areaIsInStage(area, activeStage)),
    [activeStage, plan.areas],
  )

  const wmuFillColor = useMemo(
    () =>
      wmuIds.length > 0
        ? ['case', ['in', ['get', WMU_ID_PROPERTY], ['literal', wmuIds]], '#22c55e', '#3b82f6']
        : '#3b82f6',
    [wmuIds],
  )

  const wmuFillOpacity = useMemo(
    () => (wmuIds.length > 0 ? ['case', ['in', ['get', WMU_ID_PROPERTY], ['literal', wmuIds]], 0.28, 0.05] : 0.08),
    [wmuIds],
  )

  const waypointCollection = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: visibleWaypoints.map((waypoint) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [waypoint.lng, waypoint.lat] },
        properties: { id: waypoint.id, name: waypoint.name, kind: waypoint.kind },
      })),
    }),
    [visibleWaypoints],
  )

  const routeCollection = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: visibleRoutes.map((route) => ({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: route.coordinates },
        properties: { id: route.id, name: route.name, kind: route.kind },
      })),
    }),
    [visibleRoutes],
  )

  const areaCollection = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: visibleAreas.map((area) => ({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: area.rings },
        properties: { id: area.id, name: area.name, kind: area.kind },
      })),
    }),
    [visibleAreas],
  )

  const draftCollection = useMemo<GeoJSON.FeatureCollection>(() => {
    const line = drawMode === 'area' && draftVertices.length >= 3 ? [...draftVertices, draftVertices[0]] : draftVertices
    return {
      type: 'FeatureCollection',
      features:
        line.length >= 2
          ? [
              {
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: line },
                properties: { id: 'draft' },
              },
            ]
          : [],
    }
  }, [draftVertices, drawMode])

  const draftVertexCollection = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: draftVertices.map((point, index) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: point },
        properties: { id: `draft-${index}` },
      })),
    }),
    [draftVertices],
  )

  const wmuHoverHtml = useCallback(
    (properties: Record<string, unknown>) => {
      const id = typeof properties[WMU_ID_PROPERTY] === 'string' ? (properties[WMU_ID_PROPERTY] as string) : ''
      const inPlan = wmuIds.includes(id)
      return `<div class="rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
        <div class="font-semibold">${escapeHtml(String(properties.boundaryName ?? id))}</div>
        <div class="mt-1 text-muted-foreground">${escapeHtml(String(properties.regionName ?? ''))} · GMZ ${escapeHtml(String(properties.gameManagementZoneId ?? '—'))}</div>
        <div class="mt-1 ${inPlan ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}">${inPlan ? 'In plan — click to remove' : 'Click to add to plan'}</div>
      </div>`
    },
    [wmuIds],
  )

  const waypointHoverHtml = useCallback((properties: Record<string, unknown>) => {
    const kind = properties.kind as WaypointKind
    return `<div class="rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
      <div class="font-semibold">${escapeHtml(String(properties.name || 'Unnamed waypoint'))}</div>
      <div class="mt-1 text-muted-foreground">${escapeHtml(WAYPOINT_KIND_LABELS[kind] ?? 'Note')}</div>
    </div>`
  }, [])

  const areaHoverHtml = useCallback((properties: Record<string, unknown>) => {
    const kind = properties.kind as AreaKind
    return `<div class="rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
      <div class="font-semibold">${escapeHtml(String(properties.name || 'Unnamed area'))}</div>
      <div class="mt-1 text-muted-foreground">${escapeHtml(AREA_KIND_LABELS[kind] ?? 'Area')}</div>
    </div>`
  }, [])

  const drawBanner = drawMode && (
    <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-md border border-border bg-background/95 px-3 py-1.5 text-xs font-medium text-foreground shadow-lg backdrop-blur">
      {drawMode === 'waypoint' ? (
        <span>Click the map to drop a waypoint</span>
      ) : (
        <>
          <span>
            {drawMode === 'route' ? 'Route' : 'Area'}: {draftVertices.length}{' '}
            {draftVertices.length === 1 ? 'point' : 'points'} — click the map to add more
          </span>
          <Button
            type="button"
            size="sm"
            className="h-6 px-2 text-[11px]"
            disabled={drawMode === 'route' ? draftVertices.length < 2 : draftVertices.length < 3}
            onClick={finishDraft}
          >
            <Check className="size-3" />
            Finish
          </Button>
        </>
      )}
      <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={cancelDraw}>
        <X className="size-3" />
        Cancel
      </Button>
    </div>
  )

  const sidebar = (
    <MapSidebarShell
      className={MAP_SIDEBAR_CLASS}
      title="Outdoors planner"
      subtitle="Plan a hunt, share it as a link, or export it"
      titleClassName="text-base"
    >
      <div className="border-b border-border px-3 py-3">
        <div className="grid grid-cols-3 gap-1" role="tablist" aria-label="Planning steps">
          {PLAN_STAGES.map((stage) => (
            <button
              key={stage.id}
              type="button"
              role="tab"
              aria-selected={activeStage === stage.id}
              className={`rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors ${
                activeStage === stage.id
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => {
                cancelDraw()
                setSelectedFeature(null)
                setActiveStage(stage.id)
              }}
            >
              {stage.shortLabel}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs font-semibold text-foreground">{activeStageInfo.title}</p>
        <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{activeStageInfo.description}</p>
        {activeStage !== 'field-plan' && (
          <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] leading-4 text-amber-800 dark:text-amber-200">
            The blue WMU layer is authoritative. Imported and hand-drawn hunt areas, closures, routes, and access points
            remain planning references until checked against their official source.
          </p>
        )}
      </div>

      {activeStage === 'eligibility' && (
        <>
          <SidebarSection title="Trip">
            <div className="space-y-2">
              <input
                className={INPUT_CLASS}
                placeholder="Trip name, e.g. Elk in MU 7-42"
                value={plan.name}
                onChange={(event) => setPlan((current) => ({ ...current, name: event.target.value }))}
              />
              <div className="grid grid-cols-2 gap-2">
                <select
                  className={INPUT_CLASS}
                  value={plan.activity}
                  aria-label="Activity"
                  onChange={(event) =>
                    setPlan((current) => ({ ...current, activity: event.target.value as PlanActivity }))
                  }
                >
                  {Object.entries(ACTIVITY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <input
                  className={INPUT_CLASS}
                  placeholder="Species, e.g. Elk"
                  value={plan.species}
                  onChange={(event) => setPlan((current) => ({ ...current, species: event.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  className={INPUT_CLASS}
                  type="date"
                  aria-label="Start date"
                  value={plan.startDate}
                  onChange={(event) => setPlan((current) => ({ ...current, startDate: event.target.value }))}
                />
                <input
                  className={INPUT_CLASS}
                  type="date"
                  aria-label="End date"
                  value={plan.endDate}
                  onChange={(event) => setPlan((current) => ({ ...current, endDate: event.target.value }))}
                />
              </div>
              <textarea
                className="min-h-16 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder="Notes — closures to verify, gear, access reminders…"
                value={plan.notes}
                onChange={(event) => setPlan((current) => ({ ...current, notes: event.target.value }))}
              />
            </div>
          </SidebarSection>

          <SidebarSection title="Management units">
            {wmuLayerError && (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs leading-5 text-amber-700 dark:text-amber-300">
                {wmuLayerError}
              </p>
            )}
            {plan.wmus.length === 0 ? (
              <p className="text-xs leading-5 text-muted-foreground">
                Click a Wildlife Management Unit on the map to add it to the plan.
              </p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {plan.wmus.map((wmu) => (
                  <li key={wmu.id}>
                    <button
                      type="button"
                      onClick={() =>
                        setPlan((current) => ({
                          ...current,
                          wmus: current.wmus.filter((entry) => entry.id !== wmu.id),
                        }))
                      }
                      className="inline-flex items-center gap-1 rounded-full border border-emerald-600/40 bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-500/20 dark:text-emerald-300"
                      title="Remove from plan"
                    >
                      {wmu.name ?? `MU ${wmu.id}`}
                      <X className="size-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {wmuLayer && (
              <p className="mt-3 text-[11px] leading-4 text-muted-foreground">
                WMU boundaries: BC Data Catalogue snapshot
                {wmuLayer.sourceUpdated ? ` updated ${wmuLayer.sourceUpdated}` : ''}
                {wmuLayer.version ? ` (${wmuLayer.version})` : ''}. Always confirm season dates in the official BC
                hunting regulations before a trip.
              </p>
            )}
          </SidebarSection>
        </>
      )}

      {activeStage !== 'eligibility' && (
        <SidebarSection
          title={`${activeStage === 'access' ? 'Access points' : 'Field waypoints'}${visibleWaypoints.length > 0 ? ` (${visibleWaypoints.length})` : ''}`}
          actions={
            <Button
              type="button"
              variant={drawMode === 'waypoint' ? 'default' : 'outline'}
              size="sm"
              className="h-7 px-2"
              onClick={() => startDraw('waypoint')}
            >
              {drawMode === 'waypoint' ? <Crosshair className="size-3.5" /> : <Plus className="size-3.5" />}
              {drawMode === 'waypoint' ? 'Click map…' : 'Add'}
            </Button>
          }
        >
          {visibleWaypoints.length === 0 ? (
            <p className="text-xs leading-5 text-muted-foreground">
              Use <span className="font-medium text-foreground">Add</span>, then click the map to add
              {activeStage === 'access'
                ? ' launches, access points, recreation sites, and hazards.'
                : ' camps and personal notes.'}
            </p>
          ) : (
            <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {visibleWaypoints.map((waypoint) => (
                <FeatureRow
                  key={waypoint.id}
                  color={WAYPOINT_COLORS[waypoint.kind]}
                  name={waypoint.name}
                  namePlaceholder="Waypoint name"
                  kind={waypoint.kind}
                  kinds={WAYPOINT_KINDS}
                  kindLabels={WAYPOINT_KIND_LABELS}
                  detail={`${waypoint.lat.toFixed(5)}, ${waypoint.lng.toFixed(5)}`}
                  notes={waypoint.notes}
                  selected={selectedFeature?.type === 'waypoint' && selectedFeature.id === waypoint.id}
                  onNameChange={(name) => updateWaypoint(waypoint.id, { name })}
                  onKindChange={(kind) => updateWaypoint(waypoint.id, { kind: kind as WaypointKind })}
                  onNotesChange={(notes) => updateWaypoint(waypoint.id, { notes })}
                  onSelect={() => setSelectedFeature({ type: 'waypoint', id: waypoint.id })}
                  onZoom={() => zoomToWaypoint(waypoint)}
                  onDelete={() => removeFeature('waypoint', waypoint.id)}
                />
              ))}
            </ul>
          )}
        </SidebarSection>
      )}

      {activeStage !== 'eligibility' && (
        <SidebarSection
          title={`${activeStage === 'access' ? 'Access routes' : 'Field routes'}${visibleRoutes.length > 0 ? ` (${visibleRoutes.length})` : ''}`}
          actions={
            <Button
              type="button"
              variant={drawMode === 'route' ? 'default' : 'outline'}
              size="sm"
              className="h-7 px-2"
              onClick={() => startDraw('route')}
            >
              <RouteIcon className="size-3.5" />
              {drawMode === 'route' ? 'Drawing…' : 'Draw'}
            </Button>
          }
        >
          {visibleRoutes.length === 0 ? (
            <p className="text-xs leading-5 text-muted-foreground">
              {activeStage === 'access'
                ? 'Draw candidate access routes, corridors, and river runs as lines on the map.'
                : 'Draw personal travel routes and range estimates as lines on the map.'}
            </p>
          ) : (
            <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {visibleRoutes.map((route) => (
                <FeatureRow
                  key={route.id}
                  color={ROUTE_COLORS[route.kind]}
                  name={route.name}
                  namePlaceholder="Route name"
                  kind={route.kind}
                  kinds={ROUTE_KINDS}
                  kindLabels={ROUTE_KIND_LABELS}
                  detail={`${route.coordinates.length} points`}
                  notes={route.notes}
                  selected={selectedFeature?.type === 'route' && selectedFeature.id === route.id}
                  onNameChange={(name) => updateRoute(route.id, { name })}
                  onKindChange={(kind) => updateRoute(route.id, { kind: kind as RouteKind })}
                  onNotesChange={(notes) => updateRoute(route.id, { notes })}
                  onSelect={() => setSelectedFeature({ type: 'route', id: route.id })}
                  onZoom={() => {
                    setSelectedFeature({ type: 'route', id: route.id })
                    zoomToBounds(coordinateBounds(route.coordinates))
                  }}
                  onDelete={() => removeFeature('route', route.id)}
                />
              ))}
            </ul>
          )}
        </SidebarSection>
      )}

      <SidebarSection
        title={`${activeStage === 'eligibility' ? 'Hunt areas' : activeStage === 'access' ? 'Closures & water' : 'Field areas'}${visibleAreas.length > 0 ? ` (${visibleAreas.length})` : ''}`}
        actions={
          <Button
            type="button"
            variant={drawMode === 'area' ? 'default' : 'outline'}
            size="sm"
            className="h-7 px-2"
            onClick={() => startDraw('area')}
          >
            <Hexagon className="size-3.5" />
            {drawMode === 'area' ? 'Drawing…' : 'Draw'}
          </Button>
        }
      >
        {visibleAreas.length === 0 ? (
          <p className="text-xs leading-5 text-muted-foreground">
            Draw{' '}
            {activeStage === 'eligibility'
              ? 'a hunt area'
              : activeStage === 'access'
                ? 'a closure or water area'
                : 'a field area'}{' '}
            as a polygon — click at least three points, then Finish.
          </p>
        ) : (
          <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {visibleAreas.map((area) => (
              <FeatureRow
                key={area.id}
                color={AREA_COLORS[area.kind]}
                name={area.name}
                namePlaceholder="Area name"
                kind={area.kind}
                kinds={AREA_KINDS}
                kindLabels={AREA_KIND_LABELS}
                detail={`${area.rings[0].length - 1} points`}
                notes={area.notes}
                selected={selectedFeature?.type === 'area' && selectedFeature.id === area.id}
                onNameChange={(name) => updateArea(area.id, { name })}
                onKindChange={(kind) => updateArea(area.id, { kind: kind as AreaKind })}
                onNotesChange={(notes) => updateArea(area.id, { notes })}
                onSelect={() => setSelectedFeature({ type: 'area', id: area.id })}
                onZoom={() => {
                  setSelectedFeature({ type: 'area', id: area.id })
                  zoomToBounds(coordinateBounds(area.rings[0]))
                }}
                onDelete={() => removeFeature('area', area.id)}
              />
            ))}
          </ul>
        )}
      </SidebarSection>

      <SidebarSection title="Save & share">
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" size="sm" onClick={handleCopyLink}>
            {copyState === 'copied' ? (
              <Check className="size-3.5" />
            ) : copyState === 'failed' ? (
              <Link2 className="size-3.5" />
            ) : (
              <Copy className="size-3.5" />
            )}
            {copyState === 'copied' ? 'Link copied' : 'Copy link'}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={handleExportPlan}>
            <Download className="size-3.5" />
            Export plan
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={handleExportGeoJson}>
            <FileJson className="size-3.5" />
            Export GeoJSON
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
            <FileUp className="size-3.5" />
            Import
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.geojson,application/json,application/geo+json"
          className="hidden"
          onChange={handleImportFile}
        />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={handleLoadSample}>
            <Sparkles className="size-3.5" />
            Load sample
          </Button>
          <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={handleNewPlan}>
            <RotateCcw className="size-3.5" />
            New plan
          </Button>
        </div>
        {statusMessage && (
          <p className="mt-2 rounded-md border border-border bg-muted/40 p-2 text-[11px] leading-4 text-muted-foreground">
            {statusMessage}
          </p>
        )}
        <p className="mt-3 text-[11px] leading-4 text-muted-foreground">
          The link in the address bar carries waypoint-scale plans; geometry-heavy plans share via Export instead.
          Exported plan files reopen here via Import, and GeoJSON drops into QGIS, Caltopo, or Avenza. The sample is a
          real MU 7-42 planning map converted from KML.
        </p>
      </SidebarSection>
    </MapSidebarShell>
  )

  if (!planReady) {
    return <div className="h-full bg-background" />
  }

  return (
    <MapSectionLayout
      sidebar={sidebar}
      desktopSidebarWidth={380}
      mobileInitialSheetState="half"
      selectedFeatureMobilePeek={{
        title: 'Outdoors planner',
        subtitle: plan.name || 'Untitled trip',
      }}
    >
      <Map
        ref={mapRef}
        center={plan.viewport?.center ?? BC_CENTER}
        zoom={plan.viewport?.zoom ?? 5}
        onViewportChange={handleViewportChange}
        controls={<MapControls position="top-right" mobilePosition="bottom-right" />}
      >
        <MapClickCapture active={drawMode != null} onMapClick={handleDrawClick} />
        {wmuLayer && (
          <MapPmtilesFillLayer
            url={wmuLayer.pmtilesUrl}
            sourceLayer={WMU_SOURCE_LAYER}
            idProperty={WMU_ID_PROPERTY}
            fillColor={wmuFillColor}
            fillOpacity={wmuFillOpacity}
            lineColor="#3b82f6"
            lineWidth={0.8}
            lineOpacity={0.5}
            selectedIds={wmuIds}
            selectionColor="#16a34a"
            selectionWidth={2.5}
            onFeatureClick={handleWmuClick}
            hoverHtml={wmuHoverHtml}
          />
        )}
        <MapFillLayer
          data={areaCollection}
          fillColor={AREA_COLOR_EXPRESSION}
          fillOpacity={0.18}
          lineColor={AREA_COLOR_EXPRESSION}
          lineWidth={1.4}
          lineOpacity={0.85}
          idProperty="id"
          selectedId={selectedFeature?.type === 'area' ? selectedFeature.id : null}
          selectionColor="#111827"
          onFeatureClick={(id) => selectFeature('area', id)}
          hoverHtml={areaHoverHtml}
        />
        <MapLineLayer
          data={routeCollection}
          color={ROUTE_COLOR_EXPRESSION}
          width={2.2}
          opacity={0.85}
          idProperty="id"
          selectedId={selectedFeature?.type === 'route' ? selectedFeature.id : null}
          selectionColor="#111827"
          onFeatureClick={(id) => selectFeature('route', id)}
        />
        <MapLineLayer data={draftCollection} color="#111827" width={2} dashArray={[2, 1.5]} opacity={0.9} />
        <MapCircleLayer
          data={draftVertexCollection}
          color="#111827"
          radius={4}
          strokeColor="#ffffff"
          strokeWidth={1.2}
        />
        <MapCircleLayer
          data={waypointCollection}
          color={WAYPOINT_COLOR_EXPRESSION}
          radius={6}
          strokeColor="#ffffff"
          strokeWidth={1.5}
          idProperty="id"
          selectedId={selectedFeature?.type === 'waypoint' ? selectedFeature.id : null}
          selectionColor="#111827"
          onFeatureClick={(id) => selectFeature('waypoint', id)}
          hoverHtml={waypointHoverHtml}
        />
      </Map>
      {drawBanner}
    </MapSectionLayout>
  )
}

export default DevOutdoors
