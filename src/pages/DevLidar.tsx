import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTheme } from 'next-themes'
import { ArrowLeft, ExternalLink, Layers3, RotateCcw } from 'lucide-react'
import { DevPageHeader } from '@/components/DevPageHeader'
import { Button } from '@/components/ui/button'
import { FullscreenPanel } from '@/components/ui/fullscreen-panel'
import { formatNumber, formatBytes } from '@/lib/format'
import { LIDAR_TILE, lidarViewerUrl, type LidarEngine } from './dev-lidar/data'

type DatasetState = 'checking' | 'available' | 'unavailable'

export default function DevLidar() {
  const { resolvedTheme } = useTheme()
  const [engine, setEngine] = useState<LidarEngine>('geolibre')
  const [dataset, setDataset] = useState<DatasetState>('checking')
  const [overviewPoints, setOverviewPoints] = useState<number | null>(null)
  const [retry, setRetry] = useState(0)
  const [frameLoaded, setFrameLoaded] = useState(false)
  const viewerUrl = lidarViewerUrl(engine, window.location.origin, resolvedTheme ?? 'light')

  useEffect(() => {
    document.title = 'LiDAR · PGMaps Dev'
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 20_000)
    let active = true
    setDataset('checking')
    setOverviewPoints(null)
    Promise.all(
      ['ept.json', 'summary.json'].map(async (name) => {
        const response = await fetch(`${LIDAR_TILE.basePath}${name}`, { signal: controller.signal })
        if (!response.ok) throw new Error('LiDAR dataset unavailable')
        return response.json()
      }),
    )
      .then(([ept, summary]) => {
        if (
          ept.points !== LIDAR_TILE.points ||
          !Array.isArray(ept.schema) ||
          !Number.isInteger(summary.overviewPoints) ||
          summary.overviewPoints < 1
        ) {
          throw new Error('Unexpected LiDAR metadata')
        }
        if (active) {
          setOverviewPoints(summary.overviewPoints)
          setDataset('available')
        }
      })
      .catch(() => {
        if (active) setDataset('unavailable')
      })
      .finally(() => window.clearTimeout(timer))
    return () => {
      active = false
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [retry])

  useEffect(() => {
    setFrameLoaded(false)
  }, [viewerUrl, retry])

  return (
    <div className="min-h-full bg-background">
      <div className="mx-auto max-w-[1800px] px-4 pb-8 pt-24 sm:px-6 sm:pt-28 md:pt-8">
        <Link
          to="/dev"
          className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" /> Dev library
        </Link>
        <DevPageHeader
          compact
          eyebrow="Point cloud explorer"
          icon={Layers3}
          title={LIDAR_TILE.name}
          description="Explore the terrain and vegetation in a British Columbia LiDAR tile. Zoom in to reveal finer detail."
          actions={
            <Button asChild variant="outline" size="sm">
              <a href={LIDAR_TILE.sourceUrl} target="_blank" rel="noopener noreferrer">
                Original LAZ <ExternalLink className="ml-2 size-3.5" />
              </a>
            </Button>
          }
        />
        <dl className="my-5 grid grid-cols-2 gap-3 rounded-xl border bg-muted/30 p-4 lg:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">Source points</dt>
            <dd className="mt-1 font-semibold tabular-nums">{formatNumber(LIDAR_TILE.points)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Elevation · {LIDAR_TILE.verticalDatum}</dt>
            <dd className="mt-1 font-semibold tabular-nums">589.95–864.47 m</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Source coordinates</dt>
            <dd className="mt-1 text-sm font-medium">{LIDAR_TILE.crs}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Original compressed file</dt>
            <dd className="mt-1 font-semibold">{formatBytes(LIDAR_TILE.bytes)}</dd>
          </div>
        </dl>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div role="group" aria-label="LiDAR viewer" className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={engine === 'geolibre' ? 'default' : 'outline'}
              aria-pressed={engine === 'geolibre'}
              onClick={() => setEngine('geolibre')}
            >
              GeoLibre · full cloud
            </Button>
            <Button
              size="sm"
              variant={engine === 'rustgis' ? 'default' : 'outline'}
              aria-pressed={engine === 'rustgis'}
              onClick={() => setEngine('rustgis')}
            >
              RustGIS · overview
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setRetry((value) => value + 1)}>
              <RotateCcw className="mr-2 size-3.5" /> Reload
            </Button>
            {dataset === 'available' && (
              <Button asChild variant="outline" size="sm">
                <a href={viewerUrl} target="_blank" rel="noopener noreferrer">
                  Open viewer <ExternalLink className="ml-2 size-3.5" />
                </a>
              </Button>
            )}
          </div>
        </div>
        <p className="mb-3 text-sm text-muted-foreground">
          {engine === 'geolibre'
            ? 'All 84.6 million points are available on demand. Use the LiDAR layer controls for elevation, intensity, classification and point size; tilt the map to explore in 3D.'
            : `An evenly distributed overview${overviewPoints ? ` of ${formatNumber(overviewPoints)} points` : ''} from the same tile. Use RustGIS for map styling and inspection; switch to GeoLibre for the full cloud.`}
        </p>
        <FullscreenPanel title={engine === 'geolibre' ? 'GeoLibre LiDAR viewer' : 'RustGIS LiDAR overview'} compact>
          {(fullscreen) => (
            <div className={fullscreen ? 'h-[calc(100dvh-6rem)] min-h-0' : 'h-[65vh] min-h-[460px]'}>
              {dataset === 'available' ? (
                <iframe
                  key={`${viewerUrl}-${retry}`}
                  src={viewerUrl}
                  title={engine === 'geolibre' ? 'GeoLibre full LiDAR point cloud' : 'RustGIS sampled LiDAR overview'}
                  className="h-full w-full border-0 bg-muted"
                  allow="fullscreen; clipboard-write"
                  allowFullScreen
                  onLoad={() => setFrameLoaded(true)}
                />
              ) : (
                <div className="flex h-full items-center justify-center bg-muted/30 p-6 text-center" role="status">
                  <div className="max-w-md">
                    <Layers3 className="mx-auto mb-4 size-10 text-muted-foreground" aria-hidden="true" />
                    <h2 className="font-semibold">
                      {dataset === 'checking'
                        ? 'Checking LiDAR data…'
                        : 'LiDAR data is not available in this deployment'}
                    </h2>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {dataset === 'checking'
                        ? 'Reading the point-cloud index before opening the viewer.'
                        : 'The GitHub Pages build must include the prepared point-cloud tiles. Use the original LAZ link above to download the source, or reload after the data build finishes.'}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </FullscreenPanel>
        {dataset === 'available' && (
          <p role="status" className="mt-2 text-xs text-muted-foreground">
            {frameLoaded
              ? 'Viewer page opened. Point-cloud progress and errors appear inside the viewer.'
              : 'Opening viewer… If it remains blank, use Open viewer to try a separate tab.'}
          </p>
        )}
        <details className="mt-5 rounded-xl border p-4 text-sm">
          <summary className="cursor-pointer font-medium">About this dataset and the viewers</summary>
          <div className="mt-3 space-y-3 text-muted-foreground">
            <p className="break-all">
              Source: {LIDAR_TILE.filename}. The point count, coordinate system and elevation limits come from the LAS
              header. No RGB colour channels are present; displayed colours represent point attributes.
            </p>
            <p>
              The full cloud is indexed as Entwine Point Tiles (EPT). Its horizontal coordinates are transformed to Web
              Mercator for the web viewer; source CGVD2013 heights are retained. The RustGIS overview is the coarsest
              EPT level, rather than the complete tile. Displayed points depend on each viewer’s point budget.
            </p>
            <p>
              Both embedded applications run in your browser and load tiles from PGMaps. They require an internet
              connection and WebGL; the hosted viewers are maintained by OpenGeos.
            </p>
            <p className="flex flex-wrap gap-4">
              <a
                className="underline"
                href="https://github.com/opengeos/GeoLibre"
                target="_blank"
                rel="noopener noreferrer"
              >
                GeoLibre · MIT
              </a>
              <a
                className="underline"
                href="https://github.com/opengeos/RustGIS"
                target="_blank"
                rel="noopener noreferrer"
              >
                RustGIS · Apache 2.0
              </a>
              <a
                className="underline"
                href="https://geolibre.app/user-guide/embedding/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Viewer documentation
              </a>
            </p>
          </div>
        </details>
      </div>
    </div>
  )
}
