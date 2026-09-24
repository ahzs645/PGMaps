import { useEffect, useMemo, useState } from 'react'
import { Flame } from 'lucide-react'
import { MapClusterLayer, MapPopup } from '@/components/ui/map'
import { MapHeatmapLayer } from '@/components/ui/map-layers'
import { InlineAlert, KeyValueRows, LegendItem, SelectedItemCard, SidebarSection, ToggleChip } from '@/components/ui/map-panels'
import { MapPopupCard } from '@/components/ui/map-popup-card'
import { AppSelect } from '@/components/ui/select'
import { MobileFeatureCard } from '@/components/ui/mobile-feature-card'
import { StatGroup } from '@/components/ui/stat-group'
import { fetchJson } from '@/lib/fetchJson'
import { DEFAULT_LOCALE, MONTH_SHORT_NAMES, formatNumber } from '@/lib/format'

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
  uwiList: string[] | null
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
  // Joined Unique Well Identifier(s); empty string when the source has none.
  uwi: string
  orientation: BcerOrientation
  area: string
  formation: string
  gas3Yr: number
  gas5Yr: number
  // Three distinct activity dates the source tracks separately ('Unknown' when absent).
  spud: string
  rigRelease: string
  firstProd: string
  weight: number
}

type BcerWellFeature = GeoJSON.Feature<GeoJSON.Point, BcerWellProperties>
type BcerWellCollection = GeoJSON.FeatureCollection<GeoJSON.Point, BcerWellProperties>

function formatYearMonth(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'Unknown'
  const year = Math.floor(value / 100)
  const month = value % 100
  if (year < 1800) return 'Unknown'
  if (month < 1 || month > 12) return String(year)
  return `${MONTH_SHORT_NAMES[month - 1]} ${year}`
}

function formatGas(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  return value.toLocaleString(DEFAULT_LOCALE, { maximumFractionDigits: 0 })
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
      uwi: (well.uwiList ?? []).map((uwi) => uwi.trim()).filter(Boolean).join(', '),
      orientation,
      area: well.areaDesc?.trim() || 'Unassigned area',
      formation: well.formDesc?.trim() || 'Unassigned formation',
      gas3Yr: Number.isFinite(well.gasProd3Yr) ? well.gasProd3Yr : 0,
      gas5Yr,
      spud: formatYearMonth(well.spudMon),
      rigRelease: formatYearMonth(well.rigRelMon),
      firstProd: formatYearMonth(well.firstProdMon),
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
          fetchJson<BcerWellRecord[]>(`${BCER_DATA_BASE}/wells/search.json.gz`, controller.signal),
          fetchJson<BcerDashboard>(`${BCER_DATA_BASE}/dashboard.json.gz`, controller.signal).catch(() => null),
          fetchJson<BcerMeta>(`${BCER_DATA_BASE}/meta.json.gz`, controller.signal).catch(() => null),
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
      ...sorted.map(([area, count]) => ({ value: area, label: `${area} (${formatNumber(count)})` })),
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
    <SidebarSection title="BCER oil & gas wells" icon={Flame} iconClassName="text-orange-600">
      <div className="space-y-4">
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
        <StatGroup
          variant="tiles"
          size="sm"
          columns={2}
          items={[
            { label: 'total wells', value: formatNumber(bcer.wells.length) },
            { label: 'visible', value: formatNumber(bcer.filteredWells.length) },
            { label: 'horizontal', value: formatNumber(bcer.horizontalCount) },
            { label: 'producing', value: formatNumber(bcer.producingCount) },
          ]}
        />
        {bcer.loading && <InlineAlert loading>Loading BCER well data...</InlineAlert>}
        {bcer.error && <InlineAlert tone="warning">{bcer.error}</InlineAlert>}
        {bcer.selectedWell && (
          <SelectedItemCard title={bcer.selectedWell.properties.name} subtitle={bcer.selectedWell.properties.operator}>
            <BcerWellDetailRows well={bcer.selectedWell} className="mt-3" />
          </SelectedItemCard>
        )}
      </div>
    </SidebarSection>
  )
}

// Shared well attributes rendered in the sidebar, desktop popup, and mobile sheet
// so every surface stays in sync. Optional dates/UWI are hidden when the source
// has no value rather than showing "Unknown" noise.
function BcerWellDetailRows({ well, className }: { well: BcerWellFeature; className?: string }) {
  const props = well.properties
  return (
    <KeyValueRows
      className={className}
      valueMaxWidth={null}
      valueClassName="capitalize"
      rows={[
        { label: 'WA number', value: String(props.waNum) },
        props.uwi ? { label: 'UWI', value: props.uwi } : null,
        { label: 'Orientation', value: props.orientation },
        { label: 'Area', value: props.area },
        { label: 'Formation', value: props.formation },
        props.spud !== 'Unknown' && { label: 'Spud', value: props.spud },
        props.rigRelease !== 'Unknown' && { label: 'Rig release', value: props.rigRelease },
        props.firstProd !== 'Unknown' && { label: 'First production', value: props.firstProd },
        { label: '3-yr gas', value: formatGas(props.gas3Yr) },
        { label: '5-yr gas', value: formatGas(props.gas5Yr) },
      ]}
    />
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
          onClose={() => bcer.setSelectedWaNum(null)}
          className="max-w-xs"
        >
          <MapPopupCard
            title={bcer.selectedWell.properties.name}
            subtitle={bcer.selectedWell.properties.operator}
            onClose={() => bcer.setSelectedWaNum(null)}
          >
            <BcerWellDetailRows well={bcer.selectedWell} />
          </MapPopupCard>
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
      <div className="rounded-md border border-border bg-background p-3 text-foreground">
        <BcerWellDetailRows well={well} />
      </div>
    </MobileFeatureCard>
  )
}

export function BcerLegend({ bcer }: { bcer: BcerState }) {
  return (
    <div className="w-full space-y-1 text-xs text-muted-foreground md:w-56">
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
        Loaded {formatNumber(bcer.wells.length)} wells with surface coordinates
        {bcer.dashboard ? ` of ${formatNumber(bcer.dashboard.totalWells)} total` : ''}.
      </p>
      <p>Served as statically exported gzipped JSON and decompressed in the browser.</p>
      <p>Gas production values are 3-year and 5-year totals as published in the BCER workbook export.</p>
    </>
  )
}
