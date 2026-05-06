import { useEffect, useMemo, useState } from 'react'
import { Database, Flame, Satellite, Trees } from 'lucide-react'
import { Map as PgMap, MapControls, MapMarker, MarkerContent } from '@/components/ui/map'
import { MapFillLayer } from '@/components/ui/map-layers'
import { MAP_STYLES, PG_CENTER } from '@/components/ui/map-styles'
import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { cn } from '@/lib/utils'
import { useHeatShadeData } from '@/maps/scorebuilder/hooks/useHeatShadeData'

interface HeatShadeManifestSource {
  id: string
  name: string
  kind: string
  featureCount?: number
  sceneCount?: number
  years?: number[]
}

interface HeatShadeManifest {
  generatedAt: string
  sources: HeatShadeManifestSource[]
  caveats?: string[]
}

interface CanueDataset {
  id: string
  label: string
  category: string
  files: string[]
}

interface CanueFile {
  datasetId: string
  label: string
  category: string
  year: number
  rowCount: number
  coordinateCount: number
  variables: string[]
}

interface CanueManifest {
  generatedAt: string
  datasets: CanueDataset[]
  files: CanueFile[]
}

type MiscLayerId = 'trees' | 'forests' | 'facilities'

const MISC_LAYERS: Array<{ id: MiscLayerId; label: string; color: string }> = [
  { id: 'trees', label: 'Tree canopy proxy', color: '#16a34a' },
  { id: 'forests', label: 'Forests', color: '#15803d' },
  { id: 'facilities', label: 'Cooling access proxy', color: '#0ea5e9' },
]

function formatDate(value: string | undefined): string {
  if (!value) return 'Unknown'
  return new Date(value).toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function useJsonManifest<T>(path: string) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      try {
        const response = await fetch(path, { signal: controller.signal })
        if (!response.ok) throw new Error(`Failed to fetch ${path}: ${response.status}`)
        setData(await response.json())
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setError((err as Error).message || 'Unable to load manifest')
      }
    }

    void load()
    return () => controller.abort()
  }, [path])

  return { data, error }
}

export default function MiscDataSection() {
  const [showSidebar, setShowSidebar] = useState(true)
  const [activeLayers, setActiveLayers] = useState<MiscLayerId[]>(['trees', 'forests', 'facilities'])
  const { trees, forests, facilities, loading, error } = useHeatShadeData(true)
  const heatShadeManifest = useJsonManifest<HeatShadeManifest>('/data/heat-shade/manifest.json')
  const canueManifest = useJsonManifest<CanueManifest>('/data/canue/bc/manifest.json')

  const forestGeojson = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: forests.map((forest) => ({
      type: 'Feature',
      id: forest.id,
      properties: {
        id: forest.id,
        name: forest.name,
        areaSqKm: forest.areaSqKm,
      },
      geometry: forest.geometry,
    })),
  }), [forests])

  const visibleTrees = useMemo(() => trees.slice(0, 900), [trees])
  const visibleFacilities = useMemo(() => facilities.slice(0, 350), [facilities])

  const canueFiles = canueManifest.data?.files ?? []
  const canueDatasets = canueManifest.data?.datasets ?? []
  const heatShadeSources = heatShadeManifest.data?.sources ?? []
  const landsatSource = heatShadeSources.find((source) => source.kind === 'historicalNdviLst')

  const toggleLayer = (layer: MiscLayerId) => {
    setActiveLayers((current) =>
      current.includes(layer)
        ? current.filter((item) => item !== layer)
        : [...current, layer]
    )
  }

  const sidebar = (
    <div className="z-10 flex h-full w-full flex-col overflow-hidden border-r border-border bg-background/95 shadow-xl backdrop-blur">
      <div className="border-b border-border bg-background/95 p-4">
        <h1 className="text-xl font-bold text-foreground">MISC Data</h1>
        <p className="text-sm text-muted-foreground">Datasets without a dedicated map</p>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="border-b border-border p-4">
          <h2 className="mb-3 text-sm font-semibold text-foreground">Map Layers</h2>
          <div className="space-y-2">
            {MISC_LAYERS.map((layer) => (
              <label key={layer.id} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={activeLayers.includes(layer.id)}
                    onChange={() => toggleLayer(layer.id)}
                    className="h-3.5 w-3.5 rounded border-input"
                    style={{ accentColor: layer.color }}
                  />
                  <span className="text-sm text-foreground">{layer.label}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {layer.id === 'trees'
                    ? trees.length.toLocaleString()
                    : layer.id === 'forests'
                      ? forests.length.toLocaleString()
                      : facilities.length.toLocaleString()}
                </span>
              </label>
            ))}
          </div>
          {loading && <div className="mt-3 text-xs text-muted-foreground">Loading heat and shade data...</div>}
          {error && <div className="mt-3 text-xs text-red-500">{error}</div>}
        </div>

        <div className="border-b border-border p-4">
          <div className="mb-3 flex items-center gap-2">
            <Trees className="h-4 w-4 text-green-600" />
            <h2 className="text-sm font-semibold text-foreground">Heat, Shade, and Canopy</h2>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-md border border-border p-2">
              <div className="text-lg font-bold text-foreground">{trees.length.toLocaleString()}</div>
              <div className="text-[10px] text-muted-foreground">tree points</div>
            </div>
            <div className="rounded-md border border-border p-2">
              <div className="text-lg font-bold text-foreground">{forests.length.toLocaleString()}</div>
              <div className="text-[10px] text-muted-foreground">forest areas</div>
            </div>
            <div className="rounded-md border border-border p-2">
              <div className="text-lg font-bold text-foreground">{facilities.length.toLocaleString()}</div>
              <div className="text-[10px] text-muted-foreground">facilities</div>
            </div>
          </div>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            Tree points are shown as a canopy and shade proxy until a full canopy raster or canopy polygon layer is available.
          </p>
        </div>

        <div className="border-b border-border p-4">
          <div className="mb-3 flex items-center gap-2">
            <Satellite className="h-4 w-4 text-violet-600" />
            <h2 className="text-sm font-semibold text-foreground">Remote Sensing Queue</h2>
          </div>
          <div className="rounded-md border border-border p-3 text-sm">
            <div className="font-medium text-foreground">{landsatSource?.name ?? 'Landsat warm-season scenes'}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {landsatSource?.sceneCount ?? 0} scenes
              {landsatSource?.years?.length ? ` across ${landsatSource.years.join(', ')}` : ''}
            </div>
          </div>
        </div>

        <div className="border-b border-border p-4">
          <div className="mb-3 flex items-center gap-2">
            <Database className="h-4 w-4 text-cyan-600" />
            <h2 className="text-sm font-semibold text-foreground">CANUE BC Extracts</h2>
          </div>
          <div className="mb-3 grid grid-cols-2 gap-2 text-center">
            <div className="rounded-md border border-border p-2">
              <div className="text-lg font-bold text-foreground">{canueDatasets.length}</div>
              <div className="text-[10px] text-muted-foreground">datasets</div>
            </div>
            <div className="rounded-md border border-border p-2">
              <div className="text-lg font-bold text-foreground">{canueFiles.length}</div>
              <div className="text-[10px] text-muted-foreground">files</div>
            </div>
          </div>
          {canueManifest.error && <div className="mb-2 text-xs text-red-500">{canueManifest.error}</div>}
          <div className="space-y-2">
            {canueFiles.slice(0, 8).map((file) => (
              <div key={`${file.datasetId}-${file.year}`} className="rounded-md border border-border p-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{file.label}</div>
                    <div className="text-xs text-muted-foreground">{file.category} - {file.year}</div>
                  </div>
                  <div className="shrink-0 text-xs text-muted-foreground">{file.variables.length} vars</div>
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground">
                  {file.coordinateCount.toLocaleString()} coordinate records
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="p-4">
          <div className="mb-2 flex items-center gap-2">
            <Flame className="h-4 w-4 text-orange-600" />
            <h2 className="text-sm font-semibold text-foreground">Source Notes</h2>
          </div>
          <div className="space-y-2 text-xs leading-5 text-muted-foreground">
            <p>Heat/shade updated {formatDate(heatShadeManifest.data?.generatedAt)}.</p>
            <p>CANUE updated {formatDate(canueManifest.data?.generatedAt)}.</p>
            {(heatShadeManifest.data?.caveats ?? []).slice(0, 2).map((caveat) => (
              <p key={caveat}>{caveat}</p>
            ))}
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <MapSectionLayout
      showDesktopSidebar={showSidebar}
      onToggleDesktopSidebar={() => setShowSidebar((current) => !current)}
      sidebar={sidebar}
    >
      <div className="relative h-full">
        <PgMap center={PG_CENTER} zoom={11} styles={MAP_STYLES}>
          <MapControls position="top-right" showZoom showCompass />

          <MapFillLayer
            data={forestGeojson}
            fillColor="#15803d"
            fillOpacity={0.28}
            lineColor="#166534"
            lineWidth={1.2}
            lineOpacity={0.8}
            visible={activeLayers.includes('forests')}
          />

          {activeLayers.includes('trees') && visibleTrees.map((tree) => (
            <MapMarker key={tree.id} longitude={tree.longitude} latitude={tree.latitude}>
              <MarkerContent>
                <div className="h-2 w-2 rounded-full border border-white bg-green-600 shadow-sm" />
              </MarkerContent>
            </MapMarker>
          ))}

          {activeLayers.includes('facilities') && visibleFacilities.map((facility) => (
            <MapMarker key={facility.id} longitude={facility.longitude} latitude={facility.latitude}>
              <MarkerContent>
                <div className="h-3 w-3 rounded-full border border-white bg-sky-500 shadow-sm" />
              </MarkerContent>
            </MapMarker>
          ))}
        </PgMap>

        <div className="absolute bottom-36 right-4 z-10 rounded-xl border border-border bg-background/95 p-4 shadow-xl backdrop-blur md:bottom-6 md:right-6">
          <h4 className="mb-2 text-xs font-semibold text-foreground">MISC Layers</h4>
          <div className="space-y-1">
            {MISC_LAYERS.filter((layer) => activeLayers.includes(layer.id)).map((layer) => (
              <div key={layer.id} className="flex items-center gap-2">
                <span className={cn('h-3 w-3', layer.id === 'forests' ? 'rounded-sm' : 'rounded-full')} style={{ backgroundColor: layer.color }} />
                <span className="text-xs text-muted-foreground">{layer.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </MapSectionLayout>
  )
}
