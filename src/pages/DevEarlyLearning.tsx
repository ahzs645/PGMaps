import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { FeatureCollection } from 'geojson'
import bbox from '@turf/bbox'
import { Map, useMap } from '@/components/ui/map'
import { MapFillLayer } from '@/components/ui/map-layers'
import { MAP_SIDEBAR_CLASS, MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { InlineAlert, MapSidebarShell, SidebarSection } from '@/components/ui/map-panels'
import { escapeHtml } from '@/lib/escapeHtml'
import { boundaryWithNames, describeCrosswalk, formatObservation, getObservation, joinFor, mapValues, WAVE_PERIODS, type Crosswalk, type Family, type Manifest } from './early-learning/data'

const ROOT = '/__dev_early_learning/'
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }
const MiB = (bytes = 0) => `${(bytes / 1048576).toFixed(1)} MiB`
function useLocalJson<T>(path: string | undefined) {
  const [state, setState] = useState<{ path: string; data?: T; error?: string }>()
  useEffect(() => {
    if (!path) return
    const controller = new AbortController()
    fetch(ROOT + path, { signal: controller.signal }).then(async r => {
      if (!r.ok) throw new Error('Local EDI data is unavailable. Run the capture and normalizer documented in the scraper README.')
      return r.json() as Promise<T>
    }).then(data => setState({ path, data })).catch(e => {
      if (!controller.signal.aborted) setState({ path, error: String(e.message) })
    })
    return () => controller.abort()
  }, [path])
  return state?.path === path ? state : undefined
}
function FocusRegion({ data, selected }: { data: FeatureCollection; selected: string }) {
  const { map, isLoaded } = useMap()
  useEffect(() => {
    if (!map || !isLoaded) return
    const feature = data.features.find(f => f.properties?.regionId === selected)
    if (!feature) return
    const bounds = bbox(feature)
    map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 45, maxZoom: 11, duration: 600 })
  }, [map, isLoaded, selected, data])
  return null
}
export default function DevEarlyLearning() {
  const [params] = useSearchParams()
  const release = params.get('release')
  const manifestPath = release && /^[a-f0-9]{64}$/.test(release) ? `releases/${release}.json` : 'latest.json'
  const manifestState = useLocalJson<Manifest>(import.meta.env.DEV ? manifestPath : undefined)
  const manifest = manifestState?.data
  const [datasetId, setDatasetId] = useState('')
  const dataset = manifest?.datasets.find(d => d.id === datasetId) ?? manifest?.datasets[manifest.datasets.length - 1]
  const [familyCode, setFamilyCode] = useState('GEOSD')
  const family = dataset?.families[familyCode] ? familyCode : Object.keys(dataset?.families ?? {})[0]
  const familyState = useLocalJson<Family>(dataset?.families[family]?.path)
  const data = familyState?.data
  const [waveChoice, setWave] = useState(9)
  const wave = dataset?.waves.includes(waveChoice) ? waveChoice : dataset?.waves[dataset.waves.length - 1] ?? 9
  const [measureChoice, setMeasure] = useState('pct_overall_vulnerable')
  const measure = dataset?.measures.find(m => m.id === measureChoice) ?? dataset?.measures[0]
  const [boundaryId, setBoundaryId] = useState('')
  const editions = manifest?.boundaries.filter(b => b.family === family && (b.joinPolicy === 'reference_only' || b.reportedWaves?.includes(wave))) ?? []
  const boundary = editions.find(b => b.id === boundaryId) ?? editions[0]
  const geometryState = useLocalJson<FeatureCollection>(boundary?.path)
  const geometry = useMemo(() => boundaryWithNames(geometryState?.data ?? EMPTY, boundary?.regionNames, boundary?.regionIds), [geometryState?.data, boundary?.regionNames, boundary?.regionIds])
  const crosswalkState = useLocalJson<Crosswalk>(manifest?.crosswalk?.families[family] ? manifest.crosswalk.path : undefined)
  const crosswalk = crosswalkState?.data?.families[family]
  const [selected, setSelected] = useState('GEOSD_57')
  const region = selected ? data?.regions.find(r => r.id === selected) : data?.regions[0]
  const selectedBoundaryName = geometry.features.find(f => f.properties?.regionId === selected)?.properties?.regionName as string | undefined
  const [search, setSearch] = useState('')
  const join = useMemo(() => joinFor(manifest, dataset, boundary, wave), [manifest, dataset, boundary, wave])
  const compatible = join.kind !== 'none'
  const mapData = useMemo(() => mapValues(geometry, data, wave, measure?.id ?? '', join, crosswalk), [geometry, data, wave, measure?.id, join, crosswalk])
  const currentNames = manifest?.boundaries.find(b => b.id === manifest.crosswalk?.families[family]?.reference)?.regionNames
  const ediNames = useMemo(() => Object.fromEntries((data?.regions ?? []).map(r => [r.id, r.name])), [data])
  const crosswalkNames = { current: (id: string) => currentNames?.[id] ?? id, edi: (id: string) => ediNames[id] ?? id }
  const joinEvidence = dataset?.mapJoin?.families?.[family]
  const sameArea = manifest?.crosswalk?.families[family]?.counts.same_area
  const numeric = mapData.features.flatMap(f => typeof f.properties?.value === 'number' ? [f.properties.value as number] : [])
  // Keep the colour domain stable when the user changes waves.
  const [min, max] = useMemo(() => {
    if (measure?.unit === 'percent') return [0, 100]
    const values = (data?.regions ?? []).filter(r => !r.id.endsWith('_ALL')).flatMap(r => r.observations.filter(o => o.measure === measure?.id && o.value !== null).map(o => o.value as number))
    return values.length ? [Math.min(...values), Math.max(...values)] : [0, 1]
  }, [data, measure?.id, measure?.unit])
  const error = manifestState?.error ?? familyState?.error ?? geometryState?.error ?? crosswalkState?.error
  const rows = (data?.regions ?? []).filter(r => `${r.name} ${r.id}`.toLowerCase().includes(search.toLowerCase()))
  const scale = measure?.id.split('_')[1] ?? 'overall'
  const unitLabel = measure?.unit === 'percent' ? 'Percent' : measure?.unit === 'count' ? 'Children (count)' : 'Standardized score'
  const count = measure?.unit === 'percent' ? getObservation(region, wave, measure.id.replace(/^pct_/, 'count_')) : undefined
  const observation = getObservation(region, wave, measure?.id ?? '')
  const calculation = observation?.calculation
  const selectClass = 'mt-1 w-full rounded-md border border-border bg-background px-2 py-2 text-sm'
  return <MapSectionLayout desktopSidebarWidth={420} mobilePeekTitle="Early development" mobilePeekSubtitle="EDI waves & boundary editions" sidebar={
    <MapSidebarShell title="Early development" subtitle="EDI waves & boundary editions · local review" className={MAP_SIDEBAR_CLASS}>
      {!import.meta.env.DEV && <p className="p-4">This review is available in the local development server. EDI source data has not been published.</p>}
      {error && <p role="alert" className="p-4 text-destructive">{error}</p>}
      {!manifest && !error && import.meta.env.DEV && <p className="p-4">Loading local releases…</p>}
      {manifest && <>
        <SidebarSection title="Choose a version">
          <label className="block text-sm">EDI source release<select aria-label="EDI source release" className={selectClass} value={dataset?.id} onChange={e => setDatasetId(e.target.value)}>{manifest.datasets.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}</select></label>
          <div className="mt-3 grid grid-cols-[1fr_90px] gap-2">
            <label className="text-sm">Geography<select aria-label="Geography" className={selectClass} value={family} onChange={e => { setFamilyCode(e.target.value); setSearch(''); setSelected('') }}>{Object.keys(dataset?.families ?? {}).map(c => <option key={c} value={c}>{manifest.families[c]}</option>)}</select></label>
            <label className="text-sm">EDI wave<select aria-label="EDI wave" className={selectClass} value={wave} onChange={e => setWave(Number(e.target.value))}>{dataset?.waves.map(w => <option key={w} value={w}>{w}</option>)}</select></label>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Wave {wave}: {WAVE_PERIODS[wave]}.</p>
          <label className="mt-3 block text-sm">Boundary edition<select aria-label="Boundary edition" className={selectClass} value={boundary?.id ?? ''} onChange={e => setBoundaryId(e.target.value)}>{!editions.length && <option value="">No geometry available</option>}{editions.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}</select></label>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{join.kind === 'publisher' ? `Map values use the dashboard’s Wave ${wave} polygons. Grey areas have no reported value.` : join.kind === 'crosswalk' ? `Values appear only on the ${sameArea ?? ''} current polygons that cover the same area as the dashboard’s polygon (at least ${Math.round((manifest.crosswalk?.thresholds.sameAreaIoU ?? 0.95) * 100)}% overlap). Tan areas have changed or were created later; values are not reassigned to them.` : 'Reference boundaries only. This release and wave have no verified matching geometry. Results remain available below.'}</p>
          {compatible && join.inferred && <InlineAlert tone="warning" className="mt-2" title="Inferred join">The workbook has no geometry. Its values are drawn on the dashboard’s polygon with the same area code. UBC does not publish this pairing{joinEvidence ? `, but all ${joinEvidence.overlappingValues.toLocaleString('en-CA')} values both releases publish for this geography agree` : ''}.</InlineAlert>}
          <label className="mt-3 block text-sm">Measure<select aria-label="Measure" className={selectClass} value={measure?.id} onChange={e => setMeasure(e.target.value)}>{dataset?.measures.map(m => <option key={m.id} value={m.id}>{m.label} · {m.unit === 'percent' ? '%' : m.unit === 'count' ? 'count' : 'score'}</option>)}</select></label>
          <p className="mt-2 text-xs text-muted-foreground">{unitLabel}. Missing and suppressed values are never treated as zero. {measure?.unit === 'standardized_score' && 'Darker colour indicates a higher score; interpretation depends on the subscale.'}</p>
          {dataset?.capture && !dataset.capture.complete && <p className="mt-3 rounded-md bg-amber-50 p-2 text-xs text-amber-900">Partial dashboard capture: {dataset.capture.completed} of {dataset.capture.inventoryRegions} selections. Only collected areas appear in this release.</p>}
        </SidebarSection>
        <SidebarSection title={region?.name ?? selectedBoundaryName ?? 'Area results'}>
          {!data && <p className="text-sm">Loading results…</p>}
          {data && !region && <p className="text-sm">This area has no result in this source release. Select a published area below to inspect its EDI series.</p>}
          {crosswalk && (selected || region?.id) && describeCrosswalk(crosswalk, selected || region?.id || '', crosswalkNames) && <InlineAlert className="mb-3" title="Current official boundary">{describeCrosswalk(crosswalk, selected || region?.id || '', crosswalkNames)}</InlineAlert>}
          {region && <>
            <p className="text-3xl font-semibold tracking-tight">{formatObservation(getObservation(region, wave, measure?.id ?? ''), measure?.unit)}</p>
            <p className="mt-1 text-sm text-muted-foreground">Wave {wave} · {measure?.label}</p>
            {count?.value != null && <p className="mt-2 text-sm">{formatObservation(count, 'count')} children (published count)</p>}
            {calculation && <div className="mt-3 rounded-md bg-muted p-3 text-xs leading-relaxed" aria-label="Calculation check">
              {calculation.status === 'unavailable' ? <p>Calculation check unavailable: {calculation.reason}</p> : <><p className="font-medium">Recalculated from published counts: {calculation.value?.toFixed(2)}%</p><p>{calculation.numerator?.toLocaleString('en-CA')} ÷ {calculation.denominator?.toLocaleString('en-CA')} × 100. The denominator sums this scale’s three outcome categories.</p><p>{calculation.status === 'matches' ? 'Matches the published percentage within rounding.' : `Differs from the published percentage by ${calculation.differencePp?.toFixed(3)} percentage points; the published value is retained.`}</p></>}
            </div>}
            {region.disabledWaves?.includes(wave) && <p className="mt-2 text-xs text-muted-foreground">The publisher disables Wave {wave} for this area. Its latest selectable wave is {region.detailWave}.</p>}
            {region.detailWaveSelection === 'latest_verified_map_wave' && (region.detailWave ?? 9) < 9 && <p className="mt-2 text-xs text-muted-foreground">Current-wave detail charts are unverified. Demographics and outcome bars use Wave {region.detailWave}, the latest verified map wave for this area.</p>}
            <table className="mt-4 w-full text-sm"><caption className="mb-2 text-left font-medium">Trend in this source release</caption><thead><tr className="border-b text-left"><th className="py-1">Wave</th><th className="text-right">{unitLabel}</th></tr></thead><tbody>{dataset?.waves.map(w => <tr key={w} className={w === wave ? 'bg-muted' : ''}><td className="px-1 py-1">{w}</td><td className="px-1 text-right tabular-nums">{formatObservation(getObservation(region,w,measure?.id ?? ''),measure?.unit)}</td></tr>)}</tbody></table>
            {region.meaningfulChange?.[scale] && <details className="mt-4 text-sm"><summary className="cursor-pointer font-medium">Publisher’s meaningful change · Wave {region.detailWave ?? 9} release</summary><p className="mt-2 leading-relaxed">{measure?.unit === 'standardized_score' ? region.subscaleChange?.[scale] : region.meaningfulChange[scale]}</p></details>}
            {region.demographics && <details className="mt-3 text-sm"><summary className="cursor-pointer font-medium">Demographics & participation · Wave {region.detailWave ?? 9}</summary><p className="mt-2 leading-relaxed">{region.demographics}</p><p className="mt-2 leading-relaxed">{region.participation}</p></details>}
          </>}
        </SidebarSection>
        <SidebarSection title={`Areas (${rows.length})`}>
          <label className="sr-only" htmlFor="edi-area-search">Find an area</label><input id="edi-area-search" className={selectClass} placeholder="Find an area or code" value={search} onChange={e => setSearch(e.target.value)} />
          <div className="mt-2 max-h-72 overflow-y-auto">{rows.map(r => <button key={r.id} className={`flex w-full items-start justify-between gap-3 rounded p-2 text-left text-sm hover:bg-muted ${region?.id === r.id ? 'bg-muted font-medium' : ''}`} onClick={() => setSelected(r.id)}><span>{r.name}<span className="block text-xs font-normal text-muted-foreground">{r.id}</span></span><span className="text-right tabular-nums">{formatObservation(getObservation(r,wave,measure?.id ?? ''),measure?.unit)}</span></button>)}</div>
        </SidebarSection>
        <SidebarSection title="Coverage & provenance">
          <a className="text-sm underline" href={dataset?.source} target="_blank" rel="noreferrer">Open publisher source</a>
          <a className="mt-2 block text-xs underline" href={`?release=${manifest.releaseId}`}>Permanent link to this local snapshot</a>
          <p className="mt-2 text-xs text-muted-foreground">{boundary?.features ?? 0} boundary features. Boundary effective edition: {boundary?.edition ?? 'not verified'}.</p>
          {manifest.boundaryStorage && <p className="mt-2 text-xs text-muted-foreground">{manifest.boundaryStorage.snapshots} boundary snapshots share {manifest.boundaryStorage.uniqueGeometryAssets} distinct geometry files. Wave provenance is kept separately.</p>}
          {manifest.boundaryStorage?.compressedBytes && <p className="mt-2 text-xs text-muted-foreground">Compressed: results {MiB(manifest.boundaryStorage.compressedBytes.results)}, EDI polygons {MiB(manifest.boundaryStorage.compressedBytes.ediWaveGeometry)}, official reference polygons {MiB(manifest.boundaryStorage.compressedBytes.referenceGeometry)}.</p>}
          <p className="mt-2 text-xs text-muted-foreground">Calculation checks reproduce aggregate percentages where complete counts are published. Child-level scores, standardized subscales, and meaningful-change classifications remain publisher calculations.</p>
          {boundary?.coverage && <p className="mt-2 text-xs">Areas without geometry: {boundary.coverage[dataset?.id.startsWith('workbook') ? 'workbook' : 'dashboard']?.missingGeometry.join(', ') || 'none in this capture'}.</p>}
          <details className="mt-3 text-sm"><summary className="cursor-pointer">Source notes & remaining gaps</summary><p className="mt-2 whitespace-pre-line text-xs leading-relaxed">{dataset?.notes}</p><ul className="mt-3 list-disc space-y-2 pl-4 text-xs">{manifest.gaps.map(g => <li key={g}>{g}</li>)}</ul><p className="mt-3 break-all text-xs text-muted-foreground">Immutable release: {manifest.releaseId}</p></details>
        </SidebarSection>
      </>}
    </MapSidebarShell>
  }>
    <Map center={[-124.6, 54.2]} zoom={4.5} loading={Boolean(boundary && !geometryState?.data && !geometryState?.error) || (join.kind === 'crosswalk' && !crosswalk && !crosswalkState?.error)}>
      <MapFillLayer data={mapData} idProperty="regionId" selectedId={selected || region?.id} fillColor={['case',['in',['get','status'],['literal',['boundary_changed','not_in_edi']]],'#e3d5b8',['==',['get','value'],null],'#a8b1bb',['interpolate',['linear'],['get','value'],min,'#ccece6',Math.max(max,min+0.001),'#006d5b']]} fillOpacity={0.65} onFeatureClick={id => setSelected(id)} hoverHtml={p => `<strong>${escapeHtml(String(p.regionName))}</strong><br/>${escapeHtml(p.status === 'reference_only' ? 'Reference boundary · no matched EDI values' : p.status === 'boundary_changed' ? 'Boundary changed since the EDI polygon · value not reassigned' : p.status === 'not_in_edi' ? 'Created after the EDI boundaries · no EDI value' : formatObservation(p.status === 'no_result' ? undefined : { wave, measure: measure?.id ?? '', value: typeof p.value === 'number' ? p.value : null, status: String(p.status) }, measure?.unit))}`} />
      <FocusRegion data={geometry} selected={selected || region?.id || ''} />
    </Map>
    <div className="pointer-events-none absolute right-16 top-16 max-w-56 rounded-lg border bg-background/95 p-3 text-xs shadow md:top-3">
      <p className="font-semibold">{compatible ? `${measure?.label} · Wave ${wave}` : 'Boundary reference view'}</p>
      {compatible && numeric.length > 0 && <><div className="my-2 h-2 rounded" style={{ background: 'linear-gradient(to right, #ccece6, #006d5b)' }} /><div className="flex justify-between"><span>{min}{measure?.unit === 'percent' ? '%' : ''}</span><span>{max}{measure?.unit === 'percent' ? '%' : ''}</span></div></>}
      <p className="mt-1 text-muted-foreground">{compatible ? `${numeric.length} ${numeric.length === 1 ? 'area' : 'areas'} with values · grey = unavailable${join.kind === 'crosswalk' ? ' · tan = boundary changed' : ''}` : 'No EDI values assigned to these polygons'}</p>
      {compatible && join.inferred && <p className="mt-1 text-muted-foreground">Workbook values on dashboard polygons (inferred)</p>}
    </div>
  </MapSectionLayout>
}
