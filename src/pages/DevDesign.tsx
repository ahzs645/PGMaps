import { useEffect, useMemo, useState } from 'react'
import MapLibreGL, { type StyleSpecification } from 'maplibre-gl'
import { Protocol } from 'pmtiles'
import {
  Check,
  Eye,
  Layers,
  MapPin,
  Palette,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Map as AppMap, MapMarker, MarkerContent, useMap } from '@/components/ui/map'
import { AppSelect } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
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
  markerFill: string
  markerInset: string
  markerSize: number
  markerShape: MarkerShape
  showLabels: boolean
  showWater: boolean
  showLandcover: boolean
  showFocusArea: boolean
}

const TASMAP_CAPTURE: DesignState = {
  title: 'My Tasmap',
  subtitle: 'Recovered local design preview',
  primaryColor: '#09558c',
  backgroundColor: '#f9f7f0',
  waterColor: '#afd4e9',
  landcoverColor: '#d8e7c5',
  boundaryColor: '#7f8f9a',
  markerFill: '#09558c',
  markerInset: '#f9f7f0',
  markerSize: 48,
  markerShape: 'circle_fill',
  showLabels: true,
  showWater: true,
  showLandcover: true,
  showFocusArea: true,
}

const ALT_THEME: DesignState = {
  ...TASMAP_CAPTURE,
  primaryColor: '#654ea3',
  backgroundColor: '#f6f2ff',
  waterColor: '#b8d9f5',
  landcoverColor: '#cfe6d8',
  boundaryColor: '#8274a5',
  markerFill: '#654ea3',
  markerInset: '#fff7db',
}

const TILE_URL = '/tasmap-tile-1.b-cdn.net/20250528.pmtiles'
const GLYPH_URL = '/api.maptiler.com/fonts/{fontstack}/{range}.pbf'
const DESIGN_CENTER: [number, number] = [121.565, 25.045]
const MARKER_COORDINATE = { longitude: 121.565, latitude: 25.045 }

let pmtilesRegistered = false

function ensurePmtilesProtocol() {
  if (pmtilesRegistered) return
  const protocol = new Protocol()

  try {
    MapLibreGL.addProtocol('pmtiles', protocol.tile)
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('already registered')) {
      throw error
    }
  }

  pmtilesRegistered = true
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

function buildTasmapStyle(design: DesignState): StyleSpecification {
  const source = 'tasmap-local'

  return {
    version: 8,
    glyphs: GLYPH_URL,
    sources: {
      [source]: {
        type: 'vector',
        url: `pmtiles://${TILE_URL}`,
        minzoom: 0,
        maxzoom: 14,
      },
    },
    layers: [
      {
        id: 'tasmap-background',
        type: 'background',
        paint: { 'background-color': design.backgroundColor },
      },
      {
        id: 'tasmap-landcover',
        type: 'fill',
        source,
        'source-layer': 'landcover',
        layout: { visibility: design.showLandcover ? 'visible' : 'none' },
        paint: {
          'fill-color': design.landcoverColor,
          'fill-opacity': 0.62,
        },
      },
      {
        id: 'tasmap-water',
        type: 'fill',
        source,
        'source-layer': 'water',
        layout: { visibility: design.showWater ? 'visible' : 'none' },
        paint: {
          'fill-color': design.waterColor,
          'fill-opacity': 0.9,
        },
      },
      {
        id: 'tasmap-roads',
        type: 'line',
        source,
        'source-layer': 'transportation',
        paint: {
          'line-color': '#ffffff',
          'line-opacity': 0.72,
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.3, 12, 1.25],
        },
      },
      {
        id: 'tasmap-boundary',
        type: 'line',
        source,
        'source-layer': 'boundary',
        paint: {
          'line-color': design.boundaryColor,
          'line-opacity': 0.45,
          'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.6, 10, 1.6],
        },
      },
      {
        id: 'tasmap-focus-area',
        type: 'circle',
        source,
        'source-layer': 'place',
        layout: { visibility: design.showFocusArea ? 'visible' : 'none' },
        filter: ['==', ['get', 'class'], 'city'],
        paint: {
          'circle-color': design.primaryColor,
          'circle-opacity': 0.12,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 14, 10, 42],
          'circle-stroke-color': design.primaryColor,
          'circle-stroke-opacity': 0.32,
          'circle-stroke-width': 1.25,
        },
      },
      {
        id: 'tasmap-water-label',
        type: 'symbol',
        source,
        'source-layer': 'water_name',
        layout: {
          visibility: design.showLabels ? 'visible' : 'none',
          'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
          'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
          'text-size': 12,
        },
        paint: {
          'text-color': '#5288a3',
          'text-halo-color': design.backgroundColor,
          'text-halo-width': 1.2,
        },
      },
      {
        id: 'tasmap-place-label',
        type: 'symbol',
        source,
        'source-layer': 'place',
        layout: {
          visibility: design.showLabels ? 'visible' : 'none',
          'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
          'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 5, 11, 10, 15],
          'text-anchor': 'top',
          'text-offset': [0, 0.6],
        },
        paint: {
          'text-color': design.primaryColor,
          'text-halo-color': design.backgroundColor,
          'text-halo-width': 1.4,
        },
      },
    ],
  }
}

function MapStatus({ onStatus }: { onStatus: (status: string) => void }) {
  const { map, isLoaded } = useMap()

  useEffect(() => {
    if (!map || !isLoaded) return

    onStatus('rendering local PMTiles')
    const handleIdle = () => onStatus('local vector tile rendered')
    const handleError = (event: { error?: Error }) => {
      onStatus(event.error?.message ?? 'map render error')
    }

    map.on('idle', handleIdle)
    map.on('error', handleError)
    return () => {
      map.off('idle', handleIdle)
      map.off('error', handleError)
    }
  }, [isLoaded, map, onStatus])

  return null
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

function TasmapMarker({ design }: { design: DesignState }) {
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
      aria-label="Tasmap marker preview"
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
              Taipei
            </text>
            <text x="340" y="235" fontSize="22">
              District
            </text>
            <text x="830" y="535" fontSize="22">
              Riverside
            </text>
          </g>
        ) : null}
      </svg>
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full">
        <TasmapMarker design={design} />
      </div>
    </div>
  )
}

export default function DevDesign() {
  const [design, setDesign] = useState<DesignState>(TASMAP_CAPTURE)
  const [status, setStatus] = useState('loading local PMTiles')
  // Probing WebGL support once in the lazy initializer avoids flipping state
  // from the mount effect.
  const [canUseWebGl] = useState(() => hasWebGlContext())

  useEffect(() => {
    ensurePmtilesProtocol()
  }, [])

  const style = useMemo(() => buildTasmapStyle(design), [design])

  const updateDesign = <Key extends keyof DesignState>(key: Key, value: DesignState[Key]) => {
    setDesign((current) => ({ ...current, [key]: value }))
  }

  return (
    <div className="flex h-full min-h-[calc(100vh-3rem)] flex-col bg-background lg:min-h-[calc(100vh-3.5rem)] lg:flex-row">
      <section className="relative min-h-[54vh] flex-1 overflow-hidden border-b border-border lg:min-h-0 lg:border-b-0 lg:border-r">
        {canUseWebGl ? (
          <AppMap
            className="h-full min-h-[54vh] lg:min-h-0"
            theme="light"
            styles={{ light: style, dark: style }}
            center={DESIGN_CENTER}
            zoom={9}
            minZoom={2}
            maxZoom={14}
            pitch={0}
            bearing={0}
          >
            <MapStatus onStatus={setStatus} />
            <MapMarker
              longitude={MARKER_COORDINATE.longitude}
              latitude={MARKER_COORDINATE.latitude}
              offset={[0, design.markerShape === 'pin' ? -20 : -8]}
            >
              <MarkerContent>
                <TasmapMarker design={design} />
              </MarkerContent>
            </MapMarker>
          </AppMap>
        ) : (
          <StaticMapPreview design={design} />
        )}

        <div className="pointer-events-none absolute left-4 top-4 max-w-[min(24rem,calc(100%-2rem))]">
          <div
            className="rounded-md border px-4 py-3 shadow-sm"
            style={{ backgroundColor: design.backgroundColor, borderColor: design.primaryColor }}
          >
            <div className="flex items-center gap-2 text-xs font-medium" style={{ color: design.primaryColor }}>
              <MapPin className="h-3.5 w-3.5" />
              Tasmap design preview
            </div>
            <h1 className="mt-1 text-xl font-semibold leading-tight" style={{ color: design.primaryColor }}>
              {design.title}
            </h1>
            <p className="mt-1 text-sm" style={{ color: design.primaryColor }}>
              {design.subtitle}
            </p>
          </div>
        </div>

        <div className="absolute bottom-4 left-4 flex items-center gap-2 rounded-md border border-border bg-background/95 px-3 py-2 text-xs text-muted-foreground shadow-sm backdrop-blur">
          <Check className="h-3.5 w-3.5 text-emerald-600" />
          {canUseWebGl ? status : 'static preview: WebGL unavailable in this browser'}
        </div>
      </section>

      <aside className="w-full overflow-y-auto bg-background lg:w-[25rem]">
        <div className="border-b border-border px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">/dev/design</h2>
              <p className="text-xs text-muted-foreground">Tasmap options transposed into PGMaps</p>
            </div>
            <Button
              type="button"
              size="icon"
              variant="outline"
              title="Reset capture theme"
              aria-label="Reset capture theme"
              onClick={() => setDesign(TASMAP_CAPTURE)}
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="grid gap-5 p-4">
          <section className="grid gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Palette className="h-4 w-4" />
              Coloring
            </div>
            <div className="grid grid-cols-2 gap-3">
              <ColorField
                label="Primary"
                value={design.primaryColor}
                onChange={(value) => {
                  updateDesign('primaryColor', value)
                  updateDesign('markerFill', value)
                }}
              />
              <ColorField
                label="Background"
                value={design.backgroundColor}
                onChange={(value) => {
                  updateDesign('backgroundColor', value)
                  updateDesign('markerInset', value)
                }}
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
                label="Marker inset"
                value={design.markerInset}
                onChange={(value) => updateDesign('markerInset', value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" size="sm" onClick={() => setDesign(TASMAP_CAPTURE)}>
                <Sparkles className="h-4 w-4" />
                Captured
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setDesign(ALT_THEME)}>
                <Palette className="h-4 w-4" />
                Alternate
              </Button>
            </div>
          </section>

          <section className="grid gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <SlidersHorizontal className="h-4 w-4" />
              Map Options
            </div>
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
          </section>

          <section className="grid gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <MapPin className="h-4 w-4" />
              Marker
            </div>
            <Field label="Shape">
              <AppSelect
                value={design.markerShape}
                onValueChange={(value) => updateDesign('markerShape', value as MarkerShape)}
                options={[
                  { value: 'circle_fill', label: 'Tasmap pin' },
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
          </section>

          <section className="grid gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Eye className="h-4 w-4" />
              Page Text
            </div>
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
          </section>

          <section className="grid gap-2 rounded-md border border-border p-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-2 font-medium text-foreground">
              <Layers className="h-4 w-4" />
              Local source
            </div>
            <div className="font-mono">{TILE_URL}</div>
            <div className="font-mono">{GLYPH_URL}</div>
          </section>
        </div>
      </aside>
    </div>
  )
}
