import { Sprout } from 'lucide-react'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { ForestryBackLink } from '@/components/dev/ForestryBackLink'
import { useObserveMapViewport } from '@/components/ui/map-viewport'
import { NativeSelect } from '@/components/ui/form-field'
import { useCallback, useEffect, useState } from 'react'
import type { GeoTIFF } from 'geotiff'
import { Map, MapMarker, MarkerContent, useMap, WORKSPACE_MAP_CONTROLS } from '@/components/ui/map'
import { MapRasterLayer } from '@/components/ui/map-layers'
import { MapSectionLayout, MAP_SIDEBAR_CLASS } from '@/components/layout/MapSectionLayout'
import { CollapsibleSection, InlineAlert, MapSidebarShell, MapSwatch, SidebarSection } from '@/components/ui/map-panels'
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
import { CurrentAnalysisDialog } from './cciss/CurrentAnalysisDialog'
import { ComparisonDialog } from './cciss/ComparisonDialog'
import { useComparisonSnapshots } from './cciss/useComparisonSnapshots'
import { Button } from '@/components/ui/button'
import { NativeSuitabilityLayer } from './cciss/NativeSuitabilityLayer'
import {
  DEFAULT_CCISS_SELECTION,
  ccissMapOptions,
  normalizeCcissSelection,
  ccissTileId,
  ccissTileUrl,
  type CcissLayerSelection,
} from './cciss/layers'
import { ccissPreparedMapProduct, ccissSourceOptions } from './cciss/mapSources'
import {
  readCcissWorkspace,
  writeCcissWorkspace,
  type CcissAnalysisMode,
  type CcissRenderSource as RenderSource,
} from './cciss/workspace'

const INITIAL_WORKSPACE = readCcissWorkspace(window.location.search)
const INITIAL_RENDER_SOURCE = INITIAL_WORKSPACE.renderSource
const SOURCE = 'https://thebeczone.ca/shiny/cciss/'
const selectClass = 'mt-1 w-full rounded-md border border-border bg-background px-2 py-2 text-sm'
const REFERENCE_BGC = '/data/cciss/reference-bgc-1961-1990.tif'
const traceLabel = (code: number) =>
  code === 99 ? 'Uncertain colour' : code === 40 ? 'EX · Unsuitable' : feasibilityClass(code)
const traceColor = (code: number): [number, number, number, number] =>
  code === 99 ? [190, 40, 180, 255] : code === 40 ? [247, 247, 247, 255] : suitabilityColor(code)

type RasterLoad = { source: File | string; image: GeoTIFFImage; origin: 'hosted' | 'file' } | null
type GeoTIFFImage = Awaited<ReturnType<GeoTIFF['getImage']>>
type SampleState = { status: 'empty' | 'loading' | 'error'; message?: string } | RasterSample

function useRasterSource(file: File | null, hostedUrl: string | null, fallbackHostedUrl?: string) {
  const [loaded, setLoaded] = useState<RasterLoad>(null)
  const [error, setError] = useState<{ source: File | string; message: string } | null>(null)
  const [missing, setMissing] = useState<File | string | null>(null)
  const source = file ?? hostedUrl

  useEffect(() => {
    if (!source) return
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
            blob = await readHostedBlob(hostedUrl!)
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

function SyncMapUrl() {
  const { map, isLoaded } = useMap()

  useObserveMapViewport(
    map,
    ({ zoom }) => {
      if (!map) return
      const center = map.getCenter()
      const url = new URL(window.location.href)
      url.searchParams.set('lng', center.lng.toFixed(6))
      url.searchParams.set('lat', center.lat.toFixed(6))
      url.searchParams.set('z', zoom.toFixed(2))
      if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url)
    },
    { enabled: isLoaded, events: ['moveend'], initial: 'none' },
  )

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
  useDocumentTitle('CCISS suitability · PGMaps')
  const [analysis, setAnalysis] = useState<CcissAnalysisMode>(INITIAL_WORKSPACE.analysis)
  const comparisons = useComparisonSnapshots()
  const openComparison = useCallback(() => setAnalysis('compare'), [])
  const [point, setPoint] = useState<[number, number]>(INITIAL_WORKSPACE.point)
  const [bgcFile, setBgcFile] = useState<File | null>(null)
  const [suitabilityFile, setSuitabilityFile] = useState<File | null>(null)
  const [selection, setSelection] = useState<CcissLayerSelection>(INITIAL_WORKSPACE.selection)
  const [renderSource, setRenderSource] = useState<RenderSource>(INITIAL_RENDER_SOURCE)
  const [vectorStatus, setVectorStatus] = useState<CategoricalRasterStatus>({
    state: 'loading',
    message: 'Loading polygons…',
  })
  const [traceMethod, setTraceMethod] = useState<'grid' | 'pixels'>(INITIAL_WORKSPACE.traceMethod)
  const [vectorPick, setVectorPick] = useState<CategoricalRasterPick | null>(null)
  const pickPolygon = useCallback((pick: CategoricalRasterPick) => {
    setPoint([pick.longitude, pick.latitude])
    setVectorPick(pick)
  }, [])
  const tileId = ccissTileId(selection)
  const [tileStatus, setTileStatus] = useState<{ id: string; available: boolean } | null>(null)
  const [tileAttempt, setTileAttempt] = useState(0)
  const mapProduct = ccissPreparedMapProduct(selection)
  const mapOptions = ccissMapOptions(selection)
  const bgcRaster = useRasterSource(bgcFile, REFERENCE_BGC)
  const suitabilityRaster = useRasterSource(
    suitabilityFile,
    mapProduct?.numeric.url ?? null,
    mapProduct?.numeric.fallbackUrl,
  )
  const bgc = useSample(bgcRaster.image, point)
  const suitability = useSample(suitabilityRaster.image, point)
  const numericLayer = mapProduct !== null
  const sources = ccissSourceOptions(selection, {
    localRaster: Boolean(suitabilityFile),
    numericRasterLoaded: Boolean(suitabilityRaster.image),
    publishedTilesAvailable: tileStatus?.id === tileId ? tileStatus.available : undefined,
  })
  const selectedSource = sources.find((source) => source.id === renderSource)!
  const polygonLayer = selectedSource.available && (renderSource === 'vector' || renderSource === 'trace')
  const updateSelection = (patch: Partial<CcissLayerSelection>) => {
    setSelection((previous) => normalizeCcissSelection({ ...previous, ...patch }))
    setVectorPick(null)
  }

  useEffect(() => {
    const url = new URL(window.location.href)
    url.search = writeCcissWorkspace(url.search, { point, selection, renderSource, traceMethod, analysis }).toString()
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url)
  }, [point, selection, renderSource, traceMethod, analysis])

  useEffect(() => {
    if (renderSource !== 'tiles') return
    const controller = new AbortController()
    fetch(`https://tileserver.thebeczone.ca/data/${tileId}.json`, { signal: controller.signal })
      .then((response) => setTileStatus({ id: tileId, available: response.ok }))
      .catch(() => {
        if (!controller.signal.aborted) setTileStatus({ id: tileId, available: false })
      })
    return () => controller.abort()
  }, [tileId, renderSource, tileAttempt])

  const tileAvailable = tileStatus?.id === tileId ? tileStatus.available : null

  return (
    <MapSectionLayout
      desktopSidebarWidth={410}
      mobilePeekTitle="CCISS spatial"
      mobilePeekSubtitle="Tile trace and numeric reference lookup"
      sidebar={
        <MapSidebarShell
          title="CCISS suitability"
          subtitle="Tile trace · numeric reference lookup"
          icon={Sprout}
          actions={<ForestryBackLink />}
          density="compact"
          className={MAP_SIDEBAR_CLASS}
        >
          <SidebarSection title="Analysis">
            <Button className="mb-2 mr-2" onClick={() => setAnalysis('report')}>
              Open species report
            </Button>
            {analysis === 'report' && (
              <ShinyReportDialog
                onClose={() => setAnalysis(null)}
                onCaptureComparison={comparisons.save}
                onOpenComparison={openComparison}
                comparisonCount={comparisons.snapshots.length}
              />
            )}
            <Button onClick={() => setAnalysis('legacy')}>Open legacy analysis</Button>
            <p className="mt-2 text-xs text-muted-foreground">
              Calculate species suitability at the selected point and explore regional trends using the older numeric
              dataset.
            </p>
            {analysis === 'legacy' && (
              <LegacyAnalysisDialog
                point={point}
                onPointChange={setPoint}
                onClose={() => setAnalysis(null)}
                onCaptureComparison={comparisons.save}
                onOpenComparison={openComparison}
                comparisonCount={comparisons.snapshots.length}
              />
            )}
            <Button className="mt-3" variant="outline" onClick={() => setAnalysis('current')}>
              Open current data analysis
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">
              Import a CCISS site-data bundle to explore its climate projections and run the calculations supported by
              its matching reference tables. The file stays in this browser.
            </p>
            {analysis === 'current' && (
              <CurrentAnalysisDialog
                point={point}
                onPointChange={setPoint}
                onClose={() => setAnalysis(null)}
                onCaptureComparison={comparisons.save}
                onOpenComparison={openComparison}
                comparisonCount={comparisons.snapshots.length}
              />
            )}
            <Button className="mt-3" variant="outline" onClick={openComparison}>
              Open comparisons ({comparisons.snapshots.length})
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">
              Save analyses before changing a location or settings, then compare their results. Saved comparisons remain
              available while this page is open and can be downloaded for later use.
            </p>
            {analysis === 'compare' && (
              <ComparisonDialog
                snapshots={comparisons.snapshots}
                onImportSnapshot={comparisons.save}
                onRemoveSnapshot={comparisons.remove}
                onRenameSnapshot={comparisons.rename}
                onClose={() => setAnalysis(null)}
              />
            )}
          </SidebarSection>
          <SidebarSection title="Map layer">
            <label className="block text-sm">
              Display
              <NativeSelect
                className={selectClass}
                value={selection.kind}
                onChange={(event) => updateSelection({ kind: event.target.value as CcissLayerSelection['kind'] })}
              >
                {mapOptions.kinds.map((kind) => (
                  <option key={kind.id} value={kind.id}>
                    {kind.label}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="mt-3 block text-sm">
              Time period
              <NativeSelect
                className={selectClass}
                value={selection.period}
                onChange={(event) => updateSelection({ period: event.target.value as CcissLayerSelection['period'] })}
              >
                {mapOptions.periods.map((period) => (
                  <option key={period.id} value={period.id}>
                    {period.label}
                  </option>
                ))}
              </NativeSelect>
            </label>
            {selection.kind === 'suitability' ? (
              <>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <label className="block text-sm">
                    Species
                    <NativeSelect
                      className={selectClass}
                      value={selection.species}
                      onChange={(event) =>
                        updateSelection({ species: event.target.value as CcissLayerSelection['species'] })
                      }
                    >
                      {mapOptions.species.map((species) => (
                        <option key={species.id} value={species.id}>
                          {species.label}
                        </option>
                      ))}
                    </NativeSelect>
                  </label>
                  <label className="block text-sm">
                    Edatope
                    <NativeSelect
                      className={selectClass}
                      value={selection.edatope}
                      onChange={(event) =>
                        updateSelection({ edatope: event.target.value as CcissLayerSelection['edatope'] })
                      }
                    >
                      {mapOptions.edatopes.map((edatope) => (
                        <option key={edatope.id} value={edatope.id}>
                          {edatope.label}
                        </option>
                      ))}
                    </NativeSelect>
                  </label>
                </div>
                {mapOptions.statistics.length > 1 && (
                  <label className="mt-3 block text-sm">
                    Map type
                    <NativeSelect
                      className={selectClass}
                      value={selection.statistic}
                      onChange={(event) =>
                        updateSelection({ statistic: event.target.value as CcissLayerSelection['statistic'] })
                      }
                    >
                      {mapOptions.statistics.map((statistic) => (
                        <option key={statistic.id} value={statistic.id}>
                          {statistic.label}
                        </option>
                      ))}
                    </NativeSelect>
                  </label>
                )}
              </>
            ) : (
              <>
                {mapOptions.showZoneGrouping && (
                  <label className="mt-3 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selection.byZone}
                      onChange={(event) => updateSelection({ byZone: event.target.checked })}
                    />
                    Group by zone
                  </label>
                )}
                {mapOptions.gcms.length > 0 && (
                  <label className="mt-3 block text-sm">
                    Climate model
                    <NativeSelect
                      className={selectClass}
                      value={selection.gcm}
                      onChange={(event) => updateSelection({ gcm: event.target.value as CcissLayerSelection['gcm'] })}
                    >
                      {mapOptions.gcms.map((gcm) => (
                        <option key={gcm.id} value={gcm.id}>
                          {gcm.label}
                        </option>
                      ))}
                    </NativeSelect>
                  </label>
                )}
              </>
            )}
            <div className="mt-3">
              <p className="mb-1 text-sm">Map source</p>
              <SegmentedControl<RenderSource>
                label="Map source"
                value={renderSource}
                onChange={(value) => {
                  setRenderSource(value)
                  setVectorPick(null)
                }}
                variant="solid"
                options={sources
                  .filter((source) => source.id === 'trace' || source.id === 'vector')
                  .map((source) => ({
                    value: source.id,
                    label: source.label,
                    disabled: !source.available,
                  }))}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Tile trace is the default. Numeric vector preserves the downloaded GeoTIFF’s cell boundaries and codes.
                The location and zoom stay in place as you switch.
              </p>
            </div>
            {!selectedSource.available && renderSource !== 'tiles' && (
              <InlineAlert title="No prepared overlay for this selection">
                {selectedSource.reason}{' '}
                {suitabilityFile ? (
                  <button className="underline" onClick={() => setRenderSource('native')}>
                    View the selected GeoTIFF
                  </button>
                ) : (
                  <button className="underline" onClick={() => setRenderSource('tiles')}>
                    View original CCISS tiles
                  </button>
                )}
                , or{' '}
                <button
                  className="underline"
                  onClick={() => {
                    setSelection(DEFAULT_CCISS_SELECTION)
                    setVectorPick(null)
                  }}
                >
                  return to Pl/C4
                </button>
                .
              </InlineAlert>
            )}
            <CollapsibleSection
              label="Comparison options"
              collapseOn="always"
              className="mt-3"
              defaultOpen={INITIAL_RENDER_SOURCE === 'tiles' || INITIAL_RENDER_SOURCE === 'native'}
            >
              <SegmentedControl<RenderSource>
                label="Other map sources"
                value={renderSource}
                onChange={(value) => {
                  setRenderSource(value)
                  setVectorPick(null)
                }}
                options={sources
                  .filter((source) => source.id === 'tiles' || source.id === 'native')
                  .map((source) => ({
                    value: source.id,
                    label: source.label,
                    disabled: source.id !== 'tiles' && !source.available,
                  }))}
              />
              <p className="mt-2 text-xs text-muted-foreground">
                Direct GeoTIFF draws the numeric raster and supports local uploads. Original tiles are only loaded when
                selected.
              </p>
              <p className="mt-2 break-all text-xs text-muted-foreground">CCISS tile set: {tileId}</p>
            </CollapsibleSection>
            {renderSource === 'tiles' && <p className="mt-2 text-xs">Showing original CCISS tiles.</p>}
            <p className="mt-2 text-xs text-muted-foreground">{selectedSource.description}</p>
            {suitabilityFile && (
              <p className="mt-2 text-xs text-muted-foreground">
                A local GeoTIFF is selected. Use Direct GeoTIFF in Comparison options to render it; the prepared numeric
                vector belongs to the hosted download.
              </p>
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
            {tileAvailable === false && renderSource === 'tiles' && (
              <InlineAlert tone="error">
                This tile set is unavailable from the CCISS server.
                <Button
                  className="mt-2"
                  variant="outline"
                  onClick={() => {
                    setTileStatus(null)
                    setTileAttempt((attempt) => attempt + 1)
                  }}
                >
                  Retry map tiles
                </Button>
              </InlineAlert>
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
              {Math.abs(point[1]).toFixed(5)}° {point[1] < 0 ? 'S' : 'N'}, {Math.abs(point[0]).toFixed(5)}°{' '}
              {point[0] < 0 ? 'W' : 'E'}
            </p>
            {numericLayer || suitabilityFile ? (
              <div className="mt-3 space-y-2">
                {suitabilityFile ? (
                  <p className="text-xs text-muted-foreground">
                    Local file values are shown without assigning a suitability class. Confirm this file’s legend, grid
                    and product; changing map options does not change the selected file.
                  </p>
                ) : (
                  <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
                    {mapProduct!.limits}
                  </p>
                )}
                <SampleResult
                  result={suitability}
                  label={
                    suitabilityFile
                      ? `Local GeoTIFF value · ${suitabilityFile.name}`
                      : `${mapProduct!.label} GeoTIFF class`
                  }
                  classValue={!suitabilityFile}
                />
                {polygonLayer && (
                  <InlineAlert
                    title={renderSource === 'trace' ? 'Inferred tile colour class' : 'Picked vector polygon'}
                  >
                    {vectorPick
                      ? renderSource === 'trace'
                        ? `${traceLabel(vectorPick.value)} · ${vectorPick.overview ? 'generalized overview; zoom in for the full cell' : 'inferred from WebP colours, not a measured value'}`
                        : `${feasibilityClass(vectorPick.value)} · numeric code ${vectorPick.value}${vectorPick.overview ? ' · generalized overview; exact GeoTIFF cell shown separately' : ''}`
                      : 'Click a polygon to inspect its class.'}
                  </InlineAlert>
                )}
                <SampleResult result={bgc} label="BGC raster ID" />
              </div>
            ) : (
              <p className="mt-3 rounded-md border p-3 text-sm text-muted-foreground">
                Numeric lookup currently covers mapped 1961–1990 suitability for Pl on C4. Other selections are
                available through original CCISS image tiles in Comparison options.
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
            mapOptions.statistics.length > 1 && (
              <SidebarSection title="Suitability change">
                <p className="text-xs text-muted-foreground">
                  Red tones indicate decline; blue tones indicate improvement. See the CCISS Spatial legend for newly
                  suitable and unsuitable classes.
                </p>
              </SidebarSection>
            )}
          <SidebarSection title="Read exact raster values">
            <p className="mb-3 text-sm">
              Matching prepared GeoTIFFs load automatically when available. You can also inspect a local download;
              selected files stay in this browser.
            </p>
            <label className="block text-sm">
              Reference BGC GeoTIFF
              <input
                className={selectClass}
                type="file"
                accept=".tif,.tiff,image/tiff"
                onChange={(event) => {
                  setBgcFile(event.target.files?.[0] ?? null)
                  event.target.value = ''
                }}
              />
            </label>
            {bgcRaster.error && (
              <p role="alert" className="mt-1 text-xs text-destructive">
                {bgcRaster.error}
              </p>
            )}
            <label className="mt-3 block text-sm">
              Local suitability GeoTIFF
              <input
                className={selectClass}
                type="file"
                accept=".tif,.tiff,image/tiff"
                onChange={(event) => {
                  setSuitabilityFile(event.target.files?.[0] ?? null)
                  if (renderSource === 'vector') setRenderSource('native')
                  setVectorPick(null)
                  event.target.value = ''
                }}
              />
            </label>
            {(bgcFile || suitabilityFile) && (
              <Button
                className="mt-2"
                variant="outline"
                onClick={() => {
                  setSuitabilityFile(null)
                  setBgcFile(null)
                  setVectorPick(null)
                }}
              >
                Use prepared data again
              </Button>
            )}
            {suitabilityRaster.error && (
              <p role="alert" className="mt-1 text-xs text-destructive">
                {suitabilityRaster.error}
              </p>
            )}
            {(bgcRaster.origin || suitabilityRaster.origin) && (
              <p className="mt-2 text-xs text-muted-foreground">
                BGC source: {bgcFile ? bgcFile.name : 'PGMaps reference snapshot'}.
                {suitabilityRaster.origin && (
                  <> Suitability source: {suitabilityFile ? suitabilityFile.name : mapProduct?.label}.</>
                )}
              </p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Local file values retain their numeric codes. Use the file’s own legend to interpret them.
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
              Open current data analysis to import a version-matched export. Its available sites, climate models and
              site series determine the calculation options. Complete reference tables are required for species
              suitability; a predictions-only export supports BGC probabilities.
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
      <Map
        center={INITIAL_WORKSPACE.camera.center}
        zoom={INITIAL_WORKSPACE.camera.zoom}
        controls={WORKSPACE_MAP_CONTROLS}
      >
        <SyncMapUrl />
        {polygonLayer ? (
          <MapCategoricalRaster
            manifestUrl={
              renderSource === 'trace'
                ? traceMethod === 'grid'
                  ? mapProduct!.gridTraceManifest!
                  : mapProduct!.pixelTraceManifest!
                : mapProduct!.vectorManifest!
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
        ) : selectedSource.available && renderSource === 'native' ? (
          suitabilityRaster.image && <NativeSuitabilityLayer key={tileId} image={suitabilityRaster.image} />
        ) : (
          renderSource === 'tiles' &&
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
