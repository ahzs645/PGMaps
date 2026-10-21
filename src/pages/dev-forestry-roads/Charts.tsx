import { useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { ChartViewport, SizedChart } from '@pgmaps/geo-toolkit/visualizations/react'
import { Button } from '@/components/ui/button'
import type { Alignment, CableAnalysis, RoadAnalysis, RoadStation, VerticalPoint } from './types'

export const ROAD_CHART_COLORS = {
  ground: '#a07845',
  design: '#0d9488',
  cut: '#d97706',
  fill: '#3b82f6',
  selected: '#e11d48',
  mass: '#7c3aed',
}

type Domain = [number, number, number, number]
type Point = { x: number; ground: number | null; design: number | null }
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n))
const finite = (n: number | null | undefined): n is number => n != null && Number.isFinite(n)
const format = (n: number | null | undefined, digits = 1) =>
  finite(n) ? n.toLocaleString('en-CA', { maximumFractionDigits: digits }) : '—'

export function formatRoadStation(value: number) {
  const rounded = Math.round(Math.max(0, value) * 10) / 10
  return `${Math.floor(rounded / 1000)}+${(rounded % 1000).toFixed(1).padStart(5, '0')}`
}

function extent(values: Array<number | null>, minimumSpan = 4): [number, number] {
  const usable = values.filter(finite)
  if (!usable.length) return [0, minimumSpan]
  const low = Math.min(...usable),
    high = Math.max(...usable)
  const span = Math.max(minimumSpan, high - low)
  return [(low + high) / 2 - span * 0.6, (low + high) / 2 + span * 0.6]
}

function chartFrame(width: number, height: number, domain: Domain) {
  const left = width < 380 ? 48 : 58,
    right = 16,
    top = 24,
    bottom = 36
  const plotWidth = Math.max(1, width - left - right),
    plotHeight = Math.max(1, height - top - bottom)
  const x = (value: number) => left + ((value - domain[0]) / Math.max(0.001, domain[1] - domain[0])) * plotWidth
  const y = (value: number) => top + ((domain[3] - value) / Math.max(0.001, domain[3] - domain[2])) * plotHeight
  return { left, right, top, bottom, plotWidth, plotHeight, x, y }
}

function eventValue(event: { clientX: number; clientY: number }, svg: SVGSVGElement, domain: Domain) {
  const bounds = svg.getBoundingClientRect()
  const frame = chartFrame(bounds.width, bounds.height, domain)
  return [
    domain[0] + clamp((event.clientX - bounds.left - frame.left) / frame.plotWidth, 0, 1) * (domain[1] - domain[0]),
    domain[3] - clamp((event.clientY - bounds.top - frame.top) / frame.plotHeight, 0, 1) * (domain[3] - domain[2]),
  ] as const
}

function linePath(points: Point[], key: 'ground' | 'design', x: (n: number) => number, y: (n: number) => number) {
  let connected = false
  return points
    .map((p) => {
      const value = p[key]
      if (!finite(value)) {
        connected = false
        return ''
      }
      const command = `${connected ? 'L' : 'M'}${x(p.x).toFixed(2)},${y(value).toFixed(2)}`
      connected = true
      return command
    })
    .join(' ')
}

/** Split sign changes at the true interpolated ground/design intersection. */
function differencePolygons(points: Point[], x: (n: number) => number, y: (n: number) => number) {
  const result: { points: string; color: string }[] = []
  const add = (a: Point, b: Point) => {
    if (!finite(a.ground) || !finite(a.design) || !finite(b.ground) || !finite(b.design)) return
    const difference = a.ground - a.design + (b.ground - b.design)
    if (Math.abs(difference) < 1e-8) return
    result.push({
      points: `${x(a.x)},${y(a.ground)} ${x(b.x)},${y(b.ground)} ${x(b.x)},${y(b.design)} ${x(a.x)},${y(a.design)}`,
      color: difference > 0 ? ROAD_CHART_COLORS.cut : ROAD_CHART_COLORS.fill,
    })
  }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i]
    if (!finite(a.ground) || !finite(a.design) || !finite(b.ground) || !finite(b.design)) continue
    const da = a.ground - a.design,
      db = b.ground - b.design
    if (da * db < 0) {
      const f = da / (da - db)
      const middle = {
        x: a.x + (b.x - a.x) * f,
        ground: a.ground + (b.ground - a.ground) * f,
        design: a.design + (b.design - a.design) * f,
      }
      add(a, middle)
      add(middle, b)
    } else add(a, b)
  }
  return result
}

function Grid({
  width,
  height,
  domain,
  xLabel,
  yLabel,
  stationTicks = false,
}: {
  width: number
  height: number
  domain: Domain
  xLabel: string
  yLabel: string
  stationTicks?: boolean
}) {
  const f = chartFrame(width, height, domain)
  const ticks = width < 360 ? 3 : 5
  return (
    <g fontSize="10" fill="hsl(var(--muted-foreground))" pointerEvents="none">
      {Array.from({ length: ticks }, (_, i) => {
        const value = domain[0] + ((domain[1] - domain[0]) * i) / (ticks - 1)
        return (
          <g key={`x${i}`}>
            <line
              x1={f.x(value)}
              x2={f.x(value)}
              y1={f.top}
              y2={height - f.bottom}
              stroke="hsl(var(--border))"
              strokeDasharray="3 4"
            />
            <text x={f.x(value)} y={height - 19} textAnchor={i === ticks - 1 ? 'end' : 'middle'}>
              {stationTicks ? formatRoadStation(value).replace(/\.0$/, '') : format(value, 0)}
            </text>
          </g>
        )
      })}
      {Array.from({ length: 4 }, (_, i) => {
        const value = domain[2] + ((domain[3] - domain[2]) * i) / 3
        return (
          <g key={`y${i}`}>
            <line x1={f.left} x2={width - f.right} y1={f.y(value)} y2={f.y(value)} stroke="hsl(var(--border))" />
            <text x={f.left - 7} y={f.y(value) + 3} textAnchor="end">
              {format(value, 1)}
            </text>
          </g>
        )
      })}
      <text x={f.left} y={12}>
        {yLabel}
      </text>
      <text x={f.left + f.plotWidth / 2} y={height - 3} textAnchor="middle">
        {xLabel}
      </text>
    </g>
  )
}

function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      {items.map((item) => (
        <span className="inline-flex items-center gap-1.5" key={item.label}>
          <span className="h-0.5 w-4" style={{ backgroundColor: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  )
}

function ChartSlot({
  children,
  footer,
}: {
  children: (width: number, height: number) => ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="flex h-full min-h-[215px] min-w-0 flex-col">
      <ChartViewport className="min-h-[175px] flex-1" minHeight={175} initialHeight={230}>
        {(height) => <SizedChart height={height}>{(width) => children(width, height)}</SizedChart>}
      </ChartViewport>
      {footer && <div className="shrink-0 space-y-1 border-t px-3 py-2">{footer}</div>}
    </div>
  )
}

function selectWithKeyboard(
  event: KeyboardEvent<SVGSVGElement>,
  station: number,
  length: number,
  onStation: (n: number) => void,
) {
  const amount = event.shiftKey ? 50 : 10
  const next =
    event.key === 'ArrowRight'
      ? station + amount
      : event.key === 'ArrowLeft'
        ? station - amount
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? length
            : null
  if (next !== null) {
    event.preventDefault()
    onStation(clamp(next, 0, length))
  }
}

export function ProfileChart({
  analysis,
  alignment,
  station,
  onStation,
  onVerticalChange,
  terrainOnly = false,
}: {
  analysis: RoadAnalysis
  alignment: Alignment
  station: number
  onStation: (chainage: number) => void
  onVerticalChange: (points: VerticalPoint[]) => void
  terrainOnly?: boolean
}) {
  const id = useId().replace(/:/g, '')
  const drag = useRef<{ id: string; points: VerticalPoint[] } | null>(null)
  const [fixedDomain, setFixedDomain] = useState<Domain | null>(null)
  const points = analysis.stations.map((s) => ({
    x: s.chainage,
    ground: s.groundElevation,
    design: terrainOnly ? null : s.designElevation,
  }))
  const [low, high] = extent([
    ...points.flatMap((p) => [p.ground, p.design]),
    ...(terrainOnly ? [] : alignment.vertical.map((v) => v.elevation)),
  ])
  const domain: Domain = fixedDomain ?? [0, Math.max(1, analysis.length), low, high]
  const active = analysis.stations.reduce<RoadStation | undefined>(
    (best, s) => (!best || Math.abs(s.chainage - station) < Math.abs(best.chainage - station) ? s : best),
    undefined,
  )
  const sorted = terrainOnly ? [] : [...alignment.vertical].sort((a, b) => a.chainage - b.chainage)
  const edit = (id: string, chainage: number, elevation: number, original = sorted) => {
    const index = original.findIndex((p) => p.id === id)
    if (index < 0) return
    const minimum = index === 0 ? 0 : original[index - 1].chainage + 0.1
    const maximum = index === original.length - 1 ? analysis.length : original[index + 1].chainage - 0.1
    const fixedChainage =
      index === 0 && original.length > 1
        ? original[0].chainage
        : index === original.length - 1 && original.length > 1
          ? original[index].chainage
          : clamp(chainage, minimum, maximum)
    onVerticalChange(
      original.map((p) =>
        p.id === id
          ? { ...p, chainage: Math.round(fixedChainage * 100) / 100, elevation: Math.round(elevation * 100) / 100 }
          : p,
      ),
    )
    onStation(fixedChainage)
  }
  const handleMove = (event: PointerEvent<SVGSVGElement>) => {
    const [chainage, elevation] = eventValue(event, event.currentTarget, domain)
    if (drag.current) edit(drag.current.id, chainage, elevation, drag.current.points)
    else if (event.buttons === 1) onStation(chainage)
  }
  return (
    <ChartSlot
      footer={
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Legend
              items={
                terrainOnly
                  ? [{ label: 'Ground', color: ROAD_CHART_COLORS.ground }]
                  : [
                      { label: 'Ground', color: ROAD_CHART_COLORS.ground },
                      { label: 'Formation', color: ROAD_CHART_COLORS.design },
                      { label: 'Cut', color: ROAD_CHART_COLORS.cut },
                      { label: 'Fill', color: ROAD_CHART_COLORS.fill },
                    ]
              }
            />
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {formatRoadStation(active?.chainage ?? station)} · {format(active?.gradePercent)}% · ground{' '}
              {format(active?.groundElevation)} m
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground">
            {terrainOnly
              ? 'Click or drag to inspect terrain. Arrow keys move the station.'
              : 'Click or drag to inspect. Double-click to add a vertical control; drag a control to edit. Arrow keys move the station.'}
          </p>
        </>
      }
    >
      {(width, height) => {
        const f = chartFrame(width, height, domain)
        return (
          <svg
            width={width}
            height={height}
            className="touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="road-profile-chart"
            data-terrain-only={terrainOnly}
            data-station={active?.chainage ?? station}
            role="group"
            tabIndex={0}
            aria-label={
              terrainOnly
                ? 'Terrain longitudinal profile. Left and right arrows select station.'
                : 'Road longitudinal profile. Left and right arrows select station. Double-click adds a vertical control.'
            }
            onKeyDown={(event) => {
              if (event.target === event.currentTarget) selectWithKeyboard(event, station, analysis.length, onStation)
            }}
            onPointerDown={(event) => {
              if (event.button !== 0) return
              event.currentTarget.setPointerCapture(event.pointerId)
              onStation(eventValue(event, event.currentTarget, domain)[0])
            }}
            onPointerMove={handleMove}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId)
              drag.current = null
              setFixedDomain(null)
            }}
            onPointerCancel={() => {
              drag.current = null
              setFixedDomain(null)
            }}
            onDoubleClick={(event) => {
              if (terrainOnly || analysis.length < 1 || (event.target as Element).getAttribute('data-pvi') === 'true')
                return
              const [chainage, elevation] = eventValue(event, event.currentTarget, domain)
              let baseline = sorted
              if (baseline.length < 2) {
                const first = analysis.stations[0],
                  last = analysis.stations[analysis.stations.length - 1]
                if (!finite(first?.designElevation) || !finite(last?.designElevation)) return
                baseline = [
                  { id: `pvi-${Date.now()}-start`, chainage: 0, elevation: first.designElevation, curveLength: 0 },
                  {
                    id: `pvi-${Date.now()}-end`,
                    chainage: analysis.length,
                    elevation: last.designElevation,
                    curveLength: 0,
                  },
                ]
              }
              if (baseline.some((p) => Math.abs(p.chainage - chainage) < 1)) return
              onVerticalChange(
                [...baseline, { id: `pvi-${Date.now()}`, chainage, elevation, curveLength: 0 }].sort(
                  (a, b) => a.chainage - b.chainage,
                ),
              )
              onStation(chainage)
            }}
          >
            <title>
              {terrainOnly
                ? 'Terrain elevation by horizontal chainage'
                : 'Ground and designed road elevation by horizontal chainage'}
            </title>
            <defs>
              <clipPath id={`profile-${id}`}>
                <rect x={f.left} y={f.top} width={f.plotWidth} height={f.plotHeight} />
              </clipPath>
            </defs>
            <Grid
              width={width}
              height={height}
              domain={domain}
              xLabel="Chainage (m)"
              yLabel="Elevation (m)"
              stationTicks
            />
            <g clipPath={`url(#profile-${id})`}>
              {differencePolygons(points, f.x, f.y).map((p, i) => (
                <polygon key={i} points={p.points} fill={p.color} opacity={0.23} />
              ))}
              <path
                d={linePath(points, 'ground', f.x, f.y)}
                fill="none"
                stroke={ROAD_CHART_COLORS.ground}
                strokeWidth={1.7}
              />
              <path
                d={linePath(points, 'design', f.x, f.y)}
                fill="none"
                stroke={ROAD_CHART_COLORS.design}
                strokeWidth={2.4}
              />
              {analysis.crossings.map((crossing) => (
                <g key={crossing.id}>
                  <line
                    x1={f.x(crossing.chainage)}
                    x2={f.x(crossing.chainage)}
                    y1={f.top}
                    y2={height - f.bottom}
                    stroke={crossing.kind === 'stream' ? ROAD_CHART_COLORS.fill : ROAD_CHART_COLORS.cut}
                    strokeDasharray="3 3"
                    opacity={0.6}
                  />
                  <title>
                    {crossing.name} at {formatRoadStation(crossing.chainage)}
                  </title>
                </g>
              ))}
              <line
                x1={f.x(station)}
                x2={f.x(station)}
                y1={f.top}
                y2={height - f.bottom}
                stroke={ROAD_CHART_COLORS.selected}
                strokeWidth={1.4}
              />
              {active && finite(terrainOnly ? active.groundElevation : active.designElevation) && (
                <circle
                  cx={f.x(active.chainage)}
                  cy={f.y((terrainOnly ? active.groundElevation : active.designElevation)!)}
                  r={4}
                  fill={ROAD_CHART_COLORS.selected}
                />
              )}
            </g>
            {sorted
              .filter((p) => p.chainage >= 0 && p.chainage <= analysis.length)
              .map((p, index) => (
                <g key={p.id}>
                  <circle
                    data-pvi="true"
                    cx={f.x(p.chainage)}
                    cy={f.y(p.elevation)}
                    r={6}
                    fill="hsl(var(--background))"
                    stroke={ROAD_CHART_COLORS.design}
                    strokeWidth={2}
                    className="cursor-ns-resize outline-none focus-visible:stroke-[4]"
                    tabIndex={0}
                    role="slider"
                    aria-label={`Vertical control ${index + 1} elevation`}
                    aria-valuemin={-12000}
                    aria-valuemax={12000}
                    aria-valuenow={p.elevation}
                    aria-valuetext={`${format(p.elevation, 2)} metres at station ${formatRoadStation(p.chainage)}`}
                    onPointerDown={(event) => {
                      event.stopPropagation()
                      drag.current = { id: p.id, points: sorted }
                      setFixedDomain(domain)
                      event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId)
                    }}
                    onKeyDown={(event) => {
                      const step = event.shiftKey ? 1 : 0.1
                      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
                        event.preventDefault()
                        event.stopPropagation()
                        edit(
                          p.id,
                          p.chainage + (event.key === 'ArrowLeft' ? -5 : event.key === 'ArrowRight' ? 5 : 0),
                          p.elevation + (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0),
                        )
                      }
                    }}
                  >
                    <title>
                      Control {index + 1}: {formatRoadStation(p.chainage)} / {format(p.elevation, 2)} m. Drag or use
                      arrow keys.
                    </title>
                  </circle>
                </g>
              ))}
            {!points.some((p) => finite(p.ground)) && (
              <text x={width / 2} y={height / 2} fill="hsl(var(--muted-foreground))" fontSize="12" textAnchor="middle">
                No terrain samples on this alignment
              </text>
            )}
          </svg>
        )
      }}
    </ChartSlot>
  )
}

export function CrossSectionChart({
  station,
  onShift: shiftAlignment,
  terrainOnly = false,
}: {
  station: RoadStation | undefined
  onShift?: (meters: number) => void
  terrainOnly?: boolean
}) {
  const id = useId().replace(/:/g, '')
  const drag = useRef<number | null>(null)
  const [shiftPreview, setShiftPreview] = useState(0)
  const onShift = terrainOnly ? undefined : shiftAlignment
  const points =
    station?.section.map((p) => ({ x: p.offset, ground: p.ground, design: terrainOnly ? null : p.design })) ?? []
  const [low, high] = extent(points.flatMap((p) => [p.ground, p.design]))
  const halfWidth = Math.max(15, ...points.map((p) => Math.abs(p.x)))
  const domain: Domain = [-halfWidth, halfWidth, low, high]
  return (
    <ChartSlot
      footer={
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Legend
              items={
                terrainOnly
                  ? [{ label: 'Ground', color: ROAD_CHART_COLORS.ground }]
                  : [
                      { label: 'Ground', color: ROAD_CHART_COLORS.ground },
                      { label: 'Template', color: ROAD_CHART_COLORS.design },
                      { label: 'Cut', color: ROAD_CHART_COLORS.cut },
                      { label: 'Fill', color: ROAD_CHART_COLORS.fill },
                    ]
              }
            />
            {!terrainOnly && (
              <span className="text-[11px] tabular-nums">
                Cut {format(station?.cutAreaM2)} m² · fill {format(station?.fillAreaM2)} m²
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground">
            <span>
              {terrainOnly
                ? 'Terrain across the selected station; negative offsets are left looking forward.'
                : station?.complete
                  ? `Daylight L ${format(station.leftDaylightM)} m / R ${format(station.rightDaylightM)} m`
                  : 'Incomplete section: terrain coverage or daylight limit.'}
            </span>
            {onShift && (
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[10px]"
                  aria-label="Shift road left one metre"
                  onClick={() => onShift(-1)}
                >
                  ← 1 m
                </Button>
                <span>Shift alignment</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[10px]"
                  aria-label="Shift road right one metre"
                  onClick={() => onShift(1)}
                >
                  1 m →
                </Button>
              </div>
            )}
          </div>
        </>
      }
    >
      {(width, height) => {
        const f = chartFrame(width, height, domain)
        return (
          <svg
            width={width}
            height={height}
            className={onShift ? 'touch-none' : undefined}
            data-testid="road-section-chart"
            data-terrain-only={terrainOnly}
            data-station={station?.chainage ?? 0}
            data-left-width={station?.leftWidth}
            data-right-width={station?.rightWidth}
            role="group"
            aria-label={`${terrainOnly ? 'Terrain' : 'Road'} cross-section at ${formatRoadStation(station?.chainage ?? 0)}. Negative offsets are left looking forward.`}
            onPointerDown={
              onShift
                ? (event) => {
                    if (event.button !== 0) return
                    drag.current = eventValue(event, event.currentTarget, domain)[0]
                    event.currentTarget.setPointerCapture(event.pointerId)
                  }
                : undefined
            }
            onPointerMove={
              onShift
                ? (event) => {
                    if (drag.current !== null)
                      setShiftPreview(clamp(eventValue(event, event.currentTarget, domain)[0] - drag.current, -20, 20))
                  }
                : undefined
            }
            onPointerUp={
              onShift
                ? (event) => {
                    if (drag.current !== null) {
                      const delta = clamp(eventValue(event, event.currentTarget, domain)[0] - drag.current, -20, 20)
                      if (Math.abs(delta) > 0.1) onShift(Math.round(delta * 10) / 10)
                      drag.current = null
                      setShiftPreview(0)
                    }
                  }
                : undefined
            }
            onPointerCancel={() => {
              drag.current = null
              setShiftPreview(0)
            }}
          >
            <title>
              {terrainOnly
                ? 'Terrain cross-section, looking in the direction of increasing chainage'
                : 'Ground and road template, looking in the direction of increasing chainage'}
            </title>
            <defs>
              <clipPath id={`section-${id}`}>
                <rect x={f.left} y={f.top} width={f.plotWidth} height={f.plotHeight} />
              </clipPath>
            </defs>
            <Grid
              width={width}
              height={height}
              domain={domain}
              xLabel="Left ← Offset from centreline (m) → Right"
              yLabel="Elevation (m)"
            />
            <g clipPath={`url(#section-${id})`}>
              {differencePolygons(points, f.x, f.y).map((p, i) => (
                <polygon key={i} points={p.points} fill={p.color} opacity={0.3} />
              ))}
              <path
                d={linePath(points, 'ground', f.x, f.y)}
                fill="none"
                stroke={ROAD_CHART_COLORS.ground}
                strokeWidth={1.8}
              />
              <path
                d={linePath(points, 'design', (n) => f.x(n + shiftPreview), f.y)}
                fill="none"
                stroke={ROAD_CHART_COLORS.design}
                strokeWidth={2.5}
              />
              <line
                x1={f.x(0)}
                x2={f.x(0)}
                y1={f.top}
                y2={height - f.bottom}
                stroke={ROAD_CHART_COLORS.selected}
                strokeDasharray="3 3"
              />
              {!terrainOnly &&
                station &&
                [-station.leftWidth, station.rightWidth].map((offset) => (
                  <line
                    key={offset}
                    x1={f.x(offset)}
                    x2={f.x(offset)}
                    y1={f.top + 7}
                    y2={height - f.bottom}
                    stroke={ROAD_CHART_COLORS.design}
                    strokeDasharray="2 5"
                    opacity={0.4}
                  />
                ))}
              {!terrainOnly &&
                station &&
                [station.leftDaylightM === null ? null : -Math.abs(station.leftDaylightM), station.rightDaylightM]
                  .filter(finite)
                  .map((offset) => {
                    const sample = points.reduce<Point | undefined>(
                      (best, p) => (!best || Math.abs(p.x - offset) < Math.abs(best.x - offset) ? p : best),
                      undefined,
                    )
                    return sample && finite(sample.ground) ? (
                      <circle
                        key={offset}
                        cx={f.x(offset)}
                        cy={f.y(sample.ground)}
                        r={3.5}
                        fill={ROAD_CHART_COLORS.cut}
                      >
                        <title>Daylight at {format(offset)} m</title>
                      </circle>
                    ) : null
                  })}
            </g>
            {shiftPreview !== 0 && (
              <text x={width / 2} y={f.top + 12} fontSize="11" fill={ROAD_CHART_COLORS.design} textAnchor="middle">
                Shift {shiftPreview > 0 ? '+' : ''}
                {format(shiftPreview)} m on release
              </text>
            )}
            {!station && (
              <text x={width / 2} y={height / 2} fill="hsl(var(--muted-foreground))" fontSize="12" textAnchor="middle">
                Select a road station
              </text>
            )}
          </svg>
        )
      }}
    </ChartSlot>
  )
}

export function MassHaulChart({
  analysis,
  station,
  onStation,
}: {
  analysis: RoadAnalysis
  station: number
  onStation: (chainage: number) => void
}) {
  const id = useId().replace(/:/g, '')
  const points = analysis.stations.map((s) => ({ x: s.chainage, ground: s.massM3, design: 0 }))
  const [low, high] = extent([0, ...points.map((p) => p.ground)], 10)
  const domain: Domain = [0, Math.max(1, analysis.length), low, high]
  return (
    <ChartSlot
      footer={
        <>
          <Legend
            items={[
              { label: 'Cumulative cut × factor − fill', color: ROAD_CHART_COLORS.mass },
              { label: 'Surplus', color: ROAD_CHART_COLORS.cut },
              { label: 'Deficit', color: ROAD_CHART_COLORS.fill },
            ]}
          />
          <p className="text-[10px] text-muted-foreground">
            Balance of computed earthwork; gaps remain unknown. Haul distances and material suitability are not
            modelled.
          </p>
        </>
      }
    >
      {(width, height) => {
        const f = chartFrame(width, height, domain)
        return (
          <svg
            width={width}
            height={height}
            role="group"
            tabIndex={0}
            aria-label="Earthwork mass balance. Click or use left and right arrows to select a road station."
            data-testid="road-mass-chart"
            className="touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onPointerDown={(event) => {
              if (event.button !== 0) return
              event.currentTarget.setPointerCapture(event.pointerId)
              onStation(eventValue(event, event.currentTarget, domain)[0])
            }}
            onPointerMove={(event) => {
              if (event.buttons === 1) onStation(eventValue(event, event.currentTarget, domain)[0])
            }}
            onKeyDown={(event) => selectWithKeyboard(event, station, analysis.length, onStation)}
          >
            <defs>
              <clipPath id={`mass-${id}`}>
                <rect x={f.left} y={f.top} width={f.plotWidth} height={f.plotHeight} />
              </clipPath>
            </defs>
            <Grid
              width={width}
              height={height}
              domain={domain}
              xLabel="Chainage (m)"
              yLabel="Cumulative balance (m³)"
              stationTicks
            />
            <g clipPath={`url(#mass-${id})`}>
              {differencePolygons(points, f.x, f.y).map((p, i) => (
                <polygon key={i} points={p.points} fill={p.color} opacity={0.2} />
              ))}
              <line
                x1={f.left}
                x2={width - f.right}
                y1={f.y(0)}
                y2={f.y(0)}
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="4 4"
              />
              <path
                d={linePath(points, 'ground', f.x, f.y)}
                stroke={ROAD_CHART_COLORS.mass}
                strokeWidth={2}
                fill="none"
              />
              <line
                x1={f.x(station)}
                x2={f.x(station)}
                y1={f.top}
                y2={height - f.bottom}
                stroke={ROAD_CHART_COLORS.selected}
                strokeWidth={1.4}
              />
            </g>
          </svg>
        )
      }}
    </ChartSlot>
  )
}

export function CableChart({ analysis }: { analysis: CableAnalysis }) {
  const points = analysis.samples.map((s) => ({ x: s.distance, ground: s.ground, design: s.cable }))
  const [low, high] = extent(points.flatMap((p) => [p.ground, p.design]))
  const domain: Domain = [0, Math.max(1, analysis.length), low, high]
  return (
    <ChartSlot
      footer={
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Legend
              items={[
                { label: 'Ground', color: ROAD_CHART_COLORS.ground },
                { label: 'Assumed cable geometry', color: ROAD_CHART_COLORS.design },
              ]}
            />
            <span className="text-[11px]">
              Minimum clearance {format(analysis.minClearance)} m{analysis.complete ? '' : ' · incomplete terrain'}
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Geometric deflection screen. Cable tension, payload and equipment capacity require a separate design.
          </p>
        </>
      }
    >
      {(width, height) => {
        const f = chartFrame(width, height, domain)
        return (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label="Cable deflection line and ground profile"
            data-testid="road-cable-chart"
          >
            <title>Cable geometry along horizontal span, with negative-clearance conflicts highlighted</title>
            <Grid width={width} height={height} domain={domain} xLabel="Horizontal span (m)" yLabel="Elevation (m)" />
            {differencePolygons(points, f.x, f.y).map((p, i) => (
              <polygon
                key={i}
                points={p.points}
                fill={p.color === ROAD_CHART_COLORS.cut ? ROAD_CHART_COLORS.selected : ROAD_CHART_COLORS.design}
                opacity={p.color === ROAD_CHART_COLORS.cut ? 0.35 : 0.1}
              />
            ))}
            <path
              d={linePath(points, 'ground', f.x, f.y)}
              stroke={ROAD_CHART_COLORS.ground}
              strokeWidth={1.8}
              fill="none"
            />
            <path
              d={linePath(points, 'design', f.x, f.y)}
              stroke={ROAD_CHART_COLORS.design}
              strokeWidth={2.3}
              fill="none"
            />
            {[points[0], points[points.length - 1]]
              .filter((p): p is Point => Boolean(p))
              .map((p, i) =>
                finite(p.ground) && finite(p.design) ? (
                  <line
                    key={i}
                    x1={f.x(p.x)}
                    x2={f.x(p.x)}
                    y1={f.y(p.ground)}
                    y2={f.y(p.design)}
                    stroke={ROAD_CHART_COLORS.design}
                    strokeWidth={3}
                  />
                ) : null,
              )}
          </svg>
        )
      }}
    </ChartSlot>
  )
}
