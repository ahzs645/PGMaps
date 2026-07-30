import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  BookOpen,
  Check,
  Download,
  Eye,
  EyeOff,
  Layers,
  MapPin,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Map, MapControls, MapMarker, MarkerContent, MarkerPopup } from '@/components/ui/map'
import { MapFillLayer } from '@/components/ui/map-layers'
import { MAP_STYLES } from '@/components/ui/map-styles'
import { cn } from '@/lib/utils'
import {
  downloadProjectPackage,
  type ProjectPackage,
  type ProjectStoryLayerDef,
  type ProjectStoryWorkspaceDef,
} from '@/lib/projectPackages'

type Viewport = {
  center: [number, number]
  zoom: number
  bearing: number
  pitch: number
}

const STORY_MAP_STYLES = {
  light: MAP_STYLES.light,
  dark: MAP_STYLES.light,
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function layerFillColor(layer: ProjectStoryLayerDef) {
  if (!layer.category) return layer.fillColor
  const matches = Object.entries(layer.category.colors).flatMap(([value, color]) => [value, color])
  return ['match', ['get', layer.category.property], ...matches, layer.category.fallback]
}

function sceneViewport(
  workspace: ProjectStoryWorkspaceDef,
  scene: ProjectPackage['scenes'][number] | undefined,
): Viewport {
  return {
    center: scene?.camera?.center ?? workspace.map.center,
    zoom: scene?.camera?.zoom ?? workspace.map.zoom,
    bearing: scene?.camera?.bearing ?? 0,
    pitch: scene?.camera?.pitch ?? 0,
  }
}

function LayerLegend({
  project,
  workspace,
  visibleLayerIds,
  onToggle,
  onClose,
}: {
  project: ProjectPackage
  workspace: ProjectStoryWorkspaceDef
  visibleLayerIds: Set<string>
  onToggle: (layerId: string) => void
  onClose: () => void
}) {
  return (
    <aside className="absolute left-3 top-3 z-20 w-[min(19rem,calc(100%-1.5rem))] overflow-hidden rounded-xl border border-slate-200/90 bg-white/95 shadow-xl backdrop-blur dark:border-slate-700 dark:bg-slate-950/95">
      <div className="flex items-center justify-between border-b px-3 py-2.5">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Story layers</div>
          <div className="mt-0.5 text-xs text-slate-500">Scene changes remain editable</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          aria-label="Close layer panel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="max-h-[min(32rem,calc(100vh-10rem))] overflow-y-auto p-2">
        {workspace.layers.map((layer) => {
          const definition = project.layers.find((item) => item.id === layer.id)
          const visible = visibleLayerIds.has(layer.id)
          return (
            <button
              key={layer.id}
              type="button"
              onClick={() => onToggle(layer.id)}
              className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-pressed={visible}
            >
              <span
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border"
                style={{
                  borderColor: visible ? layer.lineColor : '#cbd5e1',
                  backgroundColor: visible ? layer.fillColor : 'transparent',
                }}
              >
                {visible && <Check className="h-3 w-3 text-white drop-shadow" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {definition?.label ?? layer.id}
                </span>
                {layer.category ? (
                  <span className="mt-1 flex flex-wrap gap-x-2 gap-y-1">
                    {Object.entries(layer.category.colors).map(([label, color]) => (
                      <span key={label} className="inline-flex items-center gap-1 text-[10px] text-slate-500">
                        <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: color }} />
                        {label}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="block text-[11px] text-slate-500">{layer.attribution ?? 'GeoJSON layer'}</span>
                )}
              </span>
              {visible ? (
                <Eye className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
              ) : (
                <EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              )}
            </button>
          )
        })}
      </div>
    </aside>
  )
}

export function ProjectStoryMap({
  project,
  config,
  onBack,
}: {
  project: ProjectPackage
  config: ProjectStoryWorkspaceDef
  onBack: () => void
}) {
  const narrativeRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef<Array<HTMLElement | null>>([])
  const [activeSceneIndex, setActiveSceneIndex] = useState(0)
  const [layerPanelOpen, setLayerPanelOpen] = useState(false)
  const [visibleLayerIds, setVisibleLayerIds] = useState(
    () => new Set(project.scenes[0]?.visibleLayerIds ?? project.layers.filter((layer) => layer.checked).map((layer) => layer.id)),
  )
  const [viewport, setViewport] = useState<Viewport>(() => sceneViewport(config, project.scenes[0]))

  const activeScene = project.scenes[activeSceneIndex]
  const activePlaces = (() => {
    if (!activeScene?.placeIds) return []
    const ids = new Set(activeScene.placeIds)
    return config.places.filter((place) => ids.has(place.id))
  })()

  const applyScene = useCallback((index: number) => {
    const scene = project.scenes[index]
    if (!scene) return
    setActiveSceneIndex(index)
    setVisibleLayerIds(new Set(scene.visibleLayerIds))
    setViewport(sceneViewport(config, scene))
  }, [config, project.scenes])

  useEffect(() => {
    const root = narrativeRef.current
    if (!root) return
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0]
        if (!visible) return
        const index = Number((visible.target as HTMLElement).dataset.sceneIndex)
        if (Number.isInteger(index)) applyScene(index)
      },
      { root, rootMargin: '-22% 0px -38% 0px', threshold: [0.25, 0.55, 0.8] },
    )
    cardRefs.current.forEach((card) => card && observer.observe(card))
    return () => observer.disconnect()
  }, [applyScene, project.scenes.length])

  function selectScene(index: number) {
    applyScene(index)
    cardRefs.current[index]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  function toggleLayer(layerId: string) {
    setVisibleLayerIds((current) => {
      const next = new Set(current)
      if (next.has(layerId)) next.delete(layerId)
      else next.add(layerId)
      return next
    })
  }

  return (
    <div className="grid h-full min-h-0 bg-slate-950 md:grid-cols-[minmax(22rem,42%)_minmax(0,1fr)]">
      <section className="order-2 flex min-h-0 flex-col bg-[#f4f1e9] text-slate-950 md:order-1">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-900/10 bg-[#f4f1e9]/95 px-4 py-3 backdrop-blur sm:px-6">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex h-9 items-center gap-2 rounded-full border border-slate-900/15 bg-white/70 px-3 text-xs font-bold transition-colors hover:bg-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Projects
          </button>
          <div className="flex items-center gap-2">
            <span className="hidden text-xs font-semibold text-slate-500 sm:block">
              {activeSceneIndex + 1} / {project.scenes.length}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 rounded-full border-slate-900/15 bg-white/70 text-xs hover:bg-white"
              onClick={() => downloadProjectPackage(project)}
            >
              <Download className="h-3.5 w-3.5" />
              JSON
            </Button>
          </div>
        </div>

        <div ref={narrativeRef} className="min-h-0 flex-1 snap-y snap-proximity overflow-y-auto scroll-smooth">
          <header className="flex min-h-[min(38rem,82vh)] flex-col justify-end px-5 pb-12 pt-10 sm:px-8">
            <div className="mb-auto flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-emerald-800">
              <BookOpen className="h-4 w-4" />
              PGMaps boundary story
            </div>
            <p className="mb-4 max-w-lg font-serif text-lg italic leading-7 text-slate-600">
              One province. Several official answers.
            </p>
            <h1 className="max-w-xl font-serif text-4xl font-semibold leading-[0.98] tracking-tight sm:text-6xl">
              {project.title}
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-slate-700">{project.summary}</p>
            <div className="mt-8 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
              Scroll to compare
              <ArrowDown className="h-4 w-4 animate-bounce" />
            </div>
          </header>

          <div className="space-y-[18vh] px-4 pb-[36vh] sm:px-7">
            {project.scenes.map((scene, index) => (
              <article
                key={`${scene.label}-${index}`}
                ref={(node) => {
                  cardRefs.current[index] = node
                }}
                data-scene-index={index}
                className="snap-center scroll-m-8"
              >
                <button
                  type="button"
                  onClick={() => selectScene(index)}
                  className={cn(
                    'w-full rounded-2xl border bg-white/92 p-5 text-left shadow-[0_18px_60px_rgba(15,23,42,0.10)] transition-all sm:p-7',
                    index === activeSceneIndex
                      ? 'border-emerald-700/40 ring-1 ring-emerald-700/20'
                      : 'border-slate-900/10 opacity-75 hover:opacity-100',
                  )}
                  aria-current={index === activeSceneIndex ? 'step' : undefined}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[11px] font-black uppercase tracking-[0.18em] text-emerald-800">
                      {scene.kicker ?? scene.label}
                    </span>
                    <span className="font-mono text-xs text-slate-400">{String(index + 1).padStart(2, '0')}</span>
                  </div>
                  <h2 className="mt-4 font-serif text-2xl font-semibold leading-tight sm:text-3xl">{scene.title}</h2>
                  <p className="mt-4 text-sm leading-7 text-slate-600 sm:text-base">{scene.text}</p>
                  <div className="mt-5 flex items-center gap-2 border-t border-slate-900/10 pt-4 text-xs font-semibold text-slate-500">
                    <MapPin className="h-3.5 w-3.5 text-emerald-700" />
                    {scene.focus}
                  </div>
                </button>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="relative order-1 h-[46dvh] min-h-64 overflow-hidden bg-slate-200 md:order-2 md:h-full">
        <Map
          className="h-full w-full"
          viewport={viewport}
          onViewportChange={setViewport}
          minZoom={config.map.minZoom}
          maxZoom={config.map.maxZoom}
          styles={STORY_MAP_STYLES}
          showStyleLoadingOverlay={false}
        >
          <MapControls position="top-right" mobilePosition="bottom-right" showZoom showCompass />

          {config.layers.map((layer) => (
            <MapFillLayer
              key={layer.id}
              data={layer.data}
              idProperty={layer.idProperty}
              fillColor={layerFillColor(layer)}
              fillOpacity={layer.fillOpacity}
              lineColor={layer.lineColor}
              lineOpacity={layer.lineOpacity}
              lineWidth={layer.lineWidth}
              visible={visibleLayerIds.has(layer.id)}
              hoverHtml={(properties) => (
                `<div class="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 shadow-lg">
                  <div class="font-semibold">${escapeHtml(properties[layer.labelProperty])}</div>
                  <div class="mt-1 text-slate-500">${escapeHtml(project.layers.find((item) => item.id === layer.id)?.label ?? layer.id)}</div>
                </div>`
              )}
            />
          ))}

          {activePlaces.map((place) => (
            <MapMarker
              key={place.id}
              longitude={place.coordinates[0]}
              latitude={place.coordinates[1]}
              anchor="bottom"
            >
              <MarkerContent>
                <div className="group flex flex-col items-center">
                  <div className="mb-1 whitespace-nowrap rounded-md bg-slate-950 px-2 py-1 text-[11px] font-bold text-white shadow-lg">
                    {place.label}
                  </div>
                  <div
                    className="h-4 w-4 rounded-full border-[3px] border-white shadow-lg ring-1 ring-slate-900/20"
                    style={{ backgroundColor: place.color ?? '#047857' }}
                  />
                </div>
              </MarkerContent>
              <MarkerPopup closeButton>
                <div className="w-52">
                  <div className="text-sm font-bold">{place.label}</div>
                  {place.note && <p className="mt-1 text-xs leading-5 text-muted-foreground">{place.note}</p>}
                </div>
              </MarkerPopup>
            </MapMarker>
          ))}
        </Map>

        <div className="absolute bottom-3 left-3 z-20 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setLayerPanelOpen((current) => !current)}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-white/70 bg-slate-950/90 px-4 text-xs font-bold text-white shadow-lg backdrop-blur transition-colors hover:bg-slate-900"
            aria-expanded={layerPanelOpen}
          >
            <Layers className="h-4 w-4" />
            Layers
            <span className="rounded-full bg-white/15 px-1.5 py-0.5">{visibleLayerIds.size}</span>
          </button>
          <div className="hidden max-w-64 truncate rounded-full border border-white/70 bg-white/90 px-3 py-2 text-xs font-semibold text-slate-700 shadow-lg backdrop-blur sm:block">
            {activeScene?.focus ?? project.region}
          </div>
        </div>

        {layerPanelOpen && (
          <LayerLegend
            project={project}
            workspace={config}
            visibleLayerIds={visibleLayerIds}
            onToggle={toggleLayer}
            onClose={() => setLayerPanelOpen(false)}
          />
        )}
      </section>
    </div>
  )
}
