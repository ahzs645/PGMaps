import { useEffect, useMemo, useRef, useState } from 'react'
import { type StyleSpecification } from 'maplibre-gl'
import {
  Copy,
  Eye,
  Layers,
  MapPin,
  MousePointer2,
  Palette,
  PanelRight,
  RotateCcw,
  Save,
  Settings,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Spline,
  Trash2,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Map as AppMap, MapMarker, MarkerContent, type MapRef } from '@/components/ui/map'
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
import { MapCurvePath, MapStoryPanel, MapStorySection, MapTitleChip } from '@/components/ui/map-story'
import {
  deriveThemeColors,
  EditorMarkerView,
  MarkerGlyph,
  MAP_THEMES,
  MapClickHandler,
  MapColorPicker,
  MapEditorPanel,
  MapToolRail,
  MapToolRailButton,
  MarkerFlyout,
  PathFlyout,
  PATH_COLOR,
  ShapeToolsFlyout,
  ThemeSwatchButton,
  useMapEditor,
} from '@/components/map-editor'
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
  countryBoundaryColor: string
  otherBoundaryColor: string
  labelColor: string
  labelHaloColor: string
  roadColor: string
  buildingColor: string
  markerFill: string
  markerInset: string
  markerSize: number
  markerShape: MarkerShape
  showLabels: boolean
  showWater: boolean
  showLandcover: boolean
  showCountryBoundaries: boolean
  showOtherBoundaries: boolean
  showFocusArea: boolean
  showStory: boolean
  showMarkers: boolean
  showPath: boolean
  showTitleChip: boolean
  showToolRail: boolean
  articleBackground: string
  textDefault: string
  textPrimary: string
  textSecondary: string
}

const SHARED_BASEMAP_CAPTURE: DesignState = {
  title: 'PGMaps Designer',
  subtitle: 'Shared basemap color preview',
  primaryColor: '#2563eb',
  backgroundColor: '#f8fafc',
  waterColor: '#bae6fd',
  landcoverColor: '#dcfce7',
  boundaryColor: '#94a3b8',
  countryBoundaryColor: '#94a3b8',
  otherBoundaryColor: '#94a3b8',
  labelColor: '#2563eb',
  labelHaloColor: '#f8fafc',
  roadColor: '#ffffff',
  buildingColor: '#e2e8f0',
  markerFill: '#2563eb',
  markerInset: '#f8fafc',
  markerSize: 48,
  markerShape: 'circle_fill',
  showLabels: true,
  showWater: true,
  showLandcover: true,
  showCountryBoundaries: true,
  showOtherBoundaries: true,
  showFocusArea: true,
  showStory: true,
  showMarkers: true,
  showPath: true,
  showTitleChip: true,
  showToolRail: true,
  articleBackground: '#ffffff',
  textDefault: '#525252',
  textPrimary: '#1e293b',
  textSecondary: '#64748b',
}

const ALT_THEME: DesignState = {
  ...SHARED_BASEMAP_CAPTURE,
  primaryColor: '#0f766e',
  backgroundColor: '#f7fee7',
  waterColor: '#67e8f9',
  landcoverColor: '#bef264',
  boundaryColor: '#64748b',
  countryBoundaryColor: '#64748b',
  otherBoundaryColor: '#64748b',
  labelColor: '#0f766e',
  labelHaloColor: '#f7fee7',
  roadColor: '#fefce8',
  buildingColor: '#d9f99d',
  markerFill: '#0f766e',
  markerInset: '#f7fee7',
}

type TextColors = Pick<DesignState, 'articleBackground' | 'textDefault' | 'textPrimary' | 'textSecondary'>

// Named text-color presets for the story-text settings popover.
const TEXT_PRESETS: Record<string, TextColors> = {
  Default: { articleBackground: '#ffffff', textDefault: '#525252', textPrimary: '#1e293b', textSecondary: '#64748b' },
  Inverted: { articleBackground: '#0f172a', textDefault: '#cbd5e1', textPrimary: '#f8fafc', textSecondary: '#94a3b8' },
  Warm: { articleBackground: '#fffaf0', textDefault: '#6b5b4b', textPrimary: '#3b2f25', textSecondary: '#9c8b78' },
}

const DESIGN_CENTER = PG_CENTER
const MARKER_COORDINATE = { longitude: PG_CENTER[0], latitude: PG_CENTER[1] }
const DESIGN_STATE_KEYS = Object.keys(SHARED_BASEMAP_CAPTURE) as Array<keyof DesignState>

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
    countryBoundaryColor: isHexColor(candidate.countryBoundaryColor)
      ? candidate.countryBoundaryColor
      : isHexColor(candidate.boundaryColor)
        ? candidate.boundaryColor
        : SHARED_BASEMAP_CAPTURE.countryBoundaryColor,
    otherBoundaryColor: isHexColor(candidate.otherBoundaryColor)
      ? candidate.otherBoundaryColor
      : isHexColor(candidate.boundaryColor)
        ? candidate.boundaryColor
        : SHARED_BASEMAP_CAPTURE.otherBoundaryColor,
    labelColor: isHexColor(candidate.labelColor)
      ? candidate.labelColor
      : isHexColor(candidate.primaryColor)
        ? candidate.primaryColor
        : SHARED_BASEMAP_CAPTURE.labelColor,
    labelHaloColor: isHexColor(candidate.labelHaloColor)
      ? candidate.labelHaloColor
      : isHexColor(candidate.backgroundColor)
        ? candidate.backgroundColor
        : SHARED_BASEMAP_CAPTURE.labelHaloColor,
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
    showCountryBoundaries:
      typeof candidate.showCountryBoundaries === 'boolean'
        ? candidate.showCountryBoundaries
        : SHARED_BASEMAP_CAPTURE.showCountryBoundaries,
    showOtherBoundaries:
      typeof candidate.showOtherBoundaries === 'boolean'
        ? candidate.showOtherBoundaries
        : SHARED_BASEMAP_CAPTURE.showOtherBoundaries,
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
    articleBackground: isHexColor(candidate.articleBackground)
      ? candidate.articleBackground
      : SHARED_BASEMAP_CAPTURE.articleBackground,
    textDefault: isHexColor(candidate.textDefault) ? candidate.textDefault : SHARED_BASEMAP_CAPTURE.textDefault,
    textPrimary: isHexColor(candidate.textPrimary) ? candidate.textPrimary : SHARED_BASEMAP_CAPTURE.textPrimary,
    textSecondary: isHexColor(candidate.textSecondary)
      ? candidate.textSecondary
      : SHARED_BASEMAP_CAPTURE.textSecondary,
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
      const isCountryBoundary = layerId.includes('country')
      layout.visibility = isCountryBoundary
        ? design.showCountryBoundaries ? 'visible' : 'none'
        : design.showOtherBoundaries ? 'visible' : 'none'
      paint['line-color'] = isCountryBoundary ? design.countryBoundaryColor : design.otherBoundaryColor
      paint['line-opacity'] = isCountryBoundary ? 0.72 : 0.48
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
        paint['text-color'] = sourceLayer.includes('water') ? design.waterColor : design.labelColor
      }
      if ('text-halo-color' in paint) paint['text-halo-color'] = design.labelHaloColor
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

// Toggle row for the tasmap-style submenu popovers (theme-aware).
function EditorToggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex h-8 cursor-pointer items-center justify-between gap-3 rounded-md px-2 text-sm text-foreground transition-colors hover:bg-accent">
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

function SourceStyleRow({
  title,
  description,
  color,
  onColorChange,
  visible,
  onVisibleChange,
  swatches,
}: {
  title: string
  description: string
  color: string
  onColorChange: (value: string) => void
  visible?: boolean
  onVisibleChange?: (value: boolean) => void
  swatches: string[]
}) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {visible !== undefined && onVisibleChange ? (
          <button
            type="button"
            onClick={() => onVisibleChange(!visible)}
            title={visible ? `Hide ${title}` : `Show ${title}`}
            aria-label={visible ? `Hide ${title}` : `Show ${title}`}
            aria-pressed={visible}
            className={cn(
              'flex size-8 items-center justify-center rounded-full transition-colors',
              visible ? 'text-foreground hover:bg-accent' : 'text-muted-foreground/60 hover:bg-accent',
            )}
          >
            <Eye className="h-5 w-5" />
          </button>
        ) : null}
        <MapColorPicker value={color} onChange={onColorChange} title={title} swatches={swatches} />
      </div>
    </div>
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
        {design.showOtherBoundaries ? (
          <g fill="none" stroke={design.otherBoundaryColor} strokeDasharray="18 15" opacity="0.48">
            <path d="M155 115 L1080 170 L1035 700 L215 665Z" strokeWidth="4" />
            <path d="M595 118 L565 705" strokeWidth="3" />
          </g>
        ) : null}
        {design.showCountryBoundaries ? (
          <path
            d="M90 85 L1110 125 L1088 735 L140 705Z"
            fill="none"
            stroke={design.countryBoundaryColor}
            strokeDasharray="22 14"
            strokeWidth="5"
            opacity="0.62"
          />
        ) : null}
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
            fill={design.labelColor}
            fontFamily="Inter, ui-sans-serif, system-ui, sans-serif"
            fontWeight="600"
            paintOrder="stroke"
            stroke={design.labelHaloColor}
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

  // --- Editor state (modular hook) ---------------------------------------
  const mapRef = useRef<MapRef | null>(null)
  const editor = useMapEditor({
    theme: {
      primaryColor: design.primaryColor,
      backgroundColor: design.backgroundColor,
      waterColor: design.waterColor,
      landcoverColor: design.landcoverColor,
    },
    mapRef,
  })
  const {
    tool,
    markers,
    paths,
    selectedId,
    selectedMarker,
    dirty,
    enterTool,
    selectMarker,
    updateMarker,
    deleteMarker,
    handleMapClick,
    exportMap,
    clearAll,
    setSelectedId,
  } = editor

  // Quick-pick swatches for color pickers (current theme + neutrals).
  const themeSwatches = useMemo(
    () => [
      design.primaryColor,
      design.backgroundColor,
      design.waterColor,
      design.landcoverColor,
      design.countryBoundaryColor,
      design.otherBoundaryColor,
      design.labelColor,
      design.labelHaloColor,
      PATH_COLOR,
      '#ffffff',
      '#000000',
    ],
    [
      design.primaryColor,
      design.backgroundColor,
      design.waterColor,
      design.landcoverColor,
      design.countryBoundaryColor,
      design.otherBoundaryColor,
      design.labelColor,
      design.labelHaloColor,
    ],
  )

  // Apply a tasmap-style theme preset: recolor the whole basemap stack
  // (background / water / roads / landcover / boundary / buildings) plus the
  // marker fill + inset from the palette's derived roles.
  const applyTheme = (colors: string[]) => {
    const next = deriveThemeColors(colors)
    setNextDesign((current) => ({
      ...current,
      primaryColor: next.primaryColor,
      backgroundColor: next.backgroundColor,
      waterColor: next.waterColor,
      landcoverColor: next.landcoverColor,
      roadColor: next.roadColor,
      boundaryColor: next.boundaryColor,
      countryBoundaryColor: next.boundaryColor,
      otherBoundaryColor: next.boundaryColor,
      labelColor: next.primaryColor,
      labelHaloColor: next.backgroundColor,
      buildingColor: next.buildingColor,
      markerFill: next.primaryColor,
      markerInset: next.backgroundColor,
    }))
  }

  // Which preset (if any) matches the current palette, for the active ring.
  // The four wedge-derived roles uniquely identify a theme.
  const activeThemeId = useMemo(() => {
    return MAP_THEMES.find((theme) => {
      const derived = deriveThemeColors(theme.colors)
      return (
        derived.backgroundColor === design.backgroundColor &&
        derived.waterColor === design.waterColor &&
        derived.roadColor === design.roadColor &&
        derived.landcoverColor === design.landcoverColor
      )
    })?.id
  }, [design.backgroundColor, design.waterColor, design.roadColor, design.landcoverColor])

  // Which named text preset (if any) the story-text colors currently match.
  const textPresetName = useMemo(() => {
    const match = Object.entries(TEXT_PRESETS).find(
      ([, preset]) =>
        preset.articleBackground === design.articleBackground &&
        preset.textDefault === design.textDefault &&
        preset.textPrimary === design.textPrimary &&
        preset.textSecondary === design.textSecondary,
    )
    return match?.[0] ?? 'Custom'
  }, [design.articleBackground, design.textDefault, design.textPrimary, design.textSecondary])

  // Keyboard: Esc cancels, Delete removes selection, Cmd/Ctrl+S exports.
  const editorRef = useRef(editor)
  useEffect(() => {
    editorRef.current = editor
  })
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const ed = editorRef.current
      const target = event.target as HTMLElement | null
      const typing = target ? /^(INPUT|TEXTAREA)$/.test(target.tagName) : false
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        ed.exportMap()
        return
      }
      if (event.key === 'Escape') {
        setOpenTool(null)
        ed.enterTool('select')
        return
      }
      if (!typing && (event.key === 'Delete' || event.key === 'Backspace') && ed.selectedId) {
        event.preventDefault()
        ed.deleteMarker(ed.selectedId)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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

  const boundaryPanel = (
    <MapEditorPanel className="w-72 space-y-3">
      <div className="text-xs font-medium text-muted-foreground">Boundaries</div>
      <SourceStyleRow
        title="Country"
        description="Country boundaries"
        color={design.countryBoundaryColor}
        onColorChange={(value) =>
          setNextDesign((current) => ({ ...current, countryBoundaryColor: value, boundaryColor: value }))
        }
        visible={design.showCountryBoundaries}
        onVisibleChange={(checked) => updateDesign('showCountryBoundaries', checked)}
        swatches={themeSwatches}
      />
      <SourceStyleRow
        title="Other"
        description="Other boundaries"
        color={design.otherBoundaryColor}
        onColorChange={(value) =>
          setNextDesign((current) => ({ ...current, otherBoundaryColor: value, boundaryColor: value }))
        }
        visible={design.showOtherBoundaries}
        onVisibleChange={(checked) => updateDesign('showOtherBoundaries', checked)}
        swatches={themeSwatches}
      />
    </MapEditorPanel>
  )

  const articlePanel = (
    <MapEditorPanel className="w-72 space-y-3">
      <AppSelect
        value={textPresetName}
        onValueChange={(value) => {
          const preset = TEXT_PRESETS[value]
          if (preset) setNextDesign((current) => ({ ...current, ...preset }))
        }}
        options={[
          ...Object.keys(TEXT_PRESETS).map((name) => ({ value: name, label: name })),
          ...(textPresetName === 'Custom' ? [{ value: 'Custom', label: 'Custom' }] : []),
        ]}
      />
      <SourceStyleRow
        title="Background"
        description="Article background color"
        color={design.articleBackground}
        onColorChange={(value) => updateDesign('articleBackground', value)}
        swatches={themeSwatches}
      />
      <SourceStyleRow
        title="Default color"
        description="Default text color"
        color={design.textDefault}
        onColorChange={(value) => updateDesign('textDefault', value)}
        swatches={themeSwatches}
      />
      <SourceStyleRow
        title="Primary color"
        description="Primary text color"
        color={design.textPrimary}
        onColorChange={(value) => updateDesign('textPrimary', value)}
        swatches={themeSwatches}
      />
      <SourceStyleRow
        title="Secondary color"
        description="Secondary text color"
        color={design.textSecondary}
        onColorChange={(value) => updateDesign('textSecondary', value)}
        swatches={themeSwatches}
      />
    </MapEditorPanel>
  )

  const labelPanel = (
    <MapEditorPanel className="w-72 space-y-3">
      <div className="text-xs font-medium text-muted-foreground">Map labels</div>
      <EditorToggle label="Labels" checked={design.showLabels} onChange={(checked) => updateDesign('showLabels', checked)} />
      <SourceStyleRow
        title="Country"
        description="Country labels"
        color={design.labelColor}
        onColorChange={(value) => updateDesign('labelColor', value)}
        visible={design.showLabels}
        onVisibleChange={(checked) => updateDesign('showLabels', checked)}
        swatches={themeSwatches}
      />
      <SourceStyleRow
        title="Halo"
        description="Label border color"
        color={design.labelHaloColor}
        onColorChange={(value) => updateDesign('labelHaloColor', value)}
        swatches={themeSwatches}
      />
    </MapEditorPanel>
  )

  const roadPanel = (
    <MapEditorPanel className="w-72 space-y-3">
      <div className="text-xs font-medium text-muted-foreground">Road</div>
      <SourceStyleRow
        title="Primary"
        description="Road color"
        color={design.roadColor}
        onColorChange={(value) => updateDesign('roadColor', value)}
        swatches={themeSwatches}
      />
    </MapEditorPanel>
  )

  const naturalPanel = (
    <MapEditorPanel className="w-72 space-y-3">
      <div className="text-xs font-medium text-muted-foreground">Natural</div>
      <SourceStyleRow
        title="Lands"
        description="Base land surface"
        color={design.backgroundColor}
        onColorChange={(value) => updateDesign('backgroundColor', value)}
        swatches={themeSwatches}
      />
      <SourceStyleRow
        title="Water"
        description="Oceans, lakes, rivers, and waterways"
        color={design.waterColor}
        onColorChange={(value) => updateDesign('waterColor', value)}
        visible={design.showWater}
        onVisibleChange={(checked) => updateDesign('showWater', checked)}
        swatches={themeSwatches}
      />
      <SourceStyleRow
        title="Greenland"
        description="Grasslands, parks, and gardens"
        color={design.landcoverColor}
        onColorChange={(value) => updateDesign('landcoverColor', value)}
        visible={design.showLandcover}
        onVisibleChange={(checked) => updateDesign('showLandcover', checked)}
        swatches={themeSwatches}
      />
    </MapEditorPanel>
  )

  const landusePanel = (
    <MapEditorPanel className="w-72 space-y-3">
      <div className="text-xs font-medium text-muted-foreground">Landuse and Building</div>
      <SourceStyleRow
        title="Building"
        description="All kinds of buildings and structures"
        color={design.buildingColor}
        onColorChange={(value) => updateDesign('buildingColor', value)}
        swatches={themeSwatches}
      />
    </MapEditorPanel>
  )

  const poiPanel = (
    <MapEditorPanel className="w-72 space-y-3">
      <div className="text-xs font-medium text-muted-foreground">Point of Interests</div>
      <SourceStyleRow
        title="POI"
        description="Point marker accent color"
        color={design.markerFill}
        onColorChange={(value) => updateDesign('markerFill', value)}
        swatches={themeSwatches}
      />
      <SourceStyleRow
        title="POI halo"
        description="Point marker inset color"
        color={design.markerInset}
        onColorChange={(value) => updateDesign('markerInset', value)}
        swatches={themeSwatches}
      />
    </MapEditorPanel>
  )

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
                onChange={(value) =>
                  setNextDesign((current) => ({ ...current, primaryColor: value, markerFill: value, labelColor: value }))
                }
              />
              <ColorField
                label="Background"
                value={design.backgroundColor}
                onChange={(value) =>
                  setNextDesign((current) => ({
                    ...current,
                    backgroundColor: value,
                    markerInset: value,
                    labelHaloColor: value,
                  }))
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
                onChange={(value) =>
                  setNextDesign((current) => ({
                    ...current,
                    boundaryColor: value,
                    countryBoundaryColor: value,
                    otherBoundaryColor: value,
                  }))
                }
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
                label="Country boundaries"
                checked={design.showCountryBoundaries}
                onChange={(checked) => updateDesign('showCountryBoundaries', checked)}
              />
              <ToggleRow
                label="Other boundaries"
                checked={design.showOtherBoundaries}
                onChange={(checked) => updateDesign('showOtherBoundaries', checked)}
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
              ref={mapRef}
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
                      onClick={() => selectMarker(marker.id)}
                      onDragEnd={({ lng, lat }) => updateMarker(marker.id, { longitude: lng, latitude: lat })}
                    >
                      <MarkerContent>
                        <EditorMarkerView
                          variant={marker.variant}
                          label={marker.label}
                          icon={<MarkerGlyph icon={marker.icon} image={marker.image} />}
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
                onClick={() => {
                  setOpenTool(null)
                  enterTool('select')
                }}
              />
              <MapToolRailButton
                icon={<Palette />}
                label="Theme & colors"
                active={openTool === 'palette'}
                onClick={() => setOpenTool((current) => (current === 'palette' ? null : 'palette'))}
                flyoutOpen={openTool === 'palette'}
                flyout={
                  <MapEditorPanel className="w-64 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">Map themes</span>
                      <Palette className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                    <div className="grid max-h-[280px] grid-cols-4 gap-2 overflow-y-auto pr-1">
                      {MAP_THEMES.map((theme) => (
                        <ThemeSwatchButton
                          key={theme.id}
                          colors={theme.colors}
                          label={theme.label}
                          active={activeThemeId === theme.id}
                          onClick={() => applyTheme(theme.colors)}
                        />
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-2 border-t border-border pt-3">
                      <button
                        type="button"
                        onClick={() => setDesign(SHARED_BASEMAP_CAPTURE)}
                        className="flex items-center justify-center gap-1 rounded-md bg-accent px-2 py-1.5 text-xs font-medium transition-colors hover:bg-accent/80"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        Captured
                      </button>
                      <button
                        type="button"
                        onClick={() => setDesign(ALT_THEME)}
                        className="flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium ring-1 ring-border transition-colors hover:bg-accent"
                      >
                        <Palette className="h-3.5 w-3.5" />
                        Alternate
                      </button>
                    </div>
                  </MapEditorPanel>
                }
              />
              <MapToolRailButton
                icon={<MapPin />}
                label="Marker tool"
                active={tool === 'marker'}
                onClick={() => {
                  enterTool('marker')
                  setOpenTool('marker')
                }}
                flyoutOpen={openTool === 'marker'}
                flyout={<MarkerFlyout editor={editor} swatches={themeSwatches} />}
              />
              <MapToolRailButton
                icon={<Spline />}
                label="Path tool"
                active={tool === 'path'}
                onClick={() => {
                  enterTool('path')
                  setOpenTool('path')
                }}
                flyoutOpen={openTool === 'path'}
                flyout={<PathFlyout editor={editor} swatches={themeSwatches} />}
              />
              <MapToolRailButton
                icon={<SlidersHorizontal />}
                label="Style"
                active={openTool === 'shapes'}
                onClick={() => setOpenTool((current) => (current === 'shapes' ? null : 'shapes'))}
                flyoutOpen={openTool === 'shapes'}
                flyout={
                  <ShapeToolsFlyout
                    panels={{
                      article: articlePanel,
                      boundary: boundaryPanel,
                      label: labelPanel,
                      road: roadPanel,
                      natural: naturalPanel,
                      landuse: landusePanel,
                      poi: poiPanel,
                    }}
                  />
                }
              />
              <MapToolRailButton
                icon={<Settings />}
                label="Settings"
                active={openTool === 'settings'}
                onClick={() => setOpenTool((current) => (current === 'settings' ? null : 'settings'))}
                flyoutOpen={openTool === 'settings'}
                flyout={
                  <MapEditorPanel className="w-72 space-y-3">
                    <EditorToggle label="Story panel" checked={design.showStory} onChange={(checked) => updateDesign('showStory', checked)} />
                    <EditorToggle label="Focus area" checked={design.showFocusArea} onChange={(checked) => updateDesign('showFocusArea', checked)} />
                    <EditorToggle label="Markers" checked={design.showMarkers} onChange={(checked) => updateDesign('showMarkers', checked)} />
                    <EditorToggle label="Paths" checked={design.showPath} onChange={(checked) => updateDesign('showPath', checked)} />
                    <div className="border-t border-border pt-3">
                      <SourceStyleRow
                        title="Country"
                        description="Country boundaries"
                        color={design.countryBoundaryColor}
                        onColorChange={(value) =>
                          setNextDesign((current) => ({
                            ...current,
                            countryBoundaryColor: value,
                            boundaryColor: value,
                          }))
                        }
                        visible={design.showCountryBoundaries}
                        onVisibleChange={(checked) => updateDesign('showCountryBoundaries', checked)}
                        swatches={themeSwatches}
                      />
                      <SourceStyleRow
                        title="Other"
                        description="Other boundaries"
                        color={design.otherBoundaryColor}
                        onColorChange={(value) =>
                          setNextDesign((current) => ({
                            ...current,
                            otherBoundaryColor: value,
                            boundaryColor: value,
                          }))
                        }
                        visible={design.showOtherBoundaries}
                        onVisibleChange={(checked) => updateDesign('showOtherBoundaries', checked)}
                        swatches={themeSwatches}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={clearAll}
                      className="mt-2 flex w-full items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium ring-1 ring-border transition-colors hover:bg-accent"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Clear all
                    </button>
                  </MapEditorPanel>
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
              <MapColorPicker
                value={selectedMarker.color1}
                onChange={(value) => updateMarker(selectedMarker.id, { color1: value })}
                title="Fill color"
                swatches={themeSwatches}
                placement="top"
              />
              <MapColorPicker
                value={selectedMarker.color2}
                onChange={(value) => updateMarker(selectedMarker.id, { color2: value })}
                title="Icon color"
                swatches={themeSwatches}
                placement="top"
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
                onClick={() => deleteMarker(selectedMarker.id)}
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
            accentColor={design.textPrimary}
            backgroundColor={design.articleBackground}
            textColor={design.textDefault}
            mutedColor={design.textSecondary}
            onClose={() => updateDesign('showStory', false)}
          >
            <p>{design.subtitle}</p>
            <MapStorySection heading="The route" accentColor={design.textPrimary} textColor={design.textDefault}>
              <p>
                Follow the dashed trail from the <strong>Start</strong> flag along the Fraser River, past the market,
                and up to the lookout. Each stop is a tasmap-style marker rendered with the shared MapLibre marker
                layer.
              </p>
            </MapStorySection>
            <MapStorySection heading="About this panel" accentColor={design.textPrimary} textColor={design.textDefault}>
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
