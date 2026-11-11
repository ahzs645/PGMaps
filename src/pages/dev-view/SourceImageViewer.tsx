import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { Maximize, ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StyledSelect } from '@/components/ui/form-field'
import { InlineAlert } from '@/components/ui/map-panels'
import { ExternalLink } from '@/components/ui/text-button'
import { formatBytes } from '@/lib/format'
import type { RasterRecord } from './catalogue'
import { sourceImageChoices, sourceImageRoleLabel, type SourceImageChoice } from './sourceImages'
import {
  clampImageView,
  createImageTileReader,
  fitImageScale,
  moveImageView,
  visibleImageTiles,
  type ImageTile,
  type ImageTileReader,
  type ImageView,
} from './imagePyramid'

type LoadedTile = ImageTile & { url: string }
type TileFrame = { plan: ImageTile[]; tiles: LoadedTile[]; loading: boolean; error?: string }

function ZoomableSource({ variant }: { variant: SourceImageChoice }) {
  const pyramid = variant.pyramid!
  const container = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Map<number, [number, number]>())
  const [viewport, setViewport] = useState({ width: 640, height: 400 })
  const [view, setView] = useState<ImageView>({ x: pyramid.width / 2, y: pyramid.height / 2, scale: 0 })
  const [frame, setFrame] = useState<TileFrame>()
  const tileReader = useRef<ImageTileReader | null>(null)
  const current = useMemo(
    () => clampImageView(view, pyramid.width, pyramid.height, viewport),
    [view, pyramid.width, pyramid.height, viewport],
  )
  const preview = variant.preview || variant.thumbnail
  const density = typeof window === 'undefined' ? 1 : window.devicePixelRatio
  const plan = useMemo(
    () => visibleImageTiles(pyramid, current, viewport, density),
    [pyramid, current, viewport, density],
  )
  const retained = useMemo(() => new Set(plan.map((tile) => tile.key)), [plan])
  const tiles = frame?.tiles.filter((tile) => retained.has(tile.key)) || []
  const status: Pick<TileFrame, 'loading' | 'error'> = frame?.plan === plan ? frame : { loading: !!plan.length }

  useEffect(() => {
    const reader = createImageTileReader(pyramid, variant.image.sha256)
    tileReader.current = reader
    return () => {
      if (tileReader.current === reader) tileReader.current = null
      reader.dispose()
    }
  }, [pyramid, variant.image.sha256])
  useEffect(() => {
    const element = container.current
    if (!element) return
    const measure = () => {
      const { width, height } = element.getBoundingClientRect()
      if (width > 0 && height > 0) setViewport({ width, height })
    }
    measure()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    observer?.observe(element)
    return () => observer?.disconnect()
  }, [])
  useEffect(() => {
    const reader = tileReader.current
    if (!reader) return
    const abort = new AbortController()
    reader.retain(retained)
    void (async () => {
      const loaded: LoadedTile[] = []
      let failed = false
      for (let start = 0; start < plan.length; start += 6) {
        if (abort.signal.aborted) return
        const results = await Promise.allSettled(
          plan.slice(start, start + 6).map(async (tile) => ({ ...tile, url: await reader.read(tile, abort.signal) })),
        )
        if (abort.signal.aborted) return
        for (const result of results) {
          if (result.status === 'fulfilled') loaded.push(result.value)
          else failed = true
        }
        setFrame({ plan, tiles: [...loaded], loading: true })
      }
      if (!abort.signal.aborted)
        setFrame({
          plan,
          tiles: loaded,
          loading: false,
          ...(failed
            ? {
                error: 'Some source detail could not load. The reading preview and original download remain available.',
              }
            : {}),
        })
    })()
    return () => abort.abort()
  }, [pyramid, variant.image.sha256, plan, retained])

  useEffect(() => {
    const element = container.current
    if (!element) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const box = element.getBoundingClientRect()
      const point: [number, number] = [event.clientX - box.left, event.clientY - box.top]
      setView((previous) =>
        moveImageView(
          previous,
          viewport,
          pyramid.width,
          pyramid.height,
          point,
          point,
          Math.exp(-Math.max(-150, Math.min(150, event.deltaY)) * 0.004),
        ),
      )
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [pyramid.width, pyramid.height, viewport])

  function point(event: PointerEvent<HTMLDivElement>): [number, number] {
    const box = event.currentTarget.getBoundingClientRect()
    return [event.clientX - box.left, event.clientY - box.top]
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const previous = pointers.current.get(event.pointerId)
    if (!previous) return
    const before = [...pointers.current.values()]
    const next = point(event)
    pointers.current.set(event.pointerId, next)
    const after = [...pointers.current.values()]
    if (before.length === 2 && after.length === 2) {
      const midpoint = (points: [number, number][]): [number, number] => [
        (points[0][0] + points[1][0]) / 2,
        (points[0][1] + points[1][1]) / 2,
      ]
      const distance = (points: [number, number][]) =>
        Math.hypot(points[1][0] - points[0][0], points[1][1] - points[0][1])
      const factor = distance(before) > 0 ? distance(after) / distance(before) : 1
      setView((value) =>
        moveImageView(value, viewport, pyramid.width, pyramid.height, midpoint(before), midpoint(after), factor),
      )
    } else if (before.length === 1)
      setView((value) => moveImageView(value, viewport, pyramid.width, pyramid.height, previous, next))
  }
  function zoom(factor: number) {
    const middle: [number, number] = [viewport.width / 2, viewport.height / 2]
    setView((previous) => moveImageView(previous, viewport, pyramid.width, pyramid.height, middle, middle, factor))
  }
  const fit = () => setView({ x: pyramid.width / 2, y: pyramid.height / 2, scale: 0 })
  const stopPointer = (event: PointerEvent<HTMLDivElement>) => pointers.current.delete(event.pointerId)

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Source image zoom">
        <Button
          size="sm"
          variant="outline"
          aria-label="Zoom out source image"
          onClick={() => zoom(1 / 1.5)}
          disabled={current.scale <= Math.min(1, fitImageScale(pyramid.width, pyramid.height, viewport) / 2)}
        >
          <ZoomOut className="size-4" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          aria-label="Zoom in source image"
          onClick={() => zoom(1.5)}
          disabled={current.scale >= Math.max(4, fitImageScale(pyramid.width, pyramid.height, viewport))}
        >
          <ZoomIn className="size-4" />
        </Button>
        <Button size="sm" variant="outline" onClick={fit}>
          <Maximize className="size-4" />
          Fit sheet
        </Button>
        <Button
          size="sm"
          variant="outline"
          aria-label="View source image at 100 percent"
          onClick={() => setView({ ...current, scale: 1 })}
        >
          100%
        </Button>
        <span className="text-xs tabular-nums text-muted-foreground">{Math.round(current.scale * 100)}%</span>
        {status.loading && (
          <span role="status" className="text-xs text-muted-foreground">
            Loading detail…
          </span>
        )}
      </div>
      <div
        ref={container}
        data-image-viewport="true"
        role="region"
        aria-label={`Zoomable ${variant.label}`}
        tabIndex={0}
        className="relative h-[min(52dvh,32rem)] min-h-56 touch-none overflow-hidden rounded-lg border bg-stone-100 outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-zinc-900"
        style={{ cursor: 'grab' }}
        onPointerDown={(event) => {
          if (event.pointerType === 'mouse' && event.button !== 0) return
          event.currentTarget.focus({ preventScroll: true })
          pointers.current.set(event.pointerId, point(event))
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={move}
        onPointerUp={stopPointer}
        onPointerCancel={stopPointer}
        onLostPointerCapture={stopPointer}
        onKeyDown={(event) => {
          if (event.key === '+' || event.key === '=') {
            event.preventDefault()
            zoom(1.5)
          } else if (event.key === '-') {
            event.preventDefault()
            zoom(1 / 1.5)
          } else if (event.key === 'Home' || event.key === '0') {
            event.preventDefault()
            fit()
          } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
            event.preventDefault()
            setView((previous) =>
              clampImageView(
                {
                  ...current,
                  x:
                    current.x + (event.key === 'ArrowRight' ? 60 : event.key === 'ArrowLeft' ? -60 : 0) / current.scale,
                  y: current.y + (event.key === 'ArrowDown' ? 60 : event.key === 'ArrowUp' ? -60 : 0) / current.scale,
                  scale: previous.scale || current.scale,
                },
                pyramid.width,
                pyramid.height,
                viewport,
              ),
            )
          }
        }}
      >
        <div
          className="pointer-events-none absolute overflow-hidden"
          style={{
            left: viewport.width / 2 - current.x * current.scale,
            top: viewport.height / 2 - current.y * current.scale,
            width: pyramid.width * current.scale,
            height: pyramid.height * current.scale,
          }}
        >
          {preview && (
            <img
              src={preview.url}
              alt={variant.label}
              draggable={false}
              referrerPolicy="no-referrer"
              className="absolute inset-0 h-full w-full"
            />
          )}
          {tiles.map((tile) => (
            <img
              key={tile.key}
              data-image-tile={tile.key}
              src={tile.url}
              alt=""
              draggable={false}
              className="absolute max-w-none"
              style={{
                left: tile.left * current.scale,
                top: tile.top * current.scale,
                width: tile.width * current.scale,
                height: tile.height * current.scale,
              }}
            />
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Drag to pan. Pinch, scroll or use the zoom controls to read more detail.
      </p>
      {status.error && <InlineAlert tone="warning">{status.error}</InlineAlert>}
    </div>
  )
}

function FlatSource({ variant }: { variant: SourceImageChoice }) {
  const preview = variant.preview || variant.thumbnail
  const pixels = (variant.image.width || 0) * (variant.image.height || 0)
  const browserImage = !/tiff/i.test(variant.image.mimeType || '') && !/\.tiff?(?:$|\?)/i.test(variant.image.url)
  const canLoad = browserImage && pixels <= 16_000_000
  const [full, setFull] = useState(false)
  const [failed, setFailed] = useState(false)
  const url = full || (!preview && canLoad) ? variant.image.url : preview?.url
  return (
    <div className="space-y-2">
      {url && !failed ? (
        <img
          src={url}
          alt={variant.label}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="max-h-[52dvh] w-full rounded-lg border bg-stone-100 object-contain dark:bg-zinc-900"
        />
      ) : (
        <InlineAlert tone="info">
          {failed
            ? 'This image could not load. Open the source file below.'
            : 'Use the source download to inspect this image.'}
        </InlineAlert>
      )}
      {!preview && !canLoad && browserImage && !full && (
        <Button variant="outline" onClick={() => setFull(true)}>
          Load full source image{variant.image.bytes ? ` · ${formatBytes(variant.image.bytes)}` : ''}
        </Button>
      )}
      {preview && (
        <p className="text-xs text-muted-foreground">
          Reading preview · {preview.width.toLocaleString()} × {preview.height.toLocaleString()} px. Open the source
          image below for its available detail.
        </p>
      )}
    </div>
  )
}

export function SourceImageViewer({ variant }: { variant: SourceImageChoice }) {
  const identity = JSON.stringify([variant.id, variant.image, variant.preview, variant.thumbnail, variant.pyramid])
  return (
    <div className="min-w-0 space-y-3">
      <p className="text-xs text-muted-foreground">
        {sourceImageRoleLabel(variant.role)}
        {variant.image.width && variant.image.height
          ? ` · ${variant.image.width.toLocaleString()} × ${variant.image.height.toLocaleString()} px`
          : ''}
        {variant.image.bytes ? ` · ${formatBytes(variant.image.bytes)}` : ''}
      </p>
      {variant.pyramid ? (
        <ZoomableSource key={identity} variant={variant} />
      ) : (
        <FlatSource key={identity} variant={variant} />
      )}
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        <ExternalLink href={variant.image.url} className="text-sm">
          {variant.role === 'original-scan'
            ? 'Download original scan'
            : variant.role === 'edit-source'
              ? 'Download edit source'
              : 'Open reading image'}
        </ExternalLink>
        {variant.source && (
          <ExternalLink href={variant.source.url} className="text-sm">
            {variant.source.title || 'Open source document'}
            {variant.source.page ? ` · page ${variant.source.page}` : ''}
          </ExternalLink>
        )}
      </div>
      {variant.note && <p className="text-xs leading-relaxed text-muted-foreground">{variant.note}</p>}
    </div>
  )
}

/** One document/panel identity with explicit original, edit-source and reading-image choices. */
export function OriginalImagePanel({
  item,
  choiceId,
  onChoiceChange,
}: {
  item: RasterRecord
  choiceId: string
  onChoiceChange: (id: string) => void
}) {
  const choices = useMemo(() => sourceImageChoices(item), [item])
  const selected =
    choices.find((choice) => choice.id === choiceId) ||
    choices.find((choice) => choice.role === 'original-scan') ||
    choices[0]
  return (
    <div className="min-w-0 space-y-3">
      {choices.length > 1 && (
        <label className="flex flex-wrap items-center gap-2 text-sm">
          Source image
          <StyledSelect
            className="min-w-0 max-w-full rounded border bg-background p-2 text-base sm:text-sm"
            aria-label="Source image"
            value={selected?.id || ''}
            onChange={(event) => onChoiceChange(event.target.value)}
          >
            {choices.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.label} · {sourceImageRoleLabel(choice.role)}
              </option>
            ))}
          </StyledSelect>
        </label>
      )}
      {selected ? (
        <SourceImageViewer variant={selected} />
      ) : (
        <>
          <InlineAlert tone="info">
            A source-image preview is not linked for this map. Its source documents are available below.
          </InlineAlert>
          {item.sources.map((source) => (
            <ExternalLink key={source.url} href={source.url} className="flex text-sm">
              {source.title}
            </ExternalLink>
          ))}
          {!item.sources.length && (
            <p className="text-sm text-muted-foreground">No original source link is recorded.</p>
          )}
        </>
      )}
    </div>
  )
}
