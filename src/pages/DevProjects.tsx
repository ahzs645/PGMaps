import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  FileText,
  FolderKanban,
  FolderOpen,
  Layers,
  Map as MapIcon,
  PanelRight,
  Search,
  Settings2,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from 'lucide-react'

import {
  DESKTOP_SIDEBAR_MAX_WIDTH,
  DESKTOP_SIDEBAR_MIN_WIDTH,
  MapSectionLayout,
} from '@/components/layout/MapSectionLayout'
import { Map as PgMap } from '@/components/ui/map'
import { MapFillLayer, MapRasterLayer } from '@/components/ui/map-layers'
import { LegendItem, MapGradientLegendItem, MapLegendPanel } from '@/components/ui/map-panels'
import { MAP_STYLES } from '@/components/ui/map-styles'
import { Button } from '@/components/ui/button'
import { AppSelect } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/hooks/useIsMobile'
import {
  buildProjectLabUrl,
  downloadProjectPackage,
  findProjectPackageBySlug,
  importProjectPackageFile,
  loadLocalProjectPackages,
  loadProjectCatalogSummaries,
  projectRecipeBars,
  removeLocalProjectPackage,
  type ProjectKind,
  type ProjectLayerDef,
  type ProjectPackage,
  type ProjectPortalMapDef,
  type ProjectPortalRasterLayerDef,
  type ProjectTheme,
} from '@/lib/projectPackages'
import { ProjectMapExplorer } from '@/maps/project-explorer/ProjectMapExplorer'
import { ProjectStoryMap } from '@/maps/project-story/ProjectStoryMap'
import { ProjectScoreMapPreview } from '@/maps/scorebuilder/ProjectScoreMapPreview'

type ControllerTab = 'layers' | 'project'
type CatalogFilter = 'all' | ProjectKind

const THEME_ACCENT: Record<ProjectTheme, string> = {
  cyan: 'border-cyan-500 bg-cyan-50 text-cyan-800 dark:border-cyan-700 dark:bg-cyan-950/35 dark:text-cyan-100',
  amber: 'border-amber-500 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/35 dark:text-amber-100',
  emerald:
    'border-emerald-500 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-100',
  blue: 'border-blue-500 bg-blue-50 text-blue-900 dark:border-blue-700 dark:bg-blue-950/35 dark:text-blue-100',
  slate:
    'border-slate-400 bg-slate-50 text-slate-800 dark:border-slate-600 dark:bg-slate-950/35 dark:text-slate-100',
}

const THEME_ICON: Record<ProjectTheme, string> = {
  cyan: 'bg-cyan-600',
  amber: 'bg-amber-600',
  emerald: 'bg-emerald-600',
  blue: 'bg-blue-600',
  slate: 'bg-slate-600',
}

const FILTER_OPTIONS: Array<{ value: CatalogFilter; label: string }> = [
  { value: 'all', label: 'All projects' },
  { value: 'map-story', label: 'Map stories' },
  { value: 'raster-story', label: 'Raster stories' },
  { value: 'index-preset', label: 'Index presets' },
  { value: 'research-pack', label: 'Research packs' },
]

const FEATURED_PROJECT_SLUGS = [
  'canada-administrative-divisions',
  'echoscreen-climate-health',
  'score-preset-pedestrian-network-study-mi',
  'where-is-north-bc',
  'nechako-watershed-research-portal',
  'roadless-areas-bc-ecoregions',
  'air-quality-bylaws-bc',
  'fine-particulate-matter-bc',
  'ground-level-ozone-bc',
  'nitrogen-dioxide-bc',
  'sulphur-dioxide-bc',
  'lidarbc-data-availability',
  'bc-population-distribution',
  'grizzly-bear-conservation-bc',
  'invasive-species-bc',
  'municipal-solid-waste-bc',
] as const

const FEATURED_PROJECT_ORDER = new Map<string, number>(FEATURED_PROJECT_SLUGS.map((slug, index) => [slug, index]))

const KIND_LABELS: Record<ProjectKind, string> = {
  'map-story': 'Map story',
  'raster-story': 'Raster story',
  'index-preset': 'Index preset',
  'research-pack': 'Research pack',
}

const TAB_LABELS: Record<ControllerTab, string> = {
  layers: 'Layers',
  project: 'Project',
}

const PROJECT_MAP_STYLES = {
  light: MAP_STYLES.light,
  dark: MAP_STYLES.light,
}

const HEALTH_AUTHORITY_BOUNDARIES_URL = '/data/boundaries/BCMoH/simplified/health_authorities.json'
const NORTHERN_HEALTH_FILTER = ['==', ['get', 'HLTH_AUTHORITY_NAME'], 'Northern']

function accentClass(project: ProjectPackage): string {
  return THEME_ACCENT[project.theme]
}

function iconClass(project: ProjectPackage): string {
  return THEME_ICON[project.theme]
}

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

function layerIcon(layer: ProjectLayerDef) {
  if (layer.type === 'raster') return <MapIcon className="h-3.5 w-3.5" />
  if (layer.type === 'boundary') return <PanelRight className="h-3.5 w-3.5" />
  if (layer.type === 'point') return <FolderOpen className="h-3.5 w-3.5" />
  if (layer.type === 'line') return <SlidersHorizontal className="h-3.5 w-3.5" />
  return <Layers className="h-3.5 w-3.5" />
}

function useProjectPackages() {
  const [staticProjects, setStaticProjects] = useState<ProjectPackage[] | null>(null)
  const [localProjects, setLocalProjects] = useState<ProjectPackage[]>(() => loadLocalProjectPackages())
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadProjectCatalogSummaries()
      .then((packages) => {
        if (!cancelled) setStaticProjects(packages)
      })
      .catch(() => {
        if (!cancelled) {
          setStaticProjects([])
          setLoadError(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const projects = useMemo(() => {
    const staticList = staticProjects ?? []
    const staticSlugs = new Set(staticList.map((pkg) => pkg.slug))
    return [...staticList, ...localProjects.filter((pkg) => !staticSlugs.has(pkg.slug))]
  }, [localProjects, staticProjects])

  const importProject = useCallback(async (file: File) => {
    const imported = await importProjectPackageFile(file)
    setLocalProjects(loadLocalProjectPackages())
    return imported
  }, [])

  const removeProject = useCallback((slug: string) => {
    removeLocalProjectPackage(slug)
    setLocalProjects(loadLocalProjectPackages())
  }, [])

  return { projects, loading: staticProjects === null, loadError, importProject, removeProject }
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
  const showLocalBoundary =
    Boolean(portal.localBoundaryLayerId) &&
    visibleLayerIds.has(portal.localBoundaryLayerId!)

  return (
    <div className={cn('relative overflow-hidden bg-slate-100 dark:bg-slate-950', className)}>
      <PgMap
        className="h-full w-full"
        center={portal.center}
        zoom={portal.zoom}
        minZoom={3}
        maxZoom={11}
        styles={PROJECT_MAP_STYLES}
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

        {activeContextLayers.map((layer) => (
          <MapRasterLayer
            key={`${layer.id}-${layer.layerName}`}
            tiles={[buildPortalWmsTileUrl(portal, layer.layerName, layer.mapPath)]}
            opacity={layer.opacity}
            tileSize={256}
            minZoom={3}
            maxZoom={12}
            attribution="Nechako Watershed Portal"
          />
        ))}

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
  const activeRasterLabel = activeRasterLayer
    ? (project.layers.find((layer) => layer.id === activeRasterLayer.id)?.label ?? activeRasterLayer.layerName)
    : null
  const showLocalBoundary =
    Boolean(portal.localBoundaryLayerId) && visibleLayerIds.has(portal.localBoundaryLayerId!)
  const activeContextLayers = portal.contextLayers.filter((layer) => visibleLayerIds.has(layer.id))

  return (
    <MapLegendPanel title="Legend" width="sm" collapsible className="max-h-[min(28rem,calc(100%-2rem))] overflow-auto">
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
    const showScoreSurface = project.layers.some(
      (layer) => layer.role === 'score' && visibleLayerIds.has(layer.id),
    )
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

function LayerToggle({
  layer,
  visible,
  onToggle,
}: {
  layer: ProjectLayerDef
  visible: boolean
  onToggle: () => void
}) {
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
  const labUrl = buildProjectLabUrl(project)

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
            <div className={cn('rounded-lg border p-3', accentClass(project))}>
              <div className="text-xs font-semibold uppercase tracking-wide">{KIND_LABELS[project.kind]}</div>
              <div className="mt-1 text-sm font-semibold">{project.lab?.presetKey ?? project.slug}</div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-semibold text-foreground">Details</div>
              {[
                ['Owner', project.owner],
                ['Updated', project.updated],
                ['Region', project.region],
                ['Status', project.status],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2"
                >
                  <span className="text-xs text-muted-foreground">{label}</span>
                  <span className="min-w-0 truncate text-right text-sm font-medium text-foreground">{value}</span>
                </div>
              ))}
            </div>

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

            {labUrl && (
              <Button asChild variant="outline" size="sm" className="w-full">
                <Link to={labUrl}>
                  <Settings2 className="h-4 w-4" />
                  Open in Index Lab
                </Link>
              </Button>
            )}
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

function ProjectDetailSections({
  project,
  onRemove,
}: {
  project: ProjectPackage
  onRemove?: (slug: string) => void
}) {
  const detailParagraphs = project.details?.length ? project.details : [project.summary, project.sourceNote]
  const [lightboxOpen, setLightboxOpen] = useState(false)

  useEffect(() => {
    if (!lightboxOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLightboxOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [lightboxOpen])

  return (
    <>
      <section className="p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
          <BookOpen className="h-4 w-4" />
          About
        </div>
        <div className="space-y-2 text-sm leading-6 text-muted-foreground">
          {detailParagraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
        {project.image && (
          <button
            type="button"
            onClick={() => setLightboxOpen(true)}
            className="mt-3 block w-full cursor-zoom-in"
            aria-label={`Zoom into ${project.image.alt}`}
          >
            <img
              src={project.image.src}
              alt={project.image.alt}
              loading="lazy"
              className="max-h-72 w-full rounded-md object-contain"
            />
          </button>
        )}
      </section>

      <section className="border-t p-4">
        <div className="grid grid-cols-2 gap-2">
          {[
            ['Owner', project.owner],
            ['Region', project.region],
            ['Updated', project.updated],
            ['Preset', project.lab?.presetKey ?? KIND_LABELS[project.kind]],
          ].map(([label, value]) => (
            <div key={label} className="rounded-md border bg-muted/20 px-3 py-2">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
              <div className="mt-0.5 truncate text-sm font-semibold text-foreground">{value}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
          <Layers className="h-4 w-4" />
          Resources
        </div>
        <div className="space-y-3">
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Layer Stack
            </div>
            <div className="flex flex-wrap gap-1.5">
              {project.layers.map((layer) => (
                <span
                  key={layer.id}
                  className="rounded-md border bg-muted/20 px-2 py-1 text-xs text-muted-foreground"
                >
                  {layer.label}
                </span>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {project.catalogMetrics.map((metric) => (
              <div key={metric.label} className="rounded-md border bg-muted/20 px-3 py-2">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {metric.label}
                </div>
                <div className="mt-0.5 text-sm font-semibold text-foreground">{metric.value}</div>
              </div>
            ))}
          </div>

          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Files</div>
            <div className="space-y-2">
              {project.files.map((file) => (
                <div key={file.label} className="flex items-start gap-2 rounded-md border bg-muted/20 px-3 py-2">
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{file.label}</div>
                    <div className="text-xs leading-5 text-muted-foreground">{file.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {project.links && project.links.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Links</div>
              <div className="space-y-2">
                {project.links.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    target={link.href.startsWith('http') ? '_blank' : undefined}
                    rel={link.href.startsWith('http') ? 'noreferrer' : undefined}
                    className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
                  >
                    <span className="truncate">{link.label}</span>
                    <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </a>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Package</div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  // Catalog previews hold metadata-only summaries; download the
                  // real package (falls back to what we have if the fetch fails).
                  void findProjectPackageBySlug(project.slug).then((full) =>
                    downloadProjectPackage(full ?? project),
                  )
                }}
              >
                <Download className="h-4 w-4" />
                Download package
              </Button>
              {project.local && onRemove && (
                <Button type="button" variant="outline" size="sm" onClick={() => onRemove(project.slug)}>
                  <Trash2 className="h-4 w-4" />
                  Remove
                </Button>
              )}
            </div>
          </div>
        </div>
      </section>

      {lightboxOpen && project.image && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={project.image.alt}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4"
          onClick={() => setLightboxOpen(false)}
        >
          <img src={project.image.src} alt={project.image.alt} className="max-h-full max-w-full object-contain" />
          <button
            type="button"
            aria-label="Close image"
            onClick={() => setLightboxOpen(false)}
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
    </>
  )
}

function ProjectBadges({ project, compact = false }: { project: ProjectPackage; compact?: boolean }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <span className={cn('rounded-md border px-2 py-0.5 text-xs font-semibold', accentClass(project))}>
        {KIND_LABELS[project.kind]}
      </span>
      {!compact && (
        <span className="rounded-md border bg-muted/30 px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {project.status}
        </span>
      )}
      {project.local && (
        <span className="rounded-md border border-dashed bg-muted/30 px-2 py-0.5 text-xs font-medium text-muted-foreground">
          Local
        </span>
      )}
    </div>
  )
}

function ProjectActions({
  project,
  onOpen,
  labLabel = 'Open in Index Lab',
}: {
  project: ProjectPackage
  onOpen: () => void
  labLabel?: string
}) {
  const labUrl = buildProjectLabUrl(project)
  return (
    <div className={cn('grid gap-2', labUrl ? 'sm:grid-cols-2' : '')}>
      <Button type="button" size="sm" onClick={onOpen}>
        Enter Project
        <ArrowRight className="h-4 w-4" />
      </Button>
      {labUrl && (
        <Button asChild variant="outline" size="sm">
          <Link to={labUrl}>
            <Settings2 className="h-4 w-4" />
            {labLabel}
          </Link>
        </Button>
      )}
    </div>
  )
}

function ProjectCatalogMobileCard({
  project,
  expanded,
  onToggleExpand,
  onOpen,
  onRemove,
}: {
  project: ProjectPackage
  expanded: boolean
  onToggleExpand: () => void
  onOpen: () => void
  onRemove: (slug: string) => void
}) {
  const labUrl = buildProjectLabUrl(project)

  return (
    <article className="overflow-hidden rounded-lg border bg-background shadow-sm">
      <div className="p-3">
        <div className="flex items-start gap-3">
          <span
            className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-white', iconClass(project))}
          >
            <FolderKanban className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <ProjectBadges project={project} compact />
            <h2 className="text-sm font-bold leading-tight text-foreground">{project.title}</h2>
          </div>
        </div>

        <p className={cn('mt-2 text-sm leading-6 text-muted-foreground', !expanded && 'line-clamp-2')}>
          {project.summary}
        </p>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button type="button" size="sm" onClick={onOpen}>
            Enter Project
            <ArrowRight className="h-4 w-4" />
          </Button>
          <button
            type="button"
            onClick={onToggleExpand}
            aria-expanded={expanded}
            className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md border bg-muted/20 px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50"
          >
            {expanded ? 'Hide details' : 'Details'}
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t">
          {labUrl && (
            <div className="border-b p-3">
              <Button asChild variant="outline" size="sm" className="w-full">
                <Link to={labUrl}>
                  <Settings2 className="h-4 w-4" />
                  Open in Index Lab
                </Link>
              </Button>
            </div>
          )}
          <ProjectDetailSections project={project} onRemove={onRemove} />
        </div>
      )}
    </article>
  )
}

function ProjectCatalogPreview({
  project,
  onOpenProject,
  onRemove,
}: {
  project: ProjectPackage
  onOpenProject: () => void
  onRemove: (slug: string) => void
}) {
  return (
    <aside className="hidden min-h-0 flex-col overflow-hidden rounded-lg border bg-background shadow-sm lg:flex">
      <div className="border-b p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <ProjectBadges project={project} />
            <h2 className="text-lg font-bold leading-tight text-foreground">{project.title}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{project.summary}</p>
          </div>
          <div
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-white',
              iconClass(project),
            )}
          >
            <FolderKanban className="h-5 w-5" />
          </div>
        </div>

        <div className="mt-4">
          <ProjectActions project={project} onOpen={onOpenProject} />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <ProjectDetailSections project={project} onRemove={onRemove} />
      </div>
    </aside>
  )
}

function ProjectCatalogPage({
  projects,
  additionalProjectCount,
  showingMoreProjects,
  loading,
  loadError,
  query,
  onQueryChange,
  filter,
  onFilterChange,
  selectedProject,
  onSelectProject,
  onOpenProject,
  onImportFile,
  onRemoveProject,
  onToggleMoreProjects,
  importError,
}: {
  projects: ProjectPackage[]
  additionalProjectCount: number
  showingMoreProjects: boolean
  loading: boolean
  loadError: boolean
  query: string
  onQueryChange: (value: string) => void
  filter: CatalogFilter
  onFilterChange: (value: CatalogFilter) => void
  selectedProject: ProjectPackage | null
  onSelectProject: (slug: string) => void
  onOpenProject: (slug: string) => void
  onImportFile: (file: File) => void
  onRemoveProject: (slug: string) => void
  onToggleMoreProjects: () => void
  importError: string | null
}) {
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  function onToggleExpand(slug: string) {
    setExpandedSlug((current) => (current === slug ? null : slug))
  }

  const emptyMessage = loading
    ? 'Loading project packages…'
    : loadError
      ? 'The project manifest failed to load.'
      : additionalProjectCount > 0
        ? 'Matching projects are available under More projects.'
      : 'No projects match the current search.'

  return (
    <div className="bg-muted/30 p-3 pt-[calc(env(safe-area-inset-top)+4rem)] text-foreground sm:p-5 sm:pt-[calc(env(safe-area-inset-top)+4rem)] md:pt-5 lg:h-[calc(100vh-4rem)] lg:min-h-[720px]">
      <div className="mx-auto max-w-[98rem] gap-4 lg:grid lg:h-full lg:grid-cols-[minmax(40rem,1.35fr)_minmax(24rem,0.85fr)]">
        <section className="flex min-h-0 flex-col rounded-lg border bg-background shadow-sm">
          <header className="border-b p-4">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div className="hidden min-w-0 sm:block">
                <h1 className="text-2xl font-bold tracking-tight">Projects</h1>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                  Open a project to explore its map and story, or send its recipe to Index Lab and play with the
                  weights yourself.
                </p>
              </div>

              <div className="grid grid-cols-[2.25rem_minmax(0,1fr)_7.75rem] gap-2 sm:min-w-[28rem] sm:grid-cols-[2.25rem_minmax(0,1fr)_10rem]">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 w-9 px-0"
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Import project package"
                  title="Import project package"
                >
                  <Upload className="h-4 w-4" />
                </Button>
                <div className="relative min-w-0">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <input
                    value={query}
                    onChange={(event) => onQueryChange(event.target.value)}
                    placeholder="Search projects"
                    className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm outline-none transition-shadow focus:ring-2 focus:ring-primary/25"
                  />
                </div>
                <AppSelect
                  value={filter}
                  onValueChange={(value) => onFilterChange(value as CatalogFilter)}
                  options={FILTER_OPTIONS}
                  triggerAriaLabel="Filter projects"
                  className="min-w-0"
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) onImportFile(file)
                    event.target.value = ''
                  }}
                />
              </div>
            </div>
            {importError && (
              <div className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                {importError}
              </div>
            )}
          </header>

          <div className="hidden min-h-0 flex-1 overflow-auto lg:block">
            <table className="w-full min-w-[560px] border-separate border-spacing-0 text-left">
              <thead className="sticky top-0 z-10 bg-background text-xs uppercase tracking-wide text-muted-foreground shadow-[0_1px_0_0_hsl(var(--border))]">
                <tr>
                  <th className="w-[48%] px-4 py-3 font-semibold">Project</th>
                  <th className="w-[20%] px-3 py-3 font-semibold">Type</th>
                  <th className="w-[18%] px-3 py-3 font-semibold">Resources</th>
                  <th className="w-[14%] px-4 py-3 text-right font-semibold">Open</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {projects.map((project) => {
                  const active = selectedProject?.slug === project.slug
                  return (
                    <tr
                      key={project.slug}
                      className={cn('align-top transition-colors', active ? 'bg-primary/5' : 'hover:bg-muted/30')}
                    >
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => onSelectProject(project.slug)}
                          className="flex w-full min-w-0 items-start gap-3 text-left"
                        >
                          <span
                            className={cn(
                              'flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-white',
                              iconClass(project),
                            )}
                          >
                            <FolderKanban className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="truncate text-sm font-semibold text-foreground">{project.title}</span>
                              {active && <Check className="h-4 w-4 shrink-0 text-primary" />}
                            </span>
                            <span className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                              {project.summary}
                            </span>
                          </span>
                        </button>
                      </td>
                      <td className="px-3 py-3">
                        <div>
                          <span
                            className={cn(
                              'inline-flex rounded-md border px-2 py-0.5 text-xs font-semibold',
                              accentClass(project),
                            )}
                          >
                            {KIND_LABELS[project.kind]}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-xs leading-5 text-muted-foreground">
                        <div>
                          <span className="font-medium text-foreground">
                            {project.catalogCounts?.layers ?? project.layers.length}
                          </span>{' '}
                          layers
                        </div>
                        <div>
                          <span className="font-medium text-foreground">
                            {project.catalogCounts?.scenes ?? project.scenes.length}
                          </span>{' '}
                          scenes
                        </div>
                        <div>
                          <span className="font-medium text-foreground">{project.lab ? 'Lab' : 'Story'}</span> recipe
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          type="button"
                          variant={active ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => onOpenProject(project.slug)}
                        >
                          Enter
                          <ArrowRight className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {projects.length === 0 && (
              <div className="p-8 text-center text-sm text-muted-foreground">{emptyMessage}</div>
            )}

            {additionalProjectCount > 0 && (
              <div className="border-t p-3 text-center">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onToggleMoreProjects}
                  aria-expanded={showingMoreProjects}
                  className="w-full"
                >
                  {showingMoreProjects ? 'Show fewer projects' : `More projects (${additionalProjectCount})`}
                  <ChevronDown className={cn('h-4 w-4 transition-transform', showingMoreProjects && 'rotate-180')} />
                </Button>
              </div>
            )}
          </div>

          <div className="space-y-3 p-3 lg:hidden">
            {projects.map((project) => (
              <ProjectCatalogMobileCard
                key={project.slug}
                project={project}
                expanded={expandedSlug === project.slug}
                onToggleExpand={() => onToggleExpand(project.slug)}
                onOpen={() => onOpenProject(project.slug)}
                onRemove={onRemoveProject}
              />
            ))}
            {projects.length === 0 && (
              <div className="p-8 text-center text-sm text-muted-foreground">{emptyMessage}</div>
            )}
            {additionalProjectCount > 0 && (
              <Button
                type="button"
                variant="outline"
                onClick={onToggleMoreProjects}
                aria-expanded={showingMoreProjects}
                className="w-full"
              >
                {showingMoreProjects ? 'Show fewer projects' : `More projects (${additionalProjectCount})`}
                <ChevronDown className={cn('h-4 w-4 transition-transform', showingMoreProjects && 'rotate-180')} />
              </Button>
            )}
          </div>
        </section>

        {selectedProject ? (
          <ProjectCatalogPreview
            project={selectedProject}
            onOpenProject={() => onOpenProject(selectedProject.slug)}
            onRemove={onRemoveProject}
          />
        ) : (
          <aside className="hidden min-h-0 items-center justify-center rounded-lg border bg-background p-6 text-center text-sm text-muted-foreground shadow-sm lg:flex">
            Select a project to preview its details.
          </aside>
        )}
      </div>
    </div>
  )
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

  function toggleLayer(layerId: string) {
    const layer = project.layers.find((item) => item.id === layerId)
    if (!layer || layer.locked) return
    setVisibleLayerIds((current) => {
      const next = new Set(current)
      if (next.has(layerId)) next.delete(layerId)
      else next.add(layerId)
      return next
    })
  }

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
            ['Updated', project.updated],
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

        <div className="rounded-md border bg-muted/20 p-3">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Source Note</div>
          <p className="text-xs leading-5 text-muted-foreground">{project.sourceNote}</p>
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

        <div className="rounded-md border bg-muted/20 p-3">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Source Note</div>
          <p className="text-xs leading-5 text-muted-foreground">{project.sourceNote}</p>
        </div>
      </div>
    </div>
  )

  return (
    <div className="h-[100dvh] min-h-[640px] md:h-[calc(100vh-4rem)]">
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
      <div className="h-[100dvh] bg-background md:h-[calc(100vh-4rem)]">
        <ProjectStoryMap project={project} config={workspace} onBack={onBack} />
      </div>
    )
  }

  return (
    <div className="h-[100dvh] bg-background md:h-[calc(100vh-4rem)]">
      <ProjectMapExplorer title={project.title} config={workspace} onBack={onBack} />
    </div>
  )
}

export default function DevProjects() {
  const { projects, loading, loadError, importProject, removeProject } = useProjectPackages()
  const navigate = useNavigate()
  const { projectSlug: routeProjectSlug } = useParams<{ projectSlug?: string }>()
  const [searchParams] = useSearchParams()
  const legacyProjectSlug = searchParams.get('project')
  const projectSlug = routeProjectSlug ?? legacyProjectSlug
  // Catalog entries are metadata-only summaries; a routed project needs its
  // full package, fetched on demand (one file, not the whole manifest).
  const [routedProject, setRoutedProject] = useState<{ slug: string; pkg: ProjectPackage | null } | null>(null)
  useEffect(() => {
    if (!projectSlug) return
    let cancelled = false
    findProjectPackageBySlug(projectSlug).then((pkg) => {
      if (!cancelled) setRoutedProject({ slug: projectSlug, pkg })
    })
    return () => {
      cancelled = true
    }
  }, [projectSlug])
  const routedProjectReady = !projectSlug || routedProject?.slug === projectSlug
  const selectedProject = projectSlug && routedProject?.slug === projectSlug ? routedProject.pkg : null
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<CatalogFilter>('all')
  const [showingMoreProjects, setShowingMoreProjects] = useState(false)
  const [previewProjectSlug, setPreviewProjectSlug] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  // Preserve old shared links while making every project URL path-based and canonical.
  useEffect(() => {
    if (routeProjectSlug || !legacyProjectSlug) return
    navigate(`/dev/projects/${encodeURIComponent(legacyProjectSlug)}`, { replace: true })
  }, [legacyProjectSlug, navigate, routeProjectSlug])

  const matchingProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return projects.filter((project) => {
      if (filter !== 'all' && project.kind !== filter) return false
      if (!normalizedQuery) return true
      return `${project.title} ${project.summary} ${project.lab?.presetKey ?? ''}`
        .toLowerCase()
        .includes(normalizedQuery)
    })
  }, [filter, projects, query])

  const { featuredProjects, additionalProjects } = useMemo(() => {
    const featured: ProjectPackage[] = []
    const additional: ProjectPackage[] = []

    for (const project of matchingProjects) {
      if (FEATURED_PROJECT_ORDER.has(project.slug)) featured.push(project)
      else additional.push(project)
    }

    featured.sort((left, right) => FEATURED_PROJECT_ORDER.get(left.slug)! - FEATURED_PROJECT_ORDER.get(right.slug)!)

    return { featuredProjects: featured, additionalProjects: additional }
  }, [matchingProjects])

  const filteredProjects = showingMoreProjects ? [...featuredProjects, ...additionalProjects] : featuredProjects
  const selectedPreviewProject =
    filteredProjects.find((project) => project.slug === previewProjectSlug) ?? filteredProjects[0] ?? null

  function openProject(slug: string) {
    navigate(`/dev/projects/${encodeURIComponent(slug)}`)
  }

  function backToCatalog() {
    navigate('/dev/projects')
  }

  async function handleImportFile(file: File) {
    try {
      const imported = await importProject(file)
      setImportError(null)
      setShowingMoreProjects(true)
      setPreviewProjectSlug(imported.slug)
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'The file could not be imported.')
    }
  }

  function handleRemoveProject(slug: string) {
    removeProject(slug)
    if (projectSlug === slug) backToCatalog()
    if (previewProjectSlug === slug) setPreviewProjectSlug(null)
  }

  if (projectSlug && !routedProjectReady) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center text-sm text-muted-foreground">
        Loading project package…
      </div>
    )
  }

  if (selectedProject) {
    if (selectedProject.workspace) {
      return <ConfiguredProjectWorkspace key={selectedProject.slug} project={selectedProject} onBack={backToCatalog} />
    }
    return <LoadedProjectWorkspace key={selectedProject.slug} project={selectedProject} onBack={backToCatalog} />
  }

  return (
    <ProjectCatalogPage
      projects={filteredProjects}
      additionalProjectCount={additionalProjects.length}
      showingMoreProjects={showingMoreProjects}
      loading={loading}
      loadError={loadError}
      query={query}
      onQueryChange={setQuery}
      filter={filter}
      onFilterChange={setFilter}
      selectedProject={selectedPreviewProject}
      onSelectProject={setPreviewProjectSlug}
      onOpenProject={openProject}
      onImportFile={handleImportFile}
      onRemoveProject={handleRemoveProject}
      onToggleMoreProjects={() => setShowingMoreProjects((current) => !current)}
      importError={importError}
    />
  )
}
