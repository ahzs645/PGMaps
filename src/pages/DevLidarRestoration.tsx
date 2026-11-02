import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, Sprout } from 'lucide-react'
import { MapSectionLayout, MAP_SIDEBAR_CLASS } from '@/components/layout/MapSectionLayout'
import { Button } from '@/components/ui/button'
import { FormField, NumberField, SelectField } from '@/components/ui/form-field'
import { InlineAlert, MapSidebarShell, SidebarSection } from '@/components/ui/map-panels'
import { downloadBlob, downloadText } from '@/lib/download'
import {
  DEFAULT_OPTIONS,
  ALL_PRODUCTS as PRODUCTS,
  SCRIP_SOURCE,
  runRestorationWorker,
  type AnalysisProduct as Product,
  type Progress,
  type RestorationResult,
} from '@/features/lidar-restoration'
import { RestorationMap } from '@/features/lidar-restoration/RestorationMap'
import { PEM_SOURCE } from '@/features/lidar-restoration/pemStructure'
import {
  meanHeightPolygons,
  rasterGeoTiff,
  restorationManifest,
  restorationZip,
} from '@/features/lidar-restoration/outputs'

const SOURCE_URL = 'https://drive.google.com/file/d/12HM0-w7PNe_cC1t-ThLrFoBZngr4jgfI/view'

export default function DevLidarRestoration() {
  const [files, setFiles] = useState<File[]>([])
  const [options, setOptions] = useState(DEFAULT_OPTIONS)
  const [result, setResult] = useState<RestorationResult | null>(null)
  const [product, setProduct] = useState<Product>('vegetation')
  const [progress, setProgress] = useState<Progress | null>(null)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)
  const active = useRef<AbortController | null>(null)
  useEffect(() => () => active.current?.abort(), [])
  useEffect(() => {
    const title = document.title
    document.title = 'LiDAR road restoration · PGMaps Dev'
    return () => {
      document.title = title
    }
  }, [])

  function invalidate() {
    setResult(null)
    setError('')
  }
  async function run() {
    active.current?.abort()
    const controller = new AbortController()
    active.current = controller
    setError('')
    setResult(null)
    setProgress({ stage: 'ground', file: '', done: 0, total: 1 })
    try {
      const next = await runRestorationWorker(files, options, controller.signal, setProgress)
      if (!controller.signal.aborted) setResult(next)
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : String(error))
    } finally {
      if (active.current === controller) {
        active.current = null
        setProgress(null)
      }
    }
  }
  async function exportResult(kind: 'tif' | 'zip' | 'polygons' | 'manifest') {
    if (!result) return
    setError('')
    setExporting(true)
    try {
      if (kind === 'zip') downloadBlob(await restorationZip(result), 'pgmaps-restoration.zip')
      else if (kind === 'tif')
        downloadBlob(new Blob([rasterGeoTiff(result, product)], { type: 'image/tiff' }), `${product}.tif`)
      else if (kind === 'polygons')
        downloadText(JSON.stringify(meanHeightPolygons(result)), 'mean-height-cells.geojson', 'application/geo+json')
      else
        downloadText(
          JSON.stringify(restorationManifest(result), null, 2),
          'restoration-manifest.json',
          'application/json',
        )
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setExporting(false)
    }
  }
  const busy = Boolean(progress)
  const sidebar = (
    <MapSidebarShell
      className={MAP_SIDEBAR_CLASS}
      title="LiDAR road restoration"
      subtitle="Local files · SCRIP + PEM-style screening"
      icon={Sprout}
    >
      <SidebarSection>
        <div className="flex gap-4 text-xs underline">
          <Link to="/dev/forestry">Forestry tools</Link>
          <Link to="/dev/lidar">LiDAR tools</Link>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          Create slope, canopy structure and return-density layers from classified LAS/LAZ files. Your files are
          processed in your browser.
        </p>
      </SidebarSection>
      <SidebarSection
        title="1. Choose LiDAR"
        subtitle="Class 2 ground required; horizontal and vertical coordinates in metres."
      >
        <FormField
          label="LAS / LAZ tiles"
          description="Up to 768 MiB and 150 million returns per run. Adjacent tiles must share a CRS and have no overlapping bounds."
        >
          <input
            type="file"
            accept=".las,.laz"
            multiple
            disabled={busy || exporting}
            className="w-full text-sm"
            onChange={(e) => {
              setFiles(Array.from(e.target.files ?? []))
              invalidate()
            }}
          />
        </FormField>
        {files.length > 0 && (
          <p className="mt-2 break-all text-xs">
            {files.map((f) => f.name).join(', ')} · {(files.reduce((n, f) => n + f.size, 0) / 1024 ** 2).toFixed(1)} MiB
          </p>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          The{' '}
          <a href={SOURCE_URL} target="_blank" rel="noreferrer" className="underline">
            BC 093G086 sample
          </a>{' '}
          has 84.6 million returns (525 MiB). Download it, then choose it above. Large files can take several minutes
          and need a desktop browser with available memory.
        </p>
      </SidebarSection>
      <SidebarSection title="2. Set grid sizes">
        <div className="space-y-3">
          {(
            [
              ['terrainCellM', 'Ground / slope cell'],
              ['densityCellM', 'Density / strata cell'],
              ['meanCellM', 'Mean-height cell'],
              ['structureCellM', 'PEM-style structural cell'],
            ] as const
          ).map(([key, label]) => (
            <NumberField
              key={key}
              label={label}
              unit="m"
              value={options[key]}
              min={0.5}
              max={100}
              step={0.5}
              disabled={busy || exporting}
              onValueChange={(v) => {
                setOptions((old) => ({ ...old, [key]: v }))
                invalidate()
              }}
            />
          ))}
        </div>
        <div className="mt-4 flex gap-2">
          <Button disabled={!files.length || busy || exporting} onClick={() => void run()}>
            Run restoration metrics
          </Button>
          {busy && (
            <Button
              variant="outline"
              onClick={() => {
                active.current?.abort()
                active.current = null
                setProgress(null)
              }}
            >
              Cancel
            </Button>
          )}
        </div>
        {progress && (
          <div className="mt-3 text-sm" role="status">
            <p>
              {progress.stage === 'ground'
                ? 'Reading ground returns'
                : progress.stage === 'terrain'
                  ? 'Building ground grid'
                  : 'Counting normalized returns'}{' '}
              · {Math.round((100 * progress.done) / progress.total)}%
            </p>
            <progress className="w-full" value={progress.done} max={progress.total} />
            <p className="break-all text-xs">{progress.file}</p>
          </div>
        )}
        {error && (
          <div className="mt-3">
            <InlineAlert tone="error">{error}</InlineAlert>
          </div>
        )}
      </SidebarSection>
      {result && (
        <>
          <SidebarSection title="3. Inspect results">
            <SelectField
              label="Restoration layer"
              value={product}
              onChange={(e) => setProduct(e.target.value as Product)}
            >
              {(Object.entries(PRODUCTS) as Array<[Product, (typeof PRODUCTS)[Product]]>).map(([id, p]) => (
                <option key={id} value={id}>
                  {p.label} ({p.unit})
                </option>
              ))}
            </SelectField>
            <p className="mt-2 text-xs text-muted-foreground">{PRODUCTS[product].description}</p>
            <dl className="mt-3 space-y-1 text-xs" aria-label="Run summary">
              <div>
                Read: <strong data-testid="returns-read">{result.counts.read.toLocaleString()}</strong> returns
              </div>
              <div>Excluded noise / withheld: {result.counts.excluded.toLocaleString()}</div>
              <div>Ground returns: {result.counts.ground.toLocaleString()}</div>
              <div>
                Terrain support: {((100 * result.counts.normalized) / (result.counts.accepted || 1)).toFixed(2)}% of
                accepted returns
              </div>
              <div>
                EPSG:{result.epsg} · vertical: {result.verticalEpsg ? `EPSG:${result.verticalEpsg}` : 'not declared'}
              </div>
            </dl>
            {result.counts.normalized < result.counts.accepted && (
              <div className="mt-3">
                <InlineAlert tone="warning">
                  Some returns have no usable ground beneath them. Incomplete vegetation cells remain NoData; inspect
                  the support layer.
                </InlineAlert>
              </div>
            )}
          </SidebarSection>
          <SidebarSection title="4. Export GIS products">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={exporting} onClick={() => void exportResult('tif')}>
                <Download className="mr-1 size-4" />
                Selected GeoTIFF
              </Button>
              <Button size="sm" variant="outline" disabled={exporting} onClick={() => void exportResult('zip')}>
                All rasters + methods ZIP
              </Button>
              <Button size="sm" variant="outline" disabled={exporting} onClick={() => void exportResult('polygons')}>
                Mean-height cells GeoJSON
              </Button>
              <Button size="sm" variant="outline" disabled={exporting} onClick={() => void exportResult('manifest')}>
                Run manifest
              </Button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              GeoTIFFs retain the source CRS, grid size and NoData. Import the ground-elevation GeoTIFF into{' '}
              <Link to="/dev/forestry/road-design" className="underline">
                Road design
              </Link>{' '}
              to use it as terrain. Mean-height polygons are individual cell footprints, capped at 50,000 cells.
            </p>
            {exporting && (
              <p role="status" className="mt-2 text-xs">
                Preparing GIS export…
              </p>
            )}
          </SidebarSection>
        </>
      )}
      <SidebarSection title="Methods and limits">
        <InlineAlert tone="warning">
          Screening approximation: the ground grid uses cell means and limited gap filling. SCRIP uses a ground TIN in
          R; these slope and height results are not an exact reproduction.
        </InlineAlert>
        <p className="mt-3 text-xs text-muted-foreground">
          Every accepted return is counted, without thinning. Noise (classes 7/18) and withheld returns are excluded.
          Understory is &gt;0.5–2 m; midstory &gt;2–10 m; overstory &gt;10 m. Their denominator is all accepted returns
          with ground support. Buildings can contribute elevated returns. These are return metrics, not biomass or
          verified restoration priorities.
        </p>
        <p className="mt-3 text-xs text-muted-foreground">
          No-return cells stay missing; observed zero ground density stays zero. Boundary densities use full cell area.
          No vertical datum conversion is performed. The map image is a preview; exported grids preserve exact source
          coordinates.
        </p>
        <a href={SCRIP_SOURCE} target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs underline">
          BC Government SCRIP source · Apache 2.0
        </a>
        <p className="mt-3 text-xs text-muted-foreground">
          PEM-style summaries use non-ground returns at or below 100 m, with height moments strictly above 2 m. Sample
          deviation uses n − 1; RMS is the square root of mean squared height. First-return canopy cover has a
          first-return denominator. The separate coefficient of variation is an additional browser metric. Percentile
          CHMs and exact LAStools parity are not implemented.
        </p>
        <a href={PEM_SOURCE} target="_blank" rel="noreferrer" className="mt-2 block text-xs underline">
          PEMlidr method reference
        </a>
      </SidebarSection>
    </MapSidebarShell>
  )
  return (
    <MapSectionLayout
      sidebar={sidebar}
      mobilePeekTitle="LiDAR road restoration"
      mobilePeekSubtitle={result ? 'Restoration metrics ready' : 'Choose local LAS / LAZ files'}
      mobileInitialSheetState="half"
    >
      <RestorationMap result={result} product={product} />
    </MapSectionLayout>
  )
}
