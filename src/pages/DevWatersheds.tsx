import bbox from '@turf/bbox'
import { Gauge, Layers, Loader2, MapPinned } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Map, MapControls, MapPopup, useMap } from '@/components/ui/map'
import { MapFillLayer } from '@/components/ui/map-layers'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type WatershedLayerKey = 'major' | 'groups'
type GeometryDetail = 'simplified' | 'full'

interface DevBoundaryProperties extends Record<string, unknown> {
  boundaryCode: string
  boundaryName: string
  sourceLayer: string
  AREA_HA?: number
  FEATURE_AREA_SQM?: number
}

type DevBoundaryFeature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, DevBoundaryProperties>
type DevBoundaryCollection = GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, DevBoundaryProperties> & {
  numberMatched?: number
  metadata?: {
    generatedAt?: string
    simplifyTolerance?: number
    simplifyKeep?: string
    numberMatched?: number
    sourceLayer?: string
  }
}

const BC_CENTER: [number, number] = [-126.4, 54.8]

const LAYER_CONFIG: Record<WatershedLayerKey, {
  label: string
  path: string
  typeName: string
  color: string
  lineColor: string
  idField: string
  nameField: string
}> = {
  major: {
    label: 'Major watersheds',
    path: '/data/boundaries/BCFWA/major_watersheds_province_simplified.geojson',
    typeName: 'WHSE_BASEMAPPING.BC_MAJOR_WATERSHEDS',
    color: '#0ea5e9',
    lineColor: '#075985',
    idField: 'OBJECTID',
    nameField: 'MAJOR_WATERSHED_SYSTEM',
  },
  groups: {
    label: 'Watershed groups',
    path: '/data/boundaries/BCFWA/watershed_groups_province_simplified.geojson',
    typeName: 'WHSE_BASEMAPPING.FWA_WATERSHED_GROUPS_POLY',
    color: '#22c55e',
    lineColor: '#166534',
    idField: 'WATERSHED_GROUP_CODE',
    nameField: 'WATERSHED_GROUP_NAME',
  },
}

const COLLECTION_KEYS = ['major:simplified', 'major:full', 'groups:simplified', 'groups:full'] as const
type CollectionKey = typeof COLLECTION_KEYS[number]

function collectionKey(layer: WatershedLayerKey, detail: GeometryDetail): CollectionKey {
  return `${layer}:${detail}` as CollectionKey
}

function emptyCollection(): DevBoundaryCollection {
  return {
    type: 'FeatureCollection',
    features: [],
  }
}

function emptyCollections(): Record<CollectionKey, DevBoundaryCollection> {
  return COLLECTION_KEYS.reduce((acc, key) => {
    acc[key] = emptyCollection()
    return acc
  }, {} as Record<CollectionKey, DevBoundaryCollection>)
}

function emptySizes(): Record<CollectionKey, number> {
  return COLLECTION_KEYS.reduce((acc, key) => {
    acc[key] = 0
    return acc
  }, {} as Record<CollectionKey, number>)
}

function getFullWfsUrl(layer: WatershedLayerKey): string {
  const config = LAYER_CONFIG[layer]
  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: `pub:${config.typeName}`,
    outputFormat: 'json',
    srsName: 'EPSG:4326',
    count: '1000',
  })

  return `https://openmaps.gov.bc.ca/geo/pub/${config.typeName}/ows?${params.toString()}`
}

function normalizeCollection(
  data: DevBoundaryCollection,
  layer: WatershedLayerKey,
  detail: GeometryDetail,
): DevBoundaryCollection {
  const config = LAYER_CONFIG[layer]
  return {
    type: 'FeatureCollection',
    metadata: {
      ...data.metadata,
      sourceLayer: config.typeName,
      numberMatched: data.metadata?.numberMatched ?? data.numberMatched,
    },
    features: (data.features ?? []).map((feature, index) => {
      const properties = feature.properties ?? {}
      const boundaryCode = String(
        properties.boundaryCode ?? properties[config.idField] ?? feature.id ?? index,
      ).trim()
      const boundaryName = String(
        properties.boundaryName ?? properties[config.nameField] ?? boundaryCode,
      ).trim()

      return {
        ...feature,
        id: boundaryCode,
        properties: {
          ...properties,
          sourceLayer: config.typeName,
          boundaryCode,
          boundaryName,
          geometryDetail: detail,
        },
      }
    }),
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000).toLocaleString()} KB`
  return `${bytes.toLocaleString()} B`
}

function formatArea(properties: DevBoundaryProperties): string {
  const hectares = typeof properties.AREA_HA === 'number'
    ? properties.AREA_HA
    : typeof properties.FEATURE_AREA_SQM === 'number'
      ? properties.FEATURE_AREA_SQM / 10_000
      : null

  if (!hectares || !Number.isFinite(hectares)) return 'Area not listed'
  return `${(hectares / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })} km²`
}

function FitBounds({ data }: { data: DevBoundaryCollection }) {
  const { map, isLoaded } = useMap()

  useEffect(() => {
    if (!isLoaded || !map || data.features.length === 0) return
    const bounds = bbox(data as never) as [number, number, number, number]
    map.fitBounds(bounds, {
      padding: 36,
      duration: 700,
      maxZoom: 6,
    })
  }, [data, isLoaded, map])

  return null
}

function DevWatersheds() {
  const [activeLayer, setActiveLayer] = useState<WatershedLayerKey>('groups')
  const [detail, setDetail] = useState<GeometryDetail>('simplified')
  const [collections, setCollections] = useState<Record<CollectionKey, DevBoundaryCollection>>(() => emptyCollections())
  const [sizes, setSizes] = useState<Record<CollectionKey, number>>(() => emptySizes())
  const [fullLoadingKey, setFullLoadingKey] = useState<CollectionKey | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedFeature, setSelectedFeature] = useState<DevBoundaryFeature | null>(null)
  const [popupLngLat, setPopupLngLat] = useState<[number, number] | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      setLoading(true)
      setError(null)

      try {
        const entries = await Promise.all(
          (Object.entries(LAYER_CONFIG) as Array<[WatershedLayerKey, typeof LAYER_CONFIG[WatershedLayerKey]]>)
            .map(async ([key, config]) => {
              const response = await fetch(config.path, { signal: controller.signal })
              if (!response.ok) throw new Error(`Failed to fetch ${config.path}: ${response.status}`)
              const text = await response.text()
              return [collectionKey(key, 'simplified'), normalizeCollection(JSON.parse(text) as DevBoundaryCollection, key, 'simplified'), text.length] as const
            }),
        )

        if (controller.signal.aborted) return

        setCollections((current) => {
          const next = { ...current }
          for (const [key, collection] of entries) next[key] = collection
          return next
        })
        setSizes((current) => {
          const next = { ...current }
          for (const [key, , size] of entries) next[key] = size
          return next
        })
      } catch (err) {
        if (!controller.signal.aborted) {
          setError((err as Error).message || 'Unable to load dev watershed files')
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void load()

    return () => controller.abort()
  }, [])

  const activeKey = collectionKey(activeLayer, detail)
  const activeCollection = collections[activeKey]
  const activeConfig = LAYER_CONFIG[activeLayer]

  const selectedId = selectedFeature?.properties.boundaryCode ?? null

  const handleFeatureClick = useCallback((id: string) => {
    const feature = activeCollection.features.find((candidate) => candidate.properties.boundaryCode === id) ?? null
    setSelectedFeature(feature)
    if (feature) {
      const bounds = bbox(feature as GeoJSON.Feature) as [number, number, number, number]
      setPopupLngLat([(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2])
    }
  }, [activeCollection])

  const loadFullLayer = useCallback(async (layer: WatershedLayerKey) => {
    const key = collectionKey(layer, 'full')
    if (collections[key].features.length > 0 || fullLoadingKey === key) return

    setFullLoadingKey(key)
    setError(null)
    try {
      const response = await fetch(getFullWfsUrl(layer))
      if (!response.ok) throw new Error(`Failed to fetch full ${LAYER_CONFIG[layer].label}: ${response.status}`)
      const text = await response.text()
      const collection = normalizeCollection(JSON.parse(text) as DevBoundaryCollection, layer, 'full')
      setCollections((current) => ({ ...current, [key]: collection }))
      setSizes((current) => ({ ...current, [key]: text.length }))
    } catch (err) {
      setError((err as Error).message || 'Unable to load full watershed geometry')
    } finally {
      setFullLoadingKey(null)
    }
  }, [collections, fullLoadingKey])

  const layerSummaries = useMemo(() => (
    (Object.keys(LAYER_CONFIG) as WatershedLayerKey[]).map((key) => {
      const summaryKey = collectionKey(key, detail)
      const collection = collections[summaryKey]
      return {
        key,
        label: LAYER_CONFIG[key].label,
        features: collection.features.length,
        size: sizes[summaryKey],
        loaded: collection.features.length > 0,
        sourceCount: collection.metadata?.numberMatched,
        tolerance: collection.metadata?.simplifyTolerance,
        simplifyKeep: collection.metadata?.simplifyKeep,
      }
    })
  ), [collections, detail, sizes])

  const handleDetailChange = useCallback((nextDetail: GeometryDetail) => {
    setDetail(nextDetail)
    setSelectedFeature(null)
    setPopupLngLat(null)
    if (nextDetail === 'full') void loadFullLayer(activeLayer)
  }, [activeLayer, loadFullLayer])

  const handleLayerChange = useCallback((nextLayer: WatershedLayerKey) => {
    setActiveLayer(nextLayer)
    setSelectedFeature(null)
    setPopupLngLat(null)
    if (detail === 'full') void loadFullLayer(nextLayer)
  }, [detail, loadFullLayer])

  return (
    <div className="relative h-[calc(100vh-64px)] min-h-[640px] bg-background">
      <Map
        center={BC_CENTER}
        zoom={4.2}
      >
        <MapControls position="top-right" className="top-auto bottom-4 md:top-2 md:bottom-auto" />
        <FitBounds data={activeCollection} />
        <MapFillLayer
          data={activeCollection}
          fillColor={activeConfig.color}
          fillOpacity={activeLayer === 'major' ? 0.2 : 0.28}
          lineColor={activeConfig.lineColor}
          lineWidth={activeLayer === 'major' ? 1.2 : 0.7}
          lineOpacity={0.75}
          idProperty="boundaryCode"
          selectedId={selectedId}
          selectionColor="#f97316"
          selectionWidth={3}
          onFeatureClick={handleFeatureClick}
        />
        {selectedFeature && popupLngLat && (
          <MapPopup longitude={popupLngLat[0]} latitude={popupLngLat[1]} closeButton={false}>
            <div className="min-w-52 text-sm">
              <div className="font-semibold text-foreground">{selectedFeature.properties.boundaryName}</div>
              <div className="mt-1 text-xs text-muted-foreground">{selectedFeature.properties.boundaryCode}</div>
              <div className="mt-2 text-xs text-muted-foreground">{formatArea(selectedFeature.properties)}</div>
            </div>
          </MapPopup>
        )}
      </Map>

      <aside className="absolute left-4 top-4 w-[min(360px,calc(100vw-2rem))] rounded-lg border bg-background/95 p-4 shadow-lg backdrop-blur">
        <div className="flex items-start gap-3">
          <div className="rounded-md border bg-muted p-2">
            <MapPinned className="size-4" />
          </div>
          <div>
            <h1 className="text-base font-semibold leading-tight">BC watershed dev map</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {detail === 'simplified'
                ? 'Province-wide simplified Freshwater Atlas boundaries for visual QA.'
                : 'Province-wide full WFS geometry loaded on demand for comparison.'}
            </p>
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          {(Object.keys(LAYER_CONFIG) as WatershedLayerKey[]).map((key) => (
            <Button
              key={key}
              size="sm"
              variant={activeLayer === key ? 'default' : 'outline'}
              className="flex-1"
              onClick={() => {
                handleLayerChange(key)
              }}
            >
              <Layers className="mr-2 size-4" />
              {key === 'major' ? 'Major' : 'Groups'}
            </Button>
          ))}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          {(['simplified', 'full'] as GeometryDetail[]).map((option) => (
            <Button
              key={option}
              size="sm"
              variant={detail === option ? 'default' : 'outline'}
              onClick={() => handleDetailChange(option)}
            >
              <Gauge className="mr-2 size-4" />
              {option === 'simplified' ? 'Simplified' : 'Full WFS'}
            </Button>
          ))}
        </div>

        <div className="mt-4 space-y-2 text-sm">
          {layerSummaries.map((summary) => (
            <div
              key={summary.key}
              className={cn(
                'rounded-md border p-3',
                activeLayer === summary.key ? 'border-primary bg-primary/5' : 'bg-muted/30',
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium">{summary.label}</span>
                <span className="text-xs text-muted-foreground">
                  {summary.loaded ? formatBytes(summary.size) : detail === 'full' ? 'Not loaded' : formatBytes(summary.size)}
                </span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {summary.loaded
                  ? `${summary.features.toLocaleString()} features${summary.sourceCount ? ` from ${summary.sourceCount.toLocaleString()} source records` : ''}${detail === 'simplified' && summary.simplifyKeep ? ` · mapshaper ${summary.simplifyKeep}` : ''}${detail === 'simplified' && !summary.simplifyKeep && summary.tolerance ? ` · tolerance ${summary.tolerance}` : ''}`
                  : 'Switch to this layer to fetch the full WFS payload.'}
              </div>
            </div>
          ))}
        </div>

        {(loading || fullLoadingKey === activeKey) && (
          <div className="mt-4 flex items-center gap-2 rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {fullLoadingKey === activeKey ? 'Loading full WFS geometry' : 'Loading dev watershed files'}
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}
      </aside>
    </div>
  )
}

export default DevWatersheds
