import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type MapLibreGL from 'maplibre-gl'
import {
  ArrowDown,
  ArrowLeft,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Download,
  Info,
  Layers,
  MapPin,
  RotateCcw,
  X,
} from 'lucide-react'

import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Map, MapMarker, MarkerContent, MarkerPopup } from '@/components/ui/map'
import { MapCircleLayer, MapFillLayer } from '@/components/ui/map-layers'
import { LegendItem, MapLegendPanel, MapLegendSection } from '@/components/ui/map-panels'
import { MAP_STYLES } from '@/components/ui/map-styles'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/hooks/useIsMobile'
import {
  downloadProjectPackage,
  type ProjectPackage,
  type ProjectSceneDef,
  type ProjectStoryLayerDef,
  type ProjectStoryWorkspaceDef,
} from '@/lib/projectPackages'
import { withBase } from '@/lib/dataUrl'
import { buildLegend, resolveLayer, sameLayerSet } from './storyScene'
import { escapeHtml } from '@/lib/escapeHtml'

const CAMERA_EASE_MS = 1150
/** Crossfade duration when scene changes swap map layers. */
const LAYER_FADE_MS = 300
/** Initial mute window after the stepper starts a programmatic scroll. */
const PROGRAMMATIC_SCROLL_MS = 300
/** A muted scroll keeps extending the mute until events stop for this long. */
const SCROLL_SETTLE_MS = 160
/** The card under this fraction of the viewport height is the active scene. */
const READING_LINE_FRACTION = 0.35
const EMPTY_FEATURE_COLLECTION: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
const joinedLayerDataCache = new globalThis.Map<string, Promise<GeoJSON.FeatureCollection>>()

function joinedLayerData(layer: ProjectStoryLayerDef): Promise<GeoJSON.FeatureCollection> {
  const join = layer.attributes
  if (!join) return Promise.reject(new Error(`Layer ${layer.id} has no attribute join`))
  const cacheKey = [layer.data, join.data, join.boundaryProperty, join.attributeProperty, join.recordsProperty].join('|')
  const cached = joinedLayerDataCache.get(cacheKey)
  if (cached) return cached

  const pending = Promise.all([
    fetch(withBase(layer.data)).then((response) => {
      if (!response.ok) throw new Error(`Boundary request failed: ${response.status}`)
      return response.json() as Promise<GeoJSON.FeatureCollection>
    }),
    fetch(withBase(join.data)).then((response) => {
      if (!response.ok) throw new Error(`Attribute request failed: ${response.status}`)
      return response.json() as Promise<Record<string, unknown>>
    }),
  ]).then(([boundaries, attributePayload]) => {
    if (boundaries.type !== 'FeatureCollection' || !Array.isArray(boundaries.features)) {
      throw new Error(`Layer ${layer.id} boundary data is not a FeatureCollection`)
    }
    const records = attributePayload[join.recordsProperty ?? 'records']
    if (!Array.isArray(records)) throw new Error(`Layer ${layer.id} attribute data has no records array`)
    const byId = new globalThis.Map(
      records
        .filter((record): record is Record<string, unknown> => Boolean(record && typeof record === 'object'))
        .map((record) => [String(record[join.attributeProperty]), record]),
    )
    return {
      ...boundaries,
      features: boundaries.features.map((feature) => {
        const properties = feature.properties ?? {}
        const attributes = byId.get(String(properties[join.boundaryProperty]))
        return attributes ? { ...feature, properties: { ...properties, ...attributes } } : feature
      }),
    }
  }).catch((error) => {
    joinedLayerDataCache.delete(cacheKey)
    throw error
  })
  joinedLayerDataCache.set(cacheKey, pending)
  return pending
}

function useStoryLayerData(layers: ProjectStoryLayerDef[]) {
  const [joinedData, setJoinedData] = useState<Record<string, GeoJSON.FeatureCollection>>({})
  useEffect(() => {
    let cancelled = false
    const joinedLayers = layers.filter((layer) => layer.attributes)
    if (joinedLayers.length === 0) {
      setJoinedData({})
      return
    }
    Promise.all(joinedLayers.map(async (layer) => [layer.id, await joinedLayerData(layer)] as const))
      .then((entries) => {
        if (!cancelled) setJoinedData(Object.fromEntries(entries))
      })
      .catch((error) => {
        if (!cancelled) console.error('Unable to join shared story-map boundaries', error)
      })
    return () => { cancelled = true }
  }, [layers])
  return joinedData
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

/* -------------------------------------------------------------------------- */
/* Narrative sidebar                                                          */
/* -------------------------------------------------------------------------- */

function StoryNarrative({
  project,
  scenes,
  activeSceneIndex,
  accent,
  scrollRef,
  cardRefs,
  onBack,
  onSelectScene,
  onStepScene,
}: {
  project: ProjectPackage
  scenes: ProjectSceneDef[]
  activeSceneIndex: number
  accent: string
  scrollRef: React.RefObject<HTMLDivElement>
  cardRefs: React.MutableRefObject<Array<HTMLElement | null>>
  onBack: () => void
  onSelectScene: (index: number) => void
  onStepScene: (direction: number) => void
}) {
  const progress = scenes.length > 0 ? ((activeSceneIndex + 1) / scenes.length) * 100 : 0
  const [sourceNoteOpen, setSourceNoteOpen] = useState(false)

  return (
    <aside className="flex h-full min-h-0 flex-col border-r bg-background">
      <div className="shrink-0 border-b p-3">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex h-8 items-center gap-2 rounded-md border bg-background px-2.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            All projects
          </button>
          <div className="flex items-center gap-1.5">
            {project.sourceNote && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSourceNoteOpen(true)}
                aria-label="Source note"
              >
                <Info className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" onClick={() => downloadProjectPackage(project)}>
              <Download className="h-3.5 w-3.5" />
              JSON
            </Button>
          </div>
        </div>

        <Dialog open={sourceNoteOpen} onOpenChange={setSourceNoteOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Source note</DialogTitle>
              <DialogDescription className="sr-only">Where this story's data comes from</DialogDescription>
            </DialogHeader>
            <p className="text-sm leading-6 text-muted-foreground">{project.sourceNote}</p>
          </DialogContent>
        </Dialog>

        <div className="mt-3 flex items-start gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-white"
            style={{ backgroundColor: accent }}
          >
            <BookOpen className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-bold leading-tight text-foreground">{project.title}</h1>
            <div className="mt-1 text-xs text-muted-foreground">
              {project.region} · {scenes.length} scenes
            </div>
          </div>
        </div>

        {/* Scene stepper — keyboard/pointer alternative to scrolling. */}
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => onStepScene(-1)}
            disabled={activeSceneIndex === 0}
            aria-label="Previous scene"
            className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full transition-[width] duration-300"
              style={{ width: `${progress}%`, backgroundColor: accent }}
            />
          </div>
          <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
            {activeSceneIndex + 1}/{scenes.length}
          </span>
          <button
            type="button"
            onClick={() => onStepScene(1)}
            disabled={activeSceneIndex >= scenes.length - 1}
            aria-label="Next scene"
            className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto scroll-smooth">
        <header className="border-b bg-muted/20 px-4 py-5">
          <div
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: accent }}
          >
            Map story
          </div>
          <p className="mt-2 text-sm leading-6 text-foreground">{project.summary}</p>
          <div className="mt-3 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            Scroll to move through the story
            <ArrowDown className="h-3.5 w-3.5" />
          </div>
        </header>

        <div className="space-y-3 p-3 pb-[40vh]">
          {scenes.map((scene, index) => {
            const active = index === activeSceneIndex
            return (
              <article
                key={`${scene.label}-${index}`}
                ref={(node) => {
                  cardRefs.current[index] = node
                }}
                data-scene-index={index}
                className="scroll-m-4"
              >
                <button
                  type="button"
                  onClick={() => onSelectScene(index)}
                  aria-current={active ? 'step' : undefined}
                  className={cn(
                    'w-full rounded-lg border bg-background p-4 text-left shadow-sm transition-colors',
                    active ? 'border-primary bg-primary/5' : 'hover:border-primary/50 hover:bg-muted/50',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className="truncate text-xs font-semibold uppercase tracking-wide"
                      style={{ color: active ? accent : undefined }}
                    >
                      <span className={cn(!active && 'text-muted-foreground')}>{scene.kicker ?? scene.label}</span>
                    </span>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                  </div>

                  <h2 className="mt-2 text-sm font-bold leading-snug text-foreground">{scene.title}</h2>
                  <p className="mt-2 text-xs leading-6 text-muted-foreground">{scene.text}</p>

                  {scene.callout && (
                    <div className="mt-3 rounded-md border bg-muted/30 p-2.5">
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {scene.callout.label}
                      </div>
                      <div className="mt-0.5 text-sm font-bold text-foreground">{scene.callout.value}</div>
                      {scene.callout.detail && (
                        <div className="mt-0.5 text-xs leading-5 text-muted-foreground">{scene.callout.detail}</div>
                      )}
                    </div>
                  )}

                  <div className="mt-3 flex items-center gap-1.5 border-t pt-2.5 text-xs font-medium text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5 shrink-0" style={{ color: accent }} />
                    <span className="truncate">{scene.focus}</span>
                  </div>
                </button>
              </article>
            )
          })}

        </div>
      </div>
    </aside>
  )
}

/* -------------------------------------------------------------------------- */
/* Story map                                                                  */
/* -------------------------------------------------------------------------- */

export function ProjectStoryMap({
  project,
  config,
  onBack,
}: {
  project: ProjectPackage
  config: ProjectStoryWorkspaceDef
  onBack: () => void
}) {
  const scenes = project.scenes
  const accent = config.accent
  const isMobile = useIsMobile()
  const joinedLayerData = useStoryLayerData(config.layers)

  const mapRef = useRef<MapLibreGL.Map | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef<Array<HTMLElement | null>>([])
  const programmaticScrollUntilRef = useRef(0)
  /** Scene a stepper click is scrolling toward; null when the reader drives. */
  const pendingSceneRef = useRef<number | null>(null)

  const [activeSceneIndex, setActiveSceneIndex] = useState(0)
  const [visibleLayerIds, setVisibleLayerIds] = useState(
    () =>
      new Set(
        scenes[0]?.visibleLayerIds ?? project.layers.filter((layer) => layer.checked).map((layer) => layer.id),
      ),
  )
  const [sidebarWidth, setSidebarWidth] = useState(380)
  const [selectedFeature, setSelectedFeature] = useState<{
    layerId: string
    id: string
    title: string
    layerLabel: string
    detail?: string
  } | null>(null)

  const activeScene = scenes[activeSceneIndex]

  // NB: `Map` here is the map component, so use a record rather than a global Map.
  const layerLabels = useMemo(
    () => Object.fromEntries(project.layers.map((layer) => [layer.id, layer.label])) as Record<string, string>,
    [project.layers],
  )

  const resolvedLayers = useMemo(
    () => config.layers.map((layer) => resolveLayer(layer, layerLabels[layer.id] ?? layer.id, activeScene, accent)),
    [accent, activeScene, config.layers, layerLabels],
  )

  // The layers panel only covers what the scene uses (plus anything the reader
  // toggled on themselves) — layers from other scenes would just be noise.
  // Building the legend from the listed set rather than the visible set keeps a
  // toggled-off layer's entries around (dimmed) so it can be toggled back on.
  const legendEntries = useMemo(() => {
    const sceneLayerIds = new Set(activeScene?.visibleLayerIds ?? [])
    const listedIds = new Set(
      resolvedLayers
        .map((resolved) => resolved.layer.id)
        .filter((id) => sceneLayerIds.has(id) || visibleLayerIds.has(id)),
    )
    return buildLegend(activeScene, resolvedLayers, listedIds, accent)
  }, [accent, activeScene, resolvedLayers, visibleLayerIds])

  const activePlaces = useMemo(() => {
    if (!activeScene?.placeIds) return []
    const ids = new Set(activeScene.placeIds)
    return config.places.filter((place) => ids.has(place.id))
  }, [activeScene, config.places])

  // Opening on the first scene's camera means no post-load jump when the story starts.
  const initialCamera = scenes[0]?.camera ?? { center: config.map.center, zoom: config.map.zoom }

  const mapStyles = useMemo(() => {
    if (config.map.basemap === 'light') return { light: MAP_STYLES.light, dark: MAP_STYLES.light }
    if (config.map.basemap === 'dark') return { light: MAP_STYLES.dark, dark: MAP_STYLES.dark }
    return MAP_STYLES
  }, [config.map.basemap])

  const sceneOverridden = activeScene ? !sameLayerSet(visibleLayerIds, activeScene.visibleLayerIds) : false

  const activeSceneIndexRef = useRef(0)

  const applyScene = useCallback(
    (index: number, { force = false } = {}) => {
      const scene = scenes[index]
      if (!scene) return
      // Scroll events re-derive the scene every frame; re-applying the active
      // one would restart the camera ease and stomp manual layer toggles.
      if (!force && index === activeSceneIndexRef.current) return
      activeSceneIndexRef.current = index
      setActiveSceneIndex(index)
      setVisibleLayerIds(new Set(scene.visibleLayerIds))
      setSelectedFeature(null)

      const map = mapRef.current
      if (!map || !scene.camera) return
      const camera = {
        center: scene.camera.center,
        zoom: scene.camera.zoom,
        bearing: scene.camera.bearing ?? 0,
        pitch: scene.camera.pitch ?? 0,
      }
      if (prefersReducedMotion()) map.jumpTo(camera)
      else map.easeTo({ ...camera, duration: CAMERA_EASE_MS })
    },
    [scenes],
  )

  // Scroll position drives the active scene: the card under the reading line
  // wins. A single trigger line keeps the mapping deterministic for cards of
  // any height — intersection-ratio thresholds can never fire for cards taller
  // than the observed band, and flip-flop at card boundaries.
  useEffect(() => {
    const root = scrollRef.current
    if (!root) return
    let frame = 0
    let settleTimer = 0

    const pickIndex = () => {
      const rootRect = root.getBoundingClientRect()
      const readingLine = rootRect.top + rootRect.height * READING_LINE_FRACTION
      let bestIndex = -1
      let bestDistance = Infinity
      cardRefs.current.forEach((card, index) => {
        if (!card) return
        const rect = card.getBoundingClientRect()
        const distance =
          readingLine < rect.top ? rect.top - readingLine : Math.max(0, readingLine - rect.bottom)
        if (distance < bestDistance) {
          bestDistance = distance
          bestIndex = index
        }
      })
      return bestIndex
    }

    const pickAndApply = () => {
      frame = 0
      if (performance.now() < programmaticScrollUntilRef.current) return
      // The reader is driving; any pending stepper target is obsolete.
      pendingSceneRef.current = null
      const index = pickIndex()
      if (index >= 0) applyScene(index)
    }

    const settle = () => {
      const target = pendingSceneRef.current
      if (target == null) {
        programmaticScrollUntilRef.current = 0
        pickAndApply()
        return
      }
      // A stepper scroll can be cut short (another click, a busy main
      // thread); converge on the clicked scene rather than re-deriving from
      // wherever the aborted scroll happened to stop.
      if (pickIndex() !== target) {
        programmaticScrollUntilRef.current = performance.now() + PROGRAMMATIC_SCROLL_MS
        cardRefs.current[target]?.scrollIntoView({ behavior: 'auto', block: 'center' })
        return
      }
      pendingSceneRef.current = null
      programmaticScrollUntilRef.current = 0
    }

    const handleScroll = () => {
      const now = performance.now()
      if (now < programmaticScrollUntilRef.current) {
        // A stepper-driven smooth scroll sweeps past intermediate cards.
        // Honouring those would drag the story back and fight rapid clicks,
        // so keep muting until events stop, then confirm the landing card.
        programmaticScrollUntilRef.current = now + SCROLL_SETTLE_MS
        window.clearTimeout(settleTimer)
        settleTimer = window.setTimeout(settle, SCROLL_SETTLE_MS + 20)
        return
      }
      if (!frame) frame = requestAnimationFrame(pickAndApply)
    }

    root.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      root.removeEventListener('scroll', handleScroll)
      if (frame) cancelAnimationFrame(frame)
      window.clearTimeout(settleTimer)
    }
  }, [applyScene])

  const goToScene = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(scenes.length - 1, index))
      const smooth = !prefersReducedMotion()
      pendingSceneRef.current = clamped
      programmaticScrollUntilRef.current = performance.now() + PROGRAMMATIC_SCROLL_MS
      applyScene(clamped, { force: true })
      cardRefs.current[clamped]?.scrollIntoView({
        behavior: smooth ? 'smooth' : 'auto',
        block: 'center',
      })
    },
    [applyScene, scenes.length],
  )

  // Step from the ref, not render state: two quick clicks can both fire
  // before the re-render from the first one commits.
  const stepScene = useCallback(
    (direction: number) => goToScene(activeSceneIndexRef.current + direction),
    [goToScene],
  )

  function toggleLayer(layerId: string) {
    setVisibleLayerIds((current) => {
      const next = new Set(current)
      if (next.has(layerId)) next.delete(layerId)
      else next.add(layerId)
      return next
    })
  }

  return (
    <MapSectionLayout
      sidebar={
        <StoryNarrative
          project={project}
          scenes={scenes}
          activeSceneIndex={activeSceneIndex}
          accent={accent}
          scrollRef={scrollRef}
          cardRefs={cardRefs}
          onBack={onBack}
          onSelectScene={goToScene}
          onStepScene={stepScene}
        />
      }
      desktopSidebarWidth={sidebarWidth}
      onDesktopSidebarWidthChange={setSidebarWidth}
      mobileInitialSheetState="half"
      mobileCollapsedVisibleHeight={68}
      showMobilePeek
      mobilePeek={
        <div className="flex min-w-0 items-center gap-1.5">
          <div className="min-w-0 flex-1 text-left">
            <div className="truncate text-xs font-semibold text-foreground">
              {activeScene?.title ?? project.title}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {activeSceneIndex + 1}/{scenes.length} · {activeScene?.focus ?? project.region}
            </div>
          </div>
          {/* stopPropagation keeps taps from starting a sheet drag or toggle. */}
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              stepScene(-1)
            }}
            disabled={activeSceneIndex === 0}
            aria-label="Previous scene"
            className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              stepScene(1)
            }}
            disabled={activeSceneIndex >= scenes.length - 1}
            aria-label="Next scene"
            className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      }
    >
      <Map
        ref={mapRef}
        className="h-full w-full"
        center={initialCamera.center}
        zoom={initialCamera.zoom}
        minZoom={config.map.minZoom}
        maxZoom={config.map.maxZoom}
        styles={mapStyles}
      >

        {resolvedLayers.map((resolved) => {
          const layerData = resolved.layer.attributes
            ? joinedLayerData[resolved.layer.id] ?? EMPTY_FEATURE_COLLECTION
            : resolved.layer.data
          const selectFeature = (id: string, _event: unknown, properties: Record<string, unknown>) =>
            setSelectedFeature({
              layerId: resolved.layer.id,
              id,
              title: String(
                properties[resolved.layer.selectionTitleProperty ?? resolved.layer.labelProperty] ?? id,
              ),
              layerLabel: resolved.label,
              detail: resolved.layer.selectionDetailProperty
                ? String(properties[resolved.layer.selectionDetailProperty] ?? '') || undefined
                : undefined,
            })
          const hoverHtml = (properties: Record<string, unknown>) =>
            `<div class="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground shadow-md">
              <div class="font-semibold">${escapeHtml(properties[resolved.layer.labelProperty])}</div>
              <div class="mt-0.5 text-muted-foreground">${escapeHtml(resolved.label)}</div>
            </div>`

          if (resolved.layer.geometry === 'point') {
            return (
              <MapCircleLayer
                key={resolved.layer.id}
                data={layerData}
                idProperty={resolved.layer.idProperty}
                color={resolved.fillColor}
                opacity={resolved.fillOpacity}
                radius={resolved.layer.circleRadius ?? 5.5}
                strokeColor={resolved.lineColor}
                strokeWidth={resolved.lineWidth}
                visible={visibleLayerIds.has(resolved.layer.id)}
                filter={resolved.filter as never}
                selectedId={selectedFeature?.layerId === resolved.layer.id ? selectedFeature.id : null}
                onFeatureClick={selectFeature}
                hoverHtml={hoverHtml}
              />
            )
          }

          return (
            <MapFillLayer
              key={resolved.layer.id}
              data={layerData}
              idProperty={resolved.layer.idProperty}
              fillColor={resolved.fillColor}
              fillOpacity={resolved.fillOpacity}
              lineColor={resolved.lineColor}
              lineOpacity={resolved.lineOpacity}
              lineWidth={resolved.lineWidth}
              visible={visibleLayerIds.has(resolved.layer.id)}
              filter={resolved.filter as never}
              fadeMs={LAYER_FADE_MS}
              selectedId={selectedFeature?.layerId === resolved.layer.id ? selectedFeature.id : null}
              onFeatureClick={selectFeature}
              hoverHtml={hoverHtml}
            />
          )
        })}

        {activePlaces.map((place) => (
          <MapMarker key={place.id} longitude={place.coordinates[0]} latitude={place.coordinates[1]} anchor="bottom">
            <MarkerContent>
              <div className="flex flex-col items-center">
                <div className="mb-1 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-xs font-semibold text-background shadow-lg">
                  {place.label}
                </div>
                <div
                  className="h-3.5 w-3.5 rounded-full border-2 border-white shadow-lg"
                  style={{ backgroundColor: place.color ?? accent }}
                />
              </div>
            </MarkerContent>
            <MarkerPopup closeButton>
              <div className="w-52">
                <div className="text-sm font-semibold text-foreground">{place.label}</div>
                {place.note && <p className="mt-1 text-xs leading-5 text-muted-foreground">{place.note}</p>}
              </div>
            </MarkerPopup>
          </MapMarker>
        ))}
      </Map>

      {selectedFeature && (
        <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex justify-center">
          <div className="pointer-events-auto flex max-h-[min(60vh,32rem)] w-full max-w-md items-start gap-3 rounded-lg border bg-background/95 px-3 py-2.5 text-sm shadow-lg backdrop-blur">
            <div className="min-w-0 flex-1">
              <div className="font-semibold leading-5 text-foreground">{selectedFeature.title}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{selectedFeature.layerLabel}</div>
              {selectedFeature.detail && (
                <div className="mt-2 max-h-[min(42vh,22rem)] overflow-y-auto whitespace-pre-line border-t pt-2 text-xs leading-5 text-muted-foreground">
                  {selectedFeature.detail}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setSelectedFeature(null)}
              aria-label="Close selected feature"
              className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>
      )}

      <MapLegendPanel
        title="Map layers"
        description={activeScene?.label}
        icon={<Layers className="h-3.5 w-3.5" />}
        collapsible
        // Expanded, the panel would cover most of a phone-sized map.
        defaultCollapsed={isMobile}
        width="md"
        contentClassName="space-y-3"
        actions={
          sceneOverridden ? (
            <button
              type="button"
              onClick={() => activeScene && setVisibleLayerIds(new Set(activeScene.visibleLayerIds))}
              className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </button>
          ) : null
        }
      >
        {/* One merged legend: entries carry their layer, so clicking one
            toggles that layer — no separate "Story layers" list. */}
        <MapLegendSection columns={legendEntries.length > 5 ? 2 : 1} scroll={legendEntries.length > 12}>
          {legendEntries.map((entry) => (
            <LegendItem
              key={entry.key}
              color={entry.color}
              label={entry.label}
              swatchShape="circle"
              active={entry.layerId ? visibleLayerIds.has(entry.layerId) : true}
              onClick={entry.layerId ? () => toggleLayer(entry.layerId as string) : undefined}
            />
          ))}
        </MapLegendSection>
      </MapLegendPanel>
    </MapSectionLayout>
  )
}
