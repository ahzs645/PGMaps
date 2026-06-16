import { useEffect, useMemo, useRef, useState } from 'react'
import { type StyleSpecification } from 'maplibre-gl'
import {
  Camera,
  Check,
  Coffee,
  Copy,
  Eye,
  Flag,
  Layers,
  MapPin,
  MousePointer2,
  Mountain,
  Palette,
  PanelRight,
  RotateCcw,
  Save,
  Settings,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Spline,
  Star,
  Trash2,
  Utensils,
  Waves,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Map as AppMap, MapMarker, MarkerContent } from '@/components/ui/map'
import { MapControls } from '@/components/ui/map-controls'
import {
  MapLegend,
  MapLegendItem,
  MapSidebarShell,
  SidebarSection,
  StatGrid,
} from '@/components/ui/map-panels'
import { AppSelect } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { MAP_STYLES, PG_CENTER } from '@/components/ui/map-styles'
import {
  EditorMarkerView,
  MapClickHandler,
  MapCurvePath,
  MapStoryPanel,
  MapStorySection,
  MapTitleChip,
  MapToolRail,
  MapToolRailButton,
  serializeEditorMap,
  type EditorMarker,
  type EditorMarkerVariant,
  type EditorPath,
} from '@/components/ui/map-story'
import { type UrlCodec, useUrlState } from '@/hooks/useUrlState'
import { cn } from '@/lib/utils'

type MarkerShape = 'circle_fill' | 'pin' | 'badge'

type DesignState = {
  title: string
  subtitle: string
  primaryColor: string
  backgroundColor: string
  waterColor: string
  landcoverColor: string
  boundaryColor: string
  roadColor: string
  buildingColor: string
  markerFill: string
  markerInset: string
  markerSize: number
  markerShape: MarkerShape
  showLabels: boolean
  showWater: boolean
  showLandcover: boolean
  showFocusArea: boolean
  showStory: boolean
  showMarkers: boolean
  showPath: boolean
  showTitleChip: boolean
  showToolRail: boolean
}

const SHARED_BASEMAP_CAPTURE: DesignState = {
  title: 'PGMaps Designer',
  subtitle: 'Shared basemap color preview',
  primaryColor: '#2563eb',
  backgroundColor: '#f8fafc',
  waterColor: '#bae6fd',
  landcoverColor: '#dcfce7',
  boundaryColor: '#94a3b8',
  roadColor: '#ffffff',
  buildingColor: '#e2e8f0',
  markerFill: '#2563eb',
  markerInset: '#f8fafc',
  markerSize: 48,
  markerShape: 'circle_fill',
  showLabels: true,
  showWater: true,
  showLandcover: true,
  showFocusArea: true,
  showStory: true,
  showMarkers: true,
  showPath: true,
  showTitleChip: true,
  showToolRail: true,
}

const ALT_THEME: DesignState = {
  ...SHARED_BASEMAP_CAPTURE,
  primaryColor: '#0f766e',
  backgroundColor: '#f7fee7',
  waterColor: '#67e8f9',
  landcoverColor: '#bef264',
  boundaryColor: '#64748b',
  roadColor: '#fefce8',
  buildingColor: '#d9f99d',
  markerFill: '#0f766e',
  markerInset: '#f7fee7',
}

const DESIGN_CENTER = PG_CENTER
const MARKER_COORDINATE = { longitude: PG_CENTER[0], latitude: PG_CENTER[1] }
const DESIGN_STATE_KEYS = Object.keys(SHARED_BASEMAP_CAPTURE) as Array<keyof DesignState>

// Serializable icon registry — editor markers store a key, not a React node.
const MARKER_ICONS = {
  flag: Flag,
  waves: Waves,
  utensils: Utensils,
  camera: Camera,
  pin: MapPin,
  mountain: Mountain,
  coffee: Coffee,
  star: Star,
} as const
type MarkerIconKey = keyof typeof MARKER_ICONS
const MARKER_ICON_KEYS = Object.keys(MARKER_ICONS) as MarkerIconKey[]

function markerIcon(key: string): React.ReactNode {
  const Icon = MARKER_ICONS[key as MarkerIconKey] ?? MapPin
  return <Icon />
}

const PATH_COLOR = '#ff9800'
const DEFAULT_MARKER_FILL = '#2563eb'
const DEFAULT_MARKER_INSET = '#f8fafc'

// Seed markers + route — now editable studio state, not constants.
const INITIAL_MARKERS: EditorMarker[] = [
  { id: 'start', longitude: -122.815, latitude: 53.9225, variant: 'badge', label: 'Start', icon: 'flag', color1: DEFAULT_MARKER_FILL, color2: DEFAULT_MARKER_INSET, size: 44 },
  { id: 'river', longitude: -122.731, latitude: 53.9205, variant: 'pin', label: '', icon: 'waves', color1: DEFAULT_MARKER_FILL, color2: DEFAULT_MARKER_INSET, size: 44 },
  { id: 'market', longitude: -122.7245, latitude: 53.8975, variant: 'pin', label: '', icon: 'utensils', color1: DEFAULT_MARKER_FILL, color2: DEFAULT_MARKER_INSET, size: 44 },
  { id: 'lookout', longitude: -122.804, latitude: 53.8865, variant: 'badge', label: 'Lookout', icon: 'camera', color1: DEFAULT_MARKER_FILL, color2: DEFAULT_MARKER_INSET, size: 44 },
]

const INITIAL_PATHS: EditorPath[] = [
  {
    id: 'route',
    points: INITIAL_MARKERS.map((marker) => [marker.longitude, marker.latitude] as [number, number]),
    curved: true,
    dashed: true,
    arrow: true,
    color: PATH_COLOR,
    width: 3,
  },
]

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
}

function coerceDesignState(value: unknown): DesignState {
  if (!value || typeof value !== 'object') return SHARED_BASEMAP_CAPTURE
  const candidate = value as Partial<DesignState>

  return {
    title: typeof candidate.title === 'string' ? candidate.title.slice(0, 80) : SHARED_BASEMAP_CAPTURE.title,
    subtitle: typeof candidate.subtitle === 'string' ? candidate.subtitle.slice(0, 120) : SHARED_BASEMAP_CAPTURE.subtitle,
    primaryColor: isHexColor(candidate.primaryColor) ? candidate.primaryColor : SHARED_BASEMAP_CAPTURE.primaryColor,
    backgroundColor: isHexColor(candidate.backgroundColor)
      ? candidate.backgroundColor
      : SHARED_BASEMAP_CAPTURE.backgroundColor,
    waterColor: isHexColor(candidate.waterColor) ? candidate.waterColor : SHARED_BASEMAP_CAPTURE.waterColor,
    landcoverColor: isHexColor(candidate.landcoverColor)
      ? candidate.landcoverColor
      : SHARED_BASEMAP_CAPTURE.landcoverColor,
    boundaryColor: isHexColor(candidate.boundaryColor) ? candidate.boundaryColor : SHARED_BASEMAP_CAPTURE.boundaryColor,
    roadColor: isHexColor(candidate.roadColor) ? candidate.roadColor : SHARED_BASEMAP_CAPTURE.roadColor,
    buildingColor: isHexColor(candidate.buildingColor) ? candidate.buildingColor : SHARED_BASEMAP_CAPTURE.buildingColor,
    markerFill: isHexColor(candidate.markerFill) ? candidate.markerFill : SHARED_BASEMAP_CAPTURE.markerFill,
    markerInset: isHexColor(candidate.markerInset) ? candidate.markerInset : SHARED_BASEMAP_CAPTURE.markerInset,
    markerSize:
      typeof candidate.markerSize === 'number' && Number.isFinite(candidate.markerSize)
        ? Math.min(72, Math.max(28, Math.round(candidate.markerSize)))
        : SHARED_BASEMAP_CAPTURE.markerSize,
    markerShape:
      candidate.markerShape === 'circle_fill' || candidate.markerShape === 'pin' || candidate.markerShape === 'badge'
        ? candidate.markerShape
        : SHARED_BASEMAP_CAPTURE.markerShape,
    showLabels: typeof candidate.showLabels === 'boolean' ? candidate.showLabels : SHARED_BASEMAP_CAPTURE.showLabels,
    showWater: typeof candidate.showWater === 'boolean' ? candidate.showWater : SHARED_BASEMAP_CAPTURE.showWater,
    showLandcover:
      typeof candidate.showLandcover === 'boolean' ? candidate.showLandcover : SHARED_BASEMAP_CAPTURE.showLandcover,
    showFocusArea:
      typeof candidate.showFocusArea === 'boolean' ? candidate.showFocusArea : SHARED_BASEMAP_CAPTURE.showFocusArea,
    showStory: typeof candidate.showStory === 'boolean' ? candidate.showStory : SHARED_BASEMAP_CAPTURE.showStory,
    showMarkers:
      typeof candidate.showMarkers === 'boolean' ? candidate.showMarkers : SHARED_BASEMAP_CAPTURE.showMarkers,
    showPath: typeof candidate.showPath === 'boolean' ? candidate.showPath : SHARED_BASEMAP_CAPTURE.showPath,
    showTitleChip:
      typeof candidate.showTitleChip === 'boolean' ? candidate.showTitleChip : SHARED_BASEMAP_CAPTURE.showTitleChip,
    showToolRail:
      typeof candidate.showToolRail === 'boolean' ? candidate.showToolRail : SHARED_BASEMAP_CAPTURE.showToolRail,
  }
}

function designEqualsDefault(design: DesignState) {
  return DESIGN_STATE_KEYS.every((key) => design[key] === SHARED_BASEMAP_CAPTURE[key])
}

const designCodec: UrlCodec<DesignState> = {
  encode: (value) => {
    if (designEqualsDefault(value)) return null
    return btoa(encodeURIComponent(JSON.stringify(value)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '')
  },
  decode: (raw) => {
    if (!raw) return SHARED_BASEMAP_CAPTURE
    try {
      const normalized = raw.replace(/-/g, '+').replace(/_/g, '/')
      const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
      return coerceDesignState(JSON.parse(decodeURIComponent(atob(padded))))
    } catch {
      return SHARED_BASEMAP_CAPTURE
    }
  },
}

function hasWebGlContext() {
  if (typeof document === 'undefined') return false
  const canvas = document.createElement('canvas')

  try {
    return Boolean(
      canvas.getContext('webgl2') ||
        canvas.getContext('webgl') ||
        canvas.getContext('experimental-webgl'),
    )
  } catch {
    return false
  }
}

function buildSharedBasemapStyle(baseStyle: StyleSpecification, design: DesignState): StyleSpecification {
  const next = JSON.parse(JSON.stringify(baseStyle)) as StyleSpecification

  next.layers = next.layers.map((layer) => {
    const layerId = layer.id.toLowerCase()
    const sourceLayer = 'source-layer' in layer && typeof layer['source-layer'] === 'string'
      ? layer['source-layer'].toLowerCase()
      : ''
    const paint = { ...(layer.paint ?? {}) } as Record<string, unknown>
    const layout = { ...(layer.layout ?? {}) } as Record<string, unknown>

    if (layer.type === 'background') {
      paint['background-color'] = design.backgroundColor
    }

    if (layer.type === 'fill' && (sourceLayer === 'water' || layerId.includes('water'))) {
      layout.visibility = design.showWater ? 'visible' : 'none'
      paint['fill-color'] = design.waterColor
      paint['fill-opacity'] = layerId.includes('shadow') ? 0.22 : 0.9
    }

    if (
      layer.type === 'fill' &&
      (sourceLayer === 'landcover' || sourceLayer === 'park' || sourceLayer === 'landuse')
    ) {
      layout.visibility = design.showLandcover ? 'visible' : 'none'
      paint['fill-color'] = design.landcoverColor
      paint['fill-opacity'] = sourceLayer === 'landuse' ? 0.42 : 0.68
    }

    if (layer.type === 'fill' && sourceLayer === 'building') {
      paint['fill-color'] = design.buildingColor
      paint['fill-opacity'] = layerId.includes('top') ? 0.72 : 0.5
    }

    if (layer.type === 'line' && sourceLayer === 'boundary') {
      paint['line-color'] = design.boundaryColor
      paint['line-opacity'] = layerId.includes('country') ? 0.72 : 0.48
    }

    if (layer.type === 'line' && sourceLayer === 'transportation' && !layerId.includes('case')) {
      paint['line-color'] = design.roadColor
      paint['line-opacity'] = layerId.includes('rail') ? 0.5 : 0.82
    }

    if (layer.type === 'line' && sourceLayer === 'waterway') {
      layout.visibility = design.showWater ? 'visible' : 'none'
      paint['line-color'] = design.waterColor
      paint['line-opacity'] = 0.76
    }

    if (layer.type === 'symbol') {
      layout.visibility = design.showLabels ? 'visible' : 'none'
      if ('text-color' in paint) {
        paint['text-color'] = sourceLayer.includes('water') ? design.waterColor : design.primaryColor
      }
      if ('text-halo-color' in paint) paint['text-halo-color'] = design.backgroundColor
    }

    return {
      ...layer,
      paint,
      layout,
    }
  })

  return next
}

function Field({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <label className={cn('grid gap-1.5 text-xs font-medium text-muted-foreground', className)}>
      <span>{label}</span>
      {children}
    </label>
  )
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-10 cursor-pointer rounded-md border border-border bg-transparent p-1"
          aria-label={label}
        />
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm text-foreground"
        />
      </div>
    </Field>
  )
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex h-9 items-center justify-between gap-3 rounded-md border border-border px-3 text-sm">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-primary"
      />
    </label>
  )
}

function DesignerMarker({ design }: { design: DesignState }) {
  const markerPath =
    design.markerShape === 'badge'
      ? 'M12 2 21 7V17L12 22 3 17V7L12 2Z'
      : 'M12,11.5A2.5,2.5 0 0,1 9.5,9A2.5,2.5 0 0,1 12,6.5A2.5,2.5 0 0,1 14.5,9A2.5 2.5 0 0,1 12,11.5M12,2A7,7 0 0,0 5,9C5,14.25 12,22 12,22C12,22 19,14.25 19,9A7,7 0 0,0 12,2Z'
  const size = design.markerSize

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={cn('drop-shadow-lg', design.markerShape === 'pin' && '-translate-y-5')}
      aria-label="Designer marker preview"
    >
      <path d={markerPath} fill={design.markerFill} />
      {design.markerShape === 'badge' ? (
        <circle cx="12" cy="12" r="3.2" fill={design.markerInset} />
      ) : null}
    </svg>
  )
}

function StaticMapPreview({ design }: { design: DesignState }) {
  return (
    <div className="relative h-full min-h-[54vh] overflow-hidden" style={{ backgroundColor: design.backgroundColor }}>
      <svg className="h-full w-full" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" role="img">
        <rect width="1200" height="800" fill={design.backgroundColor} />
        {design.showLandcover ? (
          <>
            <path
              d="M-80 650 C110 505 260 635 430 505 C620 360 785 450 960 315 C1100 210 1270 280 1320 160 L1320 880 L-80 880Z"
              fill={design.landcoverColor}
              opacity="0.7"
            />
            <path
              d="M-60 190 C130 105 260 210 390 150 C565 70 700 130 850 90 C1010 45 1140 78 1280 5 L1280 -80 L-60 -80Z"
              fill={design.landcoverColor}
              opacity="0.46"
            />
          </>
        ) : null}
        {design.showWater ? (
          <>
            <path
              d="M-50 480 C155 405 270 425 430 355 C610 275 715 310 895 240 C1050 180 1135 185 1260 120"
              fill="none"
              stroke={design.waterColor}
              strokeLinecap="round"
              strokeWidth="88"
              opacity="0.9"
            />
            <path
              d="M870 820 C885 650 1005 595 1015 455 C1028 270 1142 205 1235 120"
              fill="none"
              stroke={design.waterColor}
              strokeLinecap="round"
              strokeWidth="64"
              opacity="0.82"
            />
          </>
        ) : null}
        <g fill="none" stroke="#ffffff" strokeLinecap="round" opacity="0.78">
          <path d="M110 760 C235 615 365 505 520 390 C705 255 865 165 1110 60" strokeWidth="14" />
          <path d="M70 270 C220 315 395 350 560 420 C725 490 900 560 1125 610" strokeWidth="10" />
          <path d="M320 765 C390 635 475 525 610 455 C755 378 880 335 1040 245" strokeWidth="8" />
        </g>
        <g fill="none" stroke={design.boundaryColor} strokeDasharray="18 15" opacity="0.48">
          <path d="M155 115 L1080 170 L1035 700 L215 665Z" strokeWidth="4" />
          <path d="M595 118 L565 705" strokeWidth="3" />
        </g>
        {design.showFocusArea ? (
          <circle
            cx="600"
            cy="395"
            r="128"
            fill={design.primaryColor}
            opacity="0.12"
            stroke={design.primaryColor}
            strokeWidth="5"
            strokeOpacity="0.34"
          />
        ) : null}
        {design.showLabels ? (
          <g
            fill={design.primaryColor}
            fontFamily="Inter, ui-sans-serif, system-ui, sans-serif"
            fontWeight="600"
            paintOrder="stroke"
            stroke={design.backgroundColor}
            strokeWidth="6"
            strokeLinejoin="round"
          >
            <text x="620" y="375" fontSize="34" textAnchor="middle">
              Prince George
            </text>
            <text x="340" y="235" fontSize="22">
              Neighbourhood
            </text>
            <text x="830" y="535" fontSize="22">
              Fraser River
            </text>
          </g>
        ) : null}
      </svg>
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full">
        <DesignerMarker design={design} />
      </div>
    </div>
  )
}

export default function DevDesign() {
  const [design, setDesign] = useUrlState('design', designCodec)
  const [baseStyles, setBaseStyles] = useState<{ light: StyleSpecification; dark: StyleSpecification } | null>(null)
  // Probing WebGL support once in the lazy initializer avoids flipping state
  // from the mount effect.
  const [canUseWebGl] = useState(() => hasWebGlContext())
  // Which tool-rail flyout is open (null = none).
  const [openTool, setOpenTool] = useState<string | null>(null)

  // --- Editor state -------------------------------------------------------
  const [tool, setTool] = useState<'select' | 'marker' | 'path'>('select')
  const [markers, setMarkers] = useState<EditorMarker[]>(INITIAL_MARKERS)
  const [paths, setPaths] = useState<EditorPath[]>(INITIAL_PATHS)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activePathId, setActivePathId] = useState<string | null>(null)
  const [markerDraft, setMarkerDraft] = useState<{ variant: EditorMarkerVariant; icon: MarkerIconKey; size: number }>({
    variant: 'pin',
    icon: 'pin',
    size: 44,
  })
  const [pathDraft, setPathDraft] = useState<{ curved: boolean; dashed: boolean; arrow: boolean; color: string }>({
    curved: true,
    dashed: true,
    arrow: true,
    color: PATH_COLOR,
  })
  // Unsaved-changes indicator for the Save tool (tasmap's dirty dot).
  const [dirty, setDirty] = useState(false)
  const editsMountedRef = useRef(false)
  useEffect(() => {
    if (!editsMountedRef.current) {
      editsMountedRef.current = true
      return
    }
    setDirty(true)
  }, [markers, paths])

  const newId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `id-${markers.length + paths.length}-${Date.now()}`)
  const updateMarker = (id: string, patch: Partial<EditorMarker>) =>
    setMarkers((current) => current.map((marker) => (marker.id === id ? { ...marker, ...patch } : marker)))
  const selectedMarker = markers.find((marker) => marker.id === selectedId) ?? null

  // Toggling a path-draft option also updates the path currently being drawn.
  const updatePathDraft = (patch: Partial<typeof pathDraft>) => {
    setPathDraft((current) => ({ ...current, ...patch }))
    if (activePathId) {
      setPaths((current) => current.map((path) => (path.id === activePathId ? { ...path, ...patch } : path)))
    }
  }

  const enterTool = (next: 'select' | 'marker' | 'path', flyout: string | null) => {
    setTool(next)
    setOpenTool(flyout)
    setSelectedId(null)
    if (next !== 'path') setActivePathId(null)
  }

  const handleMapClick = (lngLat: [number, number]) => {
    if (tool === 'marker') {
      const marker: EditorMarker = {
        id: newId(),
        longitude: lngLat[0],
        latitude: lngLat[1],
        variant: markerDraft.variant,
        label: markerDraft.variant === 'badge' ? 'Label' : '',
        icon: markerDraft.icon,
        color1: design.primaryColor,
        color2: design.backgroundColor,
        size: markerDraft.size,
      }
      setMarkers((current) => [...current, marker])
      return
    }
    if (tool === 'path') {
      if (!activePathId) {
        const id = newId()
        setPaths((current) => [...current, { id, points: [lngLat], ...pathDraft, width: 3 }])
        setActivePathId(id)
      } else {
        setPaths((current) =>
          current.map((path) => (path.id === activePathId ? { ...path, points: [...path.points, lngLat] } : path)),
        )
      }
      return
    }
    setSelectedId(null)
  }

  const exportMap = () => {
    const data = serializeEditorMap({
      markers,
      paths,
      theme: {
        primaryColor: design.primaryColor,
        backgroundColor: design.backgroundColor,
        waterColor: design.waterColor,
        landcoverColor: design.landcoverColor,
      },
    })
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'pgmap.json'
    anchor.click()
    URL.revokeObjectURL(url)
    setDirty(false)
  }

  // Keyboard: Esc cancels, Delete removes selection, Cmd/Ctrl+S exports.
  const exportRef = useRef(exportMap)
  exportRef.current = exportMap
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = target ? /^(INPUT|TEXTAREA)$/.test(target.tagName) : false
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        exportRef.current()
        return
      }
      if (event.key === 'Escape') {
        setSelectedId(null)
        setActivePathId(null)
        setTool('select')
        setOpenTool(null)
        return
      }
      if (!typing && (event.key === 'Delete' || event.key === 'Backspace') && selectedId) {
        event.preventDefault()
        setMarkers((current) => current.filter((marker) => marker.id !== selectedId))
        setSelectedId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId])

  useEffect(() => {
    let cancelled = false

    async function loadBaseStyles() {
      try {
        const [lightResponse, darkResponse] = await Promise.all([
          fetch(MAP_STYLES.light),
          fetch(MAP_STYLES.dark),
        ])
        if (!lightResponse.ok || !darkResponse.ok) {
          throw new Error('Unable to load shared basemap styles')
        }

        const [light, dark] = await Promise.all([
          lightResponse.json() as Promise<StyleSpecification>,
          darkResponse.json() as Promise<StyleSpecification>,
        ])

        if (!cancelled) {
          setBaseStyles({ light, dark })
        }
      } catch (error) {
        if (!cancelled) console.error(error)
      }
    }

    loadBaseStyles()

    return () => {
      cancelled = true
    }
  }, [])

  const styles = useMemo(() => {
    if (!baseStyles) return null
    return {
      light: buildSharedBasemapStyle(baseStyles.light, design),
      dark: buildSharedBasemapStyle(baseStyles.dark, design),
    }
  }, [baseStyles, design])

  const setNextDesign = (next: DesignState | ((current: DesignState) => DesignState)) => {
    setDesign(typeof next === 'function' ? next(design) : next)
  }

  const updateDesign = <Key extends keyof DesignState>(key: Key, value: DesignState[Key]) => {
    setDesign({ ...design, [key]: value })
  }

  const copyShareUrl = async () => {
    await navigator.clipboard?.writeText(window.location.href)
  }

  return (
    <div className="flex h-full min-h-[calc(100vh-3rem)] flex-col bg-background lg:min-h-[calc(100vh-3.5rem)] lg:flex-row">
      <aside className="order-2 w-full overflow-y-auto bg-background lg:order-1 lg:w-[25rem]">
        <MapSidebarShell
          title="Map Designer"
          subtitle="Recolor the same Carto basemap stack used by PGMaps"
          actions={
            <>
              <Button
                type="button"
                size="icon"
                variant="outline"
                title="Copy share URL"
                aria-label="Copy share URL"
                onClick={copyShareUrl}
              >
                <Copy className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="outline"
                title="Reset capture theme"
                aria-label="Reset capture theme"
                onClick={() => setDesign(SHARED_BASEMAP_CAPTURE)}
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
            </>
          }
          className="border-r-0 lg:border-r"
        >
          <SidebarSection title="Coloring" icon={Palette}>
            <div className="grid grid-cols-2 gap-3">
              <ColorField
                label="Primary"
                value={design.primaryColor}
                onChange={(value) => setNextDesign((current) => ({ ...current, primaryColor: value, markerFill: value }))}
              />
              <ColorField
                label="Background"
                value={design.backgroundColor}
                onChange={(value) =>
                  setNextDesign((current) => ({ ...current, backgroundColor: value, markerInset: value }))
                }
              />
              <ColorField label="Water" value={design.waterColor} onChange={(value) => updateDesign('waterColor', value)} />
              <ColorField
                label="Landcover"
                value={design.landcoverColor}
                onChange={(value) => updateDesign('landcoverColor', value)}
              />
              <ColorField
                label="Boundary"
                value={design.boundaryColor}
                onChange={(value) => updateDesign('boundaryColor', value)}
              />
              <ColorField
                label="Roads"
                value={design.roadColor}
                onChange={(value) => updateDesign('roadColor', value)}
              />
              <ColorField
                label="Buildings"
                value={design.buildingColor}
                onChange={(value) => updateDesign('buildingColor', value)}
              />
              <ColorField
                label="Marker inset"
                value={design.markerInset}
                onChange={(value) => updateDesign('markerInset', value)}
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button type="button" size="sm" onClick={() => setDesign(SHARED_BASEMAP_CAPTURE)}>
                <Sparkles className="h-4 w-4" />
                Captured
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setDesign(ALT_THEME)}>
                <Palette className="h-4 w-4" />
                Alternate
              </Button>
            </div>
          </SidebarSection>

          <SidebarSection title="Map Options" icon={SlidersHorizontal}>
            <div className="grid gap-2">
              <ToggleRow label="Labels" checked={design.showLabels} onChange={(checked) => updateDesign('showLabels', checked)} />
              <ToggleRow label="Water layer" checked={design.showWater} onChange={(checked) => updateDesign('showWater', checked)} />
              <ToggleRow
                label="Landcover layer"
                checked={design.showLandcover}
                onChange={(checked) => updateDesign('showLandcover', checked)}
              />
              <ToggleRow
                label="Focus area"
                checked={design.showFocusArea}
                onChange={(checked) => updateDesign('showFocusArea', checked)}
              />
            </div>
          </SidebarSection>

          <SidebarSection title="Story Overlays" icon={PanelRight}>
            <div className="grid gap-2">
              <ToggleRow
                label="Story panel"
                checked={design.showStory}
                onChange={(checked) => updateDesign('showStory', checked)}
              />
              <ToggleRow
                label="Map markers"
                checked={design.showMarkers}
                onChange={(checked) => updateDesign('showMarkers', checked)}
              />
              <ToggleRow
                label="Route path"
                checked={design.showPath}
                onChange={(checked) => updateDesign('showPath', checked)}
              />
              <ToggleRow
                label="Title chip"
                checked={design.showTitleChip}
                onChange={(checked) => updateDesign('showTitleChip', checked)}
              />
              <ToggleRow
                label="Tool rail"
                checked={design.showToolRail}
                onChange={(checked) => updateDesign('showToolRail', checked)}
              />
            </div>
          </SidebarSection>

          <SidebarSection title="Marker" icon={MapPin}>
            <div className="grid gap-3">
              <Field label="Shape">
                <AppSelect
                  value={design.markerShape}
                  onValueChange={(value) => updateDesign('markerShape', value as MarkerShape)}
                  options={[
                    { value: 'circle_fill', label: 'Filled pin' },
                    { value: 'pin', label: 'Lifted pin' },
                    { value: 'badge', label: 'Badge' },
                  ]}
                />
              </Field>
              <Field label={`Size ${design.markerSize}px`}>
                <Slider
                  value={[design.markerSize]}
                  min={28}
                  max={72}
                  step={1}
                  onValueChange={([value]) => updateDesign('markerSize', value ?? design.markerSize)}
                />
              </Field>
            </div>
          </SidebarSection>

          <SidebarSection title="Page Text" icon={Eye}>
            <div className="grid gap-3">
              <Field label="Title">
                <input
                  value={design.title}
                  onChange={(event) => updateDesign('title', event.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
                />
              </Field>
              <Field label="Subtitle">
                <input
                  value={design.subtitle}
                  onChange={(event) => updateDesign('subtitle', event.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
                />
              </Field>
            </div>
          </SidebarSection>

          <SidebarSection title="Style Summary" icon={Layers}>
            <StatGrid
              columns={3}
              stats={[
                { label: 'Palette', value: designEqualsDefault(design) ? 'base' : 'custom' },
                { label: 'Layers on', value: [design.showWater, design.showLandcover, design.showLabels].filter(Boolean).length },
                { label: 'Marker', value: `${design.markerSize}px` },
              ]}
            />
            <div className="mt-3 grid gap-2 rounded-md border border-border p-3 text-xs text-muted-foreground">
              <div className="font-mono">{MAP_STYLES.light}</div>
              <div className="font-mono">{MAP_STYLES.dark}</div>
            </div>
          </SidebarSection>
        </MapSidebarShell>
      </aside>

      <section className="order-1 flex min-h-[54vh] flex-1 overflow-hidden border-b border-border lg:order-2 lg:min-h-0 lg:border-b-0">
        <div className="relative min-h-[54vh] flex-1 overflow-hidden lg:min-h-0">
          {canUseWebGl && styles ? (
            <AppMap
              className="h-full min-h-[54vh] lg:min-h-0"
              styles={styles}
              showStyleLoadingOverlay={false}
              center={DESIGN_CENTER}
              zoom={12}
              minZoom={2}
              maxZoom={14}
              pitch={0}
              bearing={0}
            >
              <MapControls showCompass showFullscreen position="bottom-right" />
              <MapMarker
                longitude={MARKER_COORDINATE.longitude}
                latitude={MARKER_COORDINATE.latitude}
                offset={[0, design.markerShape === 'pin' ? -20 : -8]}
              >
                <MarkerContent>
                  <DesignerMarker design={design} />
                </MarkerContent>
              </MapMarker>

              {design.showMarkers
                ? markers.map((marker) => (
                    <MapMarker
                      key={marker.id}
                      longitude={marker.longitude}
                      latitude={marker.latitude}
                      anchor={marker.variant === 'dot' ? 'center' : 'bottom'}
                      draggable={tool === 'select'}
                      onClick={() => {
                        setTool('select')
                        setSelectedId(marker.id)
                      }}
                      onDragEnd={({ lng, lat }) => updateMarker(marker.id, { longitude: lng, latitude: lat })}
                    >
                      <MarkerContent>
                        <EditorMarkerView
                          variant={marker.variant}
                          label={marker.label}
                          icon={markerIcon(marker.icon)}
                          color1={marker.color1}
                          color2={marker.color2}
                          size={marker.size}
                          selected={selectedId === marker.id}
                        />
                      </MarkerContent>
                    </MapMarker>
                  ))
                : null}

              {design.showPath
                ? paths.map((path) =>
                    path.points.length >= 2 ? (
                      <MapCurvePath
                        key={path.id}
                        points={path.points}
                        curved={path.curved}
                        dashed={path.dashed}
                        arrow={path.arrow}
                        color={path.color}
                        width={path.width}
                      />
                    ) : null,
                  )
                : null}

              <MapClickHandler onClick={handleMapClick} cursor={tool === 'select' ? '' : 'crosshair'} />
            </AppMap>
          ) : (
            <StaticMapPreview design={design} />
          )}

          <MapLegend title="Style Layers" position="top-right" collapsible className="hidden sm:block">
            <MapLegendItem
              color={design.waterColor}
              label="Water"
              active={design.showWater}
              onClick={() => updateDesign('showWater', !design.showWater)}
            />
            <MapLegendItem
              color={design.landcoverColor}
              label="Landcover"
              active={design.showLandcover}
              onClick={() => updateDesign('showLandcover', !design.showLandcover)}
            />
            <MapLegendItem
              color={design.primaryColor}
              label="Labels"
              active={design.showLabels}
              onClick={() => updateDesign('showLabels', !design.showLabels)}
            />
            <MapLegendItem
              color={design.primaryColor}
              label="Focus area"
              active={design.showFocusArea}
              onClick={() => updateDesign('showFocusArea', !design.showFocusArea)}
              swatchShape="dot"
            />
          </MapLegend>

          {!design.showStory ? (
            <div
              className={cn(
                'pointer-events-none absolute top-4 max-w-[min(24rem,calc(100%-2rem))]',
                design.showToolRail ? 'left-20' : 'left-4',
              )}
            >
              <div
                className="rounded-md border px-4 py-3 shadow-sm"
                style={{ backgroundColor: design.backgroundColor, borderColor: design.primaryColor }}
              >
                <div className="flex items-center gap-2 text-xs font-medium" style={{ color: design.primaryColor }}>
                  <MapPin className="h-3.5 w-3.5" />
                  PGMaps basemap designer
                </div>
                <h1 className="mt-1 text-xl font-semibold leading-tight" style={{ color: design.primaryColor }}>
                  {design.title}
                </h1>
                <p className="mt-1 text-sm" style={{ color: design.primaryColor }}>
                  {design.subtitle}
                </p>
              </div>
            </div>
          ) : null}

          {design.showTitleChip ? (
            <div className="absolute bottom-4 left-4 z-10">
              <MapTitleChip title={design.title} icon={<MapPin />} badgeColor={design.primaryColor} />
            </div>
          ) : null}

          {design.showToolRail ? (
            <MapToolRail>
              <MapToolRailButton
                icon={<MousePointer2 />}
                label="Select / move"
                active={tool === 'select' && openTool === null}
                onClick={() => enterTool('select', null)}
              />
              <MapToolRailButton
                icon={<Palette />}
                label="Theme & colors"
                active={openTool === 'palette'}
                onClick={() => setOpenTool((current) => (current === 'palette' ? null : 'palette'))}
                flyoutOpen={openTool === 'palette'}
                flyout={
                  <div className="w-64 rounded-xl border border-border bg-background/95 p-3 shadow-xl backdrop-blur">
                    <div className="grid grid-cols-2 gap-2">
                      <ColorField
                        label="Primary"
                        value={design.primaryColor}
                        onChange={(value) =>
                          setNextDesign((current) => ({ ...current, primaryColor: value, markerFill: value }))
                        }
                      />
                      <ColorField
                        label="Background"
                        value={design.backgroundColor}
                        onChange={(value) =>
                          setNextDesign((current) => ({ ...current, backgroundColor: value, markerInset: value }))
                        }
                      />
                      <ColorField
                        label="Water"
                        value={design.waterColor}
                        onChange={(value) => updateDesign('waterColor', value)}
                      />
                      <ColorField
                        label="Landcover"
                        value={design.landcoverColor}
                        onChange={(value) => updateDesign('landcoverColor', value)}
                      />
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <Button type="button" size="sm" onClick={() => setDesign(SHARED_BASEMAP_CAPTURE)}>
                        <Sparkles className="h-4 w-4" />
                        Captured
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => setDesign(ALT_THEME)}>
                        <Palette className="h-4 w-4" />
                        Alternate
                      </Button>
                    </div>
                  </div>
                }
              />
              <MapToolRailButton
                icon={<MapPin />}
                label="Marker tool — click map to place"
                active={tool === 'marker'}
                onClick={() => enterTool('marker', 'marker')}
                flyoutOpen={openTool === 'marker'}
                flyout={
                  <div className="w-64 space-y-3 rounded-xl border border-border bg-background/95 p-3 shadow-xl backdrop-blur">
                    <div>
                      <div className="mb-1.5 text-xs font-medium text-muted-foreground">Marker type</div>
                      <div className="grid grid-cols-3 gap-2">
                        {(['pin', 'dot', 'badge'] as const).map((variant) => (
                          <button
                            key={variant}
                            type="button"
                            onClick={() => setMarkerDraft((current) => ({ ...current, variant }))}
                            className={cn(
                              'rounded-md border px-2 py-1.5 text-xs capitalize transition-colors',
                              markerDraft.variant === variant
                                ? 'border-primary text-primary'
                                : 'border-input text-muted-foreground hover:bg-accent',
                            )}
                          >
                            {variant}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="mb-1.5 text-xs font-medium text-muted-foreground">Icon</div>
                      <div className="grid grid-cols-4 gap-1.5">
                        {MARKER_ICON_KEYS.map((key) => {
                          const Icon = MARKER_ICONS[key]
                          return (
                            <button
                              key={key}
                              type="button"
                              onClick={() => setMarkerDraft((current) => ({ ...current, icon: key }))}
                              aria-label={key}
                              className={cn(
                                'flex items-center justify-center rounded-md border p-2 transition-colors',
                                markerDraft.icon === key
                                  ? 'border-primary text-primary'
                                  : 'border-input text-muted-foreground hover:bg-accent',
                              )}
                            >
                              <Icon className="h-4 w-4" />
                            </button>
                          )
                        })}
                      </div>
                    </div>
                    <Field label={`Size ${markerDraft.size}px`}>
                      <Slider
                        value={[markerDraft.size]}
                        min={28}
                        max={64}
                        step={1}
                        onValueChange={([value]) =>
                          setMarkerDraft((current) => ({ ...current, size: value ?? current.size }))
                        }
                      />
                    </Field>
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      Click the map to drop a marker. New markers use the current Primary / Background colors.
                    </p>
                  </div>
                }
              />
              <MapToolRailButton
                icon={<Spline />}
                label="Path tool — click map to add points"
                active={tool === 'path'}
                onClick={() => enterTool('path', 'path')}
                flyoutOpen={openTool === 'path'}
                flyout={
                  <div className="w-60 space-y-3 rounded-xl border border-border bg-background/95 p-3 shadow-xl backdrop-blur">
                    <div className="grid gap-2">
                      <ToggleRow label="Curved" checked={pathDraft.curved} onChange={(checked) => updatePathDraft({ curved: checked })} />
                      <ToggleRow label="Dashed" checked={pathDraft.dashed} onChange={(checked) => updatePathDraft({ dashed: checked })} />
                      <ToggleRow label="Arrow end" checked={pathDraft.arrow} onChange={(checked) => updatePathDraft({ arrow: checked })} />
                    </div>
                    <ColorField label="Color" value={pathDraft.color} onChange={(value) => updatePathDraft({ color: value })} />
                    <p className="text-[11px] leading-snug text-muted-foreground">Click the map to add points to the path.</p>
                    <Button
                      type="button"
                      size="sm"
                      className="w-full"
                      disabled={!activePathId}
                      onClick={() => {
                        setActivePathId(null)
                        enterTool('select', null)
                      }}
                    >
                      <Check className="h-4 w-4" />
                      Finish path
                    </Button>
                  </div>
                }
              />
              <MapToolRailButton
                icon={<Settings />}
                label="Settings"
                active={openTool === 'settings'}
                onClick={() => setOpenTool((current) => (current === 'settings' ? null : 'settings'))}
                flyoutOpen={openTool === 'settings'}
                flyout={
                  <div className="w-56 space-y-2 rounded-xl border border-border bg-background/95 p-3 shadow-xl backdrop-blur">
                    <ToggleRow label="Story panel" checked={design.showStory} onChange={(checked) => updateDesign('showStory', checked)} />
                    <ToggleRow label="Focus area" checked={design.showFocusArea} onChange={(checked) => updateDesign('showFocusArea', checked)} />
                    <ToggleRow label="Markers" checked={design.showMarkers} onChange={(checked) => updateDesign('showMarkers', checked)} />
                    <ToggleRow label="Paths" checked={design.showPath} onChange={(checked) => updateDesign('showPath', checked)} />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="w-full"
                      onClick={() => {
                        setMarkers([])
                        setPaths([])
                        setActivePathId(null)
                        setSelectedId(null)
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                      Clear all
                    </Button>
                  </div>
                }
              />
              <MapToolRailButton
                icon={<Share2 />}
                label="Copy share URL"
                onClick={() => {
                  setOpenTool(null)
                  copyShareUrl()
                }}
              />
              <MapToolRailButton
                icon={<Save />}
                label="Download map JSON (⌘S)"
                badge={dirty}
                onClick={() => {
                  setOpenTool(null)
                  exportMap()
                }}
              />
            </MapToolRail>
          ) : null}

          {selectedMarker ? (
            <div className="absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-border bg-background/95 px-3 py-2 shadow-xl backdrop-blur">
              <span className="text-xs font-medium text-muted-foreground">Marker</span>
              <div className="flex items-center gap-1.5">
                {(['pin', 'dot', 'badge'] as const).map((variant) => (
                  <button
                    key={variant}
                    type="button"
                    onClick={() => updateMarker(selectedMarker.id, { variant })}
                    className={cn(
                      'rounded-md border px-2 py-1 text-[11px] capitalize transition-colors',
                      selectedMarker.variant === variant
                        ? 'border-primary text-primary'
                        : 'border-input text-muted-foreground hover:bg-accent',
                    )}
                  >
                    {variant}
                  </button>
                ))}
              </div>
              <input
                type="color"
                value={selectedMarker.color1}
                onChange={(event) => updateMarker(selectedMarker.id, { color1: event.target.value })}
                className="h-7 w-8 cursor-pointer rounded border border-border bg-transparent p-0.5"
                aria-label="Fill color"
              />
              <input
                type="color"
                value={selectedMarker.color2}
                onChange={(event) => updateMarker(selectedMarker.id, { color2: event.target.value })}
                className="h-7 w-8 cursor-pointer rounded border border-border bg-transparent p-0.5"
                aria-label="Icon color"
              />
              {selectedMarker.variant === 'badge' ? (
                <input
                  value={selectedMarker.label}
                  onChange={(event) => updateMarker(selectedMarker.id, { label: event.target.value })}
                  placeholder="Label"
                  className="h-7 w-24 rounded-md border border-input bg-background px-2 text-sm text-foreground"
                />
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setMarkers((current) => current.filter((marker) => marker.id !== selectedMarker.id))
                  setSelectedId(null)
                }}
                className="text-destructive transition-colors hover:text-destructive/80"
                aria-label="Delete marker"
              >
                <Trash2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : null}
        </div>

        {design.showStory ? (
          <MapStoryPanel
            title={design.title}
            eyebrow="Field guide"
            accentColor={design.primaryColor}
            backgroundColor={design.backgroundColor}
            onClose={() => updateDesign('showStory', false)}
          >
            <p>{design.subtitle}</p>
            <MapStorySection heading="The route" accentColor={design.primaryColor}>
              <p>
                Follow the dashed trail from the <strong>Start</strong> flag along the Fraser River, past the market,
                and up to the lookout. Each stop is a tasmap-style marker rendered with the shared MapLibre marker
                layer.
              </p>
            </MapStorySection>
            <MapStorySection heading="About this panel" accentColor={design.primaryColor}>
              <p>
                This is tasmap&rsquo;s &ldquo;classic&rdquo; story panel rebuilt on PGMaps&rsquo; own stack &mdash;
                drag the handle on its left edge to resize. Recolor the basemap and markers from the sidebar; the share
                URL captures every change.
              </p>
            </MapStorySection>
          </MapStoryPanel>
        ) : null}
      </section>
    </div>
  )
}
