import { useEffect, useMemo, useState } from 'react'
import { Flame, Gauge } from 'lucide-react'
import { MapClusterLayer, MapPopup } from '@/components/ui/map'
import { MapHeatmapLayer } from '@/components/ui/map-layers'
import { InlineAlert, LegendItem, StatGrid, ToggleChip } from '@/components/ui/map-panels'
import { AppSelect } from '@/components/ui/select'
import { MobileFeatureCard } from '@/components/ui/mobile-feature-card'

// BCER (British Columbia Energy Regulator) oil and gas well data, served as
// statically exported gzipped JSON from the BCER Data Viewer deploy. The files
// are plain `.json.gz` (Content-Type: application/gzip, no Content-Encoding),
// so they have to be decompressed client side rather than relying on the
// browser's transparent gzip handling. CORS is open (Access-Control-Allow-Origin: *).
export const BCER_DATA_BASE = 'https://projects.ahmadjalil.com/BCER/data'
// Wells cluster in north-east BC (Montney / Peace region); centre the map there.
export const BCER_CENTER: [number, number] = [-121.9, 57.3]
export const BCER_ZOOM = 5

type BcerOrientation = 'horizontal' | 'vertical'
type BcerOrientationFilter = 'all' | BcerOrientation
type BcerProductionFilter = 'all' | 'producing'

// Shape of each row in wells/search.json.gz (subset of the BCER WellSearchResult).
interface BcerWellRecord {
  waNum: number
  wellName: string | null
  operator: string | null
  operatorAbbr: string | null
  areaCode: number | null
  areaDesc: string | null
  formCode: number | null
  formDesc: string | null
  spudMon: number | null
  rigRelMon: number | null
  firstProdMon: number | null
  orientation: string | null
  surfLat: number | null
  surfLon: number | null
  gasProd3Yr: number
  gasProd5Yr: number
}

interface BcerDashboard {
  totalWells: number
  totalHorizontal: number
  totalVertical: number
  dataCurrentTo: string
  topAreas: Array<{ areaDesc: string; count: number }>
  topFormations: Array<{ formDesc: string; count: number }>
}

interface BcerMeta {
  sourceAgency?: string
  sourceWebsite?: string
  dataCurrentTo?: string
  importTimestamp?: string
}

interface BcerWellProperties {
  waNum: number
  name: string
  operator: string
  orientation: BcerOrientation
  area: string
  formation: string
  gas3Yr: number
  gas5Yr: number
  spud: string
  weight: number
}

type BcerWellFeature = GeoJSON.Feature<GeoJSON.Point, BcerWellProperties>
type BcerWellCollection = GeoJSON.FeatureCollection<GeoJSON.Point, BcerWellProperties>

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatYearMonth(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'Unknown'
  const year = Math.floor(value / 100)
  const month = value % 100
  if (year < 1800) return 'Unknown'
  if (month < 1 || month > 12) return String(year)
  return `${MONTH_LABELS[month - 1]} ${year}`
}

function formatGas(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

async function fetchGzipJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`)
  const buffer = await response.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
  if (isGzip && typeof DecompressionStream !== 'undefined') {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
    const text = await new Response(stream).text()
    return JSON.parse(text) as T
  }
  // Either not gzip (server transparently decompressed it) or no DecompressionStream.
  return JSON.parse(new TextDecoder().decode(bytes)) as T
}

function toFeature(well: BcerWellRecord): BcerWellFeature {
  const orientation: BcerOrientation = (well.orientation ?? '').toUpperCase().startsWith('H')
    ? 'horizontal'
    : 'vertical'
  const gas5Yr = Number.isFinite(well.gasProd5Yr) ? well.gasProd5Yr : 0
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [well.surfLon as number, well.surfLat as number] },
    properties: {
      waNum: well.waNum,
      name: well.wellName?.replace(/\s+/g, ' ').trim() || `WA #${well.waNum}`,
      operator: well.operator?.trim() || 'Unknown operator',
      orientation,
      area: well.areaDesc?.trim() || 'Unassigned area',
      formation: well.formDesc?.trim() || 'Unassigned formation',
      gas3Yr: Number.isFinite(well.gasProd3Yr) ? well.gasProd3Yr : 0,
      gas5Yr,
      spud: formatYearMonth(well.spudMon ?? well.firstProdMon ?? well.rigRelMon),
      // Log scale keeps a handful of very high producers from washing out the heatmap.
      weight: gas5Yr > 0 ? Math.log10(gas5Yr + 1) : 0,
    },
  }
}

export const BCER_ORIENTATION_OPTIONS: Array<{ value: BcerOrientationFilter; label: string }> = [
  { value: 'all', label: 'All wells' },
  { value: 'horizontal', label: 'Horizontal' },
  { value: 'vertical', label: 'Vertical' },
]

export const BCER_PRODUCTION_OPTIONS: Array<{ value: BcerProductionFilter; label: string }> = [
  { value: 'all', label: 'All wells' },
  { value: 'producing', label: 'Producing (5-yr gas > 0)' },
]

const BCER_ORIENTATION_BUCKETS: Array<{ id: BcerOrientation; label: string; color: string }> = [
  { id: 'horizontal', label: 'Horizontal', color: '#f97316' },
  { id: 'vertical', label: 'Vertical', color: '#2563eb' },
]

export function useBcerData(active: boolean) {
  const [orientationFilter, setOrientationFilter] = useState<BcerOrientationFilter>('all')
  const [areaFilter, setAreaFilter] = useState<string>('all')
  const [productionFilter, setProductionFilter] = useState<BcerProductionFilter>('all')
  const [showPoints, setShowPoints] = useState(true)
  const [showHeatmap, setShowHeatmap] = useState(false)
  const [wells, setWells] = useState<BcerWellFeature[]>([])
  const [dashboard, setDashboard] = useState<BcerDashboard | null>(null)
  const [meta, setMeta] = useState<BcerMeta | null>(null)
  const [selectedWaNum, setSelectedWaNum] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!active || loaded) return
    const controller = new AbortController()

    async function load() {
      try {
        setLoading(true)
        setError(null)
        const [search, dash, metaData] = await Promise.all([
          fetchGzipJson<BcerWellRecord[]>(`${BCER_DATA_BASE}/wells/search.json.gz`, controller.signal),
          fetchGzipJson<BcerDashboard>(`${BCER_DATA_BASE}/dashboard.json.gz`, controller.signal).catch(() => null),
          fetchGzipJson<BcerMeta>(`${BCER_DATA_BASE}/meta.json.gz`, controller.signal).catch(() => null),
        ])
        const features = search
          .filter(
            (well) =>
              typeof well.surfLat === 'number' &&
              typeof well.surfLon === 'number' &&
              Number.isFinite(well.surfLat) &&
              Number.isFinite(well.surfLon),
          )
          .map(toFeature)
        setWells(features)
        setDashboard(dash)
        setMeta(metaData)
        setLoaded(true)
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setError((err as Error).message || 'Unable to load BCER well data')
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void load()
    return () => controller.abort()
  }, [active, loaded])

  const areaOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const well of wells) {
      counts.set(well.properties.area, (counts.get(well.properties.area) ?? 0) + 1)
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
    return [
      { value: 'all', label: 'All areas' },
      ...sorted.map(([area, count]) => ({ value: area, label: `${area} (${count.toLocaleString()})` })),
    ]
  }, [wells])

  const filteredWells = useMemo(
    () =>
      wells.filter((well) => {
        if (orientationFilter !== 'all' && well.properties.orientation !== orientationFilter) return false
        if (areaFilter !== 'all' && well.properties.area !== areaFilter) return false
        if (productionFilter === 'producing' && well.properties.gas5Yr <= 0) return false
        return true
      }),
    [wells, orientationFilter, areaFilter, productionFilter],
  )

  const filteredCollection = useMemo<BcerWellCollection>(
    () => ({ type: 'FeatureCollection', features: filteredWells }),
    [filteredWells],
  )

  const selectedWell = useMemo(
    () => wells.find((well) => well.properties.waNum === selectedWaNum) ?? null,
    [wells, selectedWaNum],
  )

  const horizontalCount = useMemo(
    () => filteredWells.filter((well) => well.properties.orientation === 'horizontal').length,
    [filteredWells],
  )
  const producingCount = useMemo(
    () => filteredWells.filter((well) => well.properties.gas5Yr > 0).length,
    [filteredWells],
  )

  return {
    orientationFilter,
    setOrientationFilter,
    areaFilter,
    setAreaFilter,
    productionFilter,
    setProductionFilter,
    showPoints,
    setShowPoints,
    showHeatmap,
    setShowHeatmap,
    wells,
    filteredWells,
    filteredCollection,
    areaOptions,
    dashboard,
    meta,
    selectedWell,
    selectedWaNum,
    setSelectedWaNum,
    horizontalCount,
    producingCount,
    loading,
    error,
  }
}

export type BcerState = ReturnType<typeof useBcerData>

export function BcerLayerControls({ bcer }: { bcer: BcerState }) {
  return (
    <div className="flex flex-wrap gap-2">
      <ToggleChip active={bcer.showPoints} onClick={() => bcer.setShowPoints((current) => !current)}>
        {bcer.showPoints ? 'Hide wells' : 'Show wells'}
      </ToggleChip>
      <ToggleChip active={bcer.showHeatmap} onClick={() => bcer.setShowHeatmap((current) => !current)} tone="orange">
        Production heatmap
      </ToggleChip>
    </div>
  )
}

export function BcerSidebar({ bcer }: { bcer: BcerState }) {
  return (
    <div className="space-y-4 border-b border-border p-4">
      <div className="mb-1 flex items-center gap-2">
        <Flame className="h-4 w-4 text-orange-600" />
        <h2 className="text-sm font-semibold text-foreground">BCER oil &amp; gas wells</h2>
      </div>
      <label className="block text-xs font-medium text-foreground">
        Orientation
        <AppSelect
          value={bcer.orientationFilter}
          onValueChange={(value) => bcer.setOrientationFilter(value as BcerState['orientationFilter'])}
          options={BCER_ORIENTATION_OPTIONS}
          className="mt-1"
          triggerClassName="h-8 rounded-md text-xs"
        />
      </label>
      <label className="block text-xs font-medium text-foreground">
        Area
        <AppSelect
          value={bcer.areaFilter}
          onValueChange={(value) => bcer.setAreaFilter(value)}
          options={bcer.areaOptions}
          className="mt-1"
          triggerClassName="h-8 rounded-md text-xs"
        />
      </label>
      <label className="block text-xs font-medium text-foreground">
        Production
        <AppSelect
          value={bcer.productionFilter}
          onValueChange={(value) => bcer.setProductionFilter(value as BcerState['productionFilter'])}
          options={BCER_PRODUCTION_OPTIONS}
          className="mt-1"
          triggerClassName="h-8 rounded-md text-xs"
        />
      </label>
      <StatGrid
        columns={2}
        stats={[
          { label: 'total wells', value: bcer.wells.length.toLocaleString() },
          { label: 'visible', value: bcer.filteredWells.length.toLocaleString() },
          { label: 'horizontal', value: bcer.horizontalCount.toLocaleString() },
          { label: 'producing', value: bcer.producingCount.toLocaleString() },
        ]}
      />
      {bcer.loading && <div className="text-xs text-muted-foreground">Loading BCER well data...</div>}
      {bcer.error && <InlineAlert tone="warning">{bcer.error}</InlineAlert>}
      {bcer.selectedWell && (
        <div className="rounded-md border border-border bg-background p-3 text-xs">
          <div className="font-semibold text-foreground">{bcer.selectedWell.properties.name}</div>
          <div className="mt-1 text-muted-foreground">{bcer.selectedWell.properties.operator}</div>
          <div className="mt-3 space-y-1">
            <BcerDetailRow label="WA number" value={String(bcer.selectedWell.properties.waNum)} />
            <BcerDetailRow label="Orientation" value={bcer.selectedWell.properties.orientation} />
            <BcerDetailRow label="Area" value={bcer.selectedWell.properties.area} />
            <BcerDetailRow label="Formation" value={bcer.selectedWell.properties.formation} />
            <BcerDetailRow label="Spud / first activity" value={bcer.selectedWell.properties.spud} />
            <BcerDetailRow label="3-yr gas" value={formatGas(bcer.selectedWell.properties.gas3Yr)} />
            <BcerDetailRow label="5-yr gas" value={formatGas(bcer.selectedWell.properties.gas5Yr)} />
          </div>
        </div>
      )}
      <div className="rounded-md border border-border bg-muted/20 p-3 text-xs leading-5 text-muted-foreground">
        Surface coordinates and production summaries from the British Columbia Energy Regulator, assembled by George
        Macauley and served as static gzipped JSON. Gas production values are 3-year and 5-year totals as published in
        the BCER workbook export.
      </div>
    </div>
  )
}

function BcerDetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium capitalize text-foreground">{value}</span>
    </div>
  )
}

export function BcerLayer({ bcer, isMobile = false }: { bcer: BcerState; isMobile?: boolean }) {
  const pointCollections = useMemo(
    () =>
      BCER_ORIENTATION_BUCKETS.map((bucket) => [
        bucket,
        {
          type: 'FeatureCollection' as const,
          features: bcer.filteredCollection.features.filter(
            (feature) => feature.properties.orientation === bucket.id,
          ),
        },
      ] as const).filter(([, collection]) => collection.features.length > 0),
    [bcer.filteredCollection],
  )

  return (
    <>
      {bcer.showHeatmap && bcer.filteredCollection.features.length > 0 && (
        <MapHeatmapLayer
          data={bcer.filteredCollection}
          intensityStops={[
            [0, 0.5],
            [6, 1.1],
            [10, 1.6],
          ]}
          radiusStops={[
            [0, 5],
            [6, 16],
            [10, 28],
          ]}
          opacity={0.75}
          colorRamp={[
            [0, 'rgba(249, 115, 22, 0)'],
            [0.2, '#fdba74'],
            [0.45, '#fb923c'],
            [0.7, '#f97316'],
            [1, '#b91c1c'],
          ]}
        />
      )}
      {bcer.showPoints &&
        pointCollections.map(([bucket, collection]) => (
          <MapClusterLayer<BcerWellProperties>
            key={bucket.id}
            data={collection}
            pointColor={bucket.color}
            clusterColors={[`${bucket.color}99`, `${bucket.color}cc`, bucket.color]}
            clusterThresholds={[100, 750]}
            onPointClick={(feature) =>
              bcer.setSelectedWaNum(
                bcer.selectedWaNum === feature.properties.waNum ? null : feature.properties.waNum,
              )
            }
          />
        ))}
      {bcer.selectedWell && !isMobile && (
        <MapPopup
          longitude={bcer.selectedWell.geometry.coordinates[0]}
          latitude={bcer.selectedWell.geometry.coordinates[1]}
          closeButton
          onClose={() => bcer.setSelectedWaNum(null)}
          className="max-w-xs"
        >
          <div className="space-y-2 text-xs">
            <div>
              <div className="font-semibold text-foreground">{bcer.selectedWell.properties.name}</div>
              <div className="text-muted-foreground">{bcer.selectedWell.properties.operator}</div>
            </div>
            <BcerDetailRow label="WA number" value={String(bcer.selectedWell.properties.waNum)} />
            <BcerDetailRow label="Orientation" value={bcer.selectedWell.properties.orientation} />
            <BcerDetailRow label="Area" value={bcer.selectedWell.properties.area} />
            <BcerDetailRow label="Formation" value={bcer.selectedWell.properties.formation} />
            <BcerDetailRow label="5-yr gas" value={formatGas(bcer.selectedWell.properties.gas5Yr)} />
          </div>
        </MapPopup>
      )}
    </>
  )
}

export function MobileBcerFeatureCard({ bcer }: { bcer: BcerState }) {
  const well = bcer.selectedWell
  if (!well) return null

  return (
    <MobileFeatureCard
      cardKey={well.properties.waNum}
      title={well.properties.name}
      subtitle={well.properties.operator}
      onClose={() => bcer.setSelectedWaNum(null)}
    >
      <div className="rounded-md border border-border bg-background p-3 text-xs text-foreground">
        <div className="space-y-1">
          <BcerDetailRow label="WA number" value={String(well.properties.waNum)} />
          <BcerDetailRow label="Orientation" value={well.properties.orientation} />
          <BcerDetailRow label="Area" value={well.properties.area} />
          <BcerDetailRow label="Formation" value={well.properties.formation} />
          <BcerDetailRow label="Spud / first activity" value={well.properties.spud} />
          <BcerDetailRow label="3-yr gas" value={formatGas(well.properties.gas3Yr)} />
          <BcerDetailRow label="5-yr gas" value={formatGas(well.properties.gas5Yr)} />
        </div>
      </div>
    </MobileFeatureCard>
  )
}

export function BcerLegend({ bcer }: { bcer: BcerState }) {
  return (
    <div className="w-full space-y-2 text-xs text-muted-foreground md:w-56">
      <div className="flex items-center gap-2 font-medium text-foreground">
        <Gauge className="h-3.5 w-3.5 text-orange-500" />
        BCER wells
      </div>
      {BCER_ORIENTATION_BUCKETS.map((bucket) => (
        <LegendItem
          key={bucket.id}
          color={bucket.color}
          label={bucket.label}
          active={bcer.showPoints && (bcer.orientationFilter === 'all' || bcer.orientationFilter === bucket.id)}
          onClick={() => {
            if (!bcer.showPoints) bcer.setShowPoints(true)
            bcer.setOrientationFilter(bcer.orientationFilter === bucket.id ? 'all' : bucket.id)
          }}
        />
      ))}
      <LegendItem
        color="#f97316"
        label="Production heatmap"
        active={bcer.showHeatmap}
        swatchShape="square"
        onClick={() => bcer.setShowHeatmap((current) => !current)}
      />
    </div>
  )
}

export function BcerSourceNotes({ bcer }: { bcer: BcerState }) {
  const currentTo = bcer.meta?.dataCurrentTo ?? bcer.dashboard?.dataCurrentTo
  return (
    <>
      <p>
        British Columbia Energy Regulator well data{currentTo ? `, current to ${currentTo}` : ''}, assembled by George
        Macauley (www.bc-er.ca).
      </p>
      <p>
        Loaded {bcer.wells.length.toLocaleString()} wells with surface coordinates
        {bcer.dashboard ? ` of ${bcer.dashboard.totalWells.toLocaleString()} total` : ''}.
      </p>
      <p>Served as statically exported gzipped JSON and decompressed in the browser.</p>
    </>
  )
}
