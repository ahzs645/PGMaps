import { useEffect, useState } from 'react'
import { ArrowLeft, Download, Layers3, TreePine } from 'lucide-react'
import type { ColorSchemeType } from 'maplibre-gl-lidar'
import { DevPageHeader } from '@/components/DevPageHeader'
import { Button } from '@/components/ui/button'
import { FullscreenPanel } from '@/components/ui/fullscreen-panel'
import { MapSidebarShell } from '@/components/ui/map-panels'
import { formatNumber } from '@/lib/format'
import { NativeLidarMap } from './NativeLidarMap'
import type { AnalysisSummary, RasterKey } from './types'
import { checkAnalysisSummary } from './data'

export function LidarWorkspace({ analysisBase, cloudBase }: { analysisBase: string; cloudBase: string }) {
  const [summary, setSummary] = useState<AnalysisSummary | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [raster, setRaster] = useState<RasterKey>('height')
  const [trees, setTrees] = useState(true)
  const [buildings, setBuildings] = useState(true)
  const [cloud, setCloud] = useState(true)
  const [reference, setReference] = useState(false)
  const [minTreeHeight, setMinTreeHeight] = useState(5)
  const [focus, setFocus] = useState({ index: -1, revision: 0 })
  const [color, setColor] = useState<ColorSchemeType>('elevation')
  useEffect(() => {
    document.title = 'LiDAR · Forest & structures · PGMaps'
    const controller = new AbortController()
    let timedOut = false
    let active = true
    const timeout = window.setTimeout(() => {
      timedOut = true
      controller.abort()
    }, 20_000)
    setError('')
    fetch(new URL('summary.json', analysisBase), { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw Error('The processed analysis is not available in this deployment.')
        const data = await r.json()
        checkAnalysisSummary(data)
        setSummary(data)
      })
      .catch((e) => {
        if (!active) return
        if (timedOut) setError('The analysis request timed out.')
        else if (!controller.signal.aborted) setError(String(e))
      })
      .finally(() => window.clearTimeout(timeout))
    return () => {
      active = false
      controller.abort()
      window.clearTimeout(timeout)
    }
  }, [analysisBase, attempt])
  const go = (index: number) => setFocus((previous) => ({ index, revision: previous.revision + 1 }))
  return (
    <div className="min-h-full bg-background text-foreground">
      <div className="mx-auto max-w-[1800px] px-4 pb-8 pt-8 sm:px-6">
        <a
          href="https://pgmaps.ahmadjalil.com/dev/"
          className="mb-4 inline-flex items-center gap-2 text-xs text-muted-foreground"
        >
          <ArrowLeft className="size-3.5" /> PGMaps / Dev
        </a>
        <DevPageHeader
          compact
          eyebrow="Native LiDAR workbench"
          icon={TreePine}
          title="Forest & structures"
          description="A measured view of BC 093G086: terrain, height above ground, crown candidates and roof-like surfaces."
          actions={
            <Button asChild variant="outline" size="sm">
              <a
                href="https://drive.google.com/file/d/12HM0-w7PNe_cC1t-ThLrFoBZngr4jgfI/view"
                target="_blank"
                rel="noopener noreferrer"
              >
                Original LAZ ↗
              </a>
            </Button>
          }
        />
        {!summary ? (
          <div className="my-8 rounded-xl border p-10 text-center" role="status">
            <Layers3 className="mx-auto mb-4 size-9 text-muted-foreground" />
            <p>{error || 'Loading the completed LiDAR analysis…'}</p>
            {error && (
              <Button className="mt-4" onClick={() => setAttempt((v) => v + 1)}>
                Retry
              </Button>
            )}
          </div>
        ) : (
          <>
            <dl className="my-5 grid grid-cols-2 gap-3 rounded-xl border bg-muted/20 p-4 lg:grid-cols-5">
              {[
                ['Observed footprint', `${summary.observed_area_ha.toFixed(1)} ha`, '84,608,005 source points'],
                [
                  'Elevated-return cover',
                  `${summary.elevated_first_return_cover_percent.toFixed(1)}%`,
                  'First returns >2 m; includes structures',
                ],
                [
                  'Median elevated height',
                  `${summary.elevated_surface_height_stats_m.median.toFixed(1)} m`,
                  'Cells >2 m, excluding roof candidates',
                ],
                [
                  'Crown candidates',
                  formatNumber(summary.tree_candidate_count),
                  'Local maxima + watershed; unvalidated',
                ],
                [
                  'Roof-like patches',
                  formatNumber(summary.building_candidate_count),
                  'Planar patches; not a building count',
                ],
              ].map(([label, value, note]) => (
                <div key={label}>
                  <dt className="text-[11px] text-muted-foreground">{label}</dt>
                  <dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd>
                  <p className="mt-1 text-[10px] leading-4 text-muted-foreground">{note}</p>
                </div>
              ))}
            </dl>
            <section className="mb-5" aria-label="Processed LiDAR products">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold">Processed from your LiDAR</h2>
                <p className="text-xs text-muted-foreground">Select a surface to explore it on the map.</p>
              </div>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {(
                  [
                    ['height', 'Height above ground', 'Canopy-height proxy · metres'],
                    ['terrain', 'Ground terrain', 'Classified ground + bounded interpolation'],
                    ['slope', 'Terrain slope', 'GeoLibre engine output · degrees'],
                    ['crowns', 'Crown regions', 'Watershed candidates · not verified trees'],
                  ] as const
                ).map(([key, title, note]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={!cloud && raster === key}
                    onClick={() => {
                      setRaster(key)
                      setCloud(false)
                    }}
                    className={`overflow-hidden rounded-xl border text-left transition-colors hover:border-emerald-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600 ${!cloud && raster === key ? 'border-emerald-600 bg-emerald-500/5' : 'bg-card'}`}
                  >
                    <img
                      src={new URL(summary.rasters[key].file, analysisBase).href}
                      alt={`${title} computed from the supplied BC LiDAR tile`}
                      className="h-36 w-full bg-slate-950 object-contain sm:h-44"
                    />
                    <span className="block px-3 pb-3 pt-2">
                      <strong className="block text-xs">{title}</strong>
                      <span className="mt-1 block text-[10px] leading-4 text-muted-foreground">{note}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
            <div className="grid items-start gap-4 lg:grid-cols-[290px_minmax(0,1fr)]">
              <MapSidebarShell
                title="Layers & exploration"
                subtitle="Measured surfaces and candidate features"
                className="h-auto rounded-xl border shadow-none lg:h-[830px]"
                scrollClassName="space-y-4 p-4"
                aria-label="Analysis layers and controls"
              >
                <section>
                  <h2 className="mb-3 text-sm font-semibold">Surface layers</h2>
                  <div className="space-y-1.5">
                    {(Object.entries(summary.rasters) as [RasterKey, AnalysisSummary['rasters'][RasterKey]][]).map(
                      ([key, layer]) => (
                        <label
                          key={key}
                          className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-xs ${raster === key ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300' : 'hover:bg-muted'}`}
                        >
                          <input
                            type="radio"
                            name="surface"
                            checked={raster === key}
                            onChange={() => {
                              setRaster(key)
                              setCloud(false)
                            }}
                          />
                          {layer.title}
                        </label>
                      ),
                    )}
                  </div>
                </section>
                <section className="border-t pt-4">
                  <h2 className="mb-3 text-sm font-semibold">Candidate overlays</h2>
                  <div className="space-y-3 text-xs">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={trees} onChange={(e) => setTrees(e.target.checked)} />
                      Dominant crown candidates
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={buildings} onChange={(e) => setBuildings(e.target.checked)} />
                      Roof-like planar patches
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={reference} onChange={(e) => setReference(e.target.checked)} />
                      GeoLibre tree test · 1 ha (pink)
                    </label>
                    <label className="block text-muted-foreground">
                      Show crown candidates ≥ {minTreeHeight} m
                      <input
                        className="mt-2 w-full"
                        type="range"
                        min={5}
                        max={40}
                        step={1}
                        value={minTreeHeight}
                        onChange={(e) => setMinTreeHeight(Number(e.target.value))}
                      />
                    </label>
                    <p className="text-[10px] leading-4 text-muted-foreground">
                      This filters displayed candidates; it does not rerun detection. Click a marker or patch to inspect
                      it.
                    </p>
                  </div>
                </section>
                <section className="border-t pt-4">
                  <h2 className="mb-3 text-sm font-semibold">Original cloud</h2>
                  <label className="flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={cloud} onChange={(e) => setCloud(e.target.checked)} />
                    Stream raw 3D points
                  </label>
                  {cloud && (
                    <>
                      <label className="mt-3 block text-xs">
                        Point colour
                        <select
                          value={color}
                          onChange={(e) => setColor(e.target.value as ColorSchemeType)}
                          className="mt-1 w-full rounded border bg-background p-2"
                        >
                          <option value="elevation">Absolute elevation</option>
                          <option value="intensity">Intensity</option>
                          <option value="classification">Source classification</option>
                        </select>
                      </label>
                      <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
                        84.6 million points available; 750,000 displayed at once. Scene Z is shifted to the lowest point
                        for viewing; source attributes retain their elevations.
                      </p>
                    </>
                  )}
                </section>
                <section className="border-t pt-4">
                  <h2 className="mb-3 text-sm font-semibold">Explore key places</h2>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => go(-1)}>
                      Whole tile
                    </Button>
                    {summary.highlights.map((place, i) => (
                      <Button key={place.label} variant="outline" size="sm" onClick={() => go(i)} title={place.note}>
                        {place.label}
                      </Button>
                    ))}
                  </div>
                </section>
                <section className="border-t pt-4">
                  <h2 className="mb-2 text-sm font-semibold">Return-height profile</h2>
                  <p className="mb-3 text-[10px] leading-4 text-muted-foreground">
                    Share of valid laser returns in each height band. This is not biomass or fuel load.
                  </p>
                  <div className="space-y-2">
                    {summary.return_height_profile.counts.map((count, i, counts) => {
                      const percent = (count / counts.reduce((a, b) => a + b, 0)) * 100
                      return (
                        <div key={i} className="grid grid-cols-[52px_1fr_38px] items-center gap-2 text-[10px]">
                          <span>{summary.return_height_profile.bins_m[i]} m</span>
                          <span className="h-2 rounded bg-muted">
                            <span className="block h-2 rounded bg-emerald-600" style={{ width: `${percent}%` }} />
                          </span>
                          <span className="text-right tabular-nums">{percent.toFixed(1)}%</span>
                        </div>
                      )
                    })}
                  </div>
                </section>
              </MapSidebarShell>
              <div className="order-first min-w-0 lg:order-none">
                <div className="mb-3 rounded-xl border bg-card p-3">
                  <div className="flex flex-wrap gap-2" aria-label="Map display">
                    <Button
                      variant={!cloud ? 'default' : 'outline'}
                      aria-pressed={!cloud}
                      onClick={() => setCloud(false)}
                    >
                      <Layers3 className="mr-2 size-4" /> Processed layers
                    </Button>
                    <Button variant={cloud ? 'default' : 'outline'} aria-pressed={cloud} onClick={() => setCloud(true)}>
                      GeoLibre 3D LiDAR
                    </Button>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    {cloud
                      ? 'Native maplibre-gl-lidar control used by GeoLibre. Your original points stream directly into this map. Drag to pan; right-drag to orbit. Expand the control for point size, colour and inspection tools.'
                      : 'Processed height and terrain surfaces, crown candidates and roof-like patches. Green markers are crown candidates; amber outlines are roof-like patches. Click a feature for its measured height.'}
                  </p>
                </div>
                <FullscreenPanel title="Native MapLibre + GeoLibre LiDAR components" compact>
                  {(fullscreen) => (
                    <div className={fullscreen ? 'h-[calc(100dvh-7rem)]' : 'h-[680px] min-h-[460px]'}>
                      <NativeLidarMap
                        summary={summary}
                        analysisBase={analysisBase}
                        cloudUrl={new URL('ept.json', cloudBase).href}
                        raster={raster}
                        trees={trees}
                        buildings={buildings}
                        reference={reference}
                        cloud={cloud}
                        minTreeHeight={minTreeHeight}
                        focus={focus}
                        color={color}
                      />
                    </div>
                  )}
                </FullscreenPanel>
                <div className="mt-3 rounded-lg border bg-card p-3">
                  <div className="flex items-center justify-between gap-4 text-xs">
                    <strong>{summary.rasters[raster].title}</strong>
                    <span className="text-muted-foreground">
                      {raster === 'crowns'
                        ? 'Categorical regions'
                        : `${summary.rasters[raster].min.toFixed(0)}–${summary.rasters[raster].max.toFixed(0)} ${summary.rasters[raster].unit}`}
                    </span>
                  </div>
                  <div
                    className="mt-2 h-2 rounded"
                    style={{ background: `linear-gradient(to right, ${summary.rasters[raster].colors.join(',')})` }}
                  />
                  <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
                    {raster === 'height'
                      ? 'DSM minus ground terrain. Canopy-height proxy: buildings and other elevated objects remain.'
                      : raster === 'support'
                        ? 'Distance to a cell with classified ground returns. Larger distances mean more interpolation, not a measured vertical error.'
                        : raster === 'crowns'
                          ? 'Categorical watershed regions seeded by local height maxima. Colours identify candidate regions; they do not indicate species.'
                          : 'Analysis uses metre-based UTM coordinates. Web raster previews are resampled; download GeoTIFFs for source-grid values.'}{' '}
                    Click the map to sample height.
                  </p>
                </div>
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                  {summary.ground_supported_percent.toFixed(2)}% of the observed footprint has a terrain-supported
                  height estimate. The source contains ground and unclassified points, with no vegetation or building
                  labels.
                </p>
              </div>
            </div>
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <details className="rounded-xl border p-4" open>
                <summary className="cursor-pointer text-sm font-semibold">What ran, and what the results mean</summary>
                <div className="mt-3 space-y-3 text-xs leading-5 text-muted-foreground">
                  <p>
                    <strong className="text-foreground">Full tile:</strong> noise/overlap-class exclusion; 1 m ground
                    and surface grids; bounded ground TIN filling; height above ground; local maxima and watershed
                    crowns; planar, single-return roof screening.
                  </p>
                  <p>
                    <strong className="text-foreground">Actual GeoLibre engine:</strong>{' '}
                    {summary.geolibre?.tools.join(', ') || 'See downloadable execution record'}.{' '}
                    {summary.geolibre?.tree_scope}
                  </p>
                  <p>
                    Changing minimum crown separation changes detection substantially:{' '}
                    {summary.tree_detection_sensitivity
                      .map((s) => `${s.minimum_separation_m} m → ${formatNumber(s.local_maxima)} peaks`)
                      .join('; ')}
                    . These are algorithm outputs, not confidence intervals or verified tree totals.
                  </p>
                  <ul className="list-disc space-y-1 pl-4">
                    {summary.limitations.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </div>
              </details>
              <section className="rounded-xl border p-4">
                <h2 className="text-sm font-semibold">Downloads & reproducibility</h2>
                <p className="mb-3 mt-2 text-xs leading-5 text-muted-foreground">
                  Processing stays separate from rendering. Re-run the versioned pipeline as data or parameters change;
                  this viewer reads the resulting manifest and products.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {summary.downloads.map((download) => (
                    <a
                      key={download.file}
                      className="flex items-center gap-2 rounded border px-3 py-2 text-xs hover:bg-muted"
                      href={new URL(download.file, analysisBase).href}
                      download
                    >
                      <Download className="size-3.5" />
                      {download.label}
                    </a>
                  ))}
                </div>
                <p className="mt-4 flex flex-wrap gap-3 text-xs underline">
                  <a href="https://github.com/opengeos/GeoLibre" target="_blank" rel="noopener noreferrer">
                    GeoLibre
                  </a>
                  <a href="https://github.com/opengeos/maplibre-gl-lidar" target="_blank" rel="noopener noreferrer">
                    LiDAR rendering component
                  </a>
                  <a href="https://github.com/opengeos/geolibre-rust" target="_blank" rel="noopener noreferrer">
                    Processing engine
                  </a>
                  <a href="https://github.com/opengeos/RustGIS" target="_blank" rel="noopener noreferrer">
                    RustGIS companion
                  </a>
                  <a href="https://github.com/ahzs645/PGMaps/pull/37" target="_blank" rel="noopener noreferrer">
                    PGMaps source
                  </a>
                </p>
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
