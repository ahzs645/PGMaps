import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Maximize, Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ControlPair, Pixel, Point } from './model'
import type { LoadedSource } from './sources'

type View = { x: number; y: number; width: number; height: number }
function zoomView(previous: View, factor: number, nativeWidth: number): View {
  const width = Math.max(8, Math.min(nativeWidth * 8, previous.width * factor)),
    height = (previous.height * width) / previous.width
  return { x: previous.x + (previous.width - width) / 2, y: previous.y + (previous.height - height) / 2, width, height }
}
export function SourceImagePane({
  source,
  readOnly = false,
  points,
  selectedId,
  pending,
  onPick,
  onMove,
  onSelect,
}: {
  source: LoadedSource | null
  readOnly?: boolean
  points: ControlPair[]
  selectedId: string | null
  pending: Pixel | null
  onPick: (pixel: Pixel) => void
  onMove: (id: string, pixel: Pixel) => void
  onSelect: (id: string) => void
}) {
  const svg = useRef<SVGSVGElement>(null)
  const [view, setView] = useState<View>(() => ({
    x: -0.5,
    y: -0.5,
    width: source?.descriptor.width || 100,
    height: source?.descriptor.height || 100,
  }))
  const [size, setSize] = useState({ width: 550, height: 500 })
  const [detail, setDetail] = useState<{
    source: LoadedSource
    url: string
    window: [number, number, number, number]
  } | null>(null)
  const press = useRef<{ client: Point; view: View; moved: boolean } | null>(null)
  const movingPoint = useRef<string | null>(null)
  const touches = useRef(new Map<number, Point>())
  const pinch = useRef<{ distance: number; view: View } | null>(null)
  const reset = () =>
    source && setView({ x: -0.5, y: -0.5, width: source.descriptor.width, height: source.descriptor.height })
  useEffect(() => {
    if (!svg.current) return
    const element = svg.current
    const observer = new ResizeObserver(() => setSize({ width: element.clientWidth, height: element.clientHeight }))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const element = svg.current
    if (!element || !source) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      setView((previous) => zoomView(previous, event.deltaY > 0 ? 1.15 : 1 / 1.15, source.descriptor.width))
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [source])
  useEffect(() => {
    if (!source?.detail || view.width > source.canvas.width * 1.25) return
    const window: [number, number, number, number] = [
      Math.max(0, Math.floor(view.x + 0.5)),
      Math.max(0, Math.floor(view.y + 0.5)),
      Math.min(source.descriptor.width, Math.ceil(view.x + view.width + 0.5)),
      Math.min(source.descriptor.height, Math.ceil(view.y + view.height + 0.5)),
    ]
    if (window[2] <= window[0] || window[3] <= window[1]) return
    const controller = new AbortController()
    const id = setTimeout(
      () =>
        void source.detail!(window, controller.signal)
          .then((url) => {
            if (!controller.signal.aborted) setDetail({ source, url, window })
          })
          .catch(() => {
            /* Keep the full reading preview if this optional detail fetch fails. */
          }),
      300,
    )
    return () => {
      controller.abort()
      clearTimeout(id)
    }
  }, [source, view])
  const scale = Math.min(size.width / view.width, size.height / view.height) || 1
  const radius = 10 / scale
  const toPixel = (x: number, y: number): Pixel | null => {
    if (!svg.current || !source) return null
    const matrix = svg.current.getScreenCTM()
    if (!matrix) return null
    const p = new DOMPoint(x, y).matrixTransform(matrix.inverse())
    if (p.x < -0.5 || p.y < -0.5 || p.x > source.descriptor.width - 0.5 || p.y > source.descriptor.height - 0.5)
      return null
    return [
      Math.max(0, Math.min(source.descriptor.width - 1, p.x)),
      Math.max(0, Math.min(source.descriptor.height - 1, p.y)),
    ]
  }
  const zoom = (factor: number) => source && setView((previous) => zoomView(previous, factor, source.descriptor.width))
  const down = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!source) return
    touches.current.set(event.pointerId, [event.clientX, event.clientY])
    svg.current?.setPointerCapture(event.pointerId)
    press.current = { client: [event.clientX, event.clientY], view, moved: false }
    if (touches.current.size === 2) {
      const [a, b] = [...touches.current.values()]
      pinch.current = { distance: Math.hypot(a[0] - b[0], a[1] - b[1]), view }
    }
  }
  const move = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (movingPoint.current) {
      const pixel = toPixel(event.clientX, event.clientY)
      if (pixel) onMove(movingPoint.current, pixel)
      return
    }
    if (!touches.current.has(event.pointerId)) return
    touches.current.set(event.pointerId, [event.clientX, event.clientY])
    if (touches.current.size >= 2 && pinch.current) {
      const [a, b] = [...touches.current.values()]
      const ratio = pinch.current.distance / Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1]))
      const start = pinch.current.view,
        width = Math.max(8, start.width * ratio),
        height = (start.height * width) / start.width
      setView({ x: start.x + (start.width - width) / 2, y: start.y + (start.height - height) / 2, width, height })
      if (press.current) press.current.moved = true
      return
    }
    if (press.current) {
      const dx = event.clientX - press.current.client[0],
        dy = event.clientY - press.current.client[1]
      if (Math.hypot(dx, dy) > 5) press.current.moved = true
      if (press.current.moved)
        setView({ ...press.current.view, x: press.current.view.x - dx / scale, y: press.current.view.y - dy / scale })
    }
  }
  const up = (event: ReactPointerEvent<SVGSVGElement>) => {
    touches.current.delete(event.pointerId)
    if (movingPoint.current) {
      movingPoint.current = null
      return
    }
    if (pinch.current) {
      pinch.current = null
      press.current = null
      return
    }
    if (press.current && !press.current.moved) {
      const pixel = toPixel(event.clientX, event.clientY)
      if (pixel && !readOnly) onPick(pixel)
    }
    press.current = null
  }
  return (
    <section className="min-w-0 overflow-hidden rounded-lg border bg-card" aria-label="Source image editor">
      <div className="flex min-h-14 items-center justify-between gap-2 border-b p-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{readOnly ? '1. Inspect the source image' : '1. Pick on the image'}</h2>
          <p className="truncate text-xs text-muted-foreground">
            {source
              ? `${source.descriptor.width.toLocaleString()} × ${source.descriptor.height.toLocaleString()} native pixels · drag to pan`
              : 'Load an image or an existing map'}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button variant="ghost" size="icon" aria-label="Zoom image out" disabled={!source} onClick={() => zoom(1.5)}>
            <Minus className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Zoom image in"
            disabled={!source}
            onClick={() => zoom(1 / 1.5)}
          >
            <Plus className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Fit source image" disabled={!source} onClick={reset}>
            <Maximize className="size-4" />
          </Button>
        </div>
      </div>
      <svg
        ref={svg}
        aria-label={
          readOnly
            ? 'Source image with recovered point positions'
            : 'Source image; click a landmark to create a control pair'
        }
        role="img"
        data-testid="georeference-source"
        className="h-[26rem] w-full select-none bg-muted/40 sm:h-[34rem]"
        style={{ touchAction: source && view.width < source.descriptor.width / 1.4 ? 'none' : 'pan-y' }}
        viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => {
          press.current = null
          movingPoint.current = null
          touches.current.clear()
          pinch.current = null
        }}
      >
        {source ? (
          <image
            href={source.imageUrl}
            preserveAspectRatio="none"
            x={-0.5}
            y={-0.5}
            width={source.descriptor.width}
            height={source.descriptor.height}
          />
        ) : (
          <text x="50" y="50" textAnchor="middle" fontSize="3" fill="currentColor">
            Your source image appears here
          </text>
        )}
        {detail && detail.source === source && (
          <image
            href={detail.url}
            preserveAspectRatio="none"
            x={detail.window[0] - 0.5}
            y={detail.window[1] - 0.5}
            width={detail.window[2] - detail.window[0]}
            height={detail.window[3] - detail.window[1]}
          />
        )}
        {points.map((point, index) => (
          <g
            key={point.id}
            onPointerDown={(event) => {
              event.stopPropagation()
              onSelect(point.id)
              if (!readOnly) {
                movingPoint.current = point.id
                svg.current?.setPointerCapture(event.pointerId)
              }
            }}
            style={{ cursor: readOnly ? 'pointer' : 'move' }}
          >
            <circle
              cx={point.pixel[0]}
              cy={point.pixel[1]}
              r={radius * (point.id === selectedId ? 1.2 : 1)}
              fill={!point.enabled ? '#6b7280' : point.role === 'check' ? '#b45309' : '#0369a1'}
              stroke="white"
              strokeWidth={2 / scale}
            />
            <text
              x={point.pixel[0]}
              y={point.pixel[1]}
              fill="white"
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={11 / scale}
              fontWeight="bold"
              pointerEvents="none"
            >
              {index + 1}
            </text>
          </g>
        ))}
        {pending && (
          <circle
            cx={pending[0]}
            cy={pending[1]}
            r={radius * 1.25}
            fill="none"
            stroke="#e11d48"
            strokeWidth={3 / scale}
          />
        )}
      </svg>
      <p className="border-t px-3 py-2 text-xs leading-5 text-muted-foreground">
        Click or tap a stable landmark, then its matching place on the map. Drag numbered points to refine them. Pinch
        or use + / − to zoom.
      </p>
    </section>
  )
}
