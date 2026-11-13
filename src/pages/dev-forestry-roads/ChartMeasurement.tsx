import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Selection = { start: number; end: number | null }
type Frame = {
  left: number
  right: number
  top: number
  bottom: number
  plotWidth: number
  plotHeight: number
  x: (value: number) => number
}

export const CHART_MEASURE_HINT = 'Shift-click two points or Shift-drag to measure horizontal distance. Escape clears.'

/** A temporary reading of the distance axis; no station, geometry or project edits. */
export function useChartMeasurement(scope: unknown) {
  const [state, setState] = useState<{ scope: unknown; selection: Selection | null }>({ scope, selection: null })
  const gesture = useRef<{ pointerId: number; clientX: number } | null>(null)
  const svg = useRef<SVGSVGElement | null>(null)
  if (state.scope !== scope) setState({ scope, selection: null })
  const selection = state.scope === scope ? state.selection : null
  const clear = () => setState({ scope, selection: null })
  return {
    selection,
    clear: () => {
      clear()
      svg.current?.focus({ preventScroll: true })
    },
    start(event: PointerEvent<SVGSVGElement>, value: number, frame: Frame) {
      if (event.button !== 0 || !event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return false
      const bounds = event.currentTarget.getBoundingClientRect()
      const x = event.clientX - bounds.left,
        y = event.clientY - bounds.top
      if (x < frame.left || x > frame.left + frame.plotWidth || y < frame.top || y > frame.top + frame.plotHeight)
        return false
      event.preventDefault()
      event.currentTarget.focus({ preventScroll: true })
      event.currentTarget.setPointerCapture(event.pointerId)
      svg.current = event.currentTarget
      gesture.current = { pointerId: event.pointerId, clientX: event.clientX }
      setState({
        scope,
        selection: selection && selection.end === null ? { ...selection, end: value } : { start: value, end: null },
      })
      return true
    },
    move(event: PointerEvent<SVGSVGElement>, value: number) {
      if (!gesture.current || gesture.current.pointerId !== event.pointerId) return false
      // A click leaves the first endpoint waiting; a deliberate drag measures in one gesture.
      if (Math.abs(event.clientX - gesture.current.clientX) >= 4 && selection)
        setState({ scope, selection: { ...selection, end: value } })
      return true
    },
    end(event: PointerEvent<SVGSVGElement>) {
      if (!gesture.current || gesture.current.pointerId !== event.pointerId) return false
      gesture.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId)
      return true
    },
    cancel() {
      if (!gesture.current) return
      gesture.current = null
      clear()
    },
    key(event: KeyboardEvent) {
      if (event.key !== 'Escape' || !selection) return false
      event.preventDefault()
      event.stopPropagation()
      clear()
      return true
    },
  }
}

type Measurement = ReturnType<typeof useChartMeasurement>
export type MeasurementSlope = { label: string; percent: number | null }
const slopeFormat = new Intl.NumberFormat('en-CA', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  signDisplay: 'exceptZero',
})

export function ChartMeasurementBand({ measurement, frame: f }: { measurement: Measurement; frame: Frame }) {
  const selection = measurement.selection
  if (!selection) return null
  const start = f.x(selection.start),
    end = f.x(selection.end ?? selection.start)
  const left = Math.max(f.left, Math.min(start, end)),
    right = Math.min(f.left + f.plotWidth, Math.max(start, end))
  if (right < left) return null
  const color = 'hsl(var(--foreground))'
  const y = f.top + Math.min(12, f.plotHeight / 2)
  return (
    <g data-testid="chart-measurement-band" pointerEvents="none" aria-hidden="true">
      <rect x={left} y={f.top} width={right - left} height={f.plotHeight} fill={color} fillOpacity={0.08} />
      {[start, end]
        .filter((x, i) => (!i || x !== start) && x >= f.left && x <= f.left + f.plotWidth)
        .map((x) => (
          <line key={x} x1={x} x2={x} y1={f.top} y2={f.top + f.plotHeight} stroke={color} strokeDasharray="4 3" />
        ))}
      {selection.end !== null && (
        <path d={`M${left},${y - 4} v8 M${left},${y} H${right} M${right},${y - 4} v8`} stroke={color} fill="none" />
      )}
    </g>
  )
}

export function ChartMeasurementReadout({
  measurement,
  frame,
  formatEndpoint,
  slopes,
}: {
  measurement: Pick<Measurement, 'selection' | 'clear' | 'key'>
  frame: Pick<Frame, 'left' | 'right' | 'bottom'>
  formatEndpoint: (value: number) => string
  slopes?: (start: number, end: number) => MeasurementSlope[]
}) {
  const selection = measurement.selection
  const decimal = (value: number) =>
    value.toLocaleString('en-CA', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  const readings =
    selection && selection.end !== null
      ? (slopes?.(selection.start, selection.end) ?? []).map(({ label, percent }) => ({
          label,
          percent,
          value: percent === null ? '—' : `${slopeFormat.format(percent)} %`,
        }))
      : []
  const matching = readings.length > 1 && readings.every((r) => r.percent !== null && r.value === readings[0].value)
  const shownReadings = matching ? [{ ...readings[0], label: 'Avg slope' }] : readings
  return (
    <div
      className="pointer-events-none absolute flex justify-center px-1"
      style={{ left: frame.left, right: frame.right, bottom: frame.bottom + 6 }}
    >
      {selection ? (
        <div
          className="pointer-events-auto flex min-w-0 items-center gap-1 rounded-md border bg-background/95 px-2 py-0.5 text-2xs shadow-sm"
          onKeyDown={(event) => measurement.key(event)}
        >
          <span role="status" className="min-w-0 tabular-nums" data-testid="chart-measurement-readout">
            {selection.end === null ? (
              <>From {formatEndpoint(selection.start)} · Shift-click the end</>
            ) : (
              <>
                <strong>{decimal(Math.abs(selection.end - selection.start))} m</strong> horizontal
                <span className="block break-words text-3xs text-muted-foreground">
                  {formatEndpoint(Math.min(selection.start, selection.end))}–
                  {formatEndpoint(Math.max(selection.start, selection.end))}
                </span>
                {shownReadings.map(({ label, value }) => (
                  <span
                    key={label}
                    className="block"
                    title={`${matching ? 'Ground and formation averages match to 0.1 %. ' : ''}Net elevation change ÷ horizontal distance, toward increasing station or offset. Unknown across missing samples.`}
                  >
                    {label}: {value}
                  </span>
                ))}
              </>
            )}
          </span>
          <Button size="icon-2xs" variant="ghost" aria-label="Clear distance measurement" onClick={measurement.clear}>
            <X aria-hidden />
          </Button>
        </div>
      ) : (
        <span className="rounded-sm bg-background/80 px-1 text-3xs text-muted-foreground" title={CHART_MEASURE_HINT}>
          Shift-click two points to measure
        </span>
      )}
    </div>
  )
}
