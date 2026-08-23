import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type MapLibreGL from 'maplibre-gl'
import {
  ArrowDown,
  ArrowLeft,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Download,
  Hand,
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
import { Map, MapControls, MapMarker, MarkerContent, MarkerPopup } from '@/components/ui/map'
import { MapCircleLayer, MapFillLayer, MapPmtilesFillLayer } from '@/components/ui/map-layers'
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

/**
 * Single-line text that marquee-scrolls when it overflows its container,
 * instead of truncating. The strip holds two copies of the text so the
 * -50% keyframe loops seamlessly; the duration scales with text length.
 */
function TickerText({ text, className }: { text: string; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const [overflowing, setOverflowing] = useState(false)

  useLayoutEffect(() => {
    const container = containerRef.current
    const span = textRef.current
    if (!container || !span) return
    setOverflowing(span.scrollWidth > container.clientWidth + 1)
  }, [text])

  return (
    <div ref={containerRef} className={cn('overflow-hidden whitespace-nowrap', className)}>
      <div
        className={cn('inline-flex max-w-none', overflowing && 'story-peek-ticker')}
        style={overflowing ? { animationDuration: `${Math.max(6, text.length * 0.35)}s` } : undefined}
      >
        <span ref={textRef} className={cn(overflowing && 'pr-10')}>
          {text}
        </span>
        {overflowing && (
          <span aria-hidden="true" className="pr-10">
            {text}
          </span>
        )}
      </div>
    </div>
  )
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

                  <h2 className="mt-2 text-sm font-bold leading-snug text-foreground md:text-base">{scene.title}</h2>
                  <p className="mt-2 text-xs leading-6 text-muted-foreground md:text-sm md:leading-6">{scene.text}</p>

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
/* Alternate story layouts                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Mapbox/MapLibre storytelling-template layout: the map is a fullscreen
 * backdrop and chapter cards scroll over it, with scroll position driving the
 * active scene. Cards align left on wide screens and collapse to center on
 * phones, as the template does below its mobile breakpoint.
 *
 * On desktop the scroll layer only claims the pointer where a card actually
 * is, so the map behind stays pannable — the template does the same with
 * `pointer-events: none` on its story container. A wheel over the exposed map
 * is forwarded to the story scroller (and map scroll-zoom is switched off in
 * `ProjectStoryMap`), so scrolling still moves the story wherever the cursor
 * sits. Touch keeps the old full-layer capture: a phone has no wheel, and a
 * pass-through would hand every story swipe to the map.
 */
function ScrollyStory({
  project,
  scenes,
  activeSceneIndex,
  accent,
  onBack,
  onSelectScene,
  onStepScene,
  scrollRef,
  cardRefs,
  chrome,
  children,
}: {
  project: ProjectPackage
  scenes: ProjectSceneDef[]
  activeSceneIndex: number
  accent: string
  onBack: () => void
  onSelectScene: (index: number) => void
  onStepScene: (direction: number) => void
  scrollRef: React.RefObject<HTMLDivElement>
  cardRefs: React.MutableRefObject<Array<HTMLElement | null>>
  chrome: React.ReactNode
  children: React.ReactNode
}) {
  const progress = scenes.length > 0 ? ((activeSceneIndex + 1) / scenes.length) * 100 : 0
  const mapLayerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const layer = mapLayerRef.current
    if (!layer) return
    // Non-passive: the wheel belongs to the story, not to the page or the map.
    const onWheel = (event: WheelEvent) => {
      const scroller = scrollRef.current
      if (!scroller) return
      event.preventDefault()
      scroller.scrollTop += event.deltaY
    }
    layer.addEventListener('wheel', onWheel, { passive: false })
    return () => layer.removeEventListener('wheel', onWheel)
  }, [scrollRef])

  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      <div ref={mapLayerRef} className="absolute inset-0">{children}</div>

      <div
        ref={scrollRef}
        className="absolute inset-0 z-10 overflow-y-auto overscroll-contain md:pointer-events-none"
      >
        <header className="flex min-h-[55svh] items-end justify-center px-4 pb-[10svh] pt-24 md:justify-start md:pl-12">
          <div className="pointer-events-auto w-full max-w-md rounded-lg border bg-background/90 p-5 shadow-lg backdrop-blur md:max-w-lg md:p-6">
            <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: accent }}>
              Map story
            </div>
            <h1 className="mt-1 text-xl font-bold leading-tight text-foreground md:text-2xl">{project.title}</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground md:text-base md:leading-7">{project.summary}</p>
            <div className="mt-3 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              Scroll to move through the story
              <ArrowDown className="h-3.5 w-3.5" />
            </div>
          </div>
        </header>

        {scenes.map((scene, index) => {
          const active = index === activeSceneIndex
          return (
            <section
              key={`${scene.label}-${index}`}
              className="flex min-h-[85svh] items-center justify-center px-4 md:justify-start md:pl-12"
            >
              <article
                ref={(node) => {
                  cardRefs.current[index] = node
                }}
                data-scene-index={index}
                className={cn(
                  'pointer-events-auto w-full max-w-md transition-opacity duration-300 md:max-w-lg',
                  active ? 'opacity-100' : 'opacity-45',
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelectScene(index)}
                  aria-current={active ? 'step' : undefined}
                  className="w-full rounded-lg border bg-background/90 p-4 text-left shadow-lg backdrop-blur md:p-5"
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
                  <h2 className="mt-2 text-sm font-bold leading-snug text-foreground md:text-lg">{scene.title}</h2>
                  <p className="mt-2 text-xs leading-6 text-muted-foreground md:text-sm md:leading-7">{scene.text}</p>
                  {scene.callout && (
                    <div className="mt-3 rounded-md border bg-muted/30 p-2.5">
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {scene.callout.label}
                      </div>
                      <div className="mt-0.5 text-sm font-bold text-foreground md:text-base">{scene.callout.value}</div>
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
            </section>
          )
        })}

        <footer className="flex min-h-[45svh] items-start justify-center px-4 pb-[30svh] pt-10 md:justify-start md:pl-12">
          <div className="pointer-events-auto w-full max-w-md rounded-lg border bg-background/90 p-4 text-xs leading-5 text-muted-foreground shadow-lg backdrop-blur md:max-w-lg md:text-sm md:leading-6">
            {project.sourceNote}
          </div>
        </footer>
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-1 bg-muted/40">
        <div
          className="h-full transition-[width] duration-300"
          style={{ width: `${progress}%`, backgroundColor: accent }}
        />
      </div>
      <button
        type="button"
        onClick={onBack}
        className="absolute left-3 top-3 z-20 hidden h-8 items-center gap-2 rounded-md border bg-background/90 px-2.5 text-xs font-medium text-foreground shadow-sm backdrop-blur transition-colors hover:bg-muted md:inline-flex"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        All projects
      </button>
      {/* Long stories are a lot of wheel on a desktop screen; the stepper jumps
          a scene at a time without giving up the scroll-driven reading. */}
      <div className="absolute left-3 top-14 z-20 hidden items-center gap-1 rounded-md border bg-background/90 px-1 py-1 shadow-sm backdrop-blur md:flex">
        <button
          type="button"
          onClick={() => onStepScene(-1)}
          disabled={activeSceneIndex === 0}
          aria-label="Previous scene"
          className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="px-1 text-xs font-medium tabular-nums text-muted-foreground">
          {activeSceneIndex + 1}/{scenes.length}
        </span>
        <button
          type="button"
          onClick={() => onStepScene(1)}
          disabled={activeSceneIndex >= scenes.length - 1}
          aria-label="Next scene"
          className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      {/* The legend belongs on phones too — a choropleth story is unreadable
          without it. It sits in the corner the centered card lane leaves free
          and starts collapsed there, so it costs a pill-sized bite of map. */}
      <div className="pointer-events-none absolute inset-0 z-20">{chrome}</div>
    </div>
  )
}
/**
 * KnightLab StoryMapJS layout: map on top, a slide pane below with arrow
 * gutters at its edges, dot navigation, keyboard arrows, and horizontal
 * swipe on touch. Slides step discretely; the camera flies between them.
 *
 * The pane sizes itself to the story rather than to a fixed fraction of the
 * viewport: every slide is rendered stacked in one grid cell, so the cell is
 * as tall as the longest slide and the pane height never changes as the
 * reader steps (a pane that resized per slide would resize the map under it).
 * A cap keeps the map's share of the screen; past it the pane scrolls, and a
 * fade at its foot says so.
 */
function SlidesStory({
  project,
  scenes,
  activeSceneIndex,
  accent,
  swipeHint,
  onBack,
  onStepScene,
  onSelectScene,
  chrome,
  children,
}: {
  project: ProjectPackage
  scenes: ProjectSceneDef[]
  activeSceneIndex: number
  accent: string
  swipeHint: 'off' | 'fullscreen' | 'pane'
  onBack: () => void
  onStepScene: (direction: number) => void
  onSelectScene: (index: number) => void
  chrome: React.ReactNode
  children: React.ReactNode
}) {
  const isMobile = useIsMobile()
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const [swipeHintDismissed, setSwipeHintDismissed] = useState(false)
  const showSwipeHint = swipeHint !== 'off' && isMobile && !swipeHintDismissed

  const handleSwipe = useCallback(
    (start: { x: number; y: number } | null, touch: { clientX: number; clientY: number }) => {
      if (!start) return false
      const dx = touch.clientX - start.x
      const dy = touch.clientY - start.y
      // A mostly-horizontal swipe advances the slide; vertical stays a scroll.
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        onStepScene(dx < 0 ? 1 : -1)
        return true
      }
      return false
    },
    [onStepScene],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (event.key === 'ArrowRight') onStepScene(1)
      if (event.key === 'ArrowLeft') onStepScene(-1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onStepScene])

  const compactHint = swipeHint === 'pane'
  const swipeHintOverlay = showSwipeHint ? (
    <div
      role="dialog"
      aria-label="Swipe to navigate"
      className={cn(
        'absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/70 px-8 text-center',
        compactHint ? 'gap-3' : 'gap-4',
      )}
      onClick={() => setSwipeHintDismissed(true)}
      onTouchStart={(event) => {
        const touch = event.touches[0]
        touchStartRef.current = { x: touch.clientX, y: touch.clientY }
      }}
      onTouchEnd={(event) => {
        const start = touchStartRef.current
        touchStartRef.current = null
        // A swipe on the overlay both advances and dismisses; a plain tap
        // falls through to the click handler and just dismisses.
        handleSwipe(start, event.changedTouches[0])
        setSwipeHintDismissed(true)
      }}
    >
      <div className="flex items-center gap-4 text-white">
        <ChevronLeft className={cn('opacity-80', compactHint ? 'h-6 w-6' : 'h-8 w-8')} />
        <Hand className={compactHint ? 'h-10 w-10' : 'h-14 w-14'} />
        <ChevronRight className={cn('opacity-80', compactHint ? 'h-6 w-6' : 'h-8 w-8')} />
      </div>
      <div className={cn('font-semibold text-white', compactHint ? 'text-base' : 'text-xl')}>
        Swipe to navigate
      </div>
      <button
        type="button"
        onClick={() => setSwipeHintDismissed(true)}
        className={cn(
          'mt-1 rounded-md bg-white font-bold text-slate-900 shadow-lg transition-colors hover:bg-slate-100',
          compactHint ? 'px-8 py-1.5 text-xs' : 'px-10 py-2 text-sm',
        )}
      >
        OK
      </button>
    </div>
  ) : null

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="relative min-h-0 flex-1">
        {children}
        <button
          type="button"
          onClick={onBack}
          className="absolute left-3 top-3 z-20 hidden h-8 items-center gap-2 rounded-md border bg-background/90 px-2.5 text-xs font-medium text-foreground shadow-sm backdrop-blur transition-colors hover:bg-muted md:inline-flex"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All projects
        </button>
        <div className="pointer-events-none absolute inset-x-0 top-3 z-10 hidden justify-center md:flex">
          <div className="max-w-md truncate rounded-md border bg-background/90 px-3 py-1 text-xs font-semibold text-foreground shadow-sm backdrop-blur">
            {project.title}
          </div>
        </div>
        <div className="pointer-events-none absolute inset-0 z-20">{chrome}</div>
      </div>

      <div
        className="relative flex max-h-[58svh] shrink-0 flex-col border-t bg-background md:max-h-[58%]"
        onTouchStart={(event) => {
          const touch = event.touches[0]
          touchStartRef.current = { x: touch.clientX, y: touch.clientY }
        }}
        onTouchEnd={(event) => {
          const start = touchStartRef.current
          touchStartRef.current = null
          handleSwipe(start, event.changedTouches[0])
        }}
      >
        <button
          type="button"
          onClick={() => onStepScene(-1)}
          disabled={activeSceneIndex === 0}
          aria-label="Previous scene"
          className="absolute inset-y-0 left-0 z-10 flex w-10 items-center justify-center border-r bg-muted/20 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30 md:w-16"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
        <button
          type="button"
          onClick={() => onStepScene(1)}
          disabled={activeSceneIndex >= scenes.length - 1}
          aria-label="Next scene"
          className="absolute inset-y-0 right-0 z-10 flex w-10 items-center justify-center border-l bg-muted/20 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30 md:w-16"
        >
          <ChevronRight className="h-6 w-6" />
        </button>

        <div className="relative flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-12 py-4 md:px-24 md:py-6">
            {/* One grid cell, every slide stacked in it: the cell is as tall as
                the longest slide, so stepping never resizes the pane. */}
            <div className="mx-auto grid max-w-2xl">
              {scenes.map((slide, index) => (
                <div
                  key={`${slide.label}-${index}`}
                  aria-hidden={index !== activeSceneIndex}
                  className={cn(
                    'col-start-1 row-start-1 text-center',
                    index !== activeSceneIndex && 'invisible',
                  )}
                >
                  <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: accent }}>
                    {slide.kicker ?? slide.label}
                  </div>
                  <h2 className="mt-1 text-lg font-bold leading-snug text-foreground md:text-2xl">{slide.title}</h2>
                  {/* Left-aligned body: centred copy in a phone-width column
                      breaks into ragged two- and three-word lines. */}
                  <p className="mt-2 text-left text-sm leading-6 text-muted-foreground md:text-base md:leading-7">
                    {slide.text}
                  </p>
                  {slide.callout && (
                    <div className="mx-auto mt-3 max-w-md rounded-md border bg-muted/30 p-2.5 text-left">
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {slide.callout.label}
                      </div>
                      <div className="mt-0.5 text-sm font-bold text-foreground md:text-base">{slide.callout.value}</div>
                      {slide.callout.detail && (
                        <div className="mt-0.5 text-xs leading-5 text-muted-foreground">{slide.callout.detail}</div>
                      )}
                    </div>
                  )}
                  {slide.focus && (
                    <div className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5 shrink-0" style={{ color: accent }} />
                      <span>{slide.focus}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          {/* Fade at the foot of the pane: on a short viewport the tallest
              slide outgrows the cap, and nothing else says there is more. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-background to-transparent" />
        </div>

        <div className="flex items-center justify-center gap-2 border-t px-4 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2">
          {scenes.map((item, index) => (
            <button
              key={`${item.label}-${index}`}
              type="button"
              onClick={() => onSelectScene(index)}
              aria-label={`Go to scene ${index + 1}`}
              aria-current={index === activeSceneIndex ? 'step' : undefined}
              className="flex h-6 w-6 items-center justify-center"
            >
              <span
                className={cn(
                  'h-2 w-2 rounded-full transition-colors',
                  index === activeSceneIndex ? '' : 'bg-muted-foreground/30',
                )}
                style={index === activeSceneIndex ? { backgroundColor: accent } : undefined}
              />
            </button>
          ))}
          <span className="ml-1 text-xs tabular-nums text-muted-foreground">
            {activeSceneIndex + 1}/{scenes.length}
          </span>
        </div>

        {swipeHint === 'pane' && swipeHintOverlay}
      </div>

      {swipeHint === 'fullscreen' && swipeHintOverlay}
    </div>
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
  const options = config.options
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

  const attachMap = useCallback(
    (instance: MapLibreGL.Map | null) => {
      mapRef.current = instance
      // Scrolly hands the wheel to the story; a map that also zoomed on wheel
      // would fight it. Every other layout keeps the standard behaviour.
      if (instance) {
        if (options.layout === 'scrolly') instance.scrollZoom.disable()
        else instance.scrollZoom.enable()
      }
    },
    [options.layout],
  )

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
      const { sceneTransition, sceneTransitionMs } = options
      if (prefersReducedMotion() || sceneTransition === 'jump') map.jumpTo(camera)
      else if (sceneTransition === 'fly') map.flyTo({ ...camera, duration: sceneTransitionMs })
      else map.easeTo({ ...camera, duration: sceneTransitionMs })
    },
    [options, scenes],
  )

  // Scrolls only the narrative container. scrollIntoView would also scroll
  // every scrollable ancestor, which on mobile drags the page itself while the
  // sheet is collapsed and wrecks the fixed map layout.
  const scrollCardIntoCenter = useCallback((index: number, behavior: ScrollBehavior) => {
    const root = scrollRef.current
    const card = cardRefs.current[index]
    if (!root || !card) return
    const rootRect = root.getBoundingClientRect()
    const cardRect = card.getBoundingClientRect()
    const top = cardRect.top - rootRect.top + root.scrollTop - (root.clientHeight - cardRect.height) / 2
    root.scrollTo({ top: Math.max(0, top), behavior })
  }, [])

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
        scrollCardIntoCenter(target, 'auto')
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
  }, [applyScene, scrollCardIntoCenter])

  const goToScene = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(scenes.length - 1, index))
      const smooth = !prefersReducedMotion()
      pendingSceneRef.current = clamped
      programmaticScrollUntilRef.current = performance.now() + PROGRAMMATIC_SCROLL_MS
      applyScene(clamped, { force: true })
      scrollCardIntoCenter(clamped, smooth ? 'smooth' : 'auto')
    },
    [applyScene, scenes.length, scrollCardIntoCenter],
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

  const mapCanvas = (
    <>
      <Map
        ref={attachMap}
        className="h-full w-full"
        center={initialCamera.center}
        zoom={initialCamera.zoom}
        minZoom={config.map.minZoom}
        maxZoom={config.map.maxZoom}
        styles={mapStyles}
        // 'hidden' removes the zoom/compass controls. Scrolly keeps them on
        // desktop only, where the story layer lets the pointer through to the
        // map; on a phone the card lane covers the map and they would be dead
        // chrome over the story.
        controls={
          options.mapControls === 'hidden'
            ? null
            : options.layout === 'scrolly'
              ? <MapControls position="top-right" showZoom showCompass className="max-md:hidden" />
              : undefined
        }
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

          if (resolved.layer.format === 'pmtiles' && resolved.layer.sourceLayer) {
            return (
              <MapPmtilesFillLayer
                key={resolved.layer.id}
                url={resolved.layer.data}
                sourceLayer={resolved.layer.sourceLayer}
                idProperty={resolved.layer.idProperty}
                fillColor={resolved.fillColor}
                fillOpacity={resolved.fillOpacity}
                lineColor={resolved.lineColor}
                lineOpacity={resolved.lineOpacity}
                lineWidth={resolved.lineWidth}
                visible={visibleLayerIds.has(resolved.layer.id)}
                filter={resolved.filter}
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
    </>
  )

  const mapChrome = (
    <>
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
        // The scrolly/slides layouts hang the chrome in a pointer-events-none
        // overlay, so the panel re-enables its own pointer events. In slides
        // mode the phone-sized map pane keeps its zoom controls bottom-right,
        // so the legend moves to the opposite corner there.
        className={cn(
          'pointer-events-auto',
          options.layout === 'slides' && 'max-md:left-3 max-md:right-auto',
          // Scrolly's card lane spans a phone's full width, so the bottom
          // corners are card territory; the legend takes the top corner the
          // cards never reach, clear of the floating mobile toolbar.
          options.layout === 'scrolly' && 'max-md:bottom-auto max-md:top-16',
        )}
        collapsible
        width="fit"
        // 'auto' collapses on mobile, where the expanded panel would cover
        // most of a phone-sized map.
        defaultCollapsed={options.legendCollapsed === 'auto' ? isMobile : options.legendCollapsed === 'always'}
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
    </>
  )

  if (options.layout === 'scrolly') {
    return (
      <ScrollyStory
        project={project}
        scenes={scenes}
        activeSceneIndex={activeSceneIndex}
        accent={accent}
        onBack={onBack}
        onSelectScene={goToScene}
        onStepScene={stepScene}
        scrollRef={scrollRef}
        cardRefs={cardRefs}
        chrome={mapChrome}
      >
        {mapCanvas}
      </ScrollyStory>
    )
  }

  if (options.layout === 'slides') {
    return (
      <SlidesStory
        project={project}
        scenes={scenes}
        activeSceneIndex={activeSceneIndex}
        accent={accent}
        swipeHint={options.slidesSwipeHint}
        onBack={onBack}
        onStepScene={stepScene}
        onSelectScene={goToScene}
        chrome={mapChrome}
      >
        {mapCanvas}
      </SlidesStory>
    )
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
      mobileInitialSheetState={options.mobileSheet}
      showMobileSheetChevron={!options.mobilePeekTicker}
      mobileCollapsedVisibleHeight={options.mobilePeekSceneText ? 128 : 68}
      showMobilePeek
      mobilePeek={
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <div className="min-w-0 flex-1 text-left">
              {options.mobilePeekTicker ? (
                <TickerText
                  key={activeSceneIndex}
                  text={activeScene?.title ?? project.title}
                  className="text-xs font-semibold text-foreground"
                />
              ) : (
                <div className="truncate text-xs font-semibold text-foreground">
                  {activeScene?.title ?? project.title}
                </div>
              )}
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
          {options.mobilePeekSceneText && activeScene?.text && (
            <p className="mt-1.5 line-clamp-3 text-xs leading-5 text-muted-foreground">{activeScene.text}</p>
          )}
        </div>
      }
    >
      {mapCanvas}
      {mapChrome}
    </MapSectionLayout>
  )
}
