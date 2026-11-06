import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { FeatureCollection } from 'geojson'
import { geometryBounds } from '@/lib/geo'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { Map, useMap } from '@/components/ui/map'
import { MapFillLayer } from '@/components/ui/map-layers'
import { MAP_SIDEBAR_CLASS, MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { numberColumn, textColumn } from '@/components/map/tableColumns'
import { MapTableBridge, defineTableSource, useMapTable } from '@/components/map/useMapTable'
import {
  InlineAlert,
  MapGradientLegendItem,
  MapLegendNote,
  MapLegendPanel,
  MapSidebarShell,
  SearchInput,
  SidebarSection,
} from '@/components/ui/map-panels'
import { ListHeader, ListState, ResultRow } from '@/components/ui/result-list'
import { VirtualResultList } from '@/components/ui/virtual-result-list'
import { NativeSelect } from '@/components/ui/form-field'
import { ExternalLink } from '@/components/ui/text-button'
import { useFetchData } from '@/hooks/useFetchData'
import { escapeHtml } from '@/lib/escapeHtml'
import { featureCenter, featuresBounds } from '@/lib/featureBounds'
import { formatBytes } from '@/lib/format'
import {
  boundaryWithNames,
  describeCrosswalk,
  formatObservation,
  getObservation,
  joinFor,
  mapValues,
  WAVE_PERIODS,
  type Crosswalk,
  type Family,
  type Manifest,
  type Measure,
} from './early-learning/data'

const ROOT = '/__dev_early_learning/'
const storedSize = (bytes = 0) => formatBytes(bytes)
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }
/** The value ramp, low to high: the map's fill and the legend both read it. */
const VALUE_RAMP = ['#ccece6', '#006d5b'] as const

type RegionFeature = GeoJSON.Feature

const regionId = (feature: RegionFeature) => String(feature.properties?.regionId)

/** The reason a polygon has no value, in the words the map's tooltip uses. */
function regionStatus(feature: RegionFeature): string {
  const { status, value } = feature.properties ?? {}
  if (typeof value === 'number') return 'Reported'
  if (status === 'reference_only') return 'Reference boundary'
  if (status === 'boundary_changed') return 'Boundary changed'
  if (status === 'not_in_edi') return 'Not in EDI'
  if (status === 'no_result') return 'No value in this release'
  return formatObservation({ wave: 0, measure: '', value: null, status: String(status) })
}

/** One row per region: the selected measure at the selected wave, under a header that names both. */
function regionColumns(measure: Measure | undefined, wave: number) {
  const unit = measure?.unit
  return [
    textColumn<RegionFeature>('name', 'Area', (feature) => String(feature.properties?.regionName ?? ''), {
      width: 240,
    }),
    textColumn<RegionFeature>('code', 'Code', (feature) => regionId(feature).replace(/^[A-Z]+_/, ''), { width: 90 }),
    numberColumn<RegionFeature>(
      'value',
      `${measure?.label ?? 'Value'} · Wave ${wave}`,
      (feature) => feature.properties?.value as number | null,
      {
        format: (value) => formatObservation({ wave, measure: measure?.id ?? '', value, status: '' }, unit),
        width: 240,
      },
    ),
    textColumn<RegionFeature>('status', 'Status', regionStatus),
  ]
}

function useLocalJson<T>(path: string | undefined) {
  const state = useFetchData<T>(import.meta.env.DEV && path ? ROOT + path : null)
  return {
    ...state,
    error: state.error
      ? `Local EDI data is unavailable. Run the capture and normalizer documented in the scraper README. ${state.error}`
      : null,
  }
}
function FocusRegion({ data, selected }: { data: FeatureCollection; selected: string }) {
  const { map, isLoaded } = useMap()
  useEffect(() => {
    if (!map || !isLoaded) return
    const feature = data.features.find((f) => f.properties?.regionId === selected)
    if (!feature) return
    const bounds = geometryBounds(feature.geometry)
    if (!bounds) return
    map.fitBounds(
      [
        [bounds[0], bounds[1]],
        [bounds[2], bounds[3]],
      ],
      { padding: 45, maxZoom: 11, duration: 600 },
    )
  }, [map, isLoaded, selected, data])
  return null
}
function useRegionTableSources(mapData: FeatureCollection, measure: Measure | undefined, wave: number) {
  return useMemo(
    () =>
      mapData.features.length
        ? [
            defineTableSource<RegionFeature>({
              id: 'regions',
              label: 'Early development areas',
              color: VALUE_RAMP[1],
              shape: 'fill',
              rows: mapData.features,
              columns: regionColumns(measure, wave),
              getRowId: regionId,
              getRowCenter: featureCenter,
              getRowBounds: (feature) => featuresBounds([feature]),
            }),
          ]
        : [],
    [mapData, measure, wave],
  )
}

export default function DevEarlyLearning() {
  const [params] = useSearchParams()
  const release = params.get('release')
  const manifestPath = release && /^[a-f0-9]{64}$/.test(release) ? `releases/${release}.json` : 'latest.json'
  const manifestState = useLocalJson<Manifest>(import.meta.env.DEV ? manifestPath : undefined)
  const manifest = manifestState?.data
  const [datasetId, setDatasetId] = useState('')
  const dataset = manifest?.datasets.find((d) => d.id === datasetId) ?? manifest?.datasets[manifest.datasets.length - 1]
  const [familyCode, setFamilyCode] = useState('GEOSD')
  const family = dataset?.families[familyCode] ? familyCode : Object.keys(dataset?.families ?? {})[0]
  const familyState = useLocalJson<Family>(dataset?.families[family]?.path)
  const data = familyState?.data
  const [waveChoice, setWave] = useState(9)
  const wave = dataset?.waves.includes(waveChoice) ? waveChoice : (dataset?.waves[dataset.waves.length - 1] ?? 9)
  const [measureChoice, setMeasure] = useState('pct_overall_vulnerable')
  const measure = dataset?.measures.find((m) => m.id === measureChoice) ?? dataset?.measures[0]
  const [boundaryId, setBoundaryId] = useState('')
  const editions = useMemo(
    () =>
      manifest?.boundaries.filter(
        (b) => b.family === family && (b.joinPolicy === 'reference_only' || b.reportedWaves?.includes(wave)),
      ) ?? [],
    [family, manifest, wave],
  )
  const boundary = useMemo(() => editions.find((b) => b.id === boundaryId) ?? editions[0], [boundaryId, editions])
  const geometryState = useLocalJson<FeatureCollection>(boundary?.path)
  const geometry = useMemo(
    () => boundaryWithNames(geometryState?.data ?? EMPTY, boundary?.regionNames, boundary?.regionIds),
    [geometryState?.data, boundary?.regionNames, boundary?.regionIds],
  )
  const crosswalkState = useLocalJson<Crosswalk>(
    manifest?.crosswalk?.families[family] ? manifest.crosswalk.path : undefined,
  )
  const crosswalk = crosswalkState?.data?.families[family]
  const [selected, setSelected] = useState('GEOSD_57')
  const region = selected ? data?.regions.find((r) => r.id === selected) : data?.regions[0]
  const selectedBoundaryName = geometry.features.find((f) => f.properties?.regionId === selected)?.properties
    ?.regionName as string | undefined
  const [search, setSearch] = useState('')
  const join = useMemo(
    () => joinFor(manifest ?? undefined, dataset, boundary, wave),
    [manifest, dataset, boundary, wave],
  )
  const compatible = join.kind !== 'none'
  const mapData = useMemo(
    () => mapValues(geometry, data ?? undefined, wave, measure?.id ?? '', join, crosswalk),
    [geometry, data, wave, measure?.id, join, crosswalk],
  )
  const currentNames = manifest?.boundaries.find(
    (b) => b.id === manifest.crosswalk?.families[family]?.reference,
  )?.regionNames
  const ediNames = useMemo(() => Object.fromEntries((data?.regions ?? []).map((r) => [r.id, r.name])), [data])
  const crosswalkNames = { current: (id: string) => currentNames?.[id] ?? id, edi: (id: string) => ediNames[id] ?? id }
  const joinEvidence = dataset?.mapJoin?.families?.[family]
  const sameArea = manifest?.crosswalk?.families[family]?.counts.same_area
  const numeric = mapData.features.flatMap((f) =>
    typeof f.properties?.value === 'number' ? [f.properties.value as number] : [],
  )
  // Keep the colour domain stable when the user changes waves.
  const [min, max] = useMemo(() => {
    if (measure?.unit === 'percent') return [0, 100]
    const values = (data?.regions ?? [])
      .filter((r) => !r.id.endsWith('_ALL'))
      .flatMap((r) =>
        r.observations.filter((o) => o.measure === measure?.id && o.value !== null).map((o) => o.value as number),
      )
    return values.length ? [Math.min(...values), Math.max(...values)] : [0, 1]
  }, [data, measure?.id, measure?.unit])
  const error = manifestState?.error ?? familyState?.error ?? geometryState?.error ?? crosswalkState?.error
  const rows = (data?.regions ?? []).filter((r) => `${r.name} ${r.id}`.toLowerCase().includes(search.toLowerCase()))
  const scale = measure?.id.split('_')[1] ?? 'overall'
  const unitLabel =
    measure?.unit === 'percent' ? 'Percent' : measure?.unit === 'count' ? 'Children (count)' : 'Standardized score'
  const count =
    measure?.unit === 'percent' ? getObservation(region, wave, measure.id.replace(/^pct_/, 'count_')) : undefined
  const observation = getObservation(region, wave, measure?.id ?? '')
  const calculation = observation?.calculation
  const selectClass = 'mt-1 w-full rounded-md border border-border bg-background px-2 py-2 text-sm'
  const sidebar = (
    <MapSidebarShell
      title="Early development"
      subtitle="EDI waves & boundary editions · local review"
      className={MAP_SIDEBAR_CLASS}
    >
      {!import.meta.env.DEV && (
        <p className="p-4">
          This review is available in the local development server. EDI source data has not been published.
        </p>
      )}
      {error && (
        <div className="p-4">
          <InlineAlert tone="error">{error}</InlineAlert>
        </div>
      )}
      {!manifest && !error && import.meta.env.DEV && (
        <div className="p-4">
          <InlineAlert loading>Loading local releases…</InlineAlert>
        </div>
      )}
      {manifest && (
        <>
          <SidebarSection title="Choose a version">
            <label className="block text-sm">
              EDI source release
              <NativeSelect
                aria-label="EDI source release"
                className={selectClass}
                value={dataset?.id}
                onChange={(e) => setDatasetId(e.target.value)}
              >
                {manifest.datasets.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <div className="mt-3 grid grid-cols-[1fr_90px] gap-2">
              <label className="text-sm">
                Geography
                <NativeSelect
                  aria-label="Geography"
                  className={selectClass}
                  value={family}
                  onChange={(e) => {
                    setFamilyCode(e.target.value)
                    setSearch('')
                    setSelected('')
                  }}
                >
                  {Object.keys(dataset?.families ?? {}).map((c) => (
                    <option key={c} value={c}>
                      {manifest.families[c]}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <label className="text-sm">
                EDI wave
                <NativeSelect
                  aria-label="EDI wave"
                  className={selectClass}
                  value={wave}
                  onChange={(e) => setWave(Number(e.target.value))}
                >
                  {dataset?.waves.map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Wave {wave}: {WAVE_PERIODS[wave]}.
            </p>
            <label className="mt-3 block text-sm">
              Boundary edition
              <NativeSelect
                aria-label="Boundary edition"
                className={selectClass}
                value={boundary?.id ?? ''}
                onChange={(e) => setBoundaryId(e.target.value)}
              >
                {!editions.length && <option value="">No geometry available</option>}
                {editions.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {join.kind === 'publisher'
                ? `Map values use the dashboard’s Wave ${wave} polygons. Grey areas have no reported value.`
                : join.kind === 'crosswalk'
                  ? `Values appear only on the ${sameArea ?? ''} current polygons that cover the same area as the dashboard’s polygon (at least ${Math.round((manifest.crosswalk?.thresholds.sameAreaIoU ?? 0.95) * 100)}% overlap). Tan areas have changed or were created later; values are not reassigned to them.`
                  : 'Reference boundaries only. This release and wave have no verified matching geometry. Results remain available below.'}
            </p>
            {compatible && join.inferred && (
              <InlineAlert tone="warning" className="mt-2" title="Inferred join">
                The workbook has no geometry. Its values are drawn on the dashboard’s polygon with the same area code.
                UBC does not publish this pairing
                {joinEvidence
                  ? `, but all ${joinEvidence.overlappingValues.toLocaleString('en-CA')} values both releases publish for this geography agree`
                  : ''}
                .
              </InlineAlert>
            )}
            <label className="mt-3 block text-sm">
              Measure
              <NativeSelect
                aria-label="Measure"
                className={selectClass}
                value={measure?.id}
                onChange={(e) => setMeasure(e.target.value)}
              >
                {dataset?.measures.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} · {m.unit === 'percent' ? '%' : m.unit === 'count' ? 'count' : 'score'}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <p className="mt-2 text-xs text-muted-foreground">
              {unitLabel}. Missing and suppressed values are never treated as zero.{' '}
              {measure?.unit === 'standardized_score' &&
                'Darker colour indicates a higher score; interpretation depends on the subscale.'}
            </p>
            {dataset?.capture && !dataset.capture.complete && (
              <p className="mt-3 rounded-md bg-amber-50 p-2 text-xs text-amber-900">
                Partial dashboard capture: {dataset.capture.completed} of {dataset.capture.inventoryRegions} selections.
                Only collected areas appear in this release.
              </p>
            )}
          </SidebarSection>
          <SidebarSection title={region?.name ?? selectedBoundaryName ?? 'Area results'}>
            {!data && <p className="text-sm">Loading results…</p>}
            {data && !region && (
              <p className="text-sm">
                This area has no result in this source release. Select a published area below to inspect its EDI series.
              </p>
            )}
            {crosswalk &&
              (selected || region?.id) &&
              describeCrosswalk(crosswalk, selected || region?.id || '', crosswalkNames) && (
                <InlineAlert className="mb-3" title="Current official boundary">
                  {describeCrosswalk(crosswalk, selected || region?.id || '', crosswalkNames)}
                </InlineAlert>
              )}
            {region && (
              <>
                <p className="text-3xl font-semibold tracking-tight">
                  {formatObservation(getObservation(region, wave, measure?.id ?? ''), measure?.unit)}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Wave {wave} · {measure?.label}
                </p>
                {count?.value != null && (
                  <p className="mt-2 text-sm">{formatObservation(count, 'count')} children (published count)</p>
                )}
                {calculation && (
                  <div className="mt-3 rounded-md bg-muted p-3 text-xs leading-relaxed" aria-label="Calculation check">
                    {calculation.status === 'unavailable' ? (
                      <p>Calculation check unavailable: {calculation.reason}</p>
                    ) : (
                      <>
                        <p className="font-medium">
                          Recalculated from published counts: {calculation.value?.toFixed(2)}%
                        </p>
                        <p>
                          {calculation.numerator?.toLocaleString('en-CA')} ÷{' '}
                          {calculation.denominator?.toLocaleString('en-CA')} × 100. The denominator sums this scale’s
                          three outcome categories.
                        </p>
                        <p>
                          {calculation.status === 'matches'
                            ? 'Matches the published percentage within rounding.'
                            : `Differs from the published percentage by ${calculation.differencePp?.toFixed(3)} percentage points; the published value is retained.`}
                        </p>
                      </>
                    )}
                  </div>
                )}
                {region.disabledWaves?.includes(wave) && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    The publisher disables Wave {wave} for this area. Its latest selectable wave is {region.detailWave}.
                  </p>
                )}
                {region.detailWaveSelection === 'latest_verified_map_wave' && (region.detailWave ?? 9) < 9 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Current-wave detail charts are unverified. Demographics and outcome bars use Wave{' '}
                    {region.detailWave}, the latest verified map wave for this area.
                  </p>
                )}
                <EngineeringTable className="mt-4 whitespace-normal text-xs [&_td]:py-1">
                  <caption className="mb-2 text-left text-sm font-medium">Trend in this source release</caption>
                  <thead>
                    <tr>
                      <ColumnHeader label="Wave" className="text-left" />
                      <ColumnHeader label={unitLabel} />
                    </tr>
                  </thead>
                  <tbody>
                    {dataset?.waves.map((w) => (
                      <tr key={w} aria-selected={w === wave}>
                        <td className="text-left">{w}</td>
                        <td>{formatObservation(getObservation(region, w, measure?.id ?? ''), measure?.unit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </EngineeringTable>
                {region.meaningfulChange?.[scale] && (
                  <details className="mt-4 text-sm">
                    <summary className="cursor-pointer font-medium">
                      Publisher’s meaningful change · Wave {region.detailWave ?? 9} release
                    </summary>
                    <p className="mt-2 leading-relaxed">
                      {measure?.unit === 'standardized_score'
                        ? region.subscaleChange?.[scale]
                        : region.meaningfulChange[scale]}
                    </p>
                  </details>
                )}
                {region.demographics && (
                  <details className="mt-3 text-sm">
                    <summary className="cursor-pointer font-medium">
                      Demographics & participation · Wave {region.detailWave ?? 9}
                    </summary>
                    <p className="mt-2 leading-relaxed">{region.demographics}</p>
                    <p className="mt-2 leading-relaxed">{region.participation}</p>
                  </details>
                )}
              </>
            )}
          </SidebarSection>
          <SidebarSection title={`Areas (${rows.length})`}>
            <SearchInput
              id="edi-area-search"
              aria-label="Find an area"
              icon
              placeholder="Find an area or code"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onClear={() => setSearch('')}
            />
            <ListHeader count={rows.length} noun={['area', 'areas']} sticky={false} />
            <ListState
              loading={familyState.loading}
              error={familyState.error}
              empty={!rows.length}
              emptyLabel="No matching areas."
              onReset={() => setSearch('')}
            >
              <VirtualResultList items={rows} getKey={(r) => r.id} estimateSize={65} label="Early development areas">
                {(r) => (
                  <ResultRow
                    title={r.name}
                    subtitle={r.id}
                    selected={region?.id === r.id}
                    accent="teal"
                    onClick={() => setSelected(r.id)}
                    trailing={formatObservation(getObservation(r, wave, measure?.id ?? ''), measure?.unit)}
                  />
                )}
              </VirtualResultList>
            </ListState>
          </SidebarSection>
          <SidebarSection title="Coverage & provenance">
            {dataset?.source && <ExternalLink href={dataset.source}>Open publisher source</ExternalLink>}
            <a className="mt-2 block text-xs underline" href={`?release=${manifest.releaseId}`}>
              Permanent link to this local snapshot
            </a>
            <p className="mt-2 text-xs text-muted-foreground">
              {boundary?.features ?? 0} boundary features. Boundary effective edition:{' '}
              {boundary?.edition ?? 'not verified'}.
            </p>
            {manifest.boundaryStorage && (
              <p className="mt-2 text-xs text-muted-foreground">
                {manifest.boundaryStorage.snapshots} boundary snapshots share{' '}
                {manifest.boundaryStorage.uniqueGeometryAssets} distinct geometry files. Wave provenance is kept
                separately.
              </p>
            )}
            {manifest.boundaryStorage?.compressedBytes && (
              <p className="mt-2 text-xs text-muted-foreground">
                Compressed: results {storedSize(manifest.boundaryStorage.compressedBytes.results)}, EDI polygons{' '}
                {storedSize(manifest.boundaryStorage.compressedBytes.ediWaveGeometry)}, official reference polygons{' '}
                {storedSize(manifest.boundaryStorage.compressedBytes.referenceGeometry)}.
              </p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Calculation checks reproduce aggregate percentages where complete counts are published. Child-level
              scores, standardized subscales, and meaningful-change classifications remain publisher calculations.
            </p>
            {boundary?.coverage && (
              <p className="mt-2 text-xs">
                Areas without geometry:{' '}
                {boundary.coverage[dataset?.id.startsWith('workbook') ? 'workbook' : 'dashboard']?.missingGeometry.join(
                  ', ',
                ) || 'none in this capture'}
                .
              </p>
            )}
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer">Source notes & remaining gaps</summary>
              <p className="mt-2 whitespace-pre-line text-xs leading-relaxed">{dataset?.notes}</p>
              <ul className="mt-3 list-disc space-y-2 pl-4 text-xs">
                {manifest.gaps.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
              <p className="mt-3 break-all text-xs text-muted-foreground">Immutable release: {manifest.releaseId}</p>
            </details>
          </SidebarSection>
        </>
      )}
    </MapSidebarShell>
  )
  const tableSources = useRegionTableSources(mapData, measure, wave)
  // `FocusRegion` already fits the map to a selected area.
  const table = useMapTable({
    sources: tableSources,
    selectedRowId: selected || region?.id || null,
    onSelectRow: (feature: RegionFeature) => setSelected(regionId(feature)),
    flyOnSelect: false,
  })
  return (
    <MapSectionLayout
      desktopSidebarWidth={420}
      mobilePeekTitle="Early development"
      mobilePeekSubtitle="EDI waves & boundary editions"
      table={table}
      sidebar={sidebar}
    >
      <Map
        center={[-124.6, 54.2]}
        zoom={4.5}
        loading={
          Boolean(boundary && !geometryState?.data && !geometryState?.error) ||
          (join.kind === 'crosswalk' && !crosswalk && !crosswalkState?.error)
        }
        deferResize={table.deferResize}
      >
        <MapTableBridge table={table} />
        <MapFillLayer
          data={mapData}
          idProperty="regionId"
          selectedId={selected || region?.id}
          fillColor={[
            'case',
            ['in', ['get', 'status'], ['literal', ['boundary_changed', 'not_in_edi']]],
            '#e3d5b8',
            ['==', ['get', 'value'], null],
            '#a8b1bb',
            [
              'interpolate',
              ['linear'],
              ['get', 'value'],
              min,
              VALUE_RAMP[0],
              Math.max(max, min + 0.001),
              VALUE_RAMP[1],
            ],
          ]}
          fillOpacity={0.65}
          onFeatureClick={(id) => setSelected(id)}
          hoverHtml={(p) =>
            `<strong>${escapeHtml(String(p.regionName))}</strong><br/>${escapeHtml(p.status === 'reference_only' ? 'Reference boundary · no matched EDI values' : p.status === 'boundary_changed' ? 'Boundary changed since the EDI polygon · value not reassigned' : p.status === 'not_in_edi' ? 'Created after the EDI boundaries · no EDI value' : formatObservation(p.status === 'no_result' ? undefined : { wave, measure: measure?.id ?? '', value: typeof p.value === 'number' ? p.value : null, status: String(p.status) }, measure?.unit))}`
          }
        />
        <FocusRegion data={geometry} selected={selected || region?.id || ''} />
        <MapLegendPanel
          title={compatible ? `${measure?.label} · Wave ${wave}` : 'Boundary reference view'}
          collapsible
          defaultCollapsed="mobile"
          width="sm"
        >
          {compatible && numeric.length > 0 && (
            <MapGradientLegendItem
              colors={VALUE_RAMP}
              minLabel={`${min}${measure?.unit === 'percent' ? '%' : ''}`}
              maxLabel={`${max}${measure?.unit === 'percent' ? '%' : ''}`}
            />
          )}
          <MapLegendNote className="mt-1 px-0">
            {compatible
              ? `${numeric.length} ${numeric.length === 1 ? 'area' : 'areas'} with values · grey = unavailable${join.kind === 'crosswalk' ? ' · tan = boundary changed' : ''}`
              : 'No EDI values assigned to these polygons'}
          </MapLegendNote>
          {compatible && join.inferred && (
            <MapLegendNote className="mt-1 px-0">Workbook values on dashboard polygons (inferred)</MapLegendNote>
          )}
        </MapLegendPanel>
      </Map>
    </MapSectionLayout>
  )
}
