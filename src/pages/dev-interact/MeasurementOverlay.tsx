import { Navigation, Redo, Undo, X } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { useMap } from '@/components/ui/map'
import { cn } from '@/lib/utils'
import { formatArea, formatDistance, measurementCanClose } from './geo'
import { MeasurementValue } from './SmallControls'
import type { MeasurementMode, MeasurementStats } from './types'

export function MeasurementOverlay({
  measurementMode,
  measurementShape,
  measurementStats,
  measurementPoints,
  measurementCursor,
  canUndo,
  canRedo,
  onAddPoint,
  onPreviewPoint,
  onSetCircleRadiusPoint,
  onUndo,
  onRedo,
  onClearMeasurement,
  onFinishMeasurement,
}: {
  measurementMode: MeasurementMode
  measurementShape: 'polygon' | 'circle'
  measurementStats: MeasurementStats
  measurementPoints: [number, number][]
  measurementCursor: [number, number] | null
  canUndo: boolean
  canRedo: boolean
  onAddPoint: (point: [number, number]) => void
  onPreviewPoint: (point: [number, number] | null) => void
  onSetCircleRadiusPoint: (point: [number, number]) => void
  onUndo: () => void
  onRedo: () => void
  onClearMeasurement: () => void
  onFinishMeasurement: () => void
}) {
  const { map } = useMap()

  useEffect(() => {
    if (!map || measurementMode !== 'drawing' || measurementShape !== 'circle' || measurementPoints.length !== 1) return

    const updatePreviewPoint = () => {
      const center = map.getCenter()
      onPreviewPoint([center.lng, center.lat])
    }

    updatePreviewPoint()
    map.on('move', updatePreviewPoint)
    return () => {
      map.off('move', updatePreviewPoint)
      onPreviewPoint(null)
    }
  }, [map, measurementMode, measurementPoints.length, measurementShape, onPreviewPoint])

  if (measurementMode === 'idle') return null

  const canClose = measurementShape === 'circle' ? measurementPoints.length >= 2 : measurementCanClose(measurementPoints)
  const addCenterPoint = () => {
    const center = map?.getCenter()
    if (!center) return
    onAddPoint([center.lng, center.lat])
  }

  return (
    <>
      <MobileMeasurementSheet
        measurementMode={measurementMode}
        measurementShape={measurementShape}
        measurementStats={measurementStats}
        measurementPoints={measurementPoints}
        measurementCursor={measurementCursor}
        canClose={canClose}
        canUndo={canUndo}
        canRedo={canRedo}
        onAddPoint={addCenterPoint}
        onPreviewPoint={onPreviewPoint}
        onSetCircleRadiusPoint={onSetCircleRadiusPoint}
        onUndo={onUndo}
        onRedo={onRedo}
        onClearMeasurement={onClearMeasurement}
        onFinishMeasurement={onFinishMeasurement}
      />
      <DesktopMeasurementCard
        measurementMode={measurementMode}
        measurementShape={measurementShape}
        measurementStats={measurementStats}
        canClose={canClose}
        onClearMeasurement={onClearMeasurement}
        onFinishMeasurement={onFinishMeasurement}
      />
    </>
  )
}

function DesktopMeasurementCard({
  measurementMode,
  measurementShape,
  measurementStats,
  canClose,
  onClearMeasurement,
  onFinishMeasurement,
}: {
  measurementMode: MeasurementMode
  measurementShape: 'polygon' | 'circle'
  measurementStats: MeasurementStats
  canClose: boolean
  onClearMeasurement: () => void
  onFinishMeasurement: () => void
}) {
  return (
    <div className="absolute bottom-4 right-4 z-20 hidden w-[min(22rem,calc(100vw-1.5rem))] rounded-lg border border-border bg-background/95 p-3 shadow-xl backdrop-blur md:block">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{measurementShape === 'circle' ? 'Circle measurement' : 'Polygon measurement'}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {measurementMode === 'drawing'
              ? measurementShape === 'circle'
                ? 'Click once for center, then click again to set radius.'
                : 'Click to add points. Click the first point or double-click to close.'
              : 'Measurement is visible only in this session.'}
          </div>
        </div>
        <button type="button" className="rounded-md p-1.5 hover:bg-muted" onClick={onClearMeasurement} aria-label="Clear measurement">
          <X className="size-4" />
        </button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {measurementShape === 'circle' && <MeasurementValue label="Radius" value={measurementStats?.radius ? formatDistance(measurementStats.radius) : '-'} />}
        <MeasurementValue label={measurementShape === 'circle' ? 'Circumference' : 'Perimeter'} value={measurementStats ? formatDistance(measurementStats.perimeter) : '-'} />
        <MeasurementValue label="Area" value={measurementStats && measurementStats.area > 0 ? formatArea(measurementStats.area) : '-'} />
      </div>
      {measurementMode === 'drawing' && (
        <Button size="sm" className="mt-3 w-full" disabled={!canClose} onClick={onFinishMeasurement}>
          {measurementShape === 'circle' ? 'Set circle' : 'Close polygon'}
        </Button>
      )}
    </div>
  )
}

function MobileMeasurementSheet({
  measurementMode,
  measurementShape,
  measurementStats,
  measurementPoints,
  measurementCursor,
  canClose,
  canUndo,
  canRedo,
  onAddPoint,
  onPreviewPoint,
  onSetCircleRadiusPoint,
  onUndo,
  onRedo,
  onClearMeasurement,
  onFinishMeasurement,
}: {
  measurementMode: MeasurementMode
  measurementShape: 'polygon' | 'circle'
  measurementStats: MeasurementStats
  measurementPoints: [number, number][]
  measurementCursor: [number, number] | null
  canClose: boolean
  canUndo: boolean
  canRedo: boolean
  onAddPoint: () => void
  onPreviewPoint: (point: [number, number] | null) => void
  onSetCircleRadiusPoint: (point: [number, number]) => void
  onUndo: () => void
  onRedo: () => void
  onClearMeasurement: () => void
  onFinishMeasurement: () => void
}) {
  if (measurementShape === 'circle') {
    return (
      <div className="pointer-events-none absolute inset-0 z-40 md:hidden">
        <MobileCircleCanvas
          measurementMode={measurementMode}
          measurementPoints={measurementPoints}
          measurementCursor={measurementCursor}
          measurementStats={measurementStats}
          onPreviewPoint={onPreviewPoint}
          onSetCircleRadiusPoint={onSetCircleRadiusPoint}
        />

        {measurementMode === 'drawing' && (
          <div className="absolute inset-x-0 top-0 z-20 flex items-start justify-between p-4">
            <Button
              type="button"
              variant="secondary"
              className="pointer-events-auto border border-black/10 bg-white px-5 text-neutral-950 shadow-lg hover:bg-neutral-100"
              onClick={onClearMeasurement}
            >
              Cancel
            </Button>
            <div className="flex gap-3">
              <IconToolbarButton
                label="Undo"
                disabled={!canUndo}
                onClick={onUndo}
                className="border-black/10 bg-white text-neutral-950 backdrop-blur hover:bg-neutral-100"
              >
                <Undo className="size-4" />
              </IconToolbarButton>
              <IconToolbarButton
                label="Redo"
                disabled={!canRedo}
                onClick={onRedo}
                className="border-black/10 bg-white text-neutral-950 backdrop-blur hover:bg-neutral-100"
              >
                <Redo className="size-4" />
              </IconToolbarButton>
            </div>
          </div>
        )}

        <div className="absolute bottom-4 right-4 z-20">
          <button
            type="button"
            className="pointer-events-auto flex size-11 items-center justify-center rounded-md border border-white/15 bg-neutral-950/80 text-white shadow-lg backdrop-blur hover:bg-neutral-900"
            aria-label="Center on measurement"
          >
            <Navigation className="size-5" />
          </button>
        </div>

        <div className="absolute inset-x-0 bottom-0 z-30">
          <div
            role="dialog"
            aria-labelledby="circle-measurement-title"
            className="pointer-events-auto overflow-hidden rounded-t-lg bg-white px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-5 text-neutral-950 shadow-[0_-2px_16px_rgba(0,0,0,0.18)]"
          >
            <div className="mx-auto mb-5 h-1 w-9 rounded-full bg-neutral-300" />
            <p id="circle-measurement-title" className="text-lg font-semibold">Circle measurement</p>
            <Button
              className="mt-8 h-12 w-full rounded-md bg-pink-500 font-semibold text-white hover:bg-pink-600"
              onClick={measurementMode === 'drawing' ? onAddPoint : onClearMeasurement}
            >
              {measurementMode === 'drawing' ? 'Add point' : 'Done'}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 md:hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-0 -translate-y-full">
        <div className="flex items-center justify-center pb-2">
          <button
            type="button"
            className="pointer-events-auto flex size-10 items-center justify-center rounded-md border border-border bg-background/90 text-foreground shadow-lg backdrop-blur"
            aria-label="Center on measurement"
          >
            <Navigation className="size-5" />
          </button>
        </div>
      </div>

      <div
        role="dialog"
        aria-labelledby="area-measurement-title"
        className="pointer-events-auto relative z-10 overflow-hidden rounded-t-lg border border-b-0 border-border bg-background shadow-[0_-2px_16px_rgba(0,0,0,0.3)]"
      >
        <header className="border-b border-border px-4 py-3">
          <p id="area-measurement-title" className="text-base font-semibold">{measurementShape === 'circle' ? 'Circle measurement' : 'Area measurement'}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {measurementMode === 'drawing'
              ? measurementShape === 'circle'
                ? measurementPoints.length === 0 ? 'Place circle center' : 'Set circle radius'
                : `${measurementPoints.length} point${measurementPoints.length === 1 ? '' : 's'} placed`
              : 'Measurement is visible only in this session.'}
          </p>
        </header>

        <div className="px-4 py-3">
          {measurementMode === 'drawing' ? (
            <Button className="w-full" onClick={onAddPoint}>
              {measurementShape === 'circle' ? (measurementPoints.length === 0 ? 'Add center' : 'Set radius') : 'Add point'}
            </Button>
          ) : null}
          <div className={cn('grid grid-cols-2 gap-2', measurementMode === 'drawing' && 'mt-3')}>
            {measurementShape === 'circle' && <MeasurementValue label="Radius" value={measurementStats?.radius ? formatDistance(measurementStats.radius) : '-'} />}
            <MeasurementValue label={measurementShape === 'circle' ? 'Circumference' : 'Perimeter'} value={measurementStats ? formatDistance(measurementStats.perimeter) : '-'} />
            <MeasurementValue label="Area" value={measurementStats && measurementStats.area > 0 ? formatArea(measurementStats.area) : '-'} />
          </div>
        </div>

        <div role="toolbar" className="flex items-center gap-2 border-t border-border bg-muted/35 px-3 py-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)]">
          <Button variant="secondary" size="sm" onClick={onClearMeasurement}>
            Cancel
          </Button>
          <div className="min-w-0 flex-1" />
          <IconToolbarButton label="Undo" disabled={!canUndo || measurementMode !== 'drawing'} onClick={onUndo}>
            <Undo className="size-4" />
          </IconToolbarButton>
          <IconToolbarButton label="Redo" disabled={!canRedo || measurementMode !== 'drawing'} onClick={onRedo}>
            <Redo className="size-4" />
          </IconToolbarButton>
          <Button size="sm" disabled={!canClose || measurementMode !== 'drawing'} onClick={onFinishMeasurement}>
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}

function MobileCircleCanvas({
  measurementMode,
  measurementPoints,
  measurementCursor,
  measurementStats,
  onPreviewPoint,
  onSetCircleRadiusPoint,
}: {
  measurementMode: MeasurementMode
  measurementPoints: [number, number][]
  measurementCursor: [number, number] | null
  measurementStats: MeasurementStats
  onPreviewPoint: (point: [number, number] | null) => void
  onSetCircleRadiusPoint: (point: [number, number]) => void
}) {
  const { map } = useMap()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragPointerRef = useRef<number | null>(null)
  const [edgeHandlePosition, setEdgeHandlePosition] = useState<{ x: number; y: number } | null>(null)
  const edgePoint = measurementPoints[1] ?? measurementCursor
  const canAdjust = Boolean(map && measurementPoints[0] && edgePoint)

  useEffect(() => {
    if (!map || measurementPoints.length === 0) return
    const canvas = canvasRef.current
    if (!canvas) return
    let frame = 0

    const draw = () => {
      frame = 0
      const rect = canvas.getBoundingClientRect()
      const scale = window.devicePixelRatio || 1
      const width = Math.max(1, Math.round(rect.width * scale))
      const height = Math.max(1, Math.round(rect.height * scale))
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }

      const context = canvas.getContext('2d')
      if (!context) return
      context.setTransform(scale, 0, 0, scale, 0, 0)
      context.clearRect(0, 0, rect.width, rect.height)

      const center = measurementPoints[0]
      const edge = measurementPoints[1] ?? measurementCursor
      if (!center || !edge) {
        setEdgeHandlePosition(null)
        return
      }

      const centerScreen = map.project(center)
      const edgeScreen = map.project(edge)
      const isDarkMode = document.documentElement.classList.contains('dark')
      const guideColor = isDarkMode ? 'rgba(255, 255, 255, 0.95)' : 'rgba(10, 10, 10, 0.78)'
      const fillColor = isDarkMode ? 'rgba(255, 255, 255, 0.10)' : 'rgba(10, 10, 10, 0.08)'
      const centerColor = isDarkMode ? '#ffffff' : '#0a0a0a'
      const labelBackground = isDarkMode ? '#ffffff' : '#0a0a0a'
      const labelForeground = isDarkMode ? '#0a0a0a' : '#ffffff'
      setEdgeHandlePosition((current) => {
        if (current && Math.abs(current.x - edgeScreen.x) < 0.5 && Math.abs(current.y - edgeScreen.y) < 0.5) return current
        return { x: edgeScreen.x, y: edgeScreen.y }
      })
      const radius = Math.hypot(edgeScreen.x - centerScreen.x, edgeScreen.y - centerScreen.y)
      if (radius < 2) return

      context.fillStyle = fillColor
      context.strokeStyle = guideColor
      context.lineWidth = 2
      context.setLineDash([5, 4])
      context.beginPath()
      context.arc(centerScreen.x, centerScreen.y, radius, 0, Math.PI * 2)
      context.fill()
      context.stroke()

      context.setLineDash([4, 4])
      context.beginPath()
      context.moveTo(centerScreen.x, centerScreen.y)
      context.lineTo(edgeScreen.x, edgeScreen.y)
      context.stroke()

      drawCrosshair(context, edgeScreen.x, edgeScreen.y, guideColor, fillColor)
      drawHandle(context, centerScreen.x, centerScreen.y, centerColor, 4, isDarkMode ? '#0a0a0a' : '#ffffff')
      drawHandle(context, edgeScreen.x, edgeScreen.y, '#ec4899', 8)

      if (measurementStats?.radius) {
        const label = formatDistance(measurementStats.radius)
        const labelX = (centerScreen.x + edgeScreen.x) / 2
        const labelY = (centerScreen.y + edgeScreen.y) / 2
        context.font = '700 13px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
        const metrics = context.measureText(label)
        const labelWidth = metrics.width + 18
        const labelHeight = 26
        context.setLineDash([])
        context.fillStyle = labelBackground
        roundRect(context, labelX - labelWidth / 2, labelY - labelHeight / 2, labelWidth, labelHeight, 13)
        context.fill()
        context.fillStyle = labelForeground
        context.fillText(label, labelX - metrics.width / 2, labelY + 4)
      }
    }

    const scheduleDraw = () => {
      if (frame) return
      frame = window.requestAnimationFrame(draw)
    }

    scheduleDraw()
    map.on('move', scheduleDraw)
    map.on('resize', scheduleDraw)
    window.addEventListener('resize', scheduleDraw)
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      map.off('move', scheduleDraw)
      map.off('resize', scheduleDraw)
      window.removeEventListener('resize', scheduleDraw)
    }
  }, [map, measurementCursor, measurementPoints, measurementStats])

  const pointFromEvent = (event: ReactPointerEvent<HTMLElement>): [number, number] | null => {
    if (!map || !canvasRef.current) return null
    const rect = canvasRef.current.getBoundingClientRect()
    const point = map.unproject([event.clientX - rect.left, event.clientY - rect.top])
    return [point.lng, point.lat]
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!canAdjust) return
    event.preventDefault()
    event.stopPropagation()
    dragPointerRef.current = event.pointerId
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragPointerRef.current !== event.pointerId) return
    event.preventDefault()
    const nextPoint = pointFromEvent(event)
    if (!nextPoint) return
    onPreviewPoint(nextPoint)
    onSetCircleRadiusPoint(nextPoint)
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragPointerRef.current !== event.pointerId) return
    event.preventDefault()
    const nextPoint = pointFromEvent(event)
    dragPointerRef.current = null
    if (nextPoint) onSetCircleRadiusPoint(nextPoint)
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return (
    <>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[300] h-full w-full md:hidden"
        style={{ cursor: 'var(--global-tool-cursor, default)' }}
        data-map-circle-measurement-canvas="true"
        data-measurement-mode={measurementMode}
      />
      {canAdjust && edgeHandlePosition && (
        <button
          type="button"
          aria-label="Adjust circle radius"
          className="pointer-events-auto absolute z-[301] size-11 -translate-x-1/2 -translate-y-1/2 touch-none cursor-grab rounded-full bg-transparent active:cursor-grabbing md:hidden"
          style={{ left: edgeHandlePosition.x, top: edgeHandlePosition.y }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <span className="absolute left-1/2 top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-pink-500 shadow" />
        </button>
      )}
    </>
  )
}

function drawHandle(context: CanvasRenderingContext2D, x: number, y: number, color: string, radius: number, strokeColor = '#ffffff') {
  context.setLineDash([])
  context.fillStyle = color
  context.strokeStyle = strokeColor
  context.lineWidth = 2
  context.beginPath()
  context.arc(x, y, radius, 0, Math.PI * 2)
  context.fill()
  context.stroke()
}

function drawCrosshair(context: CanvasRenderingContext2D, x: number, y: number, color: string, fillColor: string) {
  context.setLineDash([])
  context.fillStyle = fillColor
  context.strokeStyle = color
  context.lineWidth = 1.5
  context.beginPath()
  context.arc(x, y, 64, 0, Math.PI * 2)
  context.fill()
  context.stroke()

  context.beginPath()
  context.moveTo(x, y - 15)
  context.lineTo(x, y + 15)
  context.moveTo(x - 15, y)
  context.lineTo(x + 15, y)
  context.stroke()
}

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath()
  context.moveTo(x + radius, y)
  context.lineTo(x + width - radius, y)
  context.quadraticCurveTo(x + width, y, x + width, y + radius)
  context.lineTo(x + width, y + height - radius)
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
  context.lineTo(x + radius, y + height)
  context.quadraticCurveTo(x, y + height, x, y + height - radius)
  context.lineTo(x, y + radius)
  context.quadraticCurveTo(x, y, x + radius, y)
  context.closePath()
}

function IconToolbarButton({
  label,
  disabled,
  onClick,
  className,
  children,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  className?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex size-9 items-center justify-center rounded-md border border-border bg-background text-foreground shadow-sm disabled:cursor-not-allowed disabled:opacity-45',
        className,
      )}
    >
      {children}
    </button>
  )
}
