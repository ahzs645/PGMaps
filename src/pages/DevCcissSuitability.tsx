import { useCallback, useEffect, useState } from 'react'
import type { GeoTIFF } from 'geotiff'
import { Map, MapMarker, MarkerContent, useMap } from '@/components/ui/map'
import { MapRasterLayer } from '@/components/ui/map-layers'
import { MapSectionLayout, MAP_SIDEBAR_CLASS } from '@/components/layout/MapSectionLayout'
import { InlineAlert, MapSidebarShell, MapSwatch, SidebarSection } from '@/components/ui/map-panels'
import {
  MapCategoricalRaster,
  type CategoricalRasterPick,
  type CategoricalRasterStatus,
} from '@/components/ui/map-categorical-raster'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { fetchBytes, FetchError } from '@/lib/fetchJson'
import { feasibilityClass, sampleCcissRaster, suitabilityColor, type RasterSample } from './cciss/raster'
import { ShinyReportDialog } from './cciss/ShinyReportDialog'
import { LegacyAnalysisDialog } from './cciss/LegacyAnalysisDialog'
import { Button } from '@/components/ui/button'
import { NativeSuitabilityLayer } from './cciss/NativeSuitabilityLayer'
import {
  CCISS_GCMS,
  CCISS_PERIODS,
  CCISS_SPECIES,
  ccissTileId,
  ccissTileUrl,
  hasComparableNumericSuitability,
  type CcissLayerSelection,
} from './cciss/layers'

const POINT: [number, number] = [-122.7497, 53.9171]
const query = new URLSearchParams(window.location.search)
const queryLongitude = Number(query.get('lng'))
const queryLatitude = Number(query.get('lat'))
const queryZoom = Number(query.get('z'))
const INITIAL_POINT: [number, number] =
  query.has('lng') &&
  query.has('lat') &&
  Number.isFinite(queryLongitude) &&
  Number.isFinite(queryLatitude) &&
  queryLongitude >= -139 &&
  queryLongitude <= -114 &&
  queryLatitude >= 48 &&
  queryLatitude <= 60
    ? [queryLongitude, queryLatitude]
    : POINT
const INITIAL_ZOOM = query.has('z') && Number.isFinite(queryZoom) && queryZoom >= 4 && queryZoom <= 20 ? queryZoom : 5.5
type RenderSource = 'tiles' | 'native' | 'vector' | 'trace'
const INITIAL_RENDER_SOURCE: RenderSource =
  query.get('render') === 'trace'
    ? 'trace'
    : query.get('render') === 'vector'
      ? 'vector'
      : query.get('render') === 'native'
        ? 'native'
        : 'tiles'
const SOURCE = 'https://thebeczone.ca/shiny/cciss/'
const selectClass = 'mt-1 w-full rounded-md border border-border bg-background px-2 py-2 text-sm'
const REFERENCE_BGC = '/data/cciss/reference-bgc-1961-1990.tif'
const REFERENCE_SUITABILITY = '/data/cciss/historical-download-1961-1990-C4-Pl.cog.tif'
const REFERENCE_SUITABILITY_FALLBACK = '/data/cciss/historical-download-1961-1990-C4-Pl.tif'
const GRID_TRACE_MANIFEST = '/data/cciss/province-grid-trace/overviews/manifest.json'
const TRACE_MANIFEST = '/data/cciss/public-tile-trace/polygons/manifest.json'
const traceLabel = (code: number) =>
  code === 99 ? 'Uncertain colour' : code === 40 ? 'EX · Unsuitable' : feasibilityClass(code)
const traceColor = (code: number): [number, number, number, number] =>
  code === 99 ? [190, 40, 180, 255] : code === 40 ? [247, 247, 247, 255] : suitabilityColor(code)
const VECTOR_MANIFEST = '/data/cciss/historical-Pl-C4-polygons/manifest.json'
const DEFAULT_SELECTION: CcissLayerSelection = {
  kind: 'suitability',
  period: '1961_1990_ref',
  edatope: 'C4',
  species: 'Pl',
  statistic: 'NewFeas',
  gcm: 'Ensemble',
  byZone: false,
}

type RasterLoad = { source: File | string; image: GeoTIFFImage; origin: 'hosted' | 'file' } | null
type GeoTIFFImage = Awaited<ReturnType<GeoTIFF['getImage']>>
type SampleState = { status: 'empty' | 'loading' | 'error'; message?: string } | RasterSample

function useRasterSource(file: File | null, hostedUrl: string, fallbackHostedUrl?: string) {
  const [loaded, setLoaded] = useState<RasterLoad>(null)
  const [error, setError] = useState<{ source: File | string; message: string } | null>(null)
  const [missing, setMissing] = useState<File | string | null>(null)
  const source = file ?? hostedUrl

  useEffect(() => {
    let current = true
    let tiff: GeoTIFF | undefined
    const controller = new AbortController()
    import('geotiff')
      .then(async ({ fromBlob }) => {
        const readHostedBlob = async (url: string) => {
          const { bytes } = await fetchBytes(url, controller.signal)
          if (
            bytes.length < 4 ||
            !(
              (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0) ||
              (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0 && bytes[3] === 0x2a)
            )
          )
            throw new FetchError(url, 404)
          return new Blob([bytes as BlobPart], { type: 'image/tiff' })
        }
        let blob: Blob
        if (file) {
          blob = file
        } else {
          try {
            blob = await readHostedBlob(hostedUrl)
          } catch (cause) {
            if (!fallbackHostedUrl || !(cause instanceof FetchError) || cause.status !== 404) throw cause
            blob = await readHostedBlob(fallbackHostedUrl)
          }
        }
        tiff = await fromBlob(blob)
        if (!current) {
          await tiff.close()
          return
        }
        const image = await tiff.getImage()
        if (current) {
          setLoaded({ source, image, origin: file ? 'file' : 'hosted' })
          setError(null)
          setMissing(null)
        }
      })
      .catch((cause) => {
        if (current) {
          if (!file && cause instanceof FetchError && cause.status === 404) setMissing(source)
          else setError({ source, message: cause instanceof Error ? cause.message : String(cause) })
        }
      })
    return () => {
      current = false
      controller.abort()
      if (tiff) void tiff.close()
    }
  }, [fallbackHostedUrl, file, hostedUrl, source])

  return {
    image: loaded?.source === source ? loaded.image : null,
    origin: loaded?.source === source ? loaded.origin : null,
    error: error?.source === source ? error.message : '',
    missing: missing === source,
  }
}

function useSample(image: GeoTIFFImage | null, point: [number, number]): SampleState {
  const [result, setResult] = useState<{
    image: GeoTIFFImage
    longitude: number
    latitude: number
    value: SampleState
  } | null>(null)
  useEffect(() => {
    if (!image) return
    let current = true
    sampleCcissRaster(image, point[1], point[0])
      .then((value) => {
        if (current) setResult({ image, longitude: point[0], latitude: point[1], value })
      })
      .catch((cause) => {
        if (current)
          setResult({
            image,
            longitude: point[0],
            latitude: point[1],
            value: { status: 'error', message: cause instanceof Error ? cause.message : String(cause) },
          })
      })
    return () => {
      current = false
    }
  }, [image, point])
  if (!image) return { status: 'empty' }
  if (result && result.image === image && result.longitude === point[0] && result.latitude === point[1]) {
    return result.value
  }
  return { status: 'loading' }
}

function ClickToInspect({ onSelect }: { onSelect: (point: [number, number]) => void }) {
  const { map, isLoaded } = useMap()
  useEffect(() => {
    if (!map || !isLoaded) return
    const handleClick = (event: { lngLat: { lng: number; lat: number } }) =>
      onSelect([event.lngLat.lng, event.lngLat.lat])
    map.on('click', handleClick)
    return () => {
      map.off('click', handleClick)
    }
  }, [map, isLoaded, onSelect])
  return null
}

function SyncMapUrl({ renderSource, traceMethod }: { renderSource: RenderSource; traceMethod: 'grid' | 'pixels' }) {
  const { map, isLoaded } = useMap()

  useEffect(() => {
    const url = new URL(window.location.href)
    url.searchParams.set('render', renderSource)
    if (renderSource === 'trace') url.searchParams.set('traceMethod', traceMethod)
    else url.searchParams.delete('traceMethod')
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url)
  }, [renderSource, traceMethod])

  useEffect(() => {
    if (!map || !isLoaded) return
    const updateViewport = () => {
      const center = map.getCenter()
      const url = new URL(window.location.href)
      url.searchParams.set('lng', center.lng.toFixed(6))
      url.searchParams.set('lat', center.lat.toFixed(6))
      url.searchParams.set('z', map.getZoom().toFixed(2))
      if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url)
    }
    map.on('moveend', updateViewport)
    return () => {
      map.off('moveend', updateViewport)
    }
  }, [map, isLoaded])

  return null
}

function SampleResult({
  result,
  label,
  classValue = false,
}: {
  result: SampleState
  label: string
  classValue?: boolean
}) {
  return (
    <div className="rounded-md border bg-muted/30 p-3 text-sm">
      <p className="font-medium">{label}</p>
      {result.status === 'value' && (
        <>
          <p className="mt-1 text-xl font-semibold tabular-nums">
            {classValue ? feasibilityClass(result.value) : result.value}
          </p>
          <p className="text-xs text-muted-foreground">
            Numeric raster cell: {result.value} · column {result.column}, row {result.row}
          </p>
        </>
      )}
      {result.status === 'outside' && <p className="mt-1 text-muted-foreground">Outside this raster.</p>}
      {result.status === 'nodata' && <p className="mt-1 text-muted-foreground">No data at this point.</p>}
      {result.status === 'loading' && <p className="mt-1 text-muted-foreground">Reading cell…</p>}
      {result.status === 'empty' && <p className="mt-1 text-muted-foreground">Choose a GeoTIFF to read the value.</p>}
      {result.status === 'error' && (
        <p role="alert" className="mt-1 text-destructive">
          {result.message}
        </p>
      )}
    </div>
  )
}

export default function DevCcissSuitability() {
  const [reportOpen, setReportOpen] = useState(query.get('analysis') === 'report')
  const [analysisOpen, setAnalysisOpen] = useState(query.get('analysis') === 'legacy')
  const [point, setPoint] = useState<[number, number]>(INITIAL_POINT)
  const [bgcFile, setBgcFile] = useState<File | null>(null)
  const [suitabilityFile, setSuitabilityFile] = useState<File | null>(null)
  const [selection, setSelection] = useState<CcissLayerSelection>(DEFAULT_SELECTION)
  const [renderSource, setRenderSource] = useState<RenderSource>(INITIAL_RENDER_SOURCE)
  const [vectorStatus, setVectorStatus] = useState<CategoricalRasterStatus>({
    state: 'loading',
    message: 'Loading polygons…',
  })
  const [traceMethod, setTraceMethod] = useState<'grid' | 'pixels'>(
    query.get('traceMethod') === 'pixels' ? 'pixels' : 'grid',
  )
  const [vectorPick, setVectorPick] = useState<CategoricalRasterPick | null>(null)
  const pickPolygon = useCallback((pick: CategoricalRasterPick) => {
    setPoint([pick.longitude, pick.latitude])
    setVectorPick(pick)
  }, [])
  const tileId = ccissTileId(selection)
  const [tileStatus, setTileStatus] = useState<{ id: string; available: boolean } | null>(null)
  const bgcRaster = useRasterSource(bgcFile, REFERENCE_BGC)
  const suitabilityRaster = useRasterSource(suitabilityFile, REFERENCE_SUITABILITY, REFERENCE_SUITABILITY_FALLBACK)
  const bgc = useSample(bgcRaster.image, point)
  const suitability = useSample(suitabilityRaster.image, point)
  const numericLayer = hasComparableNumericSuitability(selection)
  const polygonLayer = numericLayer && (renderSource === 'vector' || renderSource === 'trace')

  useEffect(() => {
    const controller = new AbortController()
    fetch(`https://tileserver.thebeczone.ca/data/${tileId}.json`, { signal: controller.signal })
      .then((response) => setTileStatus({ id: tileId, available: response.ok }))
      .catch(() => {
        if (!controller.signal.aborted) setTileStatus({ id: tileId, available: false })
      })
    return () => controller.abort()
  }, [tileId])

  const tileAvailable = tileStatus?.id === tileId ? tileStatus.available : null

  return (
    <MapSectionLayout
      desktopSidebarWidth={410}
      mobilePeekTitle="CCISS spatial"
      mobilePeekSubtitle="Public tiles and numeric raster lookup"
      sidebar={
        <MapSidebarShell
          title="CCISS spatial"
          subtitle="Public CCISS layers · numeric reference lookup"
          className={MAP_SIDEBAR_CLASS}
        >
          <SidebarSection title="Analysis">
            <Button className="mb-2 mr-2" onClick={() => setReportOpen(true)}>
              Open species report
            </Button>
            {reportOpen && <ShinyReportDialog onClose={() => setReportOpen(false)} />}
            <Button onClick={() => setAnalysisOpen(true)}>Open legacy analysis</Button>
            <p className="mt-2 text-xs text-muted-foreground">
              Calculate species suitability at the selected point and explore regional trends using the older numeric
              dataset.
            </p>
            {analysisOpen && <LegacyAnalysisDialog point={point} onClose={() => setAnalysisOpen(false)} />}
          </SidebarSection>
          <SidebarSection title="Map layer">
            <label className="block text-sm">
              Display
              <select
                className={selectClass}
                value={selection.kind}
                onChange={(event) =>
                  setSelection((previous) => ({ ...previous, kind: event.target.value as CcissLayerSelection['kind'] }))
                }
              >
                <option value="suitability">Tree species suitability</option>
                <option value="bgc">BGC classification</option>
              </select>
            </label>
            <label className="mt-3 block text-sm">
              Time period
              <select
                className={selectClass}
                value={selection.period}
                onChange={(event) =>
                  setSelection((previous) => ({
                    ...previous,
                    period: event.target.value as CcissLayerSelection['period'],
                  }))
                }
              >
                {CCISS_PERIODS.map((period) => (
                  <option key={period.id} value={period.id}>
                    {period.label}
                  </option>
                ))}
              </select>
            </label>
            {selection.kind === 'suitability' ? (
              <>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <label className="block text-sm">
                    Species
                    <select
                      className={selectClass}
                      value={selection.species}
                      onChange={(event) =>
                        setSelection((previous) => ({
                          ...previous,
                          species: event.target.value as CcissLayerSelection['species'],
                        }))
                      }
                    >
                      {CCISS_SPECIES.map((species) => (
                        <option key={species} value={species}>
                          {species}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm">
                    Edatope
                    <select
                      className={selectClass}
                      value={selection.edatope}
                      onChange={(event) =>
                        setSelection((previous) => ({
                          ...previous,
                          edatope: event.target.value as CcissLayerSelection['edatope'],
                        }))
                      }
                    >
                      {(['B2', 'C4', 'D6'] as const).map((edatope) => (
                        <option key={edatope} value={edatope}>
                          {edatope}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {!selection.period.startsWith('1961_1990') && (
                  <label className="mt-3 block text-sm">
                    Map type
                    <select
                      className={selectClass}
                      value={selection.statistic}
                      onChange={(event) =>
                        setSelection((previous) => ({
                          ...previous,
                          statistic: event.target.value as CcissLayerSelection['statistic'],
                        }))
                      }
                    >
                      <option value="NewFeas">Projected suitability</option>
                      <option value="MeanChange">Suitability change</option>
                    </select>
                  </label>
                )}
              </>
            ) : (
              <>
                <label className="mt-3 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selection.byZone}
                    onChange={(event) => setSelection((previous) => ({ ...previous, byZone: event.target.checked }))}
                  />
                  Group by zone
                </label>
                {selection.period.startsWith('20') && selection.period !== '2001_2020_obs' && (
                  <label className="mt-3 block text-sm">
                    Climate model
                    <select
                      className={selectClass}
                      value={selection.gcm}
                      onChange={(event) =>
                        setSelection((previous) => ({
                          ...previous,
                          gcm: event.target.value as CcissLayerSelection['gcm'],
                        }))
                      }
                    >
                      {CCISS_GCMS.map((gcm) => (
                        <option key={gcm} value={gcm}>
                          {gcm}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            )}
            <p className="mt-2 break-all text-xs text-muted-foreground">CCISS tile set: {tileId}</p>
            {numericLayer && (
              <div className="mt-3">
                <p className="mb-1 text-sm">Compare map sources</p>
                <SegmentedControl<RenderSource>
                  label="Compare map sources"
                  value={renderSource}
                  onChange={(value) => {
                    setRenderSource(value)
                    setVectorPick(null)
                  }}
                  variant="solid"
                  options={[
                    { value: 'tiles', label: 'CCISS tiles' },
                    { value: 'native', label: 'Numeric GeoTIFF', disabled: !suitabilityRaster.image },
                    { value: 'vector', label: 'Vector', disabled: Boolean(suitabilityFile) },
                    { value: 'trace', label: 'Tile trace' },
                  ]}
                />
                <p className="mt-1 text-xs text-muted-foreground">The location and zoom stay in place as you switch.</p>
              </div>
            )}
            {polygonLayer && (
              <div className="mt-2 space-y-2">
                <p className="text-xs text-muted-foreground">
                  {renderSource === 'trace'
                    ? traceMethod === 'grid'
                      ? 'Full published layer coverage for mapped 1961–1990 Pl/C4, reconstructed on an assumed 10-arc-second grid. Purple marks unresolved cells. Inferred display classes; not used for calculations.'
                      : 'Pixel-by-pixel colour tracing of the same nine tiles. Purple marks ambiguous pixels (0.42%). Inferred display classes; not used for calculations. No coverage outside the test area.'
                    : 'Polygons from the same historical Pl/C4 download. Original cell boundaries and class codes are preserved.'}
                </p>
                {renderSource === 'trace' && (
                  <SegmentedControl<'grid' | 'pixels'>
                    label="Tile reconstruction method"
                    value={traceMethod}
                    variant="solid"
                    onChange={(value) => {
                      setTraceMethod(value)
                      setVectorPick(null)
                    }}
                    options={[
                      { value: 'grid', label: 'Grid cells' },
                      { value: 'pixels', label: 'Image pixels (sample)' },
                    ]}
                  />
                )}
                {renderSource === 'trace' && (
                  <a
                    className="text-xs underline"
                    href={
                      traceMethod === 'grid'
                        ? '?lng=-126.526528&lat=54.154306&z=4.5&render=trace&traceMethod=grid'
                        : '?lng=-124.666920&lat=54.209275&z=12&render=trace&traceMethod=pixels'
                    }
                  >
                    {traceMethod === 'grid' ? 'View whole layer' : 'View pixel-trace sample'}
                  </a>
                )}
                <InlineAlert
                  tone={vectorStatus.state === 'error' ? 'error' : 'info'}
                  loading={vectorStatus.state === 'loading'}
                >
                  {vectorStatus.message}
                </InlineAlert>
              </div>
            )}
            {numericLayer && renderSource === 'native' && (
              <p className="mt-2 text-xs text-muted-foreground">
                PGMaps draws the downloaded GeoTIFF’s cells at every zoom. Regional features also differ from the public
                mapped tiles; the blue branch west of Prince George appears only in the download.
              </p>
            )}
            {numericLayer && renderSource === 'native' && !suitabilityRaster.image && (
              <p className="mt-2 text-xs text-muted-foreground">
                {suitabilityRaster.missing
                  ? 'The numeric GeoTIFF is not hosted here; select a local download below.'
                  : 'Loading the numeric GeoTIFF…'}
              </p>
            )}
            {tileAvailable === false && !(numericLayer && renderSource !== 'tiles') && (
              <p role="alert" className="mt-2 text-sm text-destructive">
                This tile set is unavailable from the CCISS server.
              </p>
            )}
          </SidebarSection>
          <SidebarSection title="Inspect a location">
            <p className="text-sm">
              {renderSource === 'trace' && numericLayer
                ? 'Click a traced polygon to inspect its inferred display class. The downloaded GeoTIFF below is a separate source.'
                : polygonLayer
                  ? 'Click a polygon to compare its stored class with the numeric GeoTIFF cell.'
                  : 'Click the map to read the downloaded numeric GeoTIFF. Compare public CCISS tiles, numeric raster rendering, and vector polygons.'}
            </p>
            <p className="mt-2 text-xs tabular-nums text-muted-foreground">
              {point[1].toFixed(5)}° N, {Math.abs(point[0]).toFixed(5)}° W
            </p>
            {numericLayer ? (
              <div className="mt-3 space-y-2">
                <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
                  Public CCISS tiles differ from the download used by Numeric GeoTIFF and Vector. For example, at
                  53.96654° N, 122.85202° W, the download says Moderate while the public mapped tile is High.
                </p>
                <SampleResult result={suitability} label="Downloaded Pl/C4 GeoTIFF class" classValue />
                {polygonLayer && (
                  <InlineAlert
                    title={renderSource === 'trace' ? 'Inferred tile colour class' : 'Picked vector polygon'}
                  >
                    {vectorPick
                      ? renderSource === 'trace'
                        ? `${traceLabel(vectorPick.value)} · ${vectorPick.overview ? 'generalized overview; zoom in for the full cell' : 'inferred from WebP colours, not a measured value'}`
                        : `${feasibilityClass(vectorPick.value)} · numeric code ${vectorPick.value}`
                      : 'Click a polygon to inspect its class.'}
                  </InlineAlert>
                )}
                <SampleResult result={bgc} label="BGC raster ID" />
              </div>
            ) : (
              <p className="mt-3 rounded-md border p-3 text-sm text-muted-foreground">
                Numeric lookup currently covers mapped 1961–1990 suitability for Pl on C4. The other visible layers are
                image tiles.
              </p>
            )}
          </SidebarSection>
          {selection.kind === 'suitability' &&
            (selection.period.startsWith('1961_1990') || selection.statistic !== 'MeanChange') && (
              <SidebarSection title="Climatic suitability">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {(
                    [
                      ['#006400', 'E1 · High'],
                      ['#1E90FF', 'E2 · Moderate'],
                      ['#EEC900', 'E3 · Low'],
                      ['#F7F7F7', 'EX · Unsuitable'],
                    ] as const
                  ).map(([color, label]) => (
                    <div key={label} className="flex items-center gap-2">
                      <MapSwatch color={color} />
                      {label}
                    </div>
                  ))}
                </div>
              </SidebarSection>
            )}
          {selection.kind === 'suitability' &&
            selection.statistic === 'MeanChange' &&
            !selection.period.startsWith('1961_1990') && (
              <SidebarSection title="Suitability change">
                <p className="text-xs text-muted-foreground">
                  Red tones indicate decline; blue tones indicate improvement. See the CCISS Spatial legend for newly
                  suitable and unsuitable classes.
                </p>
              </SidebarSection>
            )}
          <SidebarSection title="Read exact raster values">
            <p className="mb-3 text-sm">
              The historical Pl/C4 download and reference BGC GeoTIFFs load automatically when PGMaps has a prepared
              snapshot. You can also select your own downloads; selected files stay in this browser.
            </p>
            <label className="block text-sm">
              Reference BGC GeoTIFF
              <input
                className={selectClass}
                type="file"
                accept=".tif,.tiff,image/tiff"
                onChange={(event) => setBgcFile(event.target.files?.[0] ?? null)}
              />
            </label>
            {bgcRaster.error && (
              <p role="alert" className="mt-1 text-xs text-destructive">
                {bgcRaster.error}
              </p>
            )}
            <label className="mt-3 block text-sm">
              Pl · C4 suitability GeoTIFF
              <input
                className={selectClass}
                type="file"
                accept=".tif,.tiff,image/tiff"
                onChange={(event) => {
                  setSuitabilityFile(event.target.files?.[0] ?? null)
                  if (renderSource === 'vector') setRenderSource('native')
                  setVectorPick(null)
                }}
              />
            </label>
            {suitabilityRaster.error && (
              <p role="alert" className="mt-1 text-xs text-destructive">
                {suitabilityRaster.error}
              </p>
            )}
            {(bgcRaster.origin || suitabilityRaster.origin) && (
              <p className="mt-2 text-xs text-muted-foreground">
                Numeric source:{' '}
                {bgcRaster.origin === 'hosted' || suitabilityRaster.origin === 'hosted'
                  ? 'PGMaps snapshot'
                  : 'selected local files'}
                .
              </p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              The class label assumes the second file is the historical Pl/C4 suitability download. Check the selection
              before interpreting a value.
            </p>
            <a
              className="mt-3 inline-block text-sm underline"
              href="https://thebeczone.ca/shiny/cciss/downloadable_docs/Subzone_Legend.csv"
              target="_blank"
              rel="noreferrer"
            >
              BGC ID legend
            </a>
          </SidebarSection>
          <SidebarSection title="Site-specific calculation">
            <p className="text-sm">
              The values above are province-wide raster cells. CCISS’s site-specific report also needs the point’s site
              series, member-by-member BGC predictions, edatopic overlap, suitability tables, and model weights. Those
              prediction arrays are not included in the public map tiles or GeoTIFF downloads.
            </p>
            <p className="mt-2 text-sm">
              The calculation can be connected when we have a version-matched data export or read-only CCISS calculation
              service.
            </p>
          </SidebarSection>
          <SidebarSection title="Other CCISS pages and reports">
            <p className="text-sm">
              CCISS also has site selection, a detailed and summary suitability report, BEC futures charts and a map,
              silvics tables, exports, species outlooks, and documentation.
            </p>
            <p className="mt-2 text-sm">
              The reports and BEC futures chart consume results generated from the remote model database. Public tiles
              support the spatial views; the public methods and model information can be linked immediately.
            </p>
            <a
              className="mt-2 inline-block text-sm underline"
              href="https://bcgov-ffec.ca/cciss-docs/Instructions.html"
              target="_blank"
              rel="noreferrer"
            >
              See the CCISS page guide
            </a>
          </SidebarSection>
          <SidebarSection title="Source">
            <a className="text-sm underline" href={SOURCE} target="_blank" rel="noreferrer">
              Open CCISS Spatial
            </a>
            <p className="mt-2 text-xs text-muted-foreground">
              Map overlay: CCISS tile server, numeric GeoTIFF tiles, or polygons generated from that download. Numeric
              results: a prepared GeoTIFF or your local download. Tile trace is a separate colour reconstruction with
              inferred labels, never a numeric calculation source.
            </p>
          </SidebarSection>
        </MapSidebarShell>
      }
    >
      <Map center={INITIAL_POINT} zoom={INITIAL_ZOOM}>
        <SyncMapUrl renderSource={numericLayer ? renderSource : 'tiles'} traceMethod={traceMethod} />
        {polygonLayer ? (
          <MapCategoricalRaster
            manifestUrl={
              renderSource === 'trace'
                ? traceMethod === 'grid'
                  ? GRID_TRACE_MANIFEST
                  : TRACE_MANIFEST
                : VECTOR_MANIFEST
            }
            colorForValue={renderSource === 'trace' ? traceColor : suitabilityColor}
            onPick={pickPolygon}
            onStatus={setVectorStatus}
            attribution={
              renderSource === 'trace'
                ? 'Inferred CCISS WebP colours · BC Ministry of Forests'
                : 'CCISS GeoTIFF download · BC Ministry of Forests'
            }
          />
        ) : numericLayer && renderSource === 'native' ? (
          suitabilityRaster.image && <NativeSuitabilityLayer key={tileId} image={suitabilityRaster.image} />
        ) : (
          tileAvailable && (
            <MapRasterLayer
              key={tileId}
              tiles={[ccissTileUrl(tileId)]}
              minZoom={5}
              maxZoom={12}
              opacity={0.8}
              resampling="nearest"
              attribution="CCISS · BC Ministry of Forests"
            />
          )
        )}
        {!polygonLayer && <ClickToInspect onSelect={setPoint} />}
        <MapMarker longitude={point[0]} latitude={point[1]}>
          <MarkerContent>
            <div className="size-4 rounded-full border-2 border-white bg-fuchsia-600 shadow-lg ring-4 ring-fuchsia-300/50" />
          </MarkerContent>
        </MapMarker>
      </Map>
    </MapSectionLayout>
  )
}
