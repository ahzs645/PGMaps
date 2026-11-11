import { useEffect, useRef, useState } from 'react'
import { InfoTip } from '@/components/ui/info-tip'
import { SidebarSection } from '@/components/ui/map-panels'
import { Button, buttonVariants } from '@/components/ui/button'
import { StyledSelect } from '@/components/ui/form-field'
import { cn } from '@/lib/utils'
import { downloadBlob, downloadText } from '@/lib/download'
import type { Basemap } from '../basemaps'
import { LidarToolLayout } from '../LidarToolLayout'
import { ImportMap } from './ImportMap'
import { ImportSidebar } from './ImportSidebar'
import { checkLasBudget, inspectLas, needsChunkedRead, streamingUrl, type LasHeader } from './las'
import { LargeCloudSection, type LargeCloud } from './LargeCloudSection'
import { DETAIL_POINTS, overviewStride, planLargeLaz, writeLas, type NativeBox } from './largeLaz'
import { readLargeLaz, thinRecords, type LargeLazProgress } from './largeLazRead'
import type { MapView } from './coordinates'
import { fileLayer, restoreProject, exportProject } from './files'
import { getImportSession, resetImportSession, setImportSession, useImportSession } from './session'
import { errorText, type PointSource } from './types'
import { CRS_OPTION_GROUPS } from '@/lib/geo/projectedCrs'
import { DEFAULT_LOCALE } from '@/lib/format'
export function ImportWorkspace({ basemap, cloudBase }: { basemap: Basemap; cloudBase: string }) {
  const session = useImportSession(),
    epoch = useRef(0),
    pending = useRef<AbortController | null>(null)
  // Cancelling aborts the work itself (reads, checksums, gzip, GeoTIFF decoding, project layers),
  // not just its result; the epoch still discards anything that completes after a cancel.
  const stopPending = () => {
    epoch.current++
    pending.current?.abort(new DOMException('Import cancelled', 'AbortError'))
    pending.current = null
  }
  const [selected, setSelected] = useState(session.layers[0]?.id ?? ''),
    [feature, setFeature] = useState<number | null>(null),
    [fit, setFit] = useState(0),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [pointStatus, setPointStatus] = useState(''),
    [sample, setSample] = useState(''),
    [crs, setCrs] = useState('auto'),
    [url, setUrl] = useState(''),
    [view3d, setView3d] = useState(false),
    [large, setLarge] = useState<LargeCloud | null>(null),
    [mapView, setMapView] = useState<MapView | null>(null)
  useEffect(() => stopPending, [])
  const choose = (id: string) => {
    setSelected(id)
    setFeature(null)
    setSample('')
  }
  const layer = session.layers.find((l) => l.id === selected) ?? session.layers[0]
  const point = (next: PointSource, keepLarge = false) => {
    if (!keepLarge) setLarge(null)
    const old = getImportSession()
    setImportSession({ ...old, point: next, missingPoints: old.missingPoints.filter((n) => n !== next.name) })
    setView3d(true)
  }
  async function files(files: File[], projectOnly = false) {
    stopPending()
    const run = epoch.current,
      controller = new AbortController(),
      signal = controller.signal
    pending.current = controller
    setBusy(true)
    const results: string[] = []
    try {
      for (const file of files) {
        if (run !== epoch.current) return
        setMessage('Reading ' + file.name + '…')
        try {
          const project =
            projectOnly ||
            /\.pgmaps\.json$/i.test(file.name) ||
            (/\.json$/i.test(file.name) &&
              /"schema"\s*:\s*"pgmaps-lidar-project"/.test(await file.slice(0, 2048).text()))
          if (project) {
            const restored = await restoreProject(file, signal)
            if (run !== epoch.current) return
            setImportSession(restored)
            choose(restored.layers[0]?.id ?? '')
            setFit((n) => n + 1)
            results.push(
              'Restored ' + restored.layers.length + ' processed layers; point sources require reattachment.',
            )
          } else if (/\.(las|laz)$/i.test(file.name)) {
            const header = await inspectLas(file, signal)
            if (header.hasCRS && needsChunkedRead(header, file.size)) {
              const done = await openLarge(file, header, run, signal)
              if (done) results.push(done)
              continue
            }
            checkLasBudget(header, file.size)
            if (run !== epoch.current) return
            point({
              id: crypto.randomUUID(),
              name: file.name,
              kind: header.copc ? 'copc' : 'file',
              file,
              pointCount: header.points,
            })
            results.push(
              file.name +
                ': ' +
                header.points.toLocaleString(DEFAULT_LOCALE) +
                ' points, ' +
                (header.copc ? 'COPC streaming' : 'bounded full-file load') +
                '.',
            )
          } else {
            const parsed = await fileLayer(file, crs, signal)
            if (run !== epoch.current) return
            const old = getImportSession()
            setImportSession({ ...old, layers: [...old.layers, parsed] })
            choose(parsed.id)
            setFit((n) => n + 1)
            results.push(file.name + ': imported.' + (parsed.note ? ' ' + parsed.note : ''))
          }
        } catch (e) {
          if (signal.aborted) return
          results.push(file.name + ': ' + errorText(e))
        }
      }
    } finally {
      if (pending.current === controller) pending.current = null
      if (run === epoch.current) {
        setBusy(false)
        setMessage(results.join(' '))
      }
    }
  }
  const progressText = (name: string, p: LargeLazProgress) =>
    `Reading ${name} in chunks: ${Math.floor((100 * p.read) / p.total)}% · ${p.read.toLocaleString(DEFAULT_LOCALE)} of ${p.total.toLocaleString(DEFAULT_LOCALE)} points · ${p.kept.toLocaleString(DEFAULT_LOCALE)} kept`
  const stem = (name: string) => name.replace(/\.(las|laz)$/i, '')
  /** Read a too-large LAS/LAZ once and show an even overview of all of it. */
  async function openLarge(file: File, header: LasHeader, run: number, signal: AbortSignal) {
    const plan = await planLargeLaz(file, header, signal)
    const stride = overviewStride(plan.header.points)
    const started = performance.now()
    const { records, count } = await readLargeLaz(
      file,
      plan,
      { kind: 'overview', stride },
      { signal, onProgress: (p) => run === epoch.current && setMessage(progressText(file.name, p)) },
    )
    if (run !== epoch.current) return null
    const overview = new File([writeLas(plan, records, count) as BlobPart], stem(file.name) + '.overview.las')
    point({
      id: crypto.randomUUID(),
      name: file.name + ' · whole-file overview',
      kind: 'file',
      file: overview,
      pointCount: count,
    })
    setLarge({ file, plan, stride, overview, overviewPoints: count, detail: null })
    return (
      `${file.name}: read ${plan.header.points.toLocaleString(DEFAULT_LOCALE)} points in ${plan.chunks.length.toLocaleString(DEFAULT_LOCALE)} chunks ` +
      `(${Math.round((performance.now() - started) / 1000)} s). Showing one point in ${stride}; zoom in and choose Full detail for this view to see every point there.`
    )
  }
  /** Read the large file again, keeping every point inside `box`. */
  async function loadDetail(box: NativeBox) {
    if (!large) return
    stopPending()
    const run = epoch.current,
      controller = new AbortController()
    pending.current = controller
    setBusy(true)
    try {
      const { file, plan } = large
      const read = await readLargeLaz(
        file,
        plan,
        { kind: 'area', box, limit: DETAIL_POINTS },
        {
          signal: controller.signal,
          onProgress: (p) => run === epoch.current && setMessage(progressText(file.name, p)),
        },
      )
      if (run !== epoch.current) return
      const { records, count } = thinRecords(read.records, read.count, plan.header.pointLength, DETAIL_POINTS)
      if (!count) {
        setMessage('No points fall inside this view. Move the map over the point cloud and try again.')
        return
      }
      const hectares = ((box[2] - box[0]) * (box[3] - box[1])) / 10_000
      const detail = new File([writeLas(plan, records, count) as BlobPart], stem(file.name) + '.detail.las')
      point(
        { id: crypto.randomUUID(), name: file.name + ' · full detail', kind: 'file', file: detail, pointCount: count },
        true,
      )
      setLarge({ ...large, detail: { points: count, hectares, thinned: read.count > count ? read.count : null } })
      setMessage(
        `Full detail: ${count.toLocaleString(DEFAULT_LOCALE)} points over ${hectares.toFixed(1)} ha` +
          (read.count > count
            ? `, thinned evenly from ${read.count.toLocaleString(DEFAULT_LOCALE)} to fit the ${DETAIL_POINTS.toLocaleString(DEFAULT_LOCALE)}-point limit.`
            : '.'),
      )
    } catch (e) {
      if (!controller.signal.aborted && run === epoch.current) setMessage(errorText(e))
    } finally {
      if (pending.current === controller) pending.current = null
      if (run === epoch.current) setBusy(false)
    }
  }
  function showOverview() {
    if (!large) return
    point(
      {
        id: crypto.randomUUID(),
        name: large.file.name + ' · whole-file overview',
        kind: 'file',
        file: large.overview,
        pointCount: large.overviewPoints,
      },
      true,
    )
    setLarge({ ...large, detail: null })
  }
  function connect(value: string) {
    try {
      const source = streamingUrl(value)
      point({
        ...source,
        id: crypto.randomUUID(),
        name: new URL(source.url).pathname.split('/').pop() ?? 'Streaming source',
      })
      setMessage(
        'Connecting with a 750,000-point display budget. URL servers must support CORS and byte ranges for COPC.',
      )
    } catch (e) {
      setMessage(errorText(e))
    }
  }
  function save() {
    try {
      downloadText(exportProject(getImportSession()), 'lidar-project.pgmaps.json', 'application/json')
      setMessage('Project saved with original processed-layer bytes. Reattach point sources after restore.')
    } catch (e) {
      setMessage(errorText(e))
    }
  }
  function sourceDownload() {
    if (!layer) return
    downloadBlob(new Blob([layer.original]), layer.source.name)
  }
  return (
    <LidarToolLayout
      toolId="data"
      title="Import & data"
      subtitle="Your point clouds, grids and candidate layers · local to this tab"
      label="LiDAR import and project workspace"
      mobilePeekSubtitle={`${session.layers.length} layer${session.layers.length === 1 ? '' : 's'}${session.point ? ' · point cloud' : ''}`}
      sidebar={
        <>
          <SidebarSection
            title="Add data"
            actions={
              <InfoTip label="About importing">
                Files stay in this browser tab. Save project preserves processed layers; reattach point sources after
                restore. Analysis tools use the bundled BC example. LAS/LAZ up to 2M points or 64 MiB load whole; larger
                files are read in chunks into an even overview, with full detail for an area you zoom to. COPC streams.
                The layer CRS applies only to files without an embedded CRS; an embedded EPSG code always wins.
              </InfoTip>
            }
          >
            <div className="flex flex-wrap gap-2">
              <label
                className={cn(
                  buttonVariants({ variant: 'outline', size: 'sm' }),
                  'cursor-pointer focus-within:ring-2 focus-within:ring-ring',
                )}
              >
                Import files
                <input
                  aria-label="Import LiDAR or processed layers"
                  type="file"
                  className="sr-only"
                  multiple
                  accept=".las,.laz,.tif,.tiff,.geojson,.json,.gz"
                  disabled={busy}
                  onChange={(e) => {
                    const selectedFiles = Array.from(e.target.files ?? [])
                    e.target.value = ''
                    void files(selectedFiles)
                  }}
                />
              </label>
              <label
                className={cn(
                  buttonVariants({ variant: 'outline', size: 'sm' }),
                  'cursor-pointer focus-within:ring-2 focus-within:ring-ring',
                )}
              >
                Restore project
                <input
                  aria-label="Restore LiDAR project"
                  type="file"
                  className="sr-only"
                  accept=".json"
                  disabled={busy}
                  onChange={(e) => {
                    const f = Array.from(e.target.files ?? [])
                    e.target.value = ''
                    void files(f, true)
                  }}
                />
              </label>
            </div>
            <label className="mt-3 block text-xs font-medium">
              Layer CRS
              <StyledSelect
                aria-label="Imported layer CRS"
                value={crs}
                onChange={(e) => setCrs(e.target.value)}
                className="mt-1"
              >
                <option value="auto">From file / WGS84 GeoJSON</option>
                {CRS_OPTION_GROUPS.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </StyledSelect>
            </label>
          </SidebarSection>
          {large && (
            <LargeCloudSection
              cloud={large}
              view={mapView}
              busy={busy}
              onDetail={loadDetail}
              onOverview={showOverview}
            />
          )}
          <SidebarSection title="Stream a point cloud" subtitle="COPC or EPT over HTTPS">
            <div className="flex flex-wrap items-center gap-2">
              <input
                aria-label="Streaming COPC or EPT URL"
                type="url"
                className="min-w-[140px] flex-1 rounded border bg-background p-1"
                placeholder="https://…/ept.json or …/.copc.laz"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <Button size="sm" variant="outline" disabled={busy} onClick={() => connect(url)}>
                Connect stream
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  point({
                    id: crypto.randomUUID(),
                    name: 'BC original sample · EPT',
                    kind: 'ept',
                    url: new URL('ept.json', cloudBase).href,
                  })
                  setMessage('Streaming the original BC sample through its preprocessed EPT hierarchy.')
                }}
              >
                BC sample EPT
              </Button>
              {session.point && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setImportSession({ ...getImportSession(), point: null })
                    setLarge(null)
                    setPointStatus('')
                  }}
                >
                  Remove points
                </Button>
              )}
            </div>
          </SidebarSection>
          <SidebarSection title="Project">
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy || (!session.layers.length && !session.point)}
                onClick={save}
              >
                Save project
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  stopPending()
                  setBusy(false)
                  resetImportSession()
                  setLarge(null)
                  choose('')
                  setSample('')
                  setMessage('Session cleared. Your original disk files are unchanged.')
                }}
              >
                Clear session
              </Button>
              {busy && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    stopPending()
                    setBusy(false)
                    setMessage('Pending import cancelled. Earlier completed imports remain.')
                  }}
                >
                  Cancel import
                </Button>
              )}
            </div>
          </SidebarSection>
          <ImportSidebar
            session={session}
            selected={layer?.id ?? ''}
            feature={feature}
            onSelect={choose}
            onFeature={setFeature}
            onDownload={sourceDownload}
            onFit={() => setFit((n) => n + 1)}
          />
        </>
      }
    >
      {message && (
        <p
          role="status"
          className="max-h-[10dvh] shrink-0 overflow-y-auto border-b bg-amber-50 p-2 text-xs dark:bg-amber-950"
        >
          {message}
        </p>
      )}
      {session.missingPoints.length > 0 && (
        <p className="max-h-[8dvh] shrink-0 overflow-y-auto bg-amber-50 p-2 text-xs dark:bg-amber-950">
          Reattach point sources: {session.missingPoints.join(', ')}
        </p>
      )}
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0">
          <ImportMap
            session={session}
            basemap={basemap}
            selected={layer?.id ?? ''}
            feature={feature}
            fit={fit}
            view3d={view3d}
            onPick={(id, index) => {
              setSelected(id)
              setFeature(index)
            }}
            onSample={setSample}
            onPointStatus={setPointStatus}
            onView={setMapView}
          />
        </div>
        <div
          role="toolbar"
          aria-label="Imported data map toolbar"
          className="absolute left-2 top-2 z-20 flex flex-wrap gap-1 rounded-md border border-border bg-background/95 p-1 shadow-sm backdrop-blur"
        >
          <Button size="sm" variant="outline" onClick={() => setFit((n) => n + 1)}>
            Fit layers
          </Button>
          <Button size="sm" variant="outline" onClick={() => setView3d((v) => !v)}>
            {view3d ? 'Top view' : '3D view'}
          </Button>
        </div>
      </div>
      <div className="max-h-[16dvh] shrink-0 overflow-y-auto border-t p-2 text-2xs" aria-live="polite">
        {sample && <p>{sample}</p>}
        <p>{pointStatus}</p>
      </div>
    </LidarToolLayout>
  )
}
