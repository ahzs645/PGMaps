import { useEffect, useMemo, useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { balanceLevelRange, balanceWhatIf, type BalanceWhatIf } from './balanceLine'
import { NumberField } from './Controls'

/** The what-if line's colour: apart from the curve, the surplus and deficit fills and the class bars. */
export const BALANCE_LINE_COLOR = '#c026d3'

const n = (value: number) => Math.round(value).toLocaleString('en-CA')
const station = (chainage: number) => {
  const rounded = Math.round(Math.max(0, chainage) * 10) / 10
  return `${Math.floor(rounded / 1000)}+${(rounded % 1000).toFixed(1).padStart(5, '0')}`
}

/** The what-if result for a level, or null while the line is off. */
export function useBalanceWhatIf(
  balance: readonly (readonly [number, number])[],
  level: number | null,
  freeHaulM: number | null,
) {
  const range = useMemo(() => balanceLevelRange(balance), [balance])
  const result = useMemo(
    () => (level === null ? null : balanceWhatIf(balance, level, freeHaulM)),
    [balance, level, freeHaulM],
  )
  return { range, result }
}

const clampTo = (value: number, [low, high]: [number, number]) => Math.max(low, Math.min(high, value))

/**
 * The line itself, drawn inside the mass-haul plot: drag it up or down, or focus it and use the
 * arrow keys (Shift or Page keys for bigger steps, Home and End for the curve's lowest and highest
 * value). Escape turns the what-if off. Ticks mark where closed loops meet the line.
 */
export function BalanceLineOverlay({
  result,
  range,
  frame,
  domainY,
  onLevel,
  onClose,
}: {
  result: BalanceWhatIf
  range: [number, number]
  frame: {
    left: number
    top: number
    plotWidth: number
    plotHeight: number
    x: (v: number) => number
    y: (v: number) => number
  }
  /** The plot's low and high y values, to turn a pointer back into m³. */
  domainY: [number, number]
  onLevel: (level: number) => void
  onClose: () => void
}) {
  const y = frame.y(result.levelM3)
  const right = frame.left + frame.plotWidth
  const step = Math.max(1, (range[1] - range[0]) / 100)
  const fromPointer = (event: PointerEvent<SVGGElement>) => {
    const svg = event.currentTarget.ownerSVGElement
    if (!svg) return
    const box = svg.getBoundingClientRect()
    const t = (event.clientY - box.top - frame.top) / frame.plotHeight
    onLevel(clampTo(domainY[1] - t * (domainY[1] - domainY[0]), range))
  }
  const onKeyDown = (event: KeyboardEvent<SVGGElement>) => {
    const big = event.shiftKey ? 10 : 1
    const next =
      event.key === 'ArrowUp'
        ? result.levelM3 + step * big
        : event.key === 'ArrowDown'
          ? result.levelM3 - step * big
          : event.key === 'PageUp'
            ? result.levelM3 + step * 10
            : event.key === 'PageDown'
              ? result.levelM3 - step * 10
              : event.key === 'Home'
                ? range[0]
                : event.key === 'End'
                  ? range[1]
                  : null
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    if (next === null) return
    event.preventDefault()
    event.stopPropagation()
    onLevel(clampTo(next, range))
  }
  return (
    <g data-testid="road-mass-balance-line" data-level={result.levelM3}>
      <line
        x1={frame.left}
        x2={right}
        y1={y}
        y2={y}
        stroke={BALANCE_LINE_COLOR}
        strokeWidth={1.6}
        strokeDasharray="8 3"
      />
      {result.loops
        .filter((loop) => !loop.open && loop.volumeM3 > 0)
        .flatMap((loop) => [loop.start, loop.end])
        .map((chainage, i) => (
          <line
            key={`${chainage}-${i}`}
            x1={frame.x(chainage)}
            x2={frame.x(chainage)}
            y1={y - 5}
            y2={y + 5}
            stroke={BALANCE_LINE_COLOR}
            strokeWidth={2}
          />
        ))}
      <g
        role="slider"
        tabIndex={0}
        aria-label="What-if balance line, m³. Drag, or use the up and down arrows; Escape turns it off."
        aria-valuemin={Math.round(range[0])}
        aria-valuemax={Math.round(range[1])}
        aria-valuenow={Math.round(result.levelM3)}
        aria-valuetext={`${n(result.levelM3)} m³`}
        className="cursor-ns-resize outline-none focus-visible:[&>rect]:stroke-foreground"
        onPointerDown={(event) => {
          if (event.button !== 0) return
          // The plot's own pointer handling selects a station; this gesture is the line's.
          event.stopPropagation()
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          event.currentTarget.focus({ preventScroll: true })
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
          event.stopPropagation()
          fromPointer(event)
        }}
        onPointerUp={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
          event.stopPropagation()
          event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onKeyDown={onKeyDown}
      >
        {/* A wide, invisible grip along the whole line. */}
        <line x1={frame.left} x2={right} y1={y} y2={y} stroke="transparent" strokeWidth={12} />
        <rect
          x={right - 92}
          y={y - 9}
          width={90}
          height={14}
          rx={3}
          fill={BALANCE_LINE_COLOR}
          stroke="transparent"
          strokeWidth={2}
        />
        <text x={right - 47} y={y + 1.5} textAnchor="middle" fontSize="9" fill="#ffffff">
          What-if {n(result.levelM3)} m³
        </text>
      </g>
    </g>
  )
}

/**
 * The what-if's controls and readout under the mass-haul chart. Off, it is one button; on, the
 * line's level, Reset and Close, the balanced loops and the totals. Nothing here changes the design
 * or the reported haul.
 */
export function BalanceWhatIfPanel({
  result,
  range,
  freeHaulM,
  onLevel,
  onOpen,
  onClose,
  onStation,
}: {
  result: BalanceWhatIf | null
  range: [number, number]
  freeHaulM: number | null
  onLevel: (level: number) => void
  onOpen: () => void
  onClose: () => void
  onStation: (chainage: number) => void
}) {
  const openButton = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)
  const isOpen = !!result
  // Closing the what-if (Escape on the line, or Close what-if) removes the focused control; hand
  // focus to the button that opens it again rather than dropping it to the page.
  useEffect(() => {
    if (isOpen) {
      wasOpen.current = true
      return
    }
    if (!wasOpen.current) return
    wasOpen.current = false
    const active = typeof document === 'undefined' ? null : document.activeElement
    if (!active || active === document.body) openButton.current?.focus({ preventScroll: true })
  }, [isOpen])
  if (!result)
    return (
      <div className="flex items-center gap-1">
        <Button
          ref={openButton}
          type="button"
          variant="outline"
          size="sm"
          className="h-6 px-2 text-3xs"
          onClick={onOpen}
          data-testid="road-mass-whatif-open"
          disabled={range[1] - range[0] <= 0}
        >
          What-if balance line
        </Button>
        <InfoTip label="About the what-if balance line">
          Drag a horizontal balance line on the diagram to see which lengths of road balance at that level, how much
          each moves and how far, and the overhaul past the free-haul distance. It is a reading of the curve only: the
          design, the solved allocation and the reported haul do not change.
        </InfoTip>
      </div>
    )
  const loops = result.loops.filter((loop) => loop.volumeM3 > 0.5)
  const closed = loops.filter((loop) => !loop.open).length
  const open = loops.length - closed
  const ends = [
    result.startM3 > 0.5 && `${n(result.startM3)} m³ comes in at the start`,
    result.startM3 < -0.5 && `${n(-result.startM3)} m³ leaves at the start`,
    result.endM3 > 0.5 && `${n(result.endM3)} m³ leaves at the end`,
    result.endM3 < -0.5 && `${n(-result.endM3)} m³ comes in at the end`,
  ].filter(Boolean)
  return (
    <div className="space-y-1 border-t pt-1 text-3xs" data-testid="road-mass-whatif">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-32">
          <NumberField
            label="What-if balance line (m³)"
            value={Math.round(result.levelM3)}
            min={Math.floor(range[0])}
            max={Math.ceil(range[1])}
            step={1}
            precision={0}
            onChange={(value) => onLevel(Math.max(range[0], Math.min(range[1], value)))}
          />
        </div>
        <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-3xs" onClick={() => onLevel(0)}>
          Reset to 0
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-3xs"
          onClick={onClose}
          data-testid="road-mass-whatif-close"
        >
          Close what-if
        </Button>
      </div>
      <p className="font-medium" style={{ color: BALANCE_LINE_COLOR }}>
        What-if only: the design and the reported haul are unchanged.
      </p>
      <p data-testid="road-mass-whatif-totals">
        {/* "Moves" counts what balances inside every loop, including the inner part of a loop that runs to a
            road end; only closed loops balance a whole length of road, so the two are stated apart. */}
        Moves {n(result.volumeM3)} m³, {n(result.haulM3m)} m³·m inside the road
        {freeHaulM === null
          ? ' · no free-haul distance entered, so no overhaul'
          : ` · overhaul ${n(result.overhaulM3)} m³, ${n(result.overhaulM3m)} m³·m past ${n(freeHaulM)} m free haul`}
        {` · ${closed} closed loop${closed === 1 ? '' : 's'} balance${closed === 1 ? 's' : ''} ${n(result.balancedLengthM)} m of road`}
        {open > 0 &&
          ` · ${open} loop${open === 1 ? ' runs' : 's run'} to a road end, where only ${open === 1 ? 'its' : 'their'} inner part balances`}
        {ends.length > 0 && ` · ${ends.join(', ')}`}
      </p>
      {loops.length > 0 && (
        <ul className="max-h-24 space-y-0.5 overflow-auto overscroll-none" data-testid="road-mass-whatif-loops">
          {loops.map((loop) => (
            <li key={`${loop.start}-${loop.end}`}>
              <button
                type="button"
                className="text-left underline decoration-dotted"
                title="Select the loop's start station"
                onClick={() => onStation(loop.start)}
              >
                {station(loop.start)}–{station(loop.end)} · {n(loop.end - loop.start)} m
                {loop.open ? ` (runs to the road ${loop.open === 'both' ? 'ends' : loop.open})` : ''}:{' '}
                {n(loop.volumeM3)} m³ {loop.direction} · mean haul{' '}
                {loop.meanHaulM === null ? '—' : `${n(loop.meanHaulM)} m`}
                {freeHaulM !== null && loop.overhaulM3 > 0.5 && ` · overhaul ${n(loop.overhaulM3)} m³`}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
