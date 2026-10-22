import { useEffect, useRef, useState } from 'react'
import { isMobileViewport } from '@/hooks/useIsMobile'
import { Button } from '@/components/ui/button'
import { downloadText } from '@/lib/download'
import type { Basemap } from '../basemaps'
import { ImportMap } from './ImportMap'
import { ImportSidebar } from './ImportSidebar'
import { checkLasBudget, inspectLas, streamingUrl } from './las'
import { fileLayer, restoreProject, exportProject } from './files'
import { getImportSession, resetImportSession, setImportSession, useImportSession } from './session'
import type { PointSource } from './types'
export function ImportWorkspace({ basemap, cloudBase }: { basemap: Basemap; cloudBase: string }) {
  const session = useImportSession(),
    epoch = useRef(0)
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
    [panel, setPanel] = useState(() => !isMobileViewport())
  useEffect(
    () => () => {
      epoch.current++
    },
    [],
  )
  const choose = (id: string) => {
    setSelected(id)
    setFeature(null)
    setSample('')
  }
  const layer = session.layers.find((l) => l.id === selected) ?? session.layers[0]
  const point = (next: PointSource) => {
    const old = getImportSession()
    setImportSession({ ...old, point: next, missingPoints: old.missingPoints.filter((n) => n !== next.name) })
    setView3d(true)
  }
  async function files(files: File[], projectOnly = false) {
    const run = ++epoch.current
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
            const restored = await restoreProject(file)
            if (run !== epoch.current) return
            setImportSession(restored)
            choose(restored.layers[0]?.id ?? '')
            setFit((n) => n + 1)
            results.push(
              'Restored ' + restored.layers.length + ' processed layers; point sources require reattachment.',
            )
          } else if (/\.(las|laz)$/i.test(file.name)) {
            const header = await inspectLas(file)
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
                header.points.toLocaleString() +
                ' points, ' +
                (header.copc ? 'COPC streaming' : 'bounded full-file load') +
                '.',
            )
          } else {
            const parsed = await fileLayer(file, crs)
            if (run !== epoch.current) return
            const old = getImportSession()
            setImportSession({ ...old, layers: [...old.layers, parsed] })
            choose(parsed.id)
            setFit((n) => n + 1)
            results.push(file.name + ': imported.')
          }
        } catch (e) {
          results.push(file.name + ': ' + (e instanceof Error ? e.message : String(e)))
        }
      }
    } finally {
      if (run === epoch.current) {
        setBusy(false)
        setMessage(results.join(' '))
      }
    }
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
      setMessage(String(e))
    }
  }
  function save() {
    try {
      downloadText(exportProject(getImportSession()), 'lidar-project.pgmaps.json', 'application/json')
      setMessage('Project saved with original processed-layer bytes. Reattach point sources after restore.')
    } catch (e) {
      setMessage(String(e))
    }
  }
  function sourceDownload() {
    if (!layer) return
    const url = URL.createObjectURL(new Blob([layer.original]))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = layer.source.name
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="LiDAR import and project workspace">
      <div className="max-h-[32dvh] shrink-0 overflow-y-auto overscroll-contain">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b p-2 text-xs">
          <label className="cursor-pointer rounded border px-3 py-2 font-medium">
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
          <label className="cursor-pointer rounded border px-3 py-2">
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
          <Button
            size="sm"
            variant="outline"
            disabled={busy || (!session.layers.length && !session.point)}
            onClick={save}
          >
            Save project
          </Button>
          <Button size="sm" variant="outline" onClick={() => setFit((n) => n + 1)}>
            Fit layers
          </Button>
          <Button size="sm" variant="outline" onClick={() => setView3d((v) => !v)}>
            {view3d ? 'Top view' : '3D view'}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setPanel((v) => !v)}>
            {panel ? 'Hide' : 'Show'} layers
          </Button>
          <label>
            Layer CRS{' '}
            <select
              aria-label="Imported layer CRS"
              value={crs}
              onChange={(e) => setCrs(e.target.value)}
              className="max-w-[150px] rounded border bg-background p-1"
            >
              <option value="auto">From file / WGS84 GeoJSON</option>
              <option value="EPSG:3157">EPSG:3157 · BC tile</option>
              <option value="EPSG:32610">EPSG:32610 · UTM 10N</option>
              <option value="EPSG:4326">EPSG:4326 · lon/lat</option>
              <option value="EPSG:3857">EPSG:3857 · Web Mercator</option>
            </select>
          </label>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              epoch.current++
              setBusy(false)
              resetImportSession()
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
                epoch.current++
                setBusy(false)
                setMessage('Pending import cancelled. Earlier completed imports remain.')
              }}
            >
              Cancel import
            </Button>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-2 py-1 text-xs">
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
                setPointStatus('')
              }}
            >
              Remove points
            </Button>
          )}
        </div>
        <p className="shrink-0 border-b px-3 py-1 text-[11px]">
          Files stay in this browser tab. Save project preserves processed layers; reattach point sources after restore.
          Analysis tools use the bundled BC example. Ordinary LAS/LAZ: ≤2M points / 64 MiB; large clouds: COPC/EPT
          streaming.
        </p>
      </div>
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
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        {panel && (
          <ImportSidebar
            session={session}
            selected={layer?.id ?? ''}
            feature={feature}
            onSelect={choose}
            onFeature={setFeature}
            onDownload={sourceDownload}
            onFit={() => setFit((n) => n + 1)}
          />
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1">
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
            />
          </div>
          <div className="max-h-[16dvh] shrink-0 overflow-y-auto border-t p-2 text-[11px]" aria-live="polite">
            {sample && <p>{sample}</p>}
            <p>{pointStatus}</p>
          </div>
        </div>
      </div>
    </main>
  )
}
