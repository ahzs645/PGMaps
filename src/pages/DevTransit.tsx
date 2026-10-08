import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTheme } from 'next-themes'
import { Bus, Clock3, Footprints, MapPin, RotateCcw, Share2 } from 'lucide-react'
import { Map, MapControls, MapMarker, MapScaleBar, MarkerContent, type MapRef } from '@/components/ui/map'
import { MAP_SIDEBAR_CLASS, MapSectionLayout } from '@/components/layout/MapSectionLayout'
import {
  InlineAlert,
  MapLegendPanel,
  MapSidebarShell,
  MapSteppedLegend,
  SidebarSection,
} from '@/components/ui/map-panels'
import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { ToggleRow } from '@/components/ui/toggle-row'
import { StatGroup } from '@/components/ui/stat-group'
import { ExternalLink } from '@/components/ui/text-button'
import { fetchJson } from '@/lib/fetchJson'
import { PlaceSearch } from './dev-transit/PlaceSearch'
import { MapHeatViewport, MapPicking, TravelLayers } from './dev-transit/TravelLayers'
import { heatPalette } from './dev-transit/heat-raster'
import { BBOX, clockTime, DEFAULT_FROM, inside, readTravelState, writeTravelState } from './dev-transit/state'
import { meters } from './dev-transit/routing'
import { markerAccessMeters } from './dev-transit/street-access'
import type { HeatGridSpec, HeatTheme, Point, TransitData, TravelOptions, TravelResult } from './dev-transit/types'

function placeName(data: TransitData | null, point: Point) {
  const stop = data?.stops.reduce<(TransitData['stops'][number] & { distance: number }) | null>((best, s) => {
    const distance = meters(s.point, point)
    return distance < (best?.distance ?? 100) ? { ...s, distance } : best
  }, null)
  return stop?.name ?? `${point[1].toFixed(5)}, ${point[0].toFixed(5)}`
}

export default function DevTransit() {
  const { resolvedTheme, forcedTheme } = useTheme()
  const heatTheme: HeatTheme = (forcedTheme ?? resolvedTheme) === 'dark' ? 'dark' : 'light'
  const palette = heatPalette(heatTheme)
  const [params, setParams] = useSearchParams()
  const savedOptions = useMemo(() => readTravelState(params.toString()), [params])
  const [drag, setDrag] = useState<{ point: Point; origin: boolean } | null>(null)
  const options = useMemo(
    () =>
      drag
        ? {
            ...savedOptions,
            ...(drag.origin ? { from: drag.point } : { to: drag.point }),
            heatFrom: drag.origin ? ('from' as const) : ('to' as const),
          }
        : savedOptions,
    [savedOptions, drag],
  )
  const [data, setData] = useState<TransitData | null>(null)
  const [result, setResult] = useState<TravelResult | null>(null)
  const [heatGrid, setHeatGrid] = useState<HeatGridSpec | null>(null)
  const [previewOffNetwork, setPreviewOffNetwork] = useState(false)
  const isDragging = Boolean(drag)
  const dragging = useRef(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(true)
  const [pickMode, setPickMode] = useState<'from' | 'to'>('to')
  const [showHeat, setShowHeat] = useState(true)
  const [showRoutes, setShowRoutes] = useState(true)
  const [showStops, setShowStops] = useState(true)
  const [notice, setNotice] = useState('')
  const [shareUrl, setShareUrl] = useState('')
  const [retry, setRetry] = useState(0)
  const worker = useRef<Worker | null>(null)
  const request = useRef(0)
  type Job = { id: number; options: TravelOptions; heatGrid: HeatGridSpec; max: number; theme: HeatTheme }
  const active = useRef<Job | null>(null)
  const pending = useRef<Job | null>(null)
  const map = useRef<MapRef>(null)

  useEffect(() => {
    const abort = new AbortController()
    void fetchJson<TransitData>('/data/transit/prince_george_travel_time.json.gz', abort.signal)
      .then((loaded) => {
        if (loaded.schema !== 'pg-travel-time-v1') throw new Error('Unsupported transit snapshot')
        if (!abort.signal.aborted) setData(loaded)
      })
      .catch((err: Error) => {
        if (!abort.signal.aborted) {
          setError(err.message)
          setBusy(false)
        }
      })
    return () => abort.abort()
  }, [retry])

  useEffect(() => {
    if (!data) return
    const instance = new Worker(new URL('./dev-transit/travel.worker.ts', import.meta.url), { type: 'module' })
    worker.current = instance
    instance.postMessage({ data, id: 0 })
    instance.onmessage = (event: MessageEvent<{ id: number; result?: TravelResult; error?: string }>) => {
      if (event.data.id !== active.current?.id) return
      const completed = active.current
      const next = pending.current
      active.current = next
      pending.current = null
      // Show completed drag frames while the latest coordinates are pending,
      // but never pair an old timetable or transport mode with new controls.
      const compatible =
        !next ||
        (next.options.departure === completed.options.departure &&
          next.options.bus === completed.options.bus &&
          next.options.heatFrom === completed.options.heatFrom &&
          next.theme === completed.theme)
      if (event.data.error && !next) setError(event.data.error)
      else if (event.data.result && compatible) {
        const offNetwork = dragging.current && (!event.data.result.originOnNetwork || !!event.data.result.originIsolated)
        setPreviewOffNetwork(offNetwork)
        // A brief gap in street access must not clear the entire heat field.
        // Label the retained preview until access resumes or the drag ends.
        if (!offNetwork) setResult(event.data.result)
        setError('')
      }
      if (next) instance.postMessage(next)
      setBusy(Boolean(next))
    }
    instance.onerror = () => {
      setError('The travel-time worker could not run. Reload this page to try again.')
      active.current = null
      pending.current = null
      setBusy(false)
    }
    return () => {
      instance.terminate()
      worker.current = null
      active.current = null
      pending.current = null
    }
  }, [data])

  // The worker reuses the route solution when only the colour scale changes.
  const calculationKey = JSON.stringify({
    from: options.from,
    to: options.to,
    departure: options.departure,
    bus: options.bus,
    heatFrom: options.heatFrom,
  })
  const calculation = useMemo(() => JSON.parse(calculationKey) as TravelOptions, [calculationKey])
  useEffect(() => {
    if (!worker.current || !data || !heatGrid) return
    setBusy(true)
    // Retain the heat during updates. Keep just one pending calculation so a
    // long drag cannot build up a queue of obsolete pointer positions.
    const job = { options: calculation, heatGrid, max: options.max, theme: heatTheme, id: ++request.current }
    if (active.current) pending.current = job
    else {
      active.current = job
      worker.current.postMessage(job)
    }
  }, [data, calculation, heatGrid, options.max, isDragging, heatTheme])

  const setViewportGrid = useCallback((next: HeatGridSpec) => {
    setHeatGrid((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next))
  }, [])

  const update = useCallback(
    (patch: Partial<typeof options>) => {
      const next = new URLSearchParams(params)
      next.delete('to')
      new URLSearchParams(writeTravelState({ ...options, ...patch })).forEach((value, key) => next.set(key, value))
      setParams(next, { replace: true })
      setShareUrl('')
    },
    [options, params, setParams],
  )

  const pick = useCallback(
    (point: Point, origin: boolean) => {
      if (!inside(point)) {
        setNotice('Choose a point within the Prince George study area.')
        return
      }
      setNotice('')
      update(origin ? { from: point } : { to: point })
    },
    [update],
  )

  const dragPoint = (point: Point, origin: boolean) => {
    if (inside(point)) {
      dragging.current = true
      setDrag({ point, origin })
    }
  }
  const finishDrag = (point: Point, origin: boolean) => {
    dragging.current = false
    setDrag(null)
    setPreviewOffNetwork(false)
    // Match the reference: grabbing either marker makes it the heat origin.
    const validPoint = inside(point) ? point : origin ? savedOptions.from : savedOptions.to
    if (validPoint)
      update({ ...(origin ? { from: validPoint } : { to: validPoint }), heatFrom: origin ? 'from' : 'to' })
    if (!inside(point)) setNotice('Choose a point within the Prince George study area.')
  }

  async function share() {
    const url = new URL(window.location.href)
    if (map.current) {
      const center = map.current.getCenter()
      url.searchParams.set('lng', center.lng.toFixed(6))
      url.searchParams.set('lat', center.lat.toFixed(6))
      url.searchParams.set('z', map.current.getZoom().toFixed(2))
    }
    setShareUrl(url.href)
    try {
      await navigator.clipboard.writeText(url.href)
      setNotice('Map link copied.')
    } catch {
      setNotice('Copy the map link below.')
    }
  }

  const journey = previewOffNetwork ? null : result?.journey
  const sidebar = (
    <MapSidebarShell
      className={MAP_SIDEBAR_CLASS}
      title="Prince George travel times"
      subtitle="Where can you get in 30 minutes?"
      icon={Bus}
    >
      <SidebarSection>
        <p className="text-sm leading-6 text-muted-foreground">
          Drag the starting point. Click anywhere to place a destination and see the journey. Shift-click sets the
          starting point.
        </p>
        <div className="mt-3 flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void share()}>
            <Share2 className="size-3.5" />
            Share map
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              update({ ...readTravelState(''), from: DEFAULT_FROM })
              setPickMode('to')
              setNotice('')
              map.current?.fitBounds([BBOX[0], BBOX[1], BBOX[2], BBOX[3]], { padding: 40, maxZoom: 12, duration: 500 })
            }}
          >
            <RotateCcw className="size-3.5" />
            Reset
          </Button>
        </div>
        {notice && (
          <p role="status" className="mt-2 text-xs text-muted-foreground">
            {notice}
          </p>
        )}
        {shareUrl && (
          <input
            aria-label="Shareable map link"
            readOnly
            value={shareUrl}
            onFocus={(event) => event.target.select()}
            className="mt-2 w-full rounded border bg-background p-2 text-xs"
          />
        )}
      </SidebarSection>
      {error && (
        <SidebarSection>
          <InlineAlert tone="error">{error}</InlineAlert>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => {
              setError('')
              setBusy(true)
              setRetry((n) => n + 1)
            }}
          >
            Retry loading transit data
          </Button>
        </SidebarSection>
      )}
      <SidebarSection title="Journey" icon={MapPin}>
        <SegmentedControl
          value={pickMode}
          onChange={setPickMode}
          label="Point to place"
          options={[
            { value: 'from', label: 'Set starting point' },
            { value: 'to', label: 'Set destination' },
          ]}
        />
        <p className="mt-3 text-xs font-semibold text-emerald-700 dark:text-emerald-400">A · STARTING POINT</p>
        <p className="text-sm">{placeName(data, options.from)}</p>
        {options.to && (
          <>
            <div className="mt-3 flex items-center justify-between">
              <p className="text-xs font-semibold text-rose-700 dark:text-rose-400">B · DESTINATION</p>
              <Button variant="ghost" size="sm" onClick={() => update({ to: null, heatFrom: 'from' })}>
                Remove destination
              </Button>
            </div>
            <p className="text-sm">{placeName(data, options.to)}</p>
          </>
        )}
        <div className="mt-3" aria-live="polite" aria-busy={busy}>
          {busy && !drag ? (
            <InlineAlert loading>Calculating travel times…</InlineAlert>
          ) : journey ? (
            <>
              <p className="text-3xl font-semibold tracking-tight" data-testid="journey-duration">
                {Math.ceil(journey.minutes)}{' '}
                <span className="text-sm font-normal text-muted-foreground">
                  min · arrive {clockTime(journey.arrival)}
                </span>
              </p>
              <ol className="mt-3 space-y-3" aria-label="Journey steps">
                {journey.legs.map((leg, i) => (
                  <li key={i} className="flex gap-2 text-xs leading-5">
                    {leg.kind === 'bus' ? (
                      <span
                        className="mt-1 flex h-6 min-w-7 items-center justify-center rounded px-1 font-bold text-white"
                        style={{ backgroundColor: leg.color }}
                      >
                        {leg.route}
                      </span>
                    ) : (
                      <Footprints className="mt-1 size-5 shrink-0 text-muted-foreground" />
                    )}
                    <div>
                      {leg.kind === 'bus' ? (
                        <>
                          <strong>
                            Bus {leg.route} toward {leg.headsign}
                          </strong>
                          <p>
                            {leg.from} → {leg.to}
                          </p>
                          <p className="text-muted-foreground">
                            {clockTime(leg.departure)}–{clockTime(leg.arrival)} · {Math.ceil(leg.wait ?? 0)} min wait
                          </p>
                        </>
                      ) : (
                        <>
                          <strong>Walk {Math.ceil((leg.arrival - leg.departure) / 60)} min</strong>
                          <p className="text-muted-foreground">
                            {leg.from} → {leg.to}
                          </p>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            options.to &&
            !error && (
              <InlineAlert tone="warning">
                No connected journey for these points. Choose a point closer to a mapped street; walking access is
                limited to {markerAccessMeters(data?.meta ?? {})} metres from the network.
              </InlineAlert>
            )
          )}
        </div>
        {options.to && (
          <div className="mt-4">
            <SegmentedControl
              value={options.heatFrom}
              onChange={(heatFrom) => update({ heatFrom })}
              label="Map travel times from"
              options={[
                { value: 'from', label: 'From A' },
                { value: 'to', label: 'From B' },
              ]}
            />
            <p className="mt-1 text-xs text-muted-foreground">Both map views depart at the time below.</p>
          </div>
        )}
      </SidebarSection>
      <SidebarSection title="Search stops & addresses">
        {data && (
          <PlaceSearch
            data={data}
            onChoose={(point) => {
              pick(point, pickMode === 'from')
              map.current?.flyTo({ center: point, zoom: 14, duration: 500 })
            }}
          />
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          {(
            [
              { name: 'Downtown', point: DEFAULT_FROM },
              { name: 'UNBC', point: [-122.81364, 53.89128] },
              { name: 'Pine Centre', point: [-122.77958, 53.89848] },
            ] as { name: string; point: Point }[]
          ).map((place) => (
            <Button key={place.name} size="sm" variant="outline" onClick={() => pick(place.point, pickMode === 'from')}>
              {place.name}
            </Button>
          ))}
        </div>
      </SidebarSection>
      <SidebarSection title="Travel settings" icon={Clock3}>
        <label className="flex items-center justify-between gap-3 text-sm">
          Departure (Pacific time)
          <input
            type="time"
            aria-label="Departure time"
            value={clockTime(options.departure)}
            onChange={(e) => {
              if (/^\d{2}:\d{2}$/.test(e.target.value)) {
                const [h, m] = e.target.value.split(':').map(Number)
                update({ departure: h * 3600 + m * 60 })
              }
            }}
            className="rounded border bg-background p-2"
          />
        </label>
        <p className="my-2 text-xs text-muted-foreground">
          Schedule snapshot: {data?.meta.referenceDate ?? 'loading'}. Includes waiting and a 1 min boarding allowance.
        </p>
        <ToggleRow
          label="Include buses"
          icon={Bus}
          active={options.bus}
          onClick={() => update({ bus: !options.bus })}
          description="Switch off to compare walking alone."
        />
        <div className="mt-3">
          <SegmentedControl
            value={String(options.max)}
            label="Colour scale maximum"
            onChange={(max) => update({ max: Number(max) })}
            options={[30, 45, 60, 90].map((n) => ({ value: String(n), label: `${n} min` }))}
          />
        </div>
        <p className="mb-1 mt-3 text-xs font-medium">Travel-time contours</p>
        <div className="grid grid-cols-4 gap-1">
          {[15, 30, 45, 60].map((n) => (
            <Button
              key={n}
              size="sm"
              variant={options.contours.includes(n) ? 'default' : 'outline'}
              aria-pressed={options.contours.includes(n)}
              onClick={() =>
                update({
                  contours: options.contours.includes(n)
                    ? options.contours.filter((m) => m !== n)
                    : [...options.contours, n].sort((a, b) => a - b),
                })
              }
            >
              {n} min
            </Button>
          ))}
        </div>
      </SidebarSection>
      <SidebarSection title="Map layers">
        <div className="space-y-2">
          <ToggleRow label="Travel-time colours" active={showHeat} onClick={() => setShowHeat(!showHeat)} />
          <ToggleRow label="Bus routes" active={showRoutes} onClick={() => setShowRoutes(!showRoutes)} />
          <ToggleRow label="Bus stops" active={showStops} onClick={() => setShowStops(!showStops)} />
        </div>
      </SidebarSection>
      {data && (
        <SidebarSection>
          <StatGroup
            variant="tiles"
            size="sm"
            columns={3}
            items={[
              { label: 'Bus routes', value: data.routes.length },
              { label: 'Stops', value: data.stops.length },
              { label: 'Within 30 min', value: result?.reachableStops ?? '—' },
            ]}
          />
          {result && !result.originOnNetwork && (
            <InlineAlert tone="warning" className="mt-2">
              No mapped road or path within {markerAccessMeters(data.meta)} metres of the heatmap starting point.
            </InlineAlert>
          )}
          {result?.originIsolated && (
            <InlineAlert tone="warning" className="mt-2">
              Only an isolated mapped path is available here. No connection to the city street network is recorded.
            </InlineAlert>
          )}
        </SidebarSection>
      )}
      <SidebarSection title="Data & method">
        <p className="text-xs leading-5 text-muted-foreground">
          Scheduled journeys from BC Transit, with estimated walking at 4.5 km/h along City of Prince George street
          centrelines and walkways. Starting points and heat samples include up to {markerAccessMeters(data?.meta ?? {})} m
          of estimated access to the network, counted in the travel time. Transfers allow up to 650 m of walking. The heatmap is generated live for the
          current view and gains detail as you zoom in. Blank areas exceed the time limit or have no connected mapped access. Street access does not verify
          sidewalks, pedestrian permissions or accessibility. No live delays are included.
        </p>
        {data && (
          <p className="mt-2 text-xs text-muted-foreground">
            Feed validity: {data.meta.feedStart}–{data.meta.feedEnd}.
          </p>
        )}
        <div className="mt-3 flex flex-col items-start gap-2">
          <ExternalLink href="https://www.bctransit.com/open-data/">BC Transit open data</ExternalLink>
          <ExternalLink href="https://www.princegeorge.ca/city-hall/maps-access-information">
            City of Prince George GIS
          </ExternalLink>
          <ExternalLink href="https://tram.camilleroux.com/bruxelles/">
            Interaction reference · Camille Roux
          </ExternalLink>
        </div>
      </SidebarSection>
    </MapSidebarShell>
  )

  const initialLng = Number(params.get('lng')),
    initialLat = Number(params.get('lat')),
    initialZoom = Number(params.get('z'))
  const hasView = params.has('lng') && params.has('lat') && inside([initialLng, initialLat])
  return (
    <MapSectionLayout
      sidebar={sidebar}
      desktopSidebarWidth={370}
      mobileInitialSheetState="collapsed"
      mobilePeekTitle={journey ? `${Math.ceil(journey.minutes)} min to destination` : 'Prince George travel times'}
      mobilePeekSubtitle={
        busy ? 'Calculating…' : `${options.bus ? 'Bus + walk' : 'Walking'} · depart ${clockTime(options.departure)}`
      }
    >
      <div className="relative h-full" data-testid="transit-map">
        <Map
          ref={map}
          center={hasView ? [initialLng, initialLat] : [-122.775, 53.9125]}
          zoom={hasView && initialZoom >= 9 && initialZoom <= 18 ? initialZoom : 11.1}
          minZoom={9}
          maxZoom={18}
          controls={
            <MapControls position="top-right" mobilePosition="bottom-right" showZoom showCompass showFullscreen />
          }
        >
          <MapPicking onPick={pick} originMode={pickMode === 'from'} />
          {data && <MapHeatViewport study={data.meta.bbox} onChange={setViewportGrid} />}
          {data && (
            <TravelLayers
              data={data}
              result={result}
              max={options.max}
              thresholds={options.contours}
              showHeat={showHeat}
              showRoutes={showRoutes && options.bus}
              showStops={showStops}
              dragging={isDragging}
              theme={heatTheme}
            />
          )}
          <MapScaleBar />
          <MapMarker
            longitude={options.from[0]}
            latitude={options.from[1]}
            draggable
            onDragStart={({ lng, lat }) => dragPoint([lng, lat], true)}
            onDrag={({ lng, lat }) => dragPoint([lng, lat], true)}
            onDragEnd={({ lng, lat }) => finishDrag([lng, lat], true)}
          >
            <MarkerContent>
              <div
                role="img"
                aria-label="Starting point A, drag to move"
                className="flex size-9 cursor-grab items-center justify-center rounded-full border-[3px] border-white bg-emerald-700 font-bold text-white shadow-lg"
              >
                A
              </div>
            </MarkerContent>
          </MapMarker>
          {options.to && (
            <MapMarker
              longitude={options.to[0]}
              latitude={options.to[1]}
              draggable
              onDragStart={({ lng, lat }) => dragPoint([lng, lat], false)}
              onDrag={({ lng, lat }) => dragPoint([lng, lat], false)}
              onDragEnd={({ lng, lat }) => finishDrag([lng, lat], false)}
            >
              <MarkerContent>
                <div
                  role="img"
                  aria-label="Destination B, drag to move"
                  className="flex size-9 cursor-grab items-center justify-center rounded-full border-[3px] border-white bg-rose-700 font-bold text-white shadow-lg"
                >
                  B
                </div>
              </MarkerContent>
            </MapMarker>
          )}
        </Map>
        <MapLegendPanel
          title={`Travel time from ${options.heatFrom === 'to' && options.to ? 'B' : 'A'}`}
          defaultCollapsed="mobile"
          collapsible
          width="lg"
        >
          <MapSteppedLegend
            bands={palette.map((color, i) => ({ color, label: `${Math.round((i * options.max) / 4)} min` }))}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {options.bus ? 'Bus + walking' : 'Walking only'} · {clockTime(options.departure)} Pacific
          </p>
          {previewOffNetwork && (
            <p role="status" className="mt-2 text-xs text-muted-foreground">
              No nearby connected street. Showing the last connected preview while you drag.
            </p>
          )}
        </MapLegendPanel>
      </div>
    </MapSectionLayout>
  )
}
