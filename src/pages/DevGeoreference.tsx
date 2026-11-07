import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Download, Redo2, RotateCcw, Save, Trash2, Undo2 } from 'lucide-react'
import { ToolPageHeader } from '@/components/ui/tool-page-header'
import { FileDropField } from '@/components/ui/file-drop-field'
import { InlineAlert } from '@/components/ui/map-panels'
import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import {
  loadCatalogue,
  shareLink,
  type RasterCatalogue,
  type RasterRecord,
  type SourceImageRecord,
} from './dev-view/catalogue'
import {
  GEOREFERENCE_SCHEMA,
  PIXEL_CONVENTION,
  FIT_CRS,
  MAX_CONTROL_PAIRS,
  parseProject,
  serializeProject,
  type GeoreferenceProject,
  type ControlPair,
  type Coordinate,
  type Pixel,
  type TransformType,
} from './dev-georeference/model'
import { fitTransformation } from './dev-georeference/transforms'
import {
  fileSha256,
  loadLocalSource,
  loadRemoteSource,
  originalSourceFile,
  type LoadedSource,
} from './dev-georeference/sources'
import { canvasBlob, renderWarpedPreview, WKT_3857, type WarpedPreview } from './dev-georeference/preview'
import { SourceImagePane } from './dev-georeference/SourceImagePane'
import { ReferencePane } from './dev-georeference/ReferencePane'

const DRAFT_KEY = 'pgmaps-georeference-draft-v1'
const methodLabels: Record<TransformType, string> = {
  similarity: 'Scale & rotate',
  affine: 'Stretch (affine)',
  'thin-plate-spline': 'Local warp (TPS)',
}
const minimum: Record<TransformType, number> = { similarity: 2, affine: 3, 'thin-plate-spline': 6 }
function message(error: unknown) {
  return error instanceof Error ? error.message : 'The operation could not be completed.'
}
function freshProject(source: LoadedSource): GeoreferenceProject {
  return {
    schema: GEOREFERENCE_SCHEMA,
    pixelConvention: PIXEL_CONVENTION,
    fitCrs: FIT_CRS,
    source: source.descriptor,
    title: source.title,
    transform: 'affine',
    points: [],
  }
}
function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 10000)
}
function projectFilename(project: GeoreferenceProject) {
  return (project.source.id.replace(/[^a-zA-Z0-9_.-]+/g, '-').slice(0, 100) || 'map') + '.georeference.json'
}
function NumericField({
  label,
  value,
  onCommit,
  step = 'any',
}: {
  label: string
  value: number
  onCommit: (value: number) => boolean | void
  step?: string
}) {
  return (
    <label className="block min-w-0 text-xs text-muted-foreground">
      {label}
      <input
        key={`${label}-${value}`}
        type="number"
        step={step}
        aria-label={label}
        defaultValue={Number(value.toFixed(8))}
        onBlur={(e) => {
          const next = Number(e.target.value)
          if (e.target.value.trim() && Number.isFinite(next)) {
            if (onCommit(next) === false) e.target.value = String(value)
          } else e.target.value = String(value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
        className="mt-1 h-9 w-full rounded border bg-background px-2 text-sm tabular-nums text-foreground"
      />
    </label>
  )
}

export default function DevGeoreference() {
  const [source, setSource] = useState<LoadedSource | null>(null)
  const [project, setProject] = useState<GeoreferenceProject | null>(null)
  const projectRef = useRef<GeoreferenceProject | null>(null)
  const history = useRef<{ past: GeoreferenceProject[]; future: GeoreferenceProject[]; group: string; time: number }>({
    past: [],
    future: [],
    group: '',
    time: 0,
  })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pendingPixel, setPendingPixel] = useState<Pixel | null>(null)
  const [repickImage, setRepickImage] = useState<string | null>(null)
  const [repickTarget, setRepickTarget] = useState<string | null>(null)
  const [catalogueUrl, setCatalogueUrl] = useState('')
  const [catalogue, setCatalogue] = useState<RasterCatalogue | null>(null)
  const [inputUrl, setInputUrl] = useState('')
  const [chosenMap, setChosenMap] = useState('')
  const [mapSearch, setMapSearch] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [preview, setPreview] = useState<WarpedPreview | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [draftAvailable, setDraftAvailable] = useState(false)
  const loadControl = useRef<AbortController | null>(null)
  const loadEpoch = useRef(0)

  const replaceProject = useCallback((next: GeoreferenceProject | null, remember = true, group = '') => {
    const previous = projectRef.current
    if (remember && previous) {
      const now = Date.now()
      if (!group || group !== history.current.group || now - history.current.time > 400)
        history.current.past = [...history.current.past.slice(-49), previous]
      history.current.future = []
      history.current.group = group
      history.current.time = now
    }
    projectRef.current = next
    setProject(next)
  }, [])
  const install = useCallback(
    (loaded: LoadedSource, expected?: GeoreferenceProject) => {
      if (expected) {
        if (
          loaded.descriptor.width !== expected.source.width ||
          loaded.descriptor.height !== expected.source.height ||
          (expected.source.sha256 && loaded.descriptor.sha256 !== expected.source.sha256)
        )
          throw Error(
            'This image does not match the saved native source. Select the original file used by this project.',
          )
        loaded.descriptor = expected.source
      }
      history.current = { past: [], future: [], group: '', time: 0 }
      setSource(loaded)
      replaceProject(expected || freshProject(loaded), false)
      setSelectedId(expected?.points[0]?.id || null)
      setPendingPixel(null)
      setRepickImage(null)
      setRepickTarget(null)
      setPreview(null)
    },
    [replaceProject],
  )
  const runLoad = useCallback(async (work: (signal: AbortSignal, epoch: number) => Promise<void>) => {
    loadControl.current?.abort()
    const controller = new AbortController()
    loadControl.current = controller
    const epoch = ++loadEpoch.current
    setError('')
    setNotice('')
    setBusy('Loading native source…')
    try {
      await work(controller.signal, epoch)
    } catch (e) {
      if (!controller.signal.aborted) setError(message(e))
    } finally {
      if (loadEpoch.current === epoch) setBusy('')
    }
  }, [])
  const loadRecord = useCallback(
    async (record: RasterRecord, signal: AbortSignal, epoch: number, collection?: RasterCatalogue) => {
      const download = record.downloads[0]
      if (!download)
        throw Error('This map has display tiles but no original raster download. Open its source image to edit it.')
      const native =
        collection?.items.find((item) => item.downloads.some((d) => d.sha256 && d.sha256 === download.sha256)) || record
      const loaded = await loadRemoteSource(
        download.url,
        { id: native.id, title: native.title, sha256: download.sha256, record: native },
        signal,
      )
      if (loadEpoch.current === epoch) {
        setChosenMap(native.id)
        install(loaded)
      }
    },
    [install],
  )
  const loadSourceRecord = useCallback(
    async (record: SourceImageRecord, signal: AbortSignal, epoch: number) => {
      const nativeLink = record.sources.find((s) => /original full-resolution/i.test(s.title))
      const url = nativeLink?.url || record.image
      if (!url) throw Error('This reference has no direct image. Download an original image from its source first.')
      const loaded = await loadRemoteSource(url, { id: record.id, title: record.title }, signal)
      if (!nativeLink) {
        loaded.descriptor.frame.kind = 'derived-image'
        loaded.descriptor.frame.description =
          record.imageScope || 'The supplied source working image; other original panels and pages are separate.'
      }
      if (loadEpoch.current === epoch) install(loaded)
    },
    [install],
  )
  const openCatalogue = useCallback(
    async (url: string, mapId?: string, sourceId?: string) => {
      await runLoad(async (signal, epoch) => {
        const collection = await loadCatalogue(url, signal)
        if (loadEpoch.current !== epoch) return
        setCatalogue(collection)
        setCatalogueUrl(url)
        setInputUrl(url)
        if (sourceId) {
          const record = collection.unplacedSources.find((s) => s.id === sourceId)
          if (!record) throw Error('The source image is no longer listed in this collection.')
          await loadSourceRecord(record, signal, epoch)
        } else {
          const record = [...collection.items, ...collection.featured].find((i) => i.id === mapId)
          if (record) await loadRecord(record, signal, epoch, collection)
          else {
            setChosenMap(collection.items[0]?.id || '')
            setNotice('Choose a map, then select Load selected map.')
          }
        }
      })
    },
    [runLoad, loadRecord, loadSourceRecord],
  )
  const importProject = useCallback(
    async (parsed: GeoreferenceProject) => {
      await runLoad(async (signal, epoch) => {
        if (
          source &&
          parsed.source.sha256 &&
          source.descriptor.sha256 === parsed.source.sha256 &&
          source.descriptor.width === parsed.source.width &&
          source.descriptor.height === parsed.source.height
        ) {
          install({ ...source }, parsed)
        } else if (parsed.source.url) {
          const loaded = await loadRemoteSource(
            parsed.source.url,
            { id: parsed.source.id, title: parsed.title, sha256: parsed.source.sha256 || undefined },
            signal,
          )
          if (loadEpoch.current === epoch) install(loaded, parsed)
        } else {
          history.current = { past: [], future: [], group: '', time: 0 }
          setSource(null)
          replaceProject(parsed, false)
          setSelectedId(parsed.points[0]?.id || null)
          setPreview(null)
          setNotice(
            'Edit file loaded. Select the matching original image to resume; your saved points will be retained.',
          )
        }
      })
    },
    [install, replaceProject, runLoad, source],
  )
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1))
    const url = params.get('catalog'),
      image = params.get('image')
    if (url) void openCatalogue(url, params.get('map') || undefined, params.get('source') || undefined)
    else if (image)
      void runLoad(async (signal, epoch) => {
        const loaded = await loadRemoteSource(image, {}, signal)
        if (loadEpoch.current === epoch) install(loaded)
      })
    try {
      setDraftAvailable(Boolean(localStorage.getItem(DRAFT_KEY)))
    } catch {
      /* Saving is optional in private browsing. */
    }
    const robots = document.createElement('meta')
    robots.name = 'robots'
    robots.content = 'noindex, nofollow, noarchive'
    document.head.append(robots)
    const referrer = document.createElement('meta')
    referrer.name = 'referrer'
    referrer.content = 'no-referrer'
    document.head.append(referrer)
    return () => {
      loadControl.current?.abort()
      robots.remove()
      referrer.remove()
    }
  }, [openCatalogue, runLoad, install])
  useEffect(() => {
    if (!project) return
    const id = window.setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, serializeProject(project))
      } catch {
        /* Download remains available if local storage is full. */
      }
    }, 350)
    return () => window.clearTimeout(id)
  }, [project])
  const evaluated = useMemo(() => {
    if (!project) return { fit: null, error: '' }
    try {
      return { fit: fitTransformation(project), error: '' }
    } catch (e) {
      return { fit: null, error: message(e) }
    }
  }, [project])
  useEffect(() => {
    const controller = new AbortController()
    if (!source || !evaluated.fit) {
      setPreview(null)
      setPreviewBusy(false)
      setPreviewError('')
      return
    }
    setPreview(null)
    setPreviewBusy(true)
    setPreviewError('')
    const id = window.setTimeout(
      () =>
        void renderWarpedPreview(source, evaluated.fit!, controller.signal)
          .then((result) => {
            if (!controller.signal.aborted) setPreview(result)
          })
          .catch((e) => {
            if (!controller.signal.aborted) {
              setPreview(null)
              setPreviewError(message(e))
            }
          })
          .finally(() => {
            if (!controller.signal.aborted) setPreviewBusy(false)
          }),
      180,
    )
    return () => {
      controller.abort()
      window.clearTimeout(id)
    }
  }, [source, evaluated.fit])
  const selected = project?.points.find((point) => point.id === selectedId) || null
  const changePoint = useCallback(
    (id: string, patch: Partial<ControlPair>, group = id) => {
      const current = projectRef.current
      if (!current) return false
      const next = {
        ...current,
        points: current.points.map((point) => (point.id === id ? { ...point, ...patch } : point)),
      }
      try {
        replaceProject(parseProject(next), true, group)
        setError('')
        return true
      } catch (e) {
        setError(message(e))
        return false
      }
    },
    [replaceProject],
  )
  const pickImage = useCallback(
    (pixel: Pixel) => {
      if (busy || !source) return
      if (repickImage) {
        changePoint(repickImage, { pixel })
        setRepickImage(null)
        return
      }
      setPendingPixel(pixel)
      setRepickTarget(null)
      setNotice('Now click the same landmark on the reference map.')
    },
    [busy, source, repickImage, changePoint],
  )
  const pickGround = useCallback(
    (coordinate: Coordinate) => {
      if (busy) return
      if (repickTarget) {
        changePoint(repickTarget, { coordinate })
        setRepickTarget(null)
        return
      }
      const current = projectRef.current
      if (!pendingPixel || !current) return
      if (current.points.length >= MAX_CONTROL_PAIRS) {
        setError('Use at most 100 point pairs.')
        return
      }
      const point: ControlPair = {
        id: crypto.randomUUID(),
        pixel: pendingPixel,
        coordinate,
        enabled: true,
        role: 'control',
      }
      try {
        replaceProject(parseProject({ ...current, points: [...current.points, point] }))
        setSelectedId(point.id)
        setPendingPixel(null)
        setNotice('Pair added. Pick another landmark, or drag either numbered point to refine it.')
        setError('')
      } catch (e) {
        setError(message(e))
      }
    },
    [busy, repickTarget, pendingPixel, changePoint, replaceProject],
  )
  const remove = (id: string) => {
    const current = projectRef.current
    if (!current) return
    replaceProject({ ...current, points: current.points.filter((p) => p.id !== id) })
    setSelectedId(null)
    setRepickImage(null)
    setRepickTarget(null)
  }
  const useCorners = () => {
    if (!source?.placement || !project) return
    const { width, height } = source.descriptor
    const pixels: Pixel[] = [
      [0, 0],
      [width - 1, 0],
      [width - 1, height - 1],
      [0, height - 1],
    ]
    replaceProject({
      ...project,
      points: pixels.map((pixel, i) => ({
        id: `inherited-corner-${i + 1}`,
        pixel,
        coordinate: source.placement!.pixelToCoordinate(pixel),
        enabled: true,
        role: 'control',
      })),
      notes:
        'Starting corners inherit the existing GeoTIFF placement. They are not independent geographic controls. Replace or refine them against stable landmarks.',
    })
    setSelectedId('inherited-corner-1')
    setNotice(
      'Starting corners loaded from the current raster. Move or replace them; they are inherited placement anchors, not independent checks.',
    )
  }
  const undo = (redo = false) => {
    const current = projectRef.current,
      list = redo ? history.current.future : history.current.past
    if (!current || !list.length) return
    const next = list.pop()!
    if (redo) history.current.past.push(current)
    else history.current.future.push(current)
    history.current.group = ''
    replaceProject(next, false)
    setPendingPixel(null)
  }
  const loadFile = async (file: File) => {
    const saved = !source && projectRef.current ? projectRef.current : undefined
    await runLoad(async (_signal, epoch) => {
      const loaded = await loadLocalSource(file)
      if (loadEpoch.current === epoch) install(loaded, saved)
    })
  }
  const openUrl = async () => {
    const url = inputUrl.trim()
    try {
      const shared = new URLSearchParams(new URL(url).hash.slice(1))
      if (shared.get('catalog')) {
        await openCatalogue(shared.get('catalog')!, shared.get('map') || undefined, shared.get('source') || undefined)
        return
      }
    } catch {
      /* The loader reports an invalid URL below. */
    }
    if (/\.json(?:\?|$)/i.test(url)) {
      await openCatalogue(url)
      return
    }
    await runLoad(async (signal, epoch) => {
      const loaded = await loadRemoteSource(url, {}, signal)
      if (loadEpoch.current === epoch) install(loaded)
    })
  }
  const exportNative = async () => {
    if (!source || !project || !evaluated.fit) return
    setBusy('Downloading original for GeoTIFF export…')
    setError('')
    try {
      const { preflightBrowserGeoTiffExport, exportRectifiedGeoTiff } = await import('./dev-georeference/browserExport')
      preflightBrowserGeoTiffExport(project, source.exportInfo)
      const file = await originalSourceFile(source)
      const sourceHash = project.source.sha256 || (await fileSha256(file))
      const verifiedProject = project.source.sha256
        ? project
        : {
            ...project,
            source: {
              ...project.source,
              sha256: sourceHash,
              ...(project.source.geotiff ? { geotiff: { ...project.source.geotiff, sha256: sourceHash } } : {}),
            },
          }
      source.file = file
      if (verifiedProject !== project) {
        source.descriptor = verifiedProject.source
        replaceProject(verifiedProject)
      }
      const blob = await exportRectifiedGeoTiff(verifiedProject, file, { onProgress: setBusy })
      download(blob, projectFilename(project).replace('.georeference.json', '.rectified.tif'))
      setNotice('Rectified GeoTIFF downloaded. Save the edit project too, so the control points remain editable.')
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy('')
    }
  }
  const exportPreview = async () => {
    if (!preview || !project || previewBusy || busy) return
    try {
      const { default: JSZip } = await import('jszip'),
        zip = new JSZip()
      zip.file('rectified-preview.png', await canvasBlob(preview.canvas))
      zip.file('rectified-preview.pgw', preview.worldFile)
      zip.file('rectified-preview.prj', WKT_3857)
      zip.file('project.georeference.json', serializeProject(project))
      zip.file(
        'README.txt',
        'Sampled reading preview in EPSG:3857, with a world file. This is not a full-resolution source product. The preview warps the image interior with a triangulated mesh. Native GeoTIFF export uses GDAL; nonlinear inverse sampling can differ between control points. Project point coordinates always address the declared native source pixel frame.\n',
      )
      download(
        await zip.generateAsync({ type: 'blob' }),
        projectFilename(project).replace('.georeference.json', '.preview.zip'),
      )
    } catch (e) {
      setError(message(e))
    }
  }
  const filteredMaps = useMemo(
    () =>
      catalogue?.items.filter((record) =>
        `${record.title} ${record.subtitle || ''}`.toLowerCase().includes(mapSearch.toLowerCase()),
      ) || [],
    [catalogue, mapSearch],
  )
  const back = catalogueUrl
    ? new URL(shareLink(catalogueUrl)).pathname + new URL(shareLink(catalogueUrl)).hash
    : '/dev/view'
  const controls = project?.points.filter((p) => p.enabled && p.role === 'control').length || 0
  const fit = evaluated.fit
  return (
    <fieldset
      disabled={Boolean(busy)}
      aria-busy={Boolean(busy)}
      className="mx-auto min-h-full min-w-0 max-w-[1700px] border-0 bg-background px-3 pb-12 pt-5 sm:px-6 sm:pt-7"
    >
      <ToolPageHeader
        title="Georeference a map"
        eyebrow="Map utility"
        description="Match image landmarks to the reference map, preview the adjustment, and keep an editable copy."
        back={
          <Link to={back} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline">
            <ArrowLeft className="size-4" />
            Back to map library
          </Link>
        }
        aside={<span className="rounded-full border px-3 py-1 text-xs">Edits stay in your browser until exported</span>}
      />
      <section className="mb-4 rounded-lg border bg-card p-3 sm:p-4" aria-label="Load map source">
        <div className="grid gap-3 lg:grid-cols-2">
          <div>
            <h2 className="mb-2 text-sm font-semibold">Open an image or GeoTIFF</h2>
            <FileDropField
              label="Source image"
              accept=".png,.jpg,.jpeg,.webp,.tif,.tiff"
              filesLabel="Choose image / GeoTIFF"
              onFiles={(files) => {
                if (files[0]) return loadFile(files[0].file)
              }}
              onError={(e) => setError(message(e))}
              disabled={Boolean(busy)}
              dropHint="or drop the original file here"
            />
          </div>
          <div>
            <h2 className="mb-2 text-sm font-semibold">Resume saved edits</h2>
            <FileDropField
              label="Georeferencing edit project"
              accept=".json"
              filesLabel="Import edit file"
              onFiles={async (files) => {
                if (files[0]) await importProject(parseProject(JSON.parse(await files[0].file.text())))
              }}
              onError={(e) => setError(message(e))}
              disabled={Boolean(busy)}
              dropHint=".georeference.json"
            />
            {draftAvailable && (
              <button
                className="mt-2 text-xs underline"
                onClick={() => {
                  try {
                    const saved = localStorage.getItem(DRAFT_KEY)
                    if (saved) void importProject(parseProject(JSON.parse(saved)))
                  } catch (e) {
                    setError(message(e))
                  }
                }}
              >
                Resume local draft
              </button>
            )}
          </div>
        </div>
        <details className="mt-3" open={Boolean(catalogue)}>
          <summary className="cursor-pointer text-sm text-muted-foreground">Open a collection or image URL</summary>
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void openUrl()
            }}
          >
            <input
              aria-label="Collection or original image URL"
              type="url"
              required
              placeholder="https://…/catalog.json or original.tif"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              className="h-9 min-w-0 flex-1 rounded border bg-background px-2 text-sm"
            />
            <Button type="submit" size="sm" variant="outline" disabled={Boolean(busy)}>
              Open URL
            </Button>
          </form>
          {catalogue && (
            <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
              <input
                aria-label="Find a map in the collection"
                placeholder="Find a map…"
                value={mapSearch}
                onChange={(e) => setMapSearch(e.target.value)}
                className="h-9 min-w-0 rounded border bg-background px-2 text-sm"
              />
              <select
                aria-label="Map to edit"
                value={chosenMap}
                onChange={(e) => setChosenMap(e.target.value)}
                className="h-9 min-w-0 max-w-full rounded border bg-background px-2 text-sm"
              >
                {filteredMaps.map((record) => (
                  <option key={record.id} value={record.id}>
                    {record.title} · {record.subtitle || record.id}
                  </option>
                ))}
              </select>
              <Button
                variant="outline"
                size="sm"
                disabled={Boolean(busy) || !chosenMap}
                onClick={() => {
                  const record = catalogue.items.find((r) => r.id === chosenMap)
                  if (record) void runLoad((signal, epoch) => loadRecord(record, signal, epoch, catalogue))
                }}
              >
                Load selected map
              </Button>
            </div>
          )}
        </details>
      </section>
      {busy && (
        <InlineAlert loading className="mb-3">
          {busy}
        </InlineAlert>
      )}
      {error && (
        <InlineAlert tone="error" className="mb-3">
          {error}
        </InlineAlert>
      )}
      {notice && (
        <div role="status" className="mb-3 rounded border border-sky-600/25 bg-sky-500/5 px-3 py-2 text-sm">
          {notice}
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="break-words text-base font-semibold">{project?.title || 'No source loaded'}</h2>
          {source && (
            <p className="text-xs text-muted-foreground">
              {source.descriptor.frame.kind === 'derived-image'
                ? 'Supplied image view only'
                : 'Native source pixel frame'}{' '}
              · {source.descriptor.width.toLocaleString()} × {source.descriptor.height.toLocaleString()} px
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!history.current.past.length || Boolean(busy)}
            onClick={() => undo()}
          >
            <Undo2 className="size-4" />
            Undo
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!history.current.future.length || Boolean(busy)}
            onClick={() => undo(true)}
          >
            <Redo2 className="size-4" />
            Redo
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!source?.placement || Boolean(project?.points.length) || Boolean(busy)}
            onClick={useCorners}
          >
            <RotateCcw className="size-4" />
            Start from current corners
          </Button>
        </div>
      </div>
      <div className={`grid items-start gap-3 lg:grid-cols-2 ${busy ? 'pointer-events-none' : ''}`}>
        <SourceImagePane
          key={'source:' + source?.descriptor.id + ':' + source?.descriptor.sha256}
          source={source}
          points={project?.points || []}
          selectedId={selectedId}
          pending={pendingPixel}
          onPick={pickImage}
          onMove={(id, pixel) => changePoint(id, { pixel })}
          onSelect={setSelectedId}
        />
        <ReferencePane
          key={'reference:' + source?.descriptor.id + ':' + source?.descriptor.sha256}
          source={source}
          points={project?.points || []}
          selectedId={selectedId}
          preview={preview}
          fit={fit}
          armed={Boolean(pendingPixel || repickTarget)}
          onPick={pickGround}
          onMove={(id, coordinate) => changePoint(id, { coordinate })}
          onSelect={setSelectedId}
        />
      </div>
      <section className="mt-4 rounded-lg border bg-card p-3 sm:p-4" aria-label="Control points and transformation">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">3. Review and adjust</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {controls} active controls · {fit?.stats.check.count || 0} active checks
            </p>
          </div>
          <SegmentedControl
            label="Transformation method"
            value={project?.transform || 'affine'}
            onChange={(v) => {
              if (project) replaceProject({ ...project, transform: v as TransformType })
            }}
            options={Object.entries(methodLabels).map(([value, label]) => ({ value, label }))}
          />
        </div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          {project?.transform === 'similarity'
            ? 'Uniform scale, rotation and position. Needs two distinct control pairs.'
            : project?.transform === 'thin-plate-spline'
              ? 'Flexible local stretching. Needs at least six distributed controls; keep separate check points.'
              : 'Position, rotation, different horizontal/vertical scales and shear. Needs three non-collinear control pairs.'}
        </p>
        {project && !fit && (
          <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">
            {controls < minimum[project.transform]
              ? `Add ${minimum[project.transform] - controls} more control pair(s) for this method.`
              : evaluated.error}
          </p>
        )}
        {previewBusy && (
          <p role="status" className="mt-2 text-xs text-muted-foreground">
            Updating warped preview…
          </p>
        )}
        {previewError && (
          <InlineAlert tone="error" className="mt-2">
            {previewError}
          </InlineAlert>
        )}
        {fit && (
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <div className="rounded border p-3">
              <p className="text-xs text-muted-foreground">Control RMS disagreement</p>
              <p className="mt-1 font-semibold tabular-nums">{fit.stats.control.groundMetres.rmse?.toFixed(2)} m</p>
            </div>
            <div className="rounded border p-3">
              <p className="text-xs text-muted-foreground">Withheld-check RMS disagreement</p>
              <p className="mt-1 font-semibold tabular-nums">
                {fit.stats.check.count ? `${fit.stats.check.groundMetres.rmse?.toFixed(2)} m` : 'No check points'}
              </p>
            </div>
            <div className="rounded border p-3">
              <p className="text-xs text-muted-foreground">Fitted model</p>
              <p className="mt-1 text-sm font-semibold">{methodLabels[project!.transform]}</p>
            </div>
          </div>
        )}
        {fit?.diagnostics.warnings.map((warning) => (
          <p key={warning} className="mt-2 text-xs text-amber-700 dark:text-amber-300">
            {warning}
          </p>
        ))}
        {!!project?.points.length && (
          <div className="mt-4 flex flex-wrap gap-2" aria-label="Point pair selection">
            {project.points.map((point, i) => (
              <Button
                key={point.id}
                size="sm"
                variant={point.id === selectedId ? 'default' : 'outline'}
                onClick={() => setSelectedId(point.id)}
                className={!point.enabled ? 'opacity-50' : ''}
              >
                {i + 1}
                {point.role === 'check' ? ' · check' : ''}
              </Button>
            ))}
          </div>
        )}
        {selected && (
          <div className="mt-3 rounded border bg-muted/10 p-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">Pair {(project?.points.indexOf(selected) || 0) + 1}</h3>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={selected.enabled}
                    onChange={(e) => changePoint(selected.id, { enabled: e.target.checked })}
                  />
                  Use pair
                </label>
                <select
                  aria-label="Selected point role"
                  value={selected.role}
                  onChange={(e) => changePoint(selected.id, { role: e.target.value as 'control' | 'check' })}
                  className="rounded border bg-background px-2 py-1 text-xs"
                >
                  <option value="control">Control (fit)</option>
                  <option value="check">Check (withheld)</option>
                </select>
                <Button variant="ghost" size="sm" onClick={() => remove(selected.id)}>
                  <Trash2 className="size-4" />
                  Delete
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <NumericField
                label="Image X (native pixels)"
                value={selected.pixel[0]}
                onCommit={(v) => changePoint(selected.id, { pixel: [v, selected.pixel[1]] })}
              />
              <NumericField
                label="Image Y (native pixels)"
                value={selected.pixel[1]}
                onCommit={(v) => changePoint(selected.id, { pixel: [selected.pixel[0], v] })}
              />
              <NumericField
                label="Target longitude"
                value={selected.coordinate[0]}
                onCommit={(v) => changePoint(selected.id, { coordinate: [v, selected.coordinate[1]] })}
              />
              <NumericField
                label="Target latitude"
                value={selected.coordinate[1]}
                onCommit={(v) => changePoint(selected.id, { coordinate: [selected.coordinate[0], v] })}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setRepickImage(selected.id)
                  setPendingPixel(null)
                  setRepickTarget(null)
                  setNotice('Click the corrected image landmark for the selected pair.')
                }}
              >
                Pick image again
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setRepickTarget(selected.id)
                  setPendingPixel(null)
                  setRepickImage(null)
                  setNotice('Click the corrected reference-map landmark for the selected pair.')
                }}
              >
                Pick map again
              </Button>
            </div>
          </div>
        )}
        {(pendingPixel || repickImage || repickTarget) && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={() => {
              setPendingPixel(null)
              setRepickImage(null)
              setRepickTarget(null)
              setNotice('Point picking cancelled.')
            }}
          >
            Cancel pending pick
          </Button>
        )}
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          Residuals describe agreement with your chosen points, not survey accuracy. Use stable landmarks across the
          whole map and reserve independent checks. Historical shorelines and proposed streets may differ from today.
        </p>
      </section>
      <section className="mt-4 rounded-lg border bg-card p-3 sm:p-4" aria-label="Download and reuse edits">
        <h2 className="text-base font-semibold">4. Download and reuse</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          Save the edit file to reopen these points and settings. Export a rectified GeoTIFF for GIS, or a smaller
          georeferenced preview.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            disabled={!project}
            onClick={() => {
              if (project)
                download(new Blob([serializeProject(project)], { type: 'application/json' }), projectFilename(project))
            }}
          >
            <Save className="size-4" />
            Download edit file
          </Button>
          <Button
            variant="outline"
            disabled={!source || !fit || fit.diagnostics.folded || Boolean(busy)}
            onClick={() => void exportNative()}
          >
            <Download className="size-4" />
            Download rectified GeoTIFF
          </Button>
          <Button
            variant="outline"
            disabled={!preview || previewBusy || Boolean(busy)}
            onClick={() => void exportPreview()}
          >
            <Download className="size-4" />
            Download preview + world file
          </Button>
        </div>
        {project && (
          <label className="mt-4 block text-xs text-muted-foreground">
            Notes and assumptions
            <textarea
              aria-label="Georeferencing notes"
              maxLength={10000}
              value={project.notes || ''}
              onChange={(e) => replaceProject({ ...project, notes: e.target.value }, true, 'notes')}
              rows={3}
              className="mt-1 w-full rounded border bg-background p-2 text-sm text-foreground"
            />
          </label>
        )}
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer font-medium">Apply a revision to the shared live map</summary>
          <div className="mt-2 space-y-2 text-sm leading-6 text-muted-foreground">
            <p>
              Download the edit file. The collection owner can replay it against the original raster, review the
              resulting tiles, then activate it under the same map ID. The previous assets remain available.
            </p>
            <p>
              Use the repository’s{' '}
              <a
                href="https://github.com/ahzs645/PGMaps/blob/main/docs/georeferencing-cli.md"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                native export and publication commands
              </a>
              . Publishing uses owner credentials and checks that the source and live catalogue have not changed. This
              browser editor does not contain those credentials.
            </p>
            <p>
              Browser exports retain native source detail within the memory budget. For larger scans, the same edit file
              drives the owner-side export. Preview images are sampled; nonlinear preview and GDAL raster sampling can
              differ between controls.
            </p>
          </div>
        </details>
      </section>
    </fieldset>
  )
}
