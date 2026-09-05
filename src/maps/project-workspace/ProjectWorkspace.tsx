import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  Eye,
  EyeOff,
  FileText,
  FolderKanban,
  FolderOpen,
  Layers,
  Map as MapIcon,
  PanelRight,
  Settings2,
  SlidersHorizontal,
} from 'lucide-react'
import { lazy, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import {
  DESKTOP_SIDEBAR_MAX_WIDTH,
  DESKTOP_SIDEBAR_MIN_WIDTH,
  MapSectionLayout,
} from '@/components/layout/MapSectionLayout'
import { Button } from '@/components/ui/button'
import { MapMarker, MarkerContent, MarkerTooltip, Map as PgMap } from '@/components/ui/map'
import { MapFillLayer, MapRasterLayer } from '@/components/ui/map-layers'
import { LegendItem, MapGradientLegendItem, MapLegendPanel } from '@/components/ui/map-panels'
import { Slider } from '@/components/ui/slider'
import { useIsMobile } from '@/hooks/useIsMobile'
import { fetchJson } from '@/lib/fetchJson'
import {
  buildProjectLabUrl,
  projectRecipeBars,
  type ProjectLayerDef,
  type ProjectPackage,
  type ProjectPortalContextLayerDef,
  type ProjectPortalMapDef,
  type ProjectPortalRasterLayerDef,
} from '@/lib/projectPackages'
import { useLoadedProjectWebMCP } from '@/lib/projectWebMCP'
import { cn } from '@/lib/utils'
const ProjectMapExplorer = lazy(() =>
  import('@/maps/project-explorer/ProjectMapExplorer').then((m) => ({ default: m.ProjectMapExplorer })),
)
const ProjectStoryMap = lazy(() =>
  import('@/maps/project-story/ProjectStoryMap').then((m) => ({ default: m.ProjectStoryMap })),
)
const ProjectScoreMapPreview = lazy(() =>
  import('@/maps/scorebuilder/ProjectScoreMapPreview').then((m) => ({ default: m.ProjectScoreMapPreview })),
)

import { KIND_LABELS, iconClass } from './projectPresentation'
type ControllerTab = 'layers' | 'project'
const TAB_LABELS: Record<ControllerTab, string> = {
  layers: 'Layers',
  project: 'Project',
}

const HEALTH_AUTHORITY_BOUNDARIES_URL = '/data/boundaries/BCMoH/simplified/health_authorities.json'
const NORTHERN_HEALTH_FILTER = ['==', ['get', 'HLTH_AUTHORITY_NAME'], 'Northern']

function buildPortalWmsTileUrl(portal: ProjectPortalMapDef, layerName: string, mapPath?: string) {
  return [
    `${portal.endpoint}?MAP=${encodeURIComponent(mapPath ?? portal.defaultMapPath)}`,
    'SERVICE=WMS',
    'VERSION=1.1.1',
    'REQUEST=GetMap',
    `LAYERS=${encodeURIComponent(layerName)}`,
    'STYLES=',
    'FORMAT=image/png',
    'TRANSPARENT=TRUE',
    'SRS=EPSG:3857',
    'WIDTH=256',
    'HEIGHT=256',
    'BBOX={bbox-epsg-3857}',
  ].join('&')
}

function buildPortalWmsLegendUrl(portal: ProjectPortalMapDef, layerName: string, mapPath?: string) {
  const params = new URLSearchParams({
    MAP: mapPath ?? portal.defaultMapPath,
    SERVICE: 'WMS',
    VERSION: '1.1.1',
    REQUEST: 'GetLegendGraphic',
    LAYER: layerName,
    FORMAT: 'image/png',
    STYLE: 'default',
  })
  return `${portal.endpoint}?${params.toString()}`
}

function defaultVisibleLayerIds(project: ProjectPackage) {
  return new Set(project.layers.filter((layer) => layer.checked).map((layer) => layer.id))
}

function ProjectPortalPointLayer({ layer }: { layer: ProjectPortalContextLayerDef }) {
  const [collection, setCollection] = useState<GeoJSON.FeatureCollection<GeoJSON.Point> | null>(null)

  useEffect(() => {
    if (!layer.data) return
    const controller = new AbortController()
    fetchJson<GeoJSON.FeatureCollection<GeoJSON.Point>>(layer.data, controller.signal)
      .then(setCollection)
      .catch(() => setCollection(null))
    return () => controller.abort()
  }, [layer.data])

  if (!collection) return null

  return collection.features.map((feature, index) => {
    const [longitude, latitude] = feature.geometry.coordinates
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null
    const properties = feature.properties ?? {}
    const label = String(properties[layer.labelProperty ?? 'name'] ?? 'Hospital')
    const key = String(properties[layer.idProperty ?? 'id'] ?? feature.id ?? index)

    return (
      <MapMarker key={key} longitude={longitude} latitude={latitude} anchor="center">
        <MarkerContent>
          <div className="flex size-8 items-center justify-center drop-shadow-md" aria-label={label}>
            <img src={layer.icon} alt="" className="size-8" />
          </div>
        </MarkerContent>
        <MarkerTooltip className="px-2 py-1 text-xs font-semibold">{label}</MarkerTooltip>
      </MapMarker>
    )
  })
}

function layerIcon(layer: ProjectLayerDef) {
  if (layer.type === 'raster') return <MapIcon className="h-3.5 w-3.5" />
  if (layer.type === 'boundary') return <PanelRight className="h-3.5 w-3.5" />
  if (layer.type === 'point') return <FolderOpen className="h-3.5 w-3.5" />
  if (layer.type === 'line') return <SlidersHorizontal className="h-3.5 w-3.5" />
  return <Layers className="h-3.5 w-3.5" />
}

function ProjectPortalMapPreview({
  project,
  portal,
  visibleLayerIds,
  rasterOpacity,
  className,
}: {
  project: ProjectPackage
  portal: ProjectPortalMapDef
  visibleLayerIds: Set<string>
  rasterOpacity: number
  className?: string
}) {
  const activeRasterLayers = portal.rasterLayers.filter((layer) => visibleLayerIds.has(layer.id))
  const activeContextLayers = portal.contextLayers.filter((layer) => visibleLayerIds.has(layer.id))
  const activeRasterLayer = activeRasterLayers[activeRasterLayers.length - 1] ?? null
  const showLocalBoundary = Boolean(portal.localBoundaryLayerId) && visibleLayerIds.has(portal.localBoundaryLayerId!)

  return (
    <div className={cn('relative overflow-hidden bg-slate-100 dark:bg-slate-950', className)}>
      <PgMap
        className="h-full w-full"
        center={portal.center}
        zoom={portal.zoom}
        minZoom={3}
        maxZoom={11}
        showStyleLoadingOverlay={false}
      >
        {activeRasterLayers.map((layer) => (
          <MapRasterLayer
            key={layer.id}
            tiles={[buildPortalWmsTileUrl(portal, layer.layerName, layer.mapPath)]}
            opacity={rasterOpacity / 100}
            tileSize={256}
            minZoom={3}
            maxZoom={11}
            attribution="Nechako Watershed Portal, ClimateData.ca"
          />
        ))}

        {activeContextLayers.map((layer) =>
          layer.data && layer.geometry === 'point' ? (
            <ProjectPortalPointLayer key={`${layer.id}-${layer.layerName}`} layer={layer} />
          ) : layer.data ? (
            <MapFillLayer
              key={`${layer.id}-${layer.layerName}`}
              data={layer.data}
              idProperty={layer.idProperty}
              filter={
                layer.featureProperty && layer.featureValue !== undefined
                  ? ['==', ['get', layer.featureProperty], layer.featureValue]
                  : undefined
              }
              fillColor={layer.legendColor}
              fillOpacity={layer.fillOpacity ?? layer.opacity}
              lineColor={layer.lineColor ?? layer.legendColor}
              lineOpacity={layer.lineOpacity ?? 1}
              lineWidth={layer.lineWidth ?? 1.5}
            />
          ) : (
            <MapRasterLayer
              key={`${layer.id}-${layer.layerName}`}
              tiles={[buildPortalWmsTileUrl(portal, layer.layerName, layer.mapPath)]}
              opacity={layer.opacity}
              tileSize={256}
              minZoom={3}
              maxZoom={12}
              attribution="Nechako Watershed Portal"
            />
          ),
        )}

        {showLocalBoundary && (
          <MapFillLayer
            data={HEALTH_AUTHORITY_BOUNDARIES_URL}
            filter={NORTHERN_HEALTH_FILTER}
            fillColor="#06b6d4"
            fillOpacity={0.07}
            lineColor="#0f172a"
            lineWidth={1.5}
            lineOpacity={0.68}
          />
        )}

        <ProjectPortalMapLegend
          project={project}
          portal={portal}
          visibleLayerIds={visibleLayerIds}
          activeRasterLayer={activeRasterLayer}
        />
      </PgMap>
    </div>
  )
}

function ProjectPortalMapLegend({
  project,
  portal,
  visibleLayerIds,
  activeRasterLayer,
}: {
  project: ProjectPackage
  portal: ProjectPortalMapDef
  visibleLayerIds: Set<string>
  activeRasterLayer: ProjectPortalRasterLayerDef | null
}) {
  const isMobile = useIsMobile()
  const activeRasterLabel = activeRasterLayer
    ? (project.layers.find((layer) => layer.id === activeRasterLayer.id)?.label ?? activeRasterLayer.layerName)
    : null
  const showLocalBoundary = Boolean(portal.localBoundaryLayerId) && visibleLayerIds.has(portal.localBoundaryLayerId!)
  const activeContextLayers = portal.contextLayers.filter((layer) => visibleLayerIds.has(layer.id))

  return (
    <MapLegendPanel
      title="Legend"
      width="sm"
      collapsible
      defaultCollapsed={isMobile}
      className="max-h-[min(28rem,calc(100%-2rem))] overflow-auto"
    >
      <div className="space-y-3">
        {activeRasterLayer ? (
          <div>
            <div className="mb-1 text-xs font-semibold text-foreground">{activeRasterLabel}</div>
            <img
              src={buildPortalWmsLegendUrl(portal, activeRasterLayer.layerName, activeRasterLayer.mapPath)}
              alt={`${activeRasterLabel} legend`}
              className="max-h-24 w-full rounded border bg-white object-contain p-1"
            />
            <div className="mt-1 text-xs leading-snug text-muted-foreground">
              Portal WMS raster, ClimateData.ca source layer.
            </div>
          </div>
        ) : (
          <div>
            <div className="mb-1 text-xs font-semibold text-foreground">{KIND_LABELS[project.kind]}</div>
            <MapGradientLegendItem
              colors={project.legend.map((item) => item.color)}
              minLabel={project.legend[0]?.label ?? 'Lower'}
              maxLabel={project.legend[project.legend.length - 1]?.label ?? 'Higher'}
            />
          </div>
        )}

        <div className="space-y-1 border-t pt-2 text-xs">
          {showLocalBoundary && (
            <LegendItem color="#0f172a" label="Northern Health" value="local BCMoH" swatchShape="line" />
          )}
          {activeContextLayers.map((layer) => (
            <LegendItem
              key={`${layer.id}-${layer.layerName}`}
              color={layer.legendColor}
              label={layer.legendLabel}
              swatchShape={layer.legendShape}
              swatch={layer.icon ? <img src={layer.icon} alt="" className="size-4" aria-hidden="true" /> : undefined}
            />
          ))}
          {!showLocalBoundary && activeContextLayers.length === 0 && (
            <div className="text-xs leading-snug text-muted-foreground">Toggle layers to update the map stack.</div>
          )}
        </div>
      </div>
    </MapLegendPanel>
  )
}

function ProjectWorkspaceMap({
  project,
  visibleLayerIds,
  rasterOpacity,
  className,
}: {
  project: ProjectPackage
  visibleLayerIds: Set<string>
  rasterOpacity: number
  className?: string
}) {
  if (project.portalMap) {
    return (
      <ProjectPortalMapPreview
        project={project}
        portal={project.portalMap}
        visibleLayerIds={visibleLayerIds}
        rasterOpacity={rasterOpacity}
        className={className}
      />
    )
  }

  if (project.lab) {
    const showScoreSurface = project.layers.some((layer) => layer.role === 'score' && visibleLayerIds.has(layer.id))
    const showPoints = project.layers.some((layer) => layer.role === 'points' && visibleLayerIds.has(layer.id))
    return (
      <ProjectScoreMapPreview
        project={project}
        showScoreSurface={showScoreSurface}
        showPoints={showPoints}
        className={className}
      />
    )
  }

  return (
    <div className={cn('flex items-center justify-center bg-muted/30 text-sm text-muted-foreground', className)}>
      This package has no map recipe.
    </div>
  )
}

function LayerToggle({ layer, visible, onToggle }: { layer: ProjectLayerDef; visible: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={layer.locked}
      className="flex w-full items-center gap-3 rounded-md border bg-background px-3 py-2 text-left transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-70"
    >
      <span
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded border',
          visible ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-muted',
        )}
      >
        {visible && <Check className="h-3.5 w-3.5" />}
      </span>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        {layerIcon(layer)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{layer.label}</span>
        <span className="block text-xs capitalize text-muted-foreground">{layer.type}</span>
      </span>
      {visible ? (
        <Eye className="h-4 w-4 text-muted-foreground" />
      ) : (
        <EyeOff className="h-4 w-4 text-muted-foreground" />
      )}
    </button>
  )
}

function ProjectController({
  project,
  activeTab,
  onTabChange,
  visibleLayerIds,
  onLayerToggle,
  rasterOpacity,
  onRasterOpacityChange,
  className,
}: {
  project: ProjectPackage
  activeTab: ControllerTab
  onTabChange: (tab: ControllerTab) => void
  visibleLayerIds: Set<string>
  onLayerToggle: (layerId: string) => void
  rasterOpacity: number
  onRasterOpacityChange: (value: number) => void
  className?: string
}) {
  const recipeBars = projectRecipeBars(project)

  return (
    <aside className={cn('flex min-h-0 flex-col rounded-lg border bg-card shadow-sm', className)}>
      <div className="border-b p-3">
        <div className="grid grid-cols-2 rounded-md bg-muted p-1">
          {(Object.keys(TAB_LABELS) as ControllerTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => onTabChange(tab)}
              className={cn(
                'h-8 rounded text-xs font-semibold transition-colors',
                activeTab === tab
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {activeTab === 'layers' && (
          <div className="space-y-4">
            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-foreground">Map Stack</div>
                <span className="text-xs text-muted-foreground">
                  {visibleLayerIds.size}/{project.layers.length}
                </span>
              </div>
              <div className="space-y-2">
                {project.layers.map((layer) => (
                  <LayerToggle
                    key={layer.id}
                    layer={layer}
                    visible={visibleLayerIds.has(layer.id)}
                    onToggle={() => onLayerToggle(layer.id)}
                  />
                ))}
              </div>
            </div>

            {project.portalMap && (
              <div className="rounded-lg border bg-background p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-foreground">Raster Opacity</div>
                  <div className="text-xs font-medium text-muted-foreground">{rasterOpacity}%</div>
                </div>
                <Slider
                  value={[rasterOpacity]}
                  min={20}
                  max={100}
                  step={5}
                  onValueChange={(value) => onRasterOpacityChange(value[0] ?? rasterOpacity)}
                  aria-label="Raster opacity"
                />
              </div>
            )}
          </div>
        )}

        {activeTab === 'project' && (
          <div className="space-y-4">
            {recipeBars.length > 0 && (
              <div>
                <div className="mb-2 text-sm font-semibold text-foreground">Recipe</div>
                <div className="space-y-2">
                  {recipeBars.map((item) => (
                    <div key={item.label} className="rounded-md border bg-background p-2.5">
                      <div className="mb-1.5 flex items-center justify-between gap-3">
                        <span className="truncate text-xs font-medium text-foreground">{item.label}</span>
                        <span className="text-xs font-semibold text-muted-foreground">
                          {item.value > 0 ? '+' : ''}
                          {item.value}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn('h-full rounded-full', item.tone)}
                          style={{ width: `${Math.max(8, Math.min(100, Math.abs(item.value)))}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="mb-2 text-sm font-semibold text-foreground">Project Files</div>
              <div className="space-y-2">
                {project.files.map((file) => (
                  <div key={file.label} className="flex items-start gap-3 rounded-md border bg-background px-3 py-2">
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">{file.label}</div>
                      <div className="text-xs leading-5 text-muted-foreground">{file.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}

function clampPanelWidth(width: number, fallback: number) {
  if (!Number.isFinite(width)) return fallback
  return Math.min(DESKTOP_SIDEBAR_MAX_WIDTH, Math.max(DESKTOP_SIDEBAR_MIN_WIDTH, Math.round(width)))
}

function LoadedProjectWorkspace({ project, onBack }: { project: ProjectPackage; onBack: () => void }) {
  const isMobile = useIsMobile()
  const [activeTab, setActiveTab] = useState<ControllerTab>('project')
  const [activeSceneIndex, setActiveSceneIndex] = useState(0)
  const [rasterOpacity, setRasterOpacity] = useState(82)
  const [visibleLayerIds, setVisibleLayerIds] = useState<Set<string>>(() => defaultVisibleLayerIds(project))
  const [showRightSidebar, setShowRightSidebar] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(() => clampPanelWidth(320, 320))
  const [rightSidebarWidth, setRightSidebarWidth] = useState(() => clampPanelWidth(360, 360))

  const activeScene = project.scenes[activeSceneIndex] ?? project.scenes[0]
  const labUrl = buildProjectLabUrl(project)

  function applyScene(index: number) {
    const scene = project.scenes[index]
    if (!scene) return
    setActiveSceneIndex(index)
    setVisibleLayerIds(new Set(scene.visibleLayerIds))
  }

  function setLayerVisibility(layerId: string, action: 'show' | 'hide' | 'toggle') {
    const layer = project.layers.find((item) => item.id === layerId)
    if (!layer || layer.locked) return
    setVisibleLayerIds((current) => {
      const next = new Set(current)
      if (action === 'show') next.add(layerId)
      else if (action === 'hide') next.delete(layerId)
      else if (next.has(layerId)) next.delete(layerId)
      else next.add(layerId)
      return next
    })
  }

  function toggleLayer(layerId: string) {
    setLayerVisibility(layerId, 'toggle')
  }

  useLoadedProjectWebMCP({
    project,
    activeSceneIndex,
    visibleLayerIds,
    rasterOpacity,
    applyScene,
    setLayerVisibility,
    setRasterOpacity,
  })

  const leftSidebar = (
    <aside className="flex h-full min-h-0 flex-col border-r bg-background">
      <div className="border-b p-3">
        <button
          type="button"
          onClick={onBack}
          className="mb-3 inline-flex h-8 items-center gap-2 rounded-md border bg-background px-2.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All projects
        </button>

        <div className="flex items-start gap-3">
          <div
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-white',
              iconClass(project),
            )}
          >
            <FolderKanban className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-bold leading-tight text-foreground">{project.title}</h1>
            <div className="mt-1 text-xs text-muted-foreground">{project.region}</div>
          </div>
        </div>

        <p className="mt-3 text-xs leading-5 text-muted-foreground">{project.summary}</p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="mb-4 grid grid-cols-2 gap-2">
          {[
            ['Owner', project.owner],
            [project.created ? 'Created' : 'Updated', project.created ?? project.updated],
            ['Type', KIND_LABELS[project.kind]],
            ['Status', project.status],
          ].map(([label, value]) => (
            <div key={label} className="rounded-md border bg-muted/20 px-2.5 py-2">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
              <div className="mt-0.5 truncate text-xs font-semibold text-foreground">{value}</div>
            </div>
          ))}
        </div>

        <div className="mb-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <BookOpen className="h-3.5 w-3.5" />
            Story Scenes
          </div>
          <div className="space-y-2">
            {project.scenes.map((scene, index) => (
              <button
                key={scene.label}
                type="button"
                onClick={() => applyScene(index)}
                className={cn(
                  'w-full rounded-md border bg-background p-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/50',
                  index === activeSceneIndex && 'border-primary bg-primary/5',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-foreground">{scene.label}</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{scene.text}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {labUrl && (
        <div className="border-t p-3">
          <Button asChild size="sm" className="w-full">
            <Link to={labUrl}>
              <Settings2 className="h-4 w-4" />
              Open in Index Lab
            </Link>
          </Button>
        </div>
      )}
    </aside>
  )

  const rightSidebar = (
    <ProjectController
      project={project}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      visibleLayerIds={visibleLayerIds}
      onLayerToggle={toggleLayer}
      rasterOpacity={rasterOpacity}
      onRasterOpacityChange={setRasterOpacity}
      className="h-full rounded-none border-0 border-l shadow-none"
    />
  )

  const mobileSidebar = (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {labUrl && (
        <div className="flex justify-end border-b p-3">
          <Button asChild size="sm" variant="outline">
            <Link to={labUrl}>
              <Settings2 className="h-4 w-4" />
              Index Lab
            </Link>
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <BookOpen className="h-3.5 w-3.5" />
            Story Scenes
          </div>
          <div className="grid grid-cols-2 gap-2">
            {project.scenes.map((scene, index) => (
              <button
                key={scene.label}
                type="button"
                onClick={() => applyScene(index)}
                className={cn(
                  'rounded-md border bg-background px-3 py-2 text-left text-sm font-semibold text-foreground transition-colors',
                  index === activeSceneIndex ? 'border-primary bg-primary/5' : 'hover:bg-muted/50',
                )}
              >
                {scene.label}
              </button>
            ))}
          </div>
          {activeScene && (
            <div className="mt-2 rounded-md border bg-muted/20 p-3">
              <div className="text-sm font-semibold text-foreground">{activeScene.title}</div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{activeScene.text}</p>
            </div>
          )}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Layers className="h-3.5 w-3.5" />
              Map Stack
            </div>
            <span className="text-xs text-muted-foreground">
              {visibleLayerIds.size}/{project.layers.length}
            </span>
          </div>
          <div className="space-y-2">
            {project.layers.map((layer) => (
              <LayerToggle
                key={layer.id}
                layer={layer}
                visible={visibleLayerIds.has(layer.id)}
                onToggle={() => toggleLayer(layer.id)}
              />
            ))}
          </div>
        </div>

        {project.portalMap && (
          <div className="rounded-lg border bg-background p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-foreground">Raster Opacity</div>
              <div className="text-xs font-medium text-muted-foreground">{rasterOpacity}%</div>
            </div>
            <Slider
              value={[rasterOpacity]}
              min={20}
              max={100}
              step={5}
              onValueChange={(value) => setRasterOpacity(value[0] ?? rasterOpacity)}
              aria-label="Raster opacity"
            />
          </div>
        )}
      </div>
    </div>
  )

  return (
    <div className="h-[100dvh] min-h-0 md:h-[calc(100vh-3.5rem)]">
      <MapSectionLayout
        sidebar={isMobile ? mobileSidebar : leftSidebar}
        desktopSidebarWidth={sidebarWidth}
        onDesktopSidebarWidthChange={setSidebarWidth}
        mobileInitialSheetState="collapsed"
        mobileCollapsedVisibleHeight={68}
        mobileSheetContentClassName="pb-0"
        mobilePeek={
          <div className="min-w-0 text-left">
            <div className="truncate text-xs font-semibold text-foreground">{project.title}</div>
            <div className="truncate text-xs text-muted-foreground">{activeScene?.title ?? project.region}</div>
          </div>
        }
        showMobilePeek
        rightSidebar={rightSidebar}
        showDesktopRightSidebar={showRightSidebar}
        onToggleDesktopRightSidebar={() => setShowRightSidebar((current) => !current)}
        desktopRightSidebarWidth={rightSidebarWidth}
        onDesktopRightSidebarWidthChange={setRightSidebarWidth}
      >
        <div className="relative h-full min-h-0">
          <ProjectWorkspaceMap
            project={project}
            visibleLayerIds={visibleLayerIds}
            rasterOpacity={rasterOpacity}
            className="h-full min-h-0"
          />
        </div>
      </MapSectionLayout>
    </div>
  )
}

function ConfiguredProjectWorkspace({ project, onBack }: { project: ProjectPackage; onBack: () => void }) {
  const workspace = project.workspace
  if (!workspace) return null

  if (workspace.type === 'story-map') {
    return (
      <div className="h-[100dvh] bg-background md:h-[calc(100vh-3.5rem)]">
        <ProjectStoryMap project={project} config={workspace} onBack={onBack} />
      </div>
    )
  }

  return (
    <div className="h-[100dvh] bg-background md:h-[calc(100vh-3.5rem)]">
      <ProjectMapExplorer title={project.title} config={workspace} onBack={onBack} />
    </div>
  )
}

export default function ProjectWorkspace(props: { project: ProjectPackage; onBack: () => void }) {
  return props.project.workspace ? <ConfiguredProjectWorkspace {...props} /> : <LoadedProjectWorkspace {...props} />
}
