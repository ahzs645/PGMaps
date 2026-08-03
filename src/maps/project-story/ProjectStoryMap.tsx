import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type MapLibreGL from 'maplibre-gl'
import {
  ArrowDown,
  ArrowLeft,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Download,
  Layers,
  MapPin,
  RotateCcw,
} from 'lucide-react'

import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { Button } from '@/components/ui/button'
import { Map, MapMarker, MarkerContent, MarkerPopup } from '@/components/ui/map'
import { MapFillLayer } from '@/components/ui/map-layers'
import { LegendItem, MapLegendPanel, MapLegendSection } from '@/components/ui/map-panels'
import { MAP_STYLES } from '@/components/ui/map-styles'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/hooks/useIsMobile'
import {
  downloadProjectPackage,
  type ProjectPackage,
  type ProjectSceneDef,
  type ProjectStoryWorkspaceDef,
} from '@/lib/projectPackages'
import { buildLegend, resolveLayer, sameLayerSet } from './storyScene'
import { escapeHtml } from '@/lib/escapeHtml'

const CAMERA_EASE_MS = 1150
/** How long the scroll observer stays muted after the stepper starts a smooth scroll. */
const PROGRAMMATIC_SCROLL_MS = 700

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
}: {
  project: ProjectPackage
  scenes: ProjectSceneDef[]
  activeSceneIndex: number
  accent: string
  scrollRef: React.RefObject<HTMLDivElement>
  cardRefs: React.MutableRefObject<Array<HTMLElement | null>>
  onBack: () => void
  onSelectScene: (index: number) => void
}) {
  const progress = scenes.length > 0 ? ((activeSceneIndex + 1) / scenes.length) * 100 : 0

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
          <Button type="button" variant="outline" size="sm" onClick={() => downloadProjectPackage(project)}>
            <Download className="h-3.5 w-3.5" />
            JSON
          </Button>
        </div>

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

        <div className="mt-3 flex items-center gap-2">
          <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full transition-[width] duration-300"
              style={{ width: `${progress}%`, backgroundColor: accent }}
            />
          </div>
          <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
            {activeSceneIndex + 1}/{scenes.length}
          </span>
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
          {project.catalogMetrics.length > 0 && (
            <div className="mt-3 grid grid-cols-3 gap-2">
              {project.catalogMetrics.map((metric) => (
                <div key={metric.label} className="rounded border bg-background p-2 text-center">
                  <div className="text-sm font-bold text-foreground">{metric.value}</div>
                  <div className="text-xs text-muted-foreground">{metric.label}</div>
                </div>
              ))}
            </div>
          )}
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

          <div className="rounded-md border bg-muted/20 p-3">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Source note</div>
            <p className="text-xs leading-5 text-muted-foreground">{project.sourceNote}</p>
          </div>
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

  const mapRef = useRef<MapLibreGL.Map | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef<Array<HTMLElement | null>>([])
  const programmaticScrollUntilRef = useRef(0)

  const [activeSceneIndex, setActiveSceneIndex] = useState(0)
  const [visibleLayerIds, setVisibleLayerIds] = useState(
    () =>
      new Set(
        scenes[0]?.visibleLayerIds ?? project.layers.filter((layer) => layer.checked).map((layer) => layer.id),
      ),
  )
  const [sidebarWidth, setSidebarWidth] = useState(380)

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

  const legendEntries = useMemo(
    () => buildLegend(activeScene, resolvedLayers, visibleLayerIds, accent),
    [accent, activeScene, resolvedLayers, visibleLayerIds],
  )

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

  const applyScene = useCallback(
    (index: number) => {
      const scene = scenes[index]
      if (!scene) return
      setActiveSceneIndex(index)
      setVisibleLayerIds(new Set(scene.visibleLayerIds))

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

  // Scroll position drives the active scene; the card nearest the reading line wins.
  useEffect(() => {
    const root = scrollRef.current
    if (!root) return
    const observer = new IntersectionObserver(
      (entries) => {
        // A smooth scroll started by the stepper sweeps past intermediate cards.
        // Honouring those would drag the story back and fight rapid clicks.
        if (performance.now() < programmaticScrollUntilRef.current) return
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0]
        if (!visible) return
        const index = Number((visible.target as HTMLElement).dataset.sceneIndex)
        if (Number.isInteger(index)) applyScene(index)
      },
      { root, rootMargin: '-20% 0px -40% 0px', threshold: [0.25, 0.55, 0.8] },
    )
    cardRefs.current.forEach((card) => card && observer.observe(card))
    return () => observer.disconnect()
  }, [applyScene, scenes.length])

  const goToScene = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(scenes.length - 1, index))
      const smooth = !prefersReducedMotion()
      programmaticScrollUntilRef.current = performance.now() + (smooth ? PROGRAMMATIC_SCROLL_MS : 0)
      applyScene(clamped)
      cardRefs.current[clamped]?.scrollIntoView({
        behavior: smooth ? 'smooth' : 'auto',
        block: 'center',
      })
    },
    [applyScene, scenes.length],
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
        />
      }
      desktopSidebarWidth={sidebarWidth}
      onDesktopSidebarWidthChange={setSidebarWidth}
      mobileInitialSheetState="half"
      mobileCollapsedVisibleHeight={68}
      showMobilePeek
      mobilePeek={
        <div className="min-w-0 text-left">
          <div className="truncate text-xs font-semibold text-foreground">
            {activeScene?.title ?? project.title}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {activeSceneIndex + 1}/{scenes.length} · {activeScene?.focus ?? project.region}
          </div>
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

        {resolvedLayers.map((resolved) => (
          <MapFillLayer
            key={resolved.layer.id}
            data={resolved.layer.data}
            idProperty={resolved.layer.idProperty}
            fillColor={resolved.fillColor}
            fillOpacity={resolved.fillOpacity}
            lineColor={resolved.lineColor}
            lineOpacity={resolved.lineOpacity}
            lineWidth={resolved.lineWidth}
            visible={visibleLayerIds.has(resolved.layer.id)}
            hoverHtml={(properties) =>
              `<div class="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground shadow-md">
                <div class="font-semibold">${escapeHtml(properties[resolved.layer.labelProperty])}</div>
                <div class="mt-0.5 text-muted-foreground">${escapeHtml(resolved.label)}</div>
              </div>`
            }
          />
        ))}

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

      {/* Scene stepper — keyboard/pointer alternative to scrolling. */}
      <div className="pointer-events-none absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-background/95 p-1 shadow-lg backdrop-blur">
        <button
          type="button"
          onClick={() => goToScene(activeSceneIndex - 1)}
          disabled={activeSceneIndex === 0}
          aria-label="Previous scene"
          className="pointer-events-auto flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="pointer-events-auto max-w-[40vw] truncate px-1.5 text-xs font-medium text-foreground">
          {activeScene?.focus ?? project.region}
        </span>
        <button
          type="button"
          onClick={() => goToScene(activeSceneIndex + 1)}
          disabled={activeSceneIndex >= scenes.length - 1}
          aria-label="Next scene"
          className="pointer-events-auto flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <MapLegendPanel
        title="Map layers"
        description={activeScene?.label}
        icon={<Layers className="h-3.5 w-3.5" />}
        collapsible
        // Expanded, the panel would cover most of a phone-sized map.
        defaultCollapsed={isMobile}
        width="lg"
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
        <MapLegendSection
          title="Story layers"
          value={`${visibleLayerIds.size}/${config.layers.length}`}
          scroll={config.layers.length > 6}
        >
          {resolvedLayers.map((resolved) => (
            <LegendItem
              key={resolved.layer.id}
              // The fill reads as the layer's identity; outlines are often near-black.
              color={resolved.layer.fillColor}
              label={resolved.label}
              active={visibleLayerIds.has(resolved.layer.id)}
              swatchShape="square"
              onClick={() => toggleLayer(resolved.layer.id)}
            />
          ))}
        </MapLegendSection>

        {legendEntries.length > 0 && (
          <MapLegendSection title="Legend" columns={legendEntries.length > 5 ? 2 : 1}>
            {legendEntries.map((entry) => (
              <LegendItem key={entry.key} color={entry.color} label={entry.label} swatchShape="circle" />
            ))}
          </MapLegendSection>
        )}
      </MapLegendPanel>
    </MapSectionLayout>
  )
}
