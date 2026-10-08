import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { ArrowDownUp, Bike, Copy, Download, Footprints, MapPinned, Repeat2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { MAP_SIDEBAR_CLASS, MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { Button } from '@/components/ui/button'
import { InlineAlert, MapSidebarShell, SidebarSection } from '@/components/ui/map-panels'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Slider } from '@/components/ui/slider'
import { StatGroup } from '@/components/ui/stat-group'
import { ToggleRow } from '@/components/ui/toggle-row'
import { downloadText } from '@/lib/download'
import { requiredString, useWebMCPTools, type WebMCPTool } from '@/lib/webmcp'
import { climbText, distanceText, MILE, routeGpx, routeStreets, tripHash } from './dev-flatten/routing'
import { ElevationProfile } from './dev-flatten/ElevationProfile'
import { FlattenMap } from './dev-flatten/FlattenMap'
import { PlaceSearch } from './dev-flatten/PlaceSearch'
import { useFlatten } from './dev-flatten/useFlatten'
import { CITIES, type CityId } from './dev-flatten/cities'

export default function DevFlatten({ cityId = 'sf' }: { cityId?: CityId }) {
  const controller = useFlatten(cityId)
  const city = controller.city
  const navigate = useNavigate()
  const { trip, setTrip, units, setUnits, model, family, selected, memberIndex, loading, searching, error, setPoint, setFocus } = controller
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [shareFallback, setShareFallback] = useState('')
  const [copied, setCopied] = useState(false)
  const mapRef = useRef<MapLibreMap | null>(null)
  const onMapReady = useCallback((map: MapLibreMap | null) => { mapRef.current = map }, [])
  useEffect(() => {
    const previous = document.title
    document.title = `${city.title} · PGMaps Dev`
    return () => { document.title = previous }
  }, [city])
  useEffect(() => { setHoverIndex(null) }, [selected])
  useEffect(() => { if (copied) { const timeout = setTimeout(() => setCopied(false), 1800); return () => clearTimeout(timeout) } }, [copied])
  const streetNames = useMemo(() => model && selected ? routeStreets(model, selected) : [], [model, selected])
  const shareUrl = () => `${location.origin}${location.pathname}${location.search}${tripHash(trip) ?? ''}`
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(shareUrl()); setCopied(true); setShareFallback('') } catch { setShareFallback(shareUrl()) }
  }
  const tools: WebMCPTool[] = [
    { name: 'search_flatten_places', title: `Search ${city.name} places`, description: `Search the local ${city.title} index of places and intersections.`, inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false }, annotations: { readOnlyHint: true }, execute(input) {
      const query = requiredString(input, 'query')
      if (!model) throw new Error('The local street graph is still loading.')
      return { matches: model.index.search(query).map(({ name, kind, lon, lat }) => ({ name, kind, longitude: lon, latitude: lat })) }
    } },
    { name: 'read_flatten_route', title: 'Read the selected flat route', description: `Read the route currently visible on the PGMaps ${city.title} development page, with its distance, climbing, alternatives and share URL.`, inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, execute(input) {
      if (!input || Object.keys(input).length) throw new Error('This tool takes no parameters.')
      return { city: city.name, loading, searching, dragging: controller.dragging, error, from: trip.from, to: trip.loop ? null : trip.to, mode: trip.mode, loop: trip.loop, units,
        route: selected ? { distanceMeters: selected.stats.distance_m, climbMeters: selected.stats.elev_gain_m, steepestPercent: selected.stats.steepest * 100, index: memberIndex + 1, alternatives: family?.members.length, streets: streetNames, shareUrl: shareUrl() } : null,
        map: { engine: 'MapLibre', loaded: mapRef.current?.loaded() ?? false, routeLayer: !!mapRef.current?.getLayer('route-layer-flatten-selected') } }
    } },
  ]
  useWebMCPTools(tools)
  const status = loading ? `Loading ${city.name} streets and elevation…` : controller.dragging ? 'Live route preview · release to compare all routes.' : searching ? trip.loop ? 'Trying loops…' : 'Finding routes from shortest to flattest…' : family ? family.loop
    ? family.shortfall ? 'No loop fits that length; this is the closest.' : `The flattest of ${family.tried} loops tried.`
    : `${family.members.length} ${family.members.length === 1 ? 'route' : 'routes'}, from shortest to flattest.` : ''
  const loopValue = Math.round(trip.loopMi * (units === 'mi' ? 1 : MILE / 1000) * 2) / 2
  const [loopDraft, setLoopDraft] = useState(loopValue)
  useEffect(() => { setLoopDraft(loopValue) }, [loopValue])
  const shortest = family?.members[0]
  const sidebar = <MapSidebarShell title={city.title} subtitle={`${city.name} · PGMaps development`} icon={MapPinned} className={MAP_SIDEBAR_CLASS}>
    <SidebarSection className="space-y-4">
      <SegmentedControl label="City" value={cityId} options={[{ value: 'pg', label: 'Prince George' }, { value: 'sf', label: 'San Francisco' }]}
        onChange={(id) => navigate(CITIES[id].path)} />
      <div className="flex items-center justify-between gap-3">
        <SegmentedControl label="Travel mode" value={trip.mode} options={[{ value: 'walk', label: 'Walk', icon: Footprints }, { value: 'bike', label: 'Bike', icon: Bike }]} onChange={(mode) => setTrip((current) => ({ ...current, mode, loopIndex: 0 }))} />
        <SegmentedControl label="Units" value={units} options={[{ value: 'mi', label: 'mi' }, { value: 'km', label: 'km' }]} onChange={setUnits} fullWidth={false} />
      </div>
      <PlaceSearch label="From" place={trip.from} model={model} onSelect={(place) => setPoint('from', place, true)} onFocus={() => setFocus('from')} />
      {!trip.loop && <PlaceSearch label="To" place={trip.to} model={model} onSelect={(place) => setPoint('to', place, true)} onFocus={() => setFocus('to')} />}
      <div className="flex gap-2">
        {!trip.loop && <Button type="button" variant="outline" size="sm" disabled={!model} onClick={() => setTrip((current) => ({ ...current, from: current.to, to: current.from }))}><ArrowDownUp className="mr-2 h-4 w-4" />Swap</Button>}
        <Button type="button" variant={trip.loop ? 'default' : 'outline'} size="sm" aria-pressed={trip.loop} disabled={!model}
          onClick={() => setTrip((current) => ({ ...current, loop: !current.loop, loopIndex: 0 }))}><Repeat2 className="mr-2 h-4 w-4" />{trip.loop ? 'Point to point' : 'Make a loop'}</Button>
      </div>
      <SegmentedControl label="Endpoint to move on the map" value={trip.loop ? 'from' : controller.focus}
        options={[{ value: 'from', label: 'Move start' }, { value: 'to', label: 'Move finish', disabled: trip.loop }]}
        onChange={setFocus} />
      <p className="text-xs text-muted-foreground">Drag either dot, or choose an endpoint above and tap the map to move it.</p>
      {trip.mode === 'bike' && <ToggleRow label="Prefer calm streets" description="Favor bike lanes and quieter streets" active={trip.calm} tone="emerald" className="text-sm" onClick={() => setTrip((current) => ({ ...current, calm: !current.calm }))} />}
      {trip.loop && <ToggleRow label="Allow out and back" description="Include the same streets there and back" active={trip.outBack} tone="emerald" className="text-sm" onClick={() => setTrip((current) => ({ ...current, outBack: !current.outBack, loopIndex: 0 }))} />}
    </SidebarSection>
    <SidebarSection title={trip.loop ? 'Loop length' : 'Route preference'} className="space-y-4">
      {trip.loop ? <>
        <Slider min={units === 'mi' ? 1 : 2} max={units === 'mi' ? 15 : 24} step={0.5} value={[loopDraft]} aria-label="Loop length" disabled={!model}
          onValueChange={([value]) => setLoopDraft(value)} onValueCommit={([value]) => setTrip((current) => ({ ...current, loopMi: value * (units === 'mi' ? 1 : 1000 / MILE), loopIndex: 0 }))} />
        <p className="text-sm text-muted-foreground">{loopDraft} {units} loop</p>
      </> : <>
        <Slider min={0} max={1} step={0.001} value={[trip.t]} aria-label="From shortest to flattest" disabled={!family || family.partial}
          onValueChange={([t]) => setTrip((current) => ({ ...current, t }))} />
        <div className="flex items-center justify-between gap-2 text-sm"><span className="text-muted-foreground">Shortest</span><span className="tabular-nums">{family && `${memberIndex + 1} of ${family.members.length}`}</span><span className="text-muted-foreground">Flattest</span></div>
      </>}
      {status && <p role="status" className="text-sm text-muted-foreground">{status}</p>}
      {error && <InlineAlert tone="error" className="text-sm">{error}{!model && <Button type="button" variant="outline" size="sm" className="mt-2" onClick={controller.retry}>Retry loading</Button>}</InlineAlert>}
      {selected && <>
        <StatGroup variant="tiles" size="sm" columns={3} items={[{ label: 'Distance', value: distanceText(selected.stats.distance_m, units) }, { label: 'Climbing', value: climbText(selected.stats.elev_gain_m, units) }, { label: 'Steepest', value: `${(selected.stats.steepest * 100).toFixed(1)}%` }]} />
        <ElevationProfile member={selected} units={units} onHover={setHoverIndex} />
        {!trip.loop && shortest && selected !== shortest && <p className="text-sm text-muted-foreground">Compared with shortest: <span className="font-medium text-foreground">{distanceText(selected.stats.distance_m - shortest.stats.distance_m, units)} longer</span>, <span className="font-medium text-emerald-700 dark:text-emerald-400">{climbText(shortest.stats.elev_gain_m - selected.stats.elev_gain_m, units)} less climbing</span>.</p>}
        {trip.loop && family && family.members.length > 1 && <div className="flex flex-wrap gap-2" role="group" aria-label="Alternative loops">{family.members.map((_, index) => <Button key={index} type="button" variant={index === memberIndex ? 'default' : 'outline'} size="sm" aria-pressed={index === memberIndex} onClick={() => setTrip((current) => ({ ...current, loopIndex: index }))}>Loop {index + 1}</Button>)}</div>}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void copyLink()}><Copy className="mr-2 h-4 w-4" />{copied ? 'Link copied' : 'Copy link'}</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => downloadText(routeGpx(selected, trip.loop ? `Loop from ${trip.from?.label}` : `${trip.from?.label} to ${trip.to?.label}`, `PGMaps ${city.title}`), `flatten${cityId}-route.gpx`, 'application/gpx+xml')}><Download className="mr-2 h-4 w-4" />GPX</Button>
        </div>
        {shareFallback && <input className="w-full rounded-md border bg-background p-2 text-xs" aria-label="Link to this route" readOnly value={shareFallback} onFocus={(event) => event.currentTarget.select()} />}
      </>}
    </SidebarSection>
    {streetNames.length > 0 && <SidebarSection title="Streets along this route"><details className="text-sm"><summary className="cursor-pointer text-muted-foreground">{streetNames.length} street and path sections</summary><ol className="mt-3 list-inside list-decimal space-y-1.5">{streetNames.map((street, index) => <li key={index}>{street}</li>)}</ol></details></SidebarSection>}
    <SidebarSection title="How this works" className="space-y-2 text-sm text-muted-foreground">
      <p>Routes run in your browser over {(model?.graph.m ?? city.data.meta.n_arcs).toLocaleString()} directed street segments, using {city.dataDescription}</p>
      {city.note && <p>{city.note}</p>}
      <p>The slider follows the trade-off between distance and total climbing. Stairs are available on foot and excluded for bikes. Calm streets use comfort-weighted distance when cycling.</p>
      <p>Loops try several directions around the start and show the flattest options near the chosen length.</p>
      <p>Original routing engine by <a className="underline underline-offset-2" href="https://almostimplemented.com">Drew Edwards</a>. <a className="underline underline-offset-2" href="https://github.com/almostimplemented/flattensf">Source and analysis</a>.{cityId === 'pg' && <> <a className="underline underline-offset-2" href={`${import.meta.env.BASE_URL}data/flatten-pg/sources.json`}>Prince George data sources</a>.</>}</p>
    </SidebarSection>
  </MapSidebarShell>
  return <MapSectionLayout sidebar={sidebar} mobileInitialSheetState="half" mobileScrimEnabled={false} mobilePeekTitle={city.title}
    mobilePeekSubtitle={selected ? `${distanceText(selected.stats.distance_m, units)} · ${climbText(selected.stats.elev_gain_m, units)} climbing` : `Plan a flat route across ${city.name}`}>
    <FlattenMap controller={controller} hoverIndex={hoverIndex} onReady={onMapReady} />
  </MapSectionLayout>
}
