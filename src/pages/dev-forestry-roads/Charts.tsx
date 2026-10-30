import type { RoadSelectionRange } from './roadSelection'
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { ChartLine, PanelBottom, Rows3 } from 'lucide-react'
import { ChartViewport, SizedChart } from '@pgmaps/geo-toolkit/visualizations/react'
import { Button } from '@/components/ui/button'
import { ReadoutGrid, type ReadoutItem } from '@/components/ui/readout-grid'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { axisTicks } from './chartScale'
import { EngineeringBands, profileGradeSpans } from './EngineeringBands'
import { verticalCurveSummary } from './engine'
import { constrainPviDrag, MIN_PVI_GAP_M } from './verticalTools'
import { classifySectionOffset, sectionCodePoints, sectionSampleAt } from './sectionGeometry'
import type { Alignment, CableAnalysis, RoadAnalysis, RoadStation, VerticalPoint } from './types'

export const ROAD_CHART_COLORS = {
  ground: '#a07845',
  design: '#0d9488',
  cut: '#d97706',
  fill: '#3b82f6',
  selected: '#e11d48',
  mass: '#7c3aed',
  ditch: '#0369a1',
}

type Domain = [number, number, number, number]
type Point = { x: number; ground: number | null; design: number | null }
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n))
const finite = (n: number | null | undefined): n is number => n != null && Number.isFinite(n)
const format = (n: number | null | undefined, digits = 1) =>
  finite(n) ? n.toLocaleString('en-CA', { maximumFractionDigits: digits }) : '—'
/** Readouts keep a fixed number of decimals so columns of values line up. */
const fixed = (n: number | null | undefined, digits = 1) =>
  finite(n) ? n.toLocaleString('en-CA', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—'

export function formatRoadStation(value: number) {
  const rounded = Math.round(Math.max(0, value) * 10) / 10
  return `${Math.floor(rounded / 1000)}+${(rounded % 1000).toFixed(1).padStart(5, '0')}`
}

function SelectionBand({ range, frame }: { range?: RoadSelectionRange; frame: ReturnType<typeof chartFrame> }) {
  if (!range) return null
  const left = Math.max(frame.left, frame.x(range.start)),
    right = Math.min(frame.left + frame.plotWidth, frame.x(range.end))
  if (right < left) return null
  return (
    <g data-testid="road-chart-selection" aria-label={`Selected ${range.label}`} pointerEvents="none">
      <rect
        x={left}
        y={frame.top}
        width={Math.max(3, right - left)}
        height={frame.plotHeight}
        fill="#e11d48"
        fillOpacity={0.12}
        stroke="#e11d48"
        strokeWidth={1}
      />
      <title>{range.label}</title>
    </g>
  )
}

function extent(values: Array<number | null>, minimumSpan = 4): [number, number] {
  const usable = values.filter(finite)
  if (!usable.length) return [0, minimumSpan]
  const low = Math.min(...usable),
    high = Math.max(...usable)
  const span = Math.max(minimumSpan, high - low)
  return [(low + high) / 2 - span * 0.6, (low + high) / 2 + span * 0.6]
}

function chartFrame(width: number, height: number, domain: Domain, top = 24) {
  const left = width < 380 ? 48 : 58,
    right = 16,
    bottom = 36
  const plotWidth = Math.max(1, width - left - right),
    plotHeight = Math.max(1, height - top - bottom)
  const x = (value: number) => left + ((value - domain[0]) / Math.max(0.001, domain[1] - domain[0])) * plotWidth
  const y = (value: number) => top + ((domain[3] - value) / Math.max(0.001, domain[3] - domain[2])) * plotHeight
  return { left, right, top, bottom, plotWidth, plotHeight, x, y }
}

function eventValue(event: { clientX: number; clientY: number }, svg: SVGSVGElement, domain: Domain, top = 24) {
  const bounds = svg.getBoundingClientRect()
  const frame = chartFrame(bounds.width, bounds.height, domain, top)
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

/** Make absent terrain visible even when a short gap is smaller than a line stroke. */
function TerrainGapBands({
  points,
  x,
  top,
  height,
}: {
  points: Point[]
  x: (value: number) => number
  top: number
  height: number
}) {
  const id = `terrain-gap-${useId().replace(/:/g, '')}`
  const spans: Array<[number, number]> = []
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i]
    if (finite(a.ground) && finite(b.ground)) continue
    const previous = spans[spans.length - 1]
    if (previous?.[1] === a.x) previous[1] = b.x
    else spans.push([a.x, b.x])
  }
  if (!spans.length) return null
  return (
    <g pointerEvents="none">
      <defs>
        <pattern id={id} width={6} height={6} patternUnits="userSpaceOnUse">
          <path d="M-1,1 L1,-1 M0,6 L6,0 M5,7 L7,5" stroke="#b45309" strokeWidth={1} opacity={0.4} />
        </pattern>
      </defs>
      {spans.map(([start, end]) => (
        <rect
          key={start}
          data-terrain-gap
          x={x(start)}
          y={top}
          width={Math.max(2, x(end) - x(start))}
          height={height}
          fill={`url(#${id})`}
        >
          <title>
            Missing terrain between {format(start, 2)} and {format(end, 2)} m
          </title>
        </rect>
      ))}
    </g>
  )
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

/**
 * Engineering axes: a plot frame, dotted major grid on round values, minor ticks, and axis titles
 * on the outside (elevation rotated on the left, the horizontal quantity at the bottom right).
 */
function Grid({
  width,
  height,
  domain,
  xLabel,
  yLabel,
  stationTicks = false,
  top = 24,
}: {
  width: number
  height: number
  domain: Domain
  xLabel: string
  yLabel: string
  stationTicks?: boolean
  top?: number
}) {
  const f = chartFrame(width, height, domain, top)
  const bottom = height - f.bottom
  const xTicks = axisTicks(domain[0], domain[1], Math.max(2, Math.floor(f.plotWidth / (stationTicks ? 72 : 44))))
  const yTicks = axisTicks(domain[2], domain[3], Math.max(2, Math.floor(f.plotHeight / 26)))
  const inside = (value: number, low: number, high: number) => value >= low - 1e-9 && value <= high + 1e-9
  const xLabelText = (value: number) =>
    stationTicks
      ? formatRoadStation(value).replace(/\.0$/, '')
      : value.toLocaleString('en-CA', {
          minimumFractionDigits: xTicks.decimals,
          maximumFractionDigits: xTicks.decimals,
        })
  const tick = 'hsl(var(--muted-foreground))'
  return (
    <g fontSize="9.5" fill="hsl(var(--muted-foreground))" pointerEvents="none" data-axis-step={xTicks.step}>
      {xTicks.major
        .filter((v) => inside(v, domain[0], domain[1]))
        .map((value) => (
          <g key={`x${value}`}>
            <line
              x1={f.x(value)}
              x2={f.x(value)}
              y1={f.top}
              y2={bottom}
              stroke="hsl(var(--border))"
              strokeDasharray="1 3"
            />
            <line x1={f.x(value)} x2={f.x(value)} y1={bottom} y2={bottom + 5} stroke={tick} />
            <text x={f.x(value)} y={bottom + 15} textAnchor="middle">
              {xLabelText(value)}
            </text>
          </g>
        ))}
      {xTicks.minor
        .filter((v) => inside(v, domain[0], domain[1]))
        .map((value) => (
          <line
            key={`xm${value}`}
            x1={f.x(value)}
            x2={f.x(value)}
            y1={bottom}
            y2={bottom + 2.5}
            stroke={tick}
            opacity={0.7}
          />
        ))}
      {yTicks.major
        .filter((v) => inside(v, domain[2], domain[3]))
        .map((value) => (
          <g key={`y${value}`}>
            <line
              x1={f.left}
              x2={width - f.right}
              y1={f.y(value)}
              y2={f.y(value)}
              stroke="hsl(var(--border))"
              strokeDasharray="1 3"
            />
            <line x1={f.left - 5} x2={f.left} y1={f.y(value)} y2={f.y(value)} stroke={tick} />
            <text x={f.left - 7} y={f.y(value) + 3} textAnchor="end">
              {value.toLocaleString('en-CA', {
                minimumFractionDigits: yTicks.decimals,
                maximumFractionDigits: yTicks.decimals,
                useGrouping: false,
              })}
            </text>
          </g>
        ))}
      {yTicks.minor
        .filter((v) => inside(v, domain[2], domain[3]))
        .map((value) => (
          <line
            key={`ym${value}`}
            x1={f.left - 2.5}
            x2={f.left}
            y1={f.y(value)}
            y2={f.y(value)}
            stroke={tick}
            opacity={0.7}
          />
        ))}
      <rect
        x={f.left}
        y={f.top}
        width={f.plotWidth}
        height={f.plotHeight}
        fill="none"
        stroke={tick}
        strokeOpacity={0.45}
      />
      <text
        x={9}
        y={f.top + f.plotHeight / 2}
        textAnchor="middle"
        transform={`rotate(-90 9 ${f.top + f.plotHeight / 2})`}
      >
        {yLabel}
      </text>
      <text x={width - f.right} y={height - 3} textAnchor="end">
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

/** Chart alone, chart with its readouts under it, or the readouts alone (the chart as a tab). */
export type ChartView = 'chart' | 'both' | 'details'
const CHART_VIEWS: ChartView[] = ['chart', 'both', 'details']
type ChartHeaderValue = { target: HTMLElement | null; view: ChartView | null; setView: (view: ChartView) => void }
const ChartHeaderContext = createContext<ChartHeaderValue | null>(null)

/**
 * Gives the charts inside a panel a place in its header for their view switch, and keeps the
 * chosen view for the panel, so it holds when the panel shows a different chart. Render `slot`
 * among the panel's header actions. `storageKey` remembers the choice in this browser.
 */
export function ChartHeader({
  storageKey,
  children,
}: {
  storageKey?: string
  children: (slot: ReactNode) => ReactNode
}) {
  const [target, setTarget] = useState<HTMLElement | null>(null)
  const [view, setStoredView] = useState<ChartView | null>(() => {
    try {
      const saved = storageKey ? localStorage.getItem(storageKey) : null
      return CHART_VIEWS.includes(saved as ChartView) ? (saved as ChartView) : null
    } catch {
      return null
    }
  })
  const setView = (next: ChartView) => {
    setStoredView(next)
    try {
      if (storageKey) localStorage.setItem(storageKey, next)
    } catch {
      // Private windows can refuse storage; the choice still holds for this session.
    }
  }
  return (
    <ChartHeaderContext.Provider value={{ target, view, setView }}>
      {children(<span ref={setTarget} className="contents" />)}
    </ChartHeaderContext.Provider>
  )
}

function ChartSlot({
  children,
  footer,
}: {
  /** May return absolutely positioned controls beside the svg; they float over the chart. */
  children: (width: number, height: number) => ReactNode
  footer?: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [compact, setCompact] = useState(false)
  const header = useContext(ChartHeaderContext)
  const [localView, setLocalView] = useState<ChartView | null>(null)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const resize = () => setCompact(element.clientHeight > 0 && element.clientHeight < 260)
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  // Until someone picks, a short chart folds its readouts away and a tall one shows both.
  const chosen = header ? header.view : localView
  const view: ChartView = !footer ? 'chart' : (chosen ?? (compact ? 'chart' : 'both'))
  const switcher = footer && (
    <SegmentedControl
      size="sm"
      className="road-chart-view-switcher"
      fullWidth={false}
      label="Chart details layout"
      value={view}
      onChange={header ? header.setView : setLocalView}
      options={[
        { value: 'chart', label: 'Chart only', icon: ChartLine, iconOnly: true },
        { value: 'both', label: 'Chart with details below', icon: PanelBottom, iconOnly: true },
        { value: 'details', label: 'Details only', icon: Rows3, iconOnly: true },
      ]}
    />
  )
  return (
    <div
      ref={ref}
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
      data-chart-slot
      data-compact={compact || undefined}
      data-chart-view={view}
    >
      {switcher &&
        (header?.target ? (
          createPortal(switcher, header.target)
        ) : (
          <div className="flex shrink-0 justify-end pb-1">{switcher}</div>
        ))}
      <div className={`relative min-h-0 flex-1 flex-col ${view === 'details' ? 'hidden' : 'flex'}`}>
        <ChartViewport className="min-h-0 flex-1" minHeight={1} initialHeight={230}>
          {(height) => <SizedChart height={height}>{(width) => children(width, height)}</SizedChart>}
        </ChartViewport>
      </div>
      {footer && (
        <div
          className={
            view === 'chart'
              ? 'hidden'
              : view === 'details'
                ? 'flex min-h-0 flex-1 flex-col'
                : `flex min-h-0 shrink-0 flex-col border-t ${compact ? 'max-h-[45%]' : 'max-h-[50%]'}`
          }
        >
          <div className="min-h-0 space-y-1 overflow-y-auto overscroll-contain px-3 py-2">{footer}</div>
        </div>
      )}
    </div>
  )
}

const PROFILE_TOP = 30
const nearestOf = (stations: RoadStation[], chainage: number) =>
  stations.reduce<RoadStation | undefined>(
    (best, s) => (!best || Math.abs(s.chainage - chainage) < Math.abs(best.chainage - chainage) ? s : best),
    undefined,
  )

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
  selectedRange,
  analysis,
  alignment,
  station,
  onStation,
  onVerticalChange,
  onViewRangeChange,
  selectedCulvertId,
  onSelectCulvert,
  terrainOnly = false,
}: {
  selectedRange?: RoadSelectionRange
  analysis: RoadAnalysis
  alignment: Alignment
  station: number
  onStation: (chainage: number) => void
  onVerticalChange?: (points: VerticalPoint[]) => void
  onViewRangeChange?: (range: [number, number]) => void
  selectedCulvertId?: string
  onSelectCulvert?: (id: string) => void
  terrainOnly?: boolean
}) {
  const id = useId().replace(/:/g, '')
  const editable = !terrainOnly && !!onVerticalChange
  const drag = useRef<{ id: string; points: VerticalPoint[] } | null>(null)
  const [fixedDomain, setFixedDomain] = useState<Domain | null>(null)
  const [navigation, setNavigation] = useState<{
    alignmentId: string
    station: number
    length: number
    range: [number, number] | null
  }>({ alignmentId: alignment.id, station, length: analysis.length, range: null })
  const [verticalScale, setVerticalScale] = useState('fit')
  if (navigation.alignmentId !== alignment.id) {
    setNavigation({ alignmentId: alignment.id, station, length: analysis.length, range: null })
    setFixedDomain(null)
  } else if (navigation.station !== station || navigation.length !== analysis.length) {
    let range = navigation.range
    if (range) {
      const length = Math.max(1, analysis.length),
        span = Math.min(length, range[1] - range[0])
      if (station < range[0] || station > range[1] || range[1] > length) {
        const start = clamp(station - span / 2, 0, Math.max(0, length - span))
        range = [start, start + span]
      }
    }
    setNavigation({ alignmentId: alignment.id, station, length: analysis.length, range })
  }
  const viewRange = navigation.range
  const setViewRange = (range: [number, number] | null) =>
    setNavigation({ alignmentId: alignment.id, station, length: analysis.length, range })
  const visibleStart = viewRange ? clamp(viewRange[0], 0, Math.max(0, analysis.length - 1)) : 0
  const visibleEnd = viewRange
    ? clamp(viewRange[1], visibleStart + 1, Math.max(1, analysis.length))
    : Math.max(1, analysis.length)
  const points = analysis.stations.map((s) => ({
    x: s.chainage,
    ground: s.groundElevation,
    design: terrainOnly ? null : s.designElevation,
  }))
  const ditches = useMemo(() => {
    if (terrainOnly) return []
    const templates = new Map(analysis.engineering?.stations.map((s) => [s.chainage, s.template]))
    const samples = analysis.stations.map((s) => sectionCodePoints(s, templates.get(s.chainage) ?? alignment.template))
    return (['left', 'right'] as const).map((side) => ({
      side,
      points: analysis.stations.map((s, index) => {
        const bottom = samples[index].find((p) => p.code === `${side}-ditch-bottom`)
        return { x: s.chainage, ground: null, design: finite(bottom?.ground) ? bottom!.design : null }
      }),
    }))
  }, [analysis, alignment.template, terrainOnly])
  const [low, high] = extent([
    ...ditches.flatMap((ditch) =>
      ditch.points.filter((p) => p.x >= visibleStart && p.x <= visibleEnd).map((p) => p.design),
    ),
    ...points
      .filter(
        (p, index) =>
          (p.x >= visibleStart && p.x <= visibleEnd) ||
          (p.x < visibleStart && points[index + 1]?.x > visibleStart) ||
          (p.x > visibleEnd && points[index - 1]?.x < visibleEnd),
      )
      .flatMap((p) => [p.ground, p.design]),
    ...(terrainOnly
      ? []
      : alignment.vertical
          .filter((v) => v.chainage >= visibleStart && v.chainage <= visibleEnd)
          .map((v) => v.elevation)),
  ])
  const domain: Domain = fixedDomain ?? [visibleStart, visibleEnd, low, high]
  const lastNotified = useRef<{ alignmentId: string; start: number; end: number } | null>(null)
  const rangeStart = domain[0],
    rangeEnd = domain[1]
  useEffect(() => {
    if (!onViewRangeChange) return
    const previous = lastNotified.current
    if (previous?.alignmentId === alignment.id && previous.start === rangeStart && previous.end === rangeEnd) return
    lastNotified.current = { alignmentId: alignment.id, start: rangeStart, end: rangeEnd }
    onViewRangeChange([rangeStart, rangeEnd])
  }, [alignment.id, rangeStart, rangeEnd, onViewRangeChange])
  const zoom = (factor: number) => {
    const length = Math.max(1, analysis.length),
      span = clamp((visibleEnd - visibleStart) * factor, Math.min(10, length), length)
    const centre = station >= visibleStart && station <= visibleEnd ? station : (visibleStart + visibleEnd) / 2
    const start = clamp(centre - span / 2, 0, Math.max(0, length - span))
    setViewRange(span >= length ? null : [start, start + span])
  }
  const pan = (direction: number) => {
    const span = visibleEnd - visibleStart,
      start = clamp(visibleStart + (direction * span) / 2, 0, Math.max(0, analysis.length - span))
    setViewRange([start, start + span])
  }
  // Wheel and trackpad: zoom about the pointer's chainage; horizontal scroll (or Shift+wheel) pans.
  // A native, non-passive listener so the page does not scroll while the pointer is on the chart.
  const wheelState = useRef({ visibleStart, visibleEnd, length: analysis.length, setViewRange })
  useEffect(() => {
    wheelState.current = { visibleStart, visibleEnd, length: analysis.length, setViewRange }
  })
  const [wheelSvg, setWheelSvg] = useState<SVGSVGElement | null>(null)
  useEffect(() => {
    if (!wheelSvg) return
    const onWheel = (event: WheelEvent) => {
      const state = wheelState.current
      const length = Math.max(1, state.length)
      const span = state.visibleEnd - state.visibleStart
      const box = wheelSvg.getBoundingClientRect()
      const left = box.width < 380 ? 48 : 58
      const fraction = clamp((event.clientX - box.left - left) / Math.max(1, box.width - left - 16), 0, 1)
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey) {
        if (span >= length - 1e-6) return
        event.preventDefault()
        const delta = ((event.shiftKey ? event.deltaY : event.deltaX) / Math.max(1, box.width)) * span
        const start = clamp(state.visibleStart + delta, 0, Math.max(0, length - span))
        state.setViewRange([start, start + span])
        return
      }
      event.preventDefault()
      const anchor = state.visibleStart + fraction * span
      // Pinch arrives as ctrl+wheel with small deltas: scale it up to match a wheel notch.
      const factor = Math.exp(clamp(event.deltaY, -200, 200) * (event.ctrlKey ? 0.01 : 0.0025))
      const next = clamp(span * factor, Math.min(10, length), length)
      if (next >= length - 1e-6) return state.setViewRange(null)
      const start = clamp(anchor - fraction * next, 0, Math.max(0, length - next))
      state.setViewRange([start, start + next])
    }
    wheelSvg.addEventListener('wheel', onWheel, { passive: false })
    return () => wheelSvg.removeEventListener('wheel', onWheel)
  }, [wheelSvg])
  const active = analysis.stations.reduce<RoadStation | undefined>(
    (best, s) => (!best || Math.abs(s.chainage - station) < Math.abs(best.chainage - station) ? s : best),
    undefined,
  )
  const sorted = terrainOnly ? [] : [...alignment.vertical].sort((a, b) => a.chainage - b.chainage)
  const gradeSpans = profileGradeSpans(analysis, alignment, terrainOnly)
  const curves = terrainOnly
    ? []
    : (() => {
        try {
          return verticalCurveSummary(alignment)
        } catch {
          return []
        }
      })()
  const edit = (id: string, chainage: number, elevation: number, original = sorted) => {
    if (!onVerticalChange) return
    const index = original.findIndex((p) => p.id === id)
    if (index < 0) return
    const placed = constrainPviDrag(original, index, chainage, elevation, analysis.length)
    onVerticalChange(
      original.map((p) =>
        p.id === id
          ? {
              ...p,
              chainage: Math.round(placed.chainage * 100) / 100,
              elevation: Math.round(placed.elevation * 100) / 100,
            }
          : p,
      ),
    )
    onStation(placed.chainage)
  }
  const profileValues = analysis.stations
    .map((s) => (terrainOnly ? s.groundElevation : s.designElevation))
    .filter(finite)
  const profileGrades = analysis.stations.map((s) => s.gradePercent).filter(finite)
  const first = analysis.stations.find((s) => finite(terrainOnly ? s.groundElevation : s.designElevation))
  const last = [...analysis.stations].reverse().find((s) => finite(terrainOnly ? s.groundElevation : s.designElevation))
  const summary = [
    `Length ${format(analysis.length)} m`,
    first && last
      ? `Elev diff ${format(((terrainOnly ? last.groundElevation : last.designElevation) ?? 0) - ((terrainOnly ? first.groundElevation : first.designElevation) ?? 0))} m`
      : null,
    profileGrades.length ? `Max grade ${format(Math.max(...profileGrades.map(Math.abs)))}%` : null,
    profileGrades.length ? `Min grade ${format(Math.min(...profileGrades.map(Math.abs)))}%` : null,
    profileValues.length ? `Elev ${format(Math.min(...profileValues))}–${format(Math.max(...profileValues))} m` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const failingCurve = (chainage: number) =>
    (analysis.verticalChecks ?? []).some(
      (check) => (check.kind === 'k' || check.kind === 'curve-length') && Math.abs(check.chainage - chainage) < 0.01,
    )
  const control = 'h-5 min-w-5 rounded px-1 text-[10px] leading-none'
  // Pan, zoom and vertical scale float over the chart's top edge instead of taking a row under it.
  const toolbar = (exaggeration: number, width: number) => (
    <div className="pointer-events-none absolute inset-x-1 top-0.5 flex items-start justify-between gap-2">
      <p
        className="min-w-0 truncate pl-1 pt-1 text-[10px] tabular-nums text-muted-foreground"
        title={`${summary} · ${editable ? 'Click or drag to inspect; double-click adds a vertical control; drag a control to edit.' : 'Click or drag to inspect.'} Arrow keys move the station.`}
        data-testid="road-profile-summary"
      >
        {width >= 520 ? summary : ''}
      </p>
      <div
        role="toolbar"
        aria-label="Profile view"
        className="pointer-events-auto flex shrink-0 items-center gap-0.5 rounded-md border bg-background/90 p-0.5 text-[10px] text-muted-foreground shadow-sm backdrop-blur-sm"
      >
        <Button
          className={control}
          size="sm"
          variant="ghost"
          aria-label="Pan profile backward"
          disabled={visibleStart <= 0}
          onClick={() => pan(-1)}
        >
          ←
        </Button>
        <Button className={control} size="sm" variant="ghost" aria-label="Zoom profile in" onClick={() => zoom(0.5)}>
          +
        </Button>
        <Button className={control} size="sm" variant="ghost" aria-label="Zoom profile out" onClick={() => zoom(2)}>
          −
        </Button>
        <Button
          className={control}
          size="sm"
          variant="ghost"
          aria-label="Pan profile forward"
          disabled={visibleEnd >= analysis.length}
          onClick={() => pan(1)}
        >
          →
        </Button>
        <Button
          className={control}
          size="sm"
          variant="ghost"
          aria-label="Fit full road profile"
          onClick={() => {
            setViewRange(null)
            setVerticalScale('fit')
          }}
        >
          Fit
        </Button>
        <select
          aria-label="Profile vertical exaggeration"
          title="Vertical exaggeration · display only"
          className="h-5 rounded border-0 bg-transparent px-0.5 text-[10px] text-foreground"
          value={verticalScale}
          onChange={(event) => setVerticalScale(event.target.value)}
        >
          {['fit', '1', '2', '5', '10'].map((value) => (
            <option value={value} key={value}>
              {value === 'fit' ? `V auto ×${format(exaggeration, 1)}` : `V ×${value}`}
            </option>
          ))}
        </select>
        {width >= 420 && (
          <span className="px-1 tabular-nums" data-testid="road-profile-range">
            {formatRoadStation(visibleStart)}–{formatRoadStation(visibleEnd)}
          </span>
        )}
      </div>
    </div>
  )
  const handleMove = (event: PointerEvent<SVGSVGElement>, displayedDomain: Domain) => {
    const [chainage, elevation] = eventValue(event, event.currentTarget, displayedDomain, PROFILE_TOP)
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
                      ...(ditches.some((ditch) => ditch.points.some((p) => finite(p.design)))
                        ? [{ label: 'L/R ditch bottoms', color: ROAD_CHART_COLORS.ditch }]
                        : []),
                    ]
              }
            />
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {formatRoadStation(active?.chainage ?? station)} · {format(active?.gradePercent)}% · ground{' '}
              {format(active?.groundElevation)} m
            </span>
          </div>
          <EngineeringBands
            analysis={analysis}
            alignment={alignment}
            station={station}
            onStation={onStation}
            terrainOnly={terrainOnly}
            range={[domain[0], domain[1]]}
          />
        </>
      }
    >
      {(width, height) => {
        const frame = chartFrame(width, height, domain, PROFILE_TOP)
        const targetScale = verticalScale === 'fit' ? 1 : Number(verticalScale)
        const halfSpan = ((domain[1] - domain[0]) * frame.plotHeight) / frame.plotWidth / (2 * targetScale)
        const displayedDomain: Domain =
          fixedDomain ??
          (verticalScale === 'fit'
            ? domain
            : [domain[0], domain[1], (low + high) / 2 - halfSpan, (low + high) / 2 + halfSpan])
        const f = chartFrame(width, height, displayedDomain, PROFILE_TOP)
        const actualExaggeration =
          f.plotHeight /
          (displayedDomain[3] - displayedDomain[2]) /
          (f.plotWidth / (displayedDomain[1] - displayedDomain[0]))
        // Dense profiles (an optimized line, a zoomed-out long road) drop annotation before data:
        // curve bands and labels go first, then callouts thin out, then the PVI handles shrink.
        const pviXs = sorted
          .filter((p) => p.chainage >= displayedDomain[0] && p.chainage <= displayedDomain[1])
          .map((p) => f.x(p.chainage))
        const gaps = pviXs
          .slice(1)
          .map((x, i) => x - pviXs[i])
          .sort((a, b) => a - b)
        const typicalGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : Infinity
        const dense = typicalGap < 44
        const labelledCurves = new Set<string>()
        let lastLabelX = -Infinity
        if (!dense)
          for (const curve of curves) {
            const x = f.x(curve.chainage)
            if (x - lastLabelX < 96) continue
            labelledCurves.add(curve.pviId)
            lastLabelX = x
          }
        const calloutIds = new Set<string>()
        let lastCalloutX = -Infinity
        for (const p of sorted) {
          if (p.chainage < displayedDomain[0] || p.chainage > displayedDomain[1]) continue
          const x = f.x(p.chainage)
          if (x - lastCalloutX < 30) continue
          calloutIds.add(p.id)
          lastCalloutX = x
        }
        const handleRadius = typicalGap < 18 ? 3.5 : typicalGap < 30 ? 4.5 : 6
        return (
          <>
            <svg
              ref={setWheelSvg}
              width={width}
              height={height}
              className="select-none touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="road-profile-chart"
              data-terrain-only={terrainOnly}
              data-station={active?.chainage ?? station}
              data-range-start={displayedDomain[0]}
              data-range-end={displayedDomain[1]}
              data-vertical-exaggeration={actualExaggeration}
              role="group"
              tabIndex={0}
              aria-label={`${terrainOnly ? 'Terrain' : 'Road'} longitudinal profile. Left and right arrows select station.${editable ? ' Double-click adds a vertical control.' : ''}`}
              onKeyDown={(event) => {
                if (event.target === event.currentTarget) selectWithKeyboard(event, station, analysis.length, onStation)
              }}
              onPointerDown={(event) => {
                event.preventDefault()
                if (event.button !== 0) return
                event.currentTarget.setPointerCapture(event.pointerId)
                onStation(eventValue(event, event.currentTarget, displayedDomain, PROFILE_TOP)[0])
              }}
              onPointerMove={(event) => handleMove(event, displayedDomain)}
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
                if (
                  !onVerticalChange ||
                  terrainOnly ||
                  analysis.length < 1 ||
                  (event.target as Element).getAttribute('data-pvi') === 'true'
                )
                  return
                const [chainage, elevation] = eventValue(event, event.currentTarget, displayedDomain, PROFILE_TOP)
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
                if (baseline.some((p) => Math.abs(p.chainage - chainage) < MIN_PVI_GAP_M)) return
                onVerticalChange(
                  [
                    ...baseline,
                    { id: `pvi-${Date.now()}`, chainage, elevation: clamp(elevation, -12000, 12000), curveLength: 0 },
                  ].sort((a, b) => a.chainage - b.chainage),
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
                domain={displayedDomain}
                xLabel="L-Stn (m)"
                yLabel="Elevation (m)"
                stationTicks
                top={PROFILE_TOP}
              />
              <g clipPath={`url(#profile-${id})`}>
                <TerrainGapBands points={points} x={f.x} top={f.top} height={f.plotHeight} />
                <SelectionBand range={selectedRange} frame={f} />
                {curves
                  .filter((curve) => curve.valid && !dense && f.x(curve.end) - f.x(curve.start) >= 6)
                  .map((curve) => (
                    <g key={curve.pviId} pointerEvents="none">
                      <rect
                        x={f.x(Math.max(0, curve.start))}
                        y={f.top}
                        width={Math.max(0, f.x(Math.min(analysis.length, curve.end)) - f.x(Math.max(0, curve.start)))}
                        height={f.plotHeight}
                        fill={ROAD_CHART_COLORS.mass}
                        opacity={0.035}
                      />
                      {[curve.start, curve.end].map((value) => (
                        <line
                          key={value}
                          x1={f.x(value)}
                          x2={f.x(value)}
                          y1={f.top}
                          y2={height - f.bottom}
                          stroke={ROAD_CHART_COLORS.mass}
                          opacity={0.4}
                          strokeDasharray="2 4"
                        />
                      ))}
                    </g>
                  ))}
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
                {ditches.map((ditch) => (
                  <path
                    key={ditch.side}
                    data-testid={`road-profile-${ditch.side}-ditch`}
                    d={linePath(ditch.points, 'design', f.x, f.y)}
                    fill="none"
                    stroke={ROAD_CHART_COLORS.ditch}
                    strokeWidth={1.3}
                    strokeDasharray={ditch.side === 'left' ? '5 3' : '2 2'}
                    pointerEvents="none"
                  >
                    <title>
                      {ditch.side === 'left' ? 'Left' : 'Right'} ditch-bottom elevation from calculated cut sections;
                      gaps remain open.
                    </title>
                  </path>
                ))}
                {analysis.crossings.map((crossing) => (
                  <g
                    key={crossing.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Inspect ${crossing.name} crossing at ${formatRoadStation(crossing.chainage)}`}
                    className="cursor-pointer"
                    onPointerDown={(event) => {
                      event.stopPropagation()
                      onStation(crossing.chainage)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        event.stopPropagation()
                        onStation(crossing.chainage)
                      }
                    }}
                  >
                    <rect
                      x={f.x(crossing.chainage) - 5}
                      y={f.top}
                      width={10}
                      height={f.plotHeight}
                      fill="transparent"
                    />
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
                {!terrainOnly &&
                  analysis.engineering?.culverts.map((culvert, culvertIndex, culverts) => {
                    const s = analysis.stations.reduce<RoadStation | undefined>(
                      (best, item) =>
                        !best || Math.abs(item.chainage - culvert.chainage) < Math.abs(best.chainage - culvert.chainage)
                          ? item
                          : best,
                      undefined,
                    )
                    const elevation = s?.designElevation ?? s?.groundElevation
                    if (!finite(elevation)) return null
                    const x = f.x(culvert.chainage),
                      y = f.y(elevation)
                    const lift =
                      12 +
                      culverts.slice(0, culvertIndex).filter((c) => Math.abs(c.chainage - culvert.chainage) < 0.001)
                        .length *
                        19
                    const grouped = culverts.filter((c) => Math.abs(c.chainage - culvert.chainage) < 0.001).length
                    const markerY = y - f.top > grouped * 19 + 8 ? y - lift : y + lift
                    const selected = selectedCulvertId === culvert.id
                    const design = alignment.engineering?.culverts.find((c) => c.id === culvert.id)
                    return (
                      <g
                        key={culvert.id}
                        className="cursor-pointer"
                        tabIndex={0}
                        role="button"
                        aria-pressed={selected}
                        aria-label={`Inspect structure ${culvert.name} at ${formatRoadStation(culvert.chainage)}`}
                        onPointerDown={(event) => {
                          event.stopPropagation()
                          onSelectCulvert?.(culvert.id)
                          onStation(culvert.chainage)
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            event.stopPropagation()
                            onSelectCulvert?.(culvert.id)
                            onStation(culvert.chainage)
                          }
                        }}
                      >
                        <path
                          d={`M${x - 6},${markerY} L${x + 6},${markerY} L${x},${markerY + 10} Z`}
                          fill={culvert.warnings.length ? ROAD_CHART_COLORS.selected : ROAD_CHART_COLORS.fill}
                          stroke={selected ? ROAD_CHART_COLORS.selected : 'hsl(var(--background))'}
                          strokeWidth={selected ? 3 : 1}
                        />
                        <text
                          x={x + 7}
                          y={markerY}
                          fontSize="9"
                          fill={selected ? ROAD_CHART_COLORS.selected : ROAD_CHART_COLORS.fill}
                          stroke="hsl(var(--background))"
                          strokeWidth={3}
                          paintOrder="stroke"
                        >
                          {design ? `${Math.round(design.diameterM * 1000)} mm` : 'Culvert'}
                          {selected ? ' · selected' : ''}
                        </text>
                        <title>
                          {culvert.name} · {formatRoadStation(culvert.chainage)} · cover {format(culvert.coverM)} m.{' '}
                          {culvert.warnings.join(' ')}
                        </title>
                      </g>
                    )
                  })}
                <line
                  x1={f.x(station)}
                  x2={f.x(station)}
                  y1={f.top}
                  y2={height - f.bottom}
                  stroke={ROAD_CHART_COLORS.selected}
                  strokeWidth={1.4}
                />
                <text
                  x={f.x(station) + (f.x(station) > width - f.right - 70 ? -4 : 4)}
                  y={f.top + 10}
                  textAnchor={f.x(station) > width - f.right - 70 ? 'end' : 'start'}
                  fontSize="9.5"
                  fontWeight={600}
                  fill={ROAD_CHART_COLORS.selected}
                  stroke="hsl(var(--background))"
                  strokeWidth={3}
                  paintOrder="stroke"
                  pointerEvents="none"
                  data-testid="road-profile-cursor-label"
                >
                  {formatRoadStation(active?.chainage ?? station)}
                </text>
                {active && finite(terrainOnly ? active.groundElevation : active.designElevation) && (
                  <circle
                    cx={f.x(active.chainage)}
                    cy={f.y((terrainOnly ? active.groundElevation : active.designElevation)!)}
                    r={4}
                    fill={ROAD_CHART_COLORS.selected}
                  />
                )}
                {gradeSpans
                  .filter((span) => f.x(span.end) - f.x(span.start) > 100)
                  .map((span) => {
                    const level = (chainage: number) => {
                      const nearest = nearestOf(analysis.stations, chainage)
                      return terrainOnly ? nearest?.groundElevation : nearest?.designElevation
                    }
                    const midpoint = (span.start + span.end) / 2
                    const elevation = level(midpoint),
                      a = level(span.start + (span.end - span.start) * 0.25),
                      b = level(span.start + (span.end - span.start) * 0.75)
                    if (!finite(elevation)) return null
                    // Label along the drawn tangent, as on a plotted profile sheet.
                    const angle =
                      finite(a) && finite(b)
                        ? clamp(
                            (Math.atan2(
                              f.y(b) - f.y(a),
                              f.x(span.start + (span.end - span.start) * 0.75) -
                                f.x(span.start + (span.end - span.start) * 0.25),
                            ) *
                              180) /
                              Math.PI,
                            -60,
                            60,
                          )
                        : 0
                    const x = f.x(midpoint),
                      y = Math.max(f.top + 10, f.y(elevation) - 7)
                    return (
                      <text
                        key={span.id}
                        x={x}
                        y={y}
                        transform={`rotate(${angle.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})`}
                        fontSize="9"
                        fill="hsl(var(--foreground))"
                        stroke="hsl(var(--background))"
                        strokeWidth={3}
                        paintOrder="stroke"
                        textAnchor="middle"
                        pointerEvents="none"
                        data-grade-label
                      >
                        {span.label}
                        <title>{span.detail}</title>
                      </text>
                    )
                  })}
                {sorted
                  .filter((p) => calloutIds.has(p.id))
                  .map((p) => {
                    const x = f.x(p.chainage),
                      bottom = height - f.bottom
                    return (
                      <g key={`callout-${p.id}`} pointerEvents="none" data-pvi-callout>
                        <line
                          x1={x}
                          x2={x}
                          y1={clamp(f.y(p.elevation), f.top, bottom)}
                          y2={bottom}
                          stroke={ROAD_CHART_COLORS.design}
                          strokeWidth={0.8}
                          opacity={0.55}
                        />
                        <text
                          x={x - 3}
                          y={bottom - 4}
                          transform={`rotate(-90 ${(x - 3).toFixed(1)} ${(bottom - 4).toFixed(1)})`}
                          fontSize="8.5"
                          fill={ROAD_CHART_COLORS.design}
                          stroke="hsl(var(--background))"
                          strokeWidth={2.5}
                          paintOrder="stroke"
                        >
                          {formatRoadStation(p.chainage)} · {format(p.elevation, 2)}
                        </text>
                      </g>
                    )
                  })}
              </g>
              {!terrainOnly &&
                (alignment.verticalControls ?? [])
                  .filter((c) => c.chainage >= displayedDomain[0] && c.chainage <= displayedDomain[1])
                  .map((c) => {
                    const x = f.x(c.chainage)
                    const failed = (analysis.verticalChecks ?? []).some(
                      (check) => check.kind.startsWith('control') && Math.abs(check.chainage - c.chainage) < 0.01,
                    )
                    const color = failed ? ROAD_CHART_COLORS.selected : '#15803d'
                    const level = nearestOf(analysis.stations, c.chainage)?.designElevation
                    const gradeY = c.elevation ?? level
                    return (
                      <g key={`control-${c.id}`} pointerEvents="none" data-vertical-control={failed ? 'fail' : 'pass'}>
                        {c.elevation !== null && (
                          <>
                            <line
                              x1={x}
                              x2={x}
                              y1={f.y(c.elevation + c.toleranceAboveM)}
                              y2={f.y(c.elevation - c.toleranceBelowM)}
                              stroke={color}
                              strokeWidth={3}
                              strokeLinecap="round"
                              opacity={0.75}
                            />
                            <rect
                              x={x - 4}
                              y={f.y(c.elevation) - 4}
                              width={8}
                              height={8}
                              fill="hsl(var(--background))"
                              stroke={color}
                              strokeWidth={2}
                            />
                          </>
                        )}
                        {c.gradePercent !== null && finite(gradeY) && (
                          <line
                            x1={f.x(c.chainage - 12)}
                            x2={f.x(c.chainage + 12)}
                            y1={f.y(gradeY - (c.gradePercent * 12) / 100)}
                            y2={f.y(gradeY + (c.gradePercent * 12) / 100)}
                            stroke={color}
                            strokeWidth={2}
                            strokeDasharray="3 2"
                          />
                        )}
                        <title>
                          Control {formatRoadStation(c.chainage)}
                          {c.elevation !== null
                            ? ` · Z ${format(c.elevation, 2)} (+${format(c.toleranceAboveM, 2)}/−${format(c.toleranceBelowM, 2)} m)`
                            : ''}
                          {c.gradePercent !== null
                            ? ` · grade ${format(c.gradePercent)} ±${format(c.gradeTolerancePercent)}%`
                            : ''}
                          {failed ? ' · not met' : ' · met'}
                        </title>
                      </g>
                    )
                  })}
              {sorted
                .map((p, index) => ({ p, index }))
                .filter(
                  ({ p }) =>
                    p.chainage >= displayedDomain[0] &&
                    p.chainage <= displayedDomain[1] &&
                    p.elevation >= displayedDomain[2] &&
                    p.elevation <= displayedDomain[3],
                )
                .map(({ p, index }) => (
                  <g key={p.id}>
                    {curves
                      .filter((curve) => curve.pviId === p.id && labelledCurves.has(curve.pviId))
                      .map((curve) => (
                        <text
                          key={curve.pviId}
                          x={f.x(p.chainage)}
                          y={Math.max(f.top + 10, f.y(p.elevation) - 13)}
                          textAnchor="middle"
                          fontSize="9"
                          fill={
                            curve.valid && !failingCurve(curve.chainage)
                              ? ROAD_CHART_COLORS.mass
                              : ROAD_CHART_COLORS.selected
                          }
                          stroke="hsl(var(--background))"
                          strokeWidth={3}
                          paintOrder="stroke"
                          pointerEvents="none"
                        >
                          {curve.valid ? 'VC' : 'Unfitted VC'} {format(curve.length, 0)}
                          {curve.k === null ? '' : ` K=${format(curve.k)}`}
                        </text>
                      ))}
                    <circle
                      data-pvi="true"
                      cx={f.x(p.chainage)}
                      cy={f.y(p.elevation)}
                      r={handleRadius}
                      fill="hsl(var(--background))"
                      stroke={ROAD_CHART_COLORS.design}
                      strokeWidth={2}
                      className={
                        editable ? 'cursor-ns-resize outline-none focus-visible:stroke-[4]' : 'pointer-events-none'
                      }
                      tabIndex={editable ? 0 : undefined}
                      role={editable ? 'slider' : undefined}
                      aria-label={`Vertical control ${index + 1} elevation`}
                      aria-valuemin={-12000}
                      aria-valuemax={12000}
                      aria-valuenow={p.elevation}
                      aria-valuetext={`${format(p.elevation, 2)} metres at station ${formatRoadStation(p.chainage)}`}
                      onPointerDown={(event) => {
                        if (!editable) return
                        event.stopPropagation()
                        drag.current = { id: p.id, points: sorted }
                        setFixedDomain(displayedDomain)
                        event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId)
                      }}
                      onKeyDown={(event) => {
                        if (!editable) return
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
                        Control {index + 1}: {formatRoadStation(p.chainage)} / {format(p.elevation, 2)} m.
                        {editable ? ' Drag or use arrow keys.' : ' Preview only.'}
                      </title>
                    </circle>
                  </g>
                ))}
              {!points.some((p) => finite(p.ground)) && (
                <text
                  x={width / 2}
                  y={height / 2}
                  fill="hsl(var(--muted-foreground))"
                  fontSize="12"
                  textAnchor="middle"
                >
                  No terrain samples on this alignment
                </text>
              )}
            </svg>
            {toolbar(actualExaggeration, width)}
          </>
        )
      }}
    </ChartSlot>
  )
}

export function CrossSectionChart({
  station,
  onShift: shiftAlignment,
  onVerticalShift,
  alignment,
  analysis,
  terrainOnly = false,
  selectedCulvertId,
  onSelectCulvert,
}: {
  station: RoadStation | undefined
  onShift?: (meters: number) => void
  onVerticalShift?: (metres: number) => void
  alignment?: Alignment
  analysis?: RoadAnalysis
  terrainOnly?: boolean
  selectedCulvertId?: string
  onSelectCulvert?: (id: string) => void
}) {
  const id = useId().replace(/:/g, '')
  const drag = useRef<number | null>(null)
  const [shiftPreview, setShiftPreview] = useState(0)
  const [hoverOffset, setHoverOffset] = useState<number | null>(null)
  const onShift = terrainOnly ? undefined : shiftAlignment
  const engineering =
    !terrainOnly && station
      ? analysis?.engineering?.stations.find((s) => Math.abs(s.chainage - station.chainage) < 0.001)
      : undefined
  const template = engineering?.template.template ?? alignment?.template
  const culverts =
    !terrainOnly && station
      ? (analysis?.engineering?.culverts.filter((c) => Math.abs(c.chainage - station.chainage) < 0.001) ?? [])
      : []
  const pipeSections = culverts.map((c) => {
    const length = c.profile[c.profile.length - 1]?.distanceM ?? 0
    const cos = Math.cos(((c.bearing - (station?.bearing ?? 0) - 90) * Math.PI) / 180)
    return {
      culvert: c,
      points: c.profile.map((p) => ({
        x: (p.distanceM - length / 2) * cos,
        ground: p.invertElevation,
        design: p.crownElevation,
      })),
    }
  })
  const points =
    station?.section.map((p) => ({ x: p.offset, ground: p.ground, design: terrainOnly ? null : p.design })) ?? []
  const codePoints = !terrainOnly && station && template ? sectionCodePoints(station, template) : []
  const hoverSample = hoverOffset === null || !station ? null : sectionSampleAt(station, hoverOffset)
  const hovered = hoverSample
    ? { x: hoverSample.offset, ground: hoverSample.ground, design: terrainOnly ? null : hoverSample.design }
    : null
  const hoveredDepth = finite(hovered?.ground) && finite(hovered?.design) ? hovered.ground - hovered.design : null
  const hoveredCode = terrainOnly
    ? 'ground transect'
    : station && template && hovered
      ? classifySectionOffset(station, template, hovered.x)
      : 'unknown-design'
  const [low, high] = extent([
    ...points.flatMap((p) => [p.ground, p.design]),
    ...pipeSections.flatMap((pipe) => pipe.points.flatMap((p) => [p.ground, p.design])),
  ])
  const halfWidth = Math.max(
    15,
    ...points.map((p) => Math.abs(p.x)),
    ...pipeSections.flatMap((pipe) => pipe.points.map((p) => Math.abs(p.x))),
  )
  const domain: Domain = [-halfWidth, halfWidth, low, high]
  const side = (left: number | undefined, right: number | undefined, digits = 1) =>
    `${fixed(left, digits)} / ${fixed(right, digits)}`
  const centreDepth =
    finite(station?.groundElevation) && finite(station?.designElevation)
      ? station.groundElevation - station.designElevation
      : null
  // Section status block, in the abbreviations of a road-design section window.
  const sectionReadout: Array<ReadoutItem | null | undefined> = !station
    ? []
    : terrainOnly
      ? [
          { label: 'L-Stn', value: formatRoadStation(station.chainage), title: 'Selected station along the line' },
          { label: 'Grd Z', value: `${fixed(station.groundElevation, 2)} m`, title: 'Ground elevation at the line' },
          {
            label: 'View',
            value: 'up-station',
            title: 'Looking toward increasing chainage; left offsets are negative',
          },
        ]
      : [
          { label: 'L-Stn', value: formatRoadStation(station.chainage), title: 'Selected station' },
          {
            label: 'Cut Dp',
            value: `${fixed(centreDepth, 2)} m`,
            title: 'Centreline cut depth: ground minus formation; negative is fill',
          },
          { label: 'Grade', value: `${fixed(station.gradePercent)}%`, title: 'Design grade at this station' },
          {
            label: 'Grd Z',
            value: fixed(station.groundElevation, 2),
            title: 'Ground elevation at the centreline (m)',
          },
          {
            label: 'Fmn Z',
            value: fixed(station.designElevation, 2),
            title: 'Formation (subgrade) elevation at the centreline (m)',
          },
          {
            label: 'Width L/R',
            value: side(station.leftWidth, station.rightWidth),
            title: 'Formation half-widths left / right (m)',
          },
          template && {
            label: 'Xfall L/R',
            value: `${side(template.leftCrossfallPercent ?? template.crossfallPercent, template.rightCrossfallPercent ?? template.crossfallPercent)}%`,
            title: 'Crossfall left / right; positive falls away from the centreline',
          },
          template && {
            label: 'Cut H:V L/R',
            value: side(template.leftCutSlope ?? template.cutSlope, template.rightCutSlope ?? template.cutSlope, 2),
            title: 'Cut batter, horizontal per vertical, left / right',
          },
          template && {
            label: 'Fill H:V L/R',
            value: side(template.leftFillSlope ?? template.fillSlope, template.rightFillSlope ?? template.fillSlope, 2),
            title: 'Fill batter, horizontal per vertical, left / right',
          },
          {
            label: 'Dayl L/R',
            value: station.complete
              ? side(
                  station.leftDaylightM === null ? undefined : Math.abs(station.leftDaylightM),
                  station.rightDaylightM ?? undefined,
                )
              : 'incomplete',
            title: station.complete
              ? 'Daylight offsets left / right of the centreline (m)'
              : 'Incomplete section: terrain coverage or daylight limit',
            tone: station.complete ? ('default' as const) : ('warning' as const),
          },
          { label: 'Cut A', value: `${fixed(station.cutAreaM2)} m²`, title: 'Cut area of this section' },
          { label: 'Fill A', value: `${fixed(station.fillAreaM2)} m²`, title: 'Fill area of this section' },
          engineering && {
            label: 'Tmpl L/R',
            value: `${engineering.template.leftName} / ${engineering.template.rightName}`,
            title: 'Template applied to each side',
          },
        ]
  return (
    <ChartSlot
      footer={
        <>
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
          <ReadoutGrid data-testid="road-section-readout" items={sectionReadout} />
          {(onShift || (!terrainOnly && onVerticalShift)) && (
            <div
              role="group"
              aria-label="Road section adjustments"
              className="flex flex-nowrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground md:flex-wrap"
            >
              {onShift && (
                <div role="group" aria-label="Shift alignment" className="flex shrink-0 items-center gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[10px]"
                    aria-label="Shift road left one metre"
                    onClick={() => onShift(-1)}
                  >
                    ← 1 m
                  </Button>
                  <span className="sr-only md:not-sr-only">Shift alignment</span>
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
              {!terrainOnly && onVerticalShift && (
                <div role="group" aria-label="Formation level" className="flex shrink-0 items-center gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[10px]"
                    aria-label="Lower formation 0.25 metres"
                    onClick={() => onVerticalShift(-0.25)}
                  >
                    ↓ 0.25 m
                  </Button>
                  <span className="sr-only md:not-sr-only">Formation level</span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[10px]"
                    aria-label="Raise formation 0.25 metres"
                    onClick={() => onVerticalShift(0.25)}
                  >
                    ↑ 0.25 m
                  </Button>
                </div>
              )}
            </div>
          )}
          {engineering && engineering.layers.length > 0 && (
            <p className="text-[10px] text-muted-foreground">
              User-entered ground layers:{' '}
              {engineering.layers
                .map(
                  (layer) =>
                    `${layer.name} (${format(layer.topDepthM)}–${layer.bottomDepthM === null ? 'deep' : format(layer.bottomDepthM)} m)`,
                )
                .join(' · ')}
              . Unassigned depths remain unclassified.
            </p>
          )}
          <p
            className="hidden min-h-4 text-[10px] tabular-nums text-muted-foreground md:block"
            data-testid="road-section-probe"
          >
            {hovered ? (
              <>
                Offset {format(hovered.x, 2)} m · ground {format(hovered.ground, 2)} m
                {!terrainOnly && (
                  <>
                    {' '}
                    · design {format(hovered.design, 2)} m ·{' '}
                    {hoveredDepth === null
                      ? 'depth unknown'
                      : `${hoveredDepth >= 0 ? 'cut' : 'fill'} ${format(Math.abs(hoveredDepth), 2)} m`}
                  </>
                )}{' '}
                · {hoveredCode}
              </>
            ) : (
              'Move over the section to inspect offset, levels and depth.'
            )}
          </p>
          {culverts.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-label={`Select section culvert ${c.name}`}
              aria-pressed={selectedCulvertId === c.id}
              onClick={() => onSelectCulvert?.(c.id)}
              className={`block w-full rounded border px-1 py-0.5 text-left text-[10px] ${selectedCulvertId === c.id ? 'border-rose-500 bg-rose-500/10 text-rose-700 dark:text-rose-300' : c.warnings.length ? 'border-transparent text-amber-700 dark:text-amber-400' : 'border-transparent text-muted-foreground'}`}
            >
              {c.name}: projected barrel · cover {format(c.coverM)} m · pipe grade {format(c.gradePercent)}% ·{' '}
              {c.complete ? 'sampled geometry complete' : 'incomplete levels or terrain'}. {c.warnings.join(' ')}
            </button>
          ))}
        </>
      }
    >
      {(width, height) => {
        const f = chartFrame(width, height, domain)
        return (
          <svg
            width={width}
            height={height}
            className="select-none touch-none"
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
            onPointerMove={(event) => {
              const offset = eventValue(event, event.currentTarget, domain)[0]
              setHoverOffset(offset)
              if (onShift && drag.current !== null) setShiftPreview(clamp(offset - drag.current, -20, 20))
            }}
            onPointerLeave={() => {
              if (drag.current === null) setHoverOffset(null)
            }}
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
              xLabel="Offset (m) · looking up-station"
              yLabel="Elevation (m)"
            />
            <g clipPath={`url(#section-${id})`}>
              <TerrainGapBands points={points} x={f.x} top={f.top} height={f.plotHeight} />
              {engineering?.layers.flatMap((layer) =>
                points.slice(1).flatMap((b, index) => {
                  const a = points[index]
                  if (!finite(a.ground) || !finite(b.ground)) return []
                  const az = a.ground - layer.topDepthM,
                    bz = b.ground - layer.topDepthM
                  const bottomA = layer.bottomDepthM === null ? low : a.ground - layer.bottomDepthM
                  const bottomB = layer.bottomDepthM === null ? low : b.ground - layer.bottomDepthM
                  return [
                    <polygon
                      key={`${layer.id}-${index}`}
                      points={`${f.x(a.x)},${f.y(az)} ${f.x(b.x)},${f.y(bz)} ${f.x(b.x)},${f.y(bottomB)} ${f.x(a.x)},${f.y(bottomA)}`}
                      fill={layer.color}
                      opacity={0.12}
                    >
                      <title>{layer.name}: user-entered horizon below original ground</title>
                    </polygon>,
                  ]
                }),
              )}
              {engineering?.layers.map((layer) => (
                <path
                  key={`layer-${layer.id}`}
                  d={linePath(
                    points.map((p) => ({ ...p, ground: finite(p.ground) ? p.ground - layer.topDepthM : null })),
                    'ground',
                    f.x,
                    f.y,
                  )}
                  fill="none"
                  stroke={layer.color}
                  strokeWidth={1}
                  strokeDasharray="4 3"
                  opacity={0.85}
                />
              ))}
              {differencePolygons(points, f.x, f.y).map((p, i) => (
                <polygon key={i} points={p.points} fill={p.color} opacity={0.3} />
              ))}
              <path
                d={linePath(points, 'ground', f.x, f.y)}
                fill="none"
                stroke={ROAD_CHART_COLORS.ground}
                strokeWidth={1.8}
              />
              {pipeSections.map(({ culvert, points: pipe }) => (
                <g
                  key={culvert.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Inspect section barrel ${culvert.name}`}
                  aria-pressed={selectedCulvertId === culvert.id}
                  className="cursor-pointer"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => onSelectCulvert?.(culvert.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      event.stopPropagation()
                      onSelectCulvert?.(culvert.id)
                    }
                  }}
                >
                  {differencePolygons(pipe, f.x, f.y).map((polygon, index) => (
                    <polygon key={index} points={polygon.points} fill={ROAD_CHART_COLORS.fill} opacity={0.3} />
                  ))}
                  <path
                    d={linePath(pipe, 'ground', f.x, f.y)}
                    fill="none"
                    stroke={selectedCulvertId === culvert.id ? ROAD_CHART_COLORS.selected : ROAD_CHART_COLORS.fill}
                    strokeWidth={selectedCulvertId === culvert.id ? 3 : 2}
                  />
                  <path
                    d={linePath(pipe, 'design', f.x, f.y)}
                    fill="none"
                    stroke={selectedCulvertId === culvert.id ? ROAD_CHART_COLORS.selected : ROAD_CHART_COLORS.fill}
                    strokeWidth={selectedCulvertId === culvert.id ? 3 : 2}
                  />
                  <title>
                    {culvert.name} projected onto the cross-section. Cover {format(culvert.coverM)} m.
                  </title>
                </g>
              ))}
              <path
                d={linePath(points, 'design', (n) => f.x(n + shiftPreview), f.y)}
                fill="none"
                stroke={ROAD_CHART_COLORS.design}
                strokeWidth={2.5}
              />
              {codePoints
                .filter((p) => p.code.endsWith('ditch-bottom') && finite(p.design))
                .map((p) => (
                  <g key={p.code} data-section-code={p.code} pointerEvents="none">
                    <circle
                      cx={f.x(p.offset + shiftPreview)}
                      cy={f.y(p.design!)}
                      r={4}
                      fill={ROAD_CHART_COLORS.ditch}
                      stroke="white"
                      strokeWidth={1}
                    />
                    <text
                      x={f.x(p.offset + shiftPreview) + (p.offset < 0 ? -6 : 6)}
                      y={f.y(p.design!) + 12}
                      textAnchor={p.offset < 0 ? 'end' : 'start'}
                      fontSize="9"
                      fill={ROAD_CHART_COLORS.ditch}
                      stroke="hsl(var(--background))"
                      strokeWidth={3}
                      paintOrder="stroke"
                    >
                      {p.side === 'left' ? 'L' : 'R'} ditch {format(p.design, 2)} m
                    </text>
                    <title>
                      {p.code}: offset {format(p.offset, 2)} m; ground {format(p.ground, 2)} m; design{' '}
                      {format(p.design, 2)} m.
                    </title>
                  </g>
                ))}
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
              {hovered && (
                <g pointerEvents="none">
                  <line
                    x1={f.x(hovered.x)}
                    x2={f.x(hovered.x)}
                    y1={f.top}
                    y2={height - f.bottom}
                    stroke="hsl(var(--foreground))"
                    strokeDasharray="2 3"
                    opacity={0.6}
                  />
                  {(['ground', 'design'] as const).map((key) =>
                    finite(hovered[key]) ? (
                      <circle
                        key={key}
                        cx={f.x(hovered.x)}
                        cy={f.y(hovered[key]!)}
                        r={3.5}
                        fill={key === 'ground' ? ROAD_CHART_COLORS.ground : ROAD_CHART_COLORS.design}
                        stroke="hsl(var(--background))"
                        strokeWidth={1}
                      />
                    ) : null,
                  )}
                </g>
              )}
            </g>
            {!terrainOnly && station && (
              <g fontSize="9" fill={ROAD_CHART_COLORS.design} stroke={ROAD_CHART_COLORS.design}>
                {[-station.leftWidth, station.rightWidth].map((offset) => (
                  <g key={`dimension-${offset}`}>
                    <line x1={f.x(0)} x2={f.x(offset)} y1={f.top + 10} y2={f.top + 10} strokeWidth={1} />
                    <line x1={f.x(offset)} x2={f.x(offset)} y1={f.top + 6} y2={f.top + 14} strokeWidth={1} />
                    <title>
                      {offset < 0 ? 'Left' : 'Right'} formation half-width: {format(Math.abs(offset))} m
                    </title>
                  </g>
                ))}
                <text
                  x={f.x(0)}
                  y={f.top + 25}
                  stroke="hsl(var(--background))"
                  strokeWidth={3}
                  paintOrder="stroke"
                  textAnchor="middle"
                >
                  L {format(station.leftWidth)} m · R {format(station.rightWidth)} m
                </text>
              </g>
            )}
            {station && (
              <g pointerEvents="none" fontSize="9.5">
                <text
                  x={f.x(0)}
                  y={f.top - 7}
                  textAnchor="middle"
                  fontWeight={600}
                  fill={ROAD_CHART_COLORS.selected}
                  data-testid="road-section-station-label"
                >
                  {formatRoadStation(station.chainage)}
                </text>
                {/* Looking up-station: the road's left is on the left, at negative offsets. */}
                <text x={f.left + 4} y={f.top + 11} fill="hsl(var(--muted-foreground))" data-section-side="left">
                  ◂ L
                </text>
                <text
                  x={width - f.right - 4}
                  y={f.top + 11}
                  textAnchor="end"
                  fill="hsl(var(--muted-foreground))"
                  data-section-side="right"
                >
                  R ▸
                </text>
              </g>
            )}
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
  selectedRange,
  analysis,
  station,
  onStation,
  viewRange,
}: {
  selectedRange?: RoadSelectionRange
  analysis: RoadAnalysis
  station: number
  onStation: (chainage: number) => void
  viewRange?: [number, number]
}) {
  const id = useId().replace(/:/g, '')
  const [showMovements, setShowMovements] = useState(false)
  const engineering = analysis.engineering
  const rangeStart = viewRange ? clamp(viewRange[0], 0, Math.max(0, analysis.length - 1)) : 0
  const rangeEnd = viewRange
    ? clamp(viewRange[1], rangeStart + 1, Math.max(1, analysis.length))
    : Math.max(1, analysis.length)
  const points = (engineering?.stations ?? analysis.stations).map((s) => ({
    x: s.chainage,
    ground: s.massM3,
    design: 0,
  }))
  const selected = points.reduce<Point | undefined>(
    (best, point) => (!best || Math.abs(point.x - station) < Math.abs(best.x - station) ? point : best),
    undefined,
  )
  const nearbyMovements = [...(engineering?.movements ?? [])]
    .filter(
      (movement) =>
        Math.max(movement.fromChainage, movement.toChainage) >= rangeStart &&
        Math.min(movement.fromChainage, movement.toChainage) <= rangeEnd,
    )
    .sort((a, b) => {
      const proximity = (movement: typeof a) =>
        Math.max(
          0,
          Math.min(movement.fromChainage, movement.toChainage) - station,
          station - Math.max(movement.fromChainage, movement.toChainage),
        )
      return proximity(a) - proximity(b) || b.transportedVolumeM3 - a.transportedVolumeM3
    })
    .slice(0, 5)
  const haulColor = (category: string) =>
    category === 'freehaul' ? '#0d9488' : category === 'overhaul' ? '#d97706' : '#7c3aed'
  const haulLabel = (category: string) =>
    category === 'freehaul' ? 'Free haul' : category === 'overhaul' ? 'Overhaul' : 'End haul'
  const [low, high] = extent(
    [
      0,
      ...points
        .filter(
          (p, i) =>
            (p.x >= rangeStart && p.x <= rangeEnd) ||
            (p.x < rangeStart && points[i + 1]?.x > rangeStart) ||
            (p.x > rangeEnd && points[i - 1]?.x < rangeEnd),
        )
        .map((p) => p.ground),
    ],
    10,
  )
  const domain: Domain = [rangeStart, rangeEnd, low, high]
  return (
    <ChartSlot
      footer={
        <>
          <Legend
            items={[
              {
                label: engineering ? 'Usable compacted cut − fill' : 'Cumulative cut × factor − fill',
                color: ROAD_CHART_COLORS.mass,
              },
              { label: 'Surplus', color: ROAD_CHART_COLORS.cut },
              { label: 'Deficit', color: ROAD_CHART_COLORS.fill },
            ]}
          />
          <p className="text-[10px]" data-testid="road-mass-cursor">
            {formatRoadStation(selected?.x ?? station)} · balance {format(selected?.ground)} m³
            {finite(selected?.ground) ? '' : ' · unknown beyond terrain gap'}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {engineering
              ? 'Material reuse and compaction follow the entered assumptions. '
              : 'Balance of computed earthwork. '}
            Gaps remain unknown; quantities cover supported intervals.
          </p>
          {engineering?.haul.enabled && (
            <>
              <p className="text-[10px] text-muted-foreground">
                Road totals · compacted volume: free haul {format(engineering.haul.freeHaulM3)} · overhaul{' '}
                {format(engineering.haul.overhaulM3)} · end haul {format(engineering.haul.endHaulM3)} m³. Borrow{' '}
                {format(engineering.haul.borrowCompactedM3)} compacted m³ · waste {format(engineering.haul.wasteBankM3)}{' '}
                bank m³{engineering.haul.complete ? '' : ' · allocation incomplete'}.
              </p>
              {nearbyMovements.length > 0 && (
                <div className="-mx-3 border-t" data-testid="road-haul-movements">
                  <button
                    className="flex w-full justify-between px-3 py-1 text-[10px] text-muted-foreground hover:bg-muted"
                    aria-expanded={showMovements}
                    onClick={() => setShowMovements((value) => !value)}
                  >
                    <span>
                      Haul movements nearest the cursor · {nearbyMovements.length} of {engineering.movements.length}
                    </span>
                    <span>{showMovements ? 'Hide −' : 'Show +'}</span>
                  </button>
                  {showMovements && (
                    <SizedChart height={nearbyMovements.length * 24 + 4}>
                      {(width) => {
                        const frame = chartFrame(width, 100, domain)
                        return (
                          <svg
                            width={width}
                            height={nearbyMovements.length * 24 + 4}
                            role="group"
                            aria-label="Computed haul movement endpoints; select either end to inspect its road station"
                          >
                            <defs>
                              <clipPath id={`haul-range-${id}`}>
                                <rect
                                  x={frame.left}
                                  y={0}
                                  width={frame.plotWidth}
                                  height={nearbyMovements.length * 24 + 4}
                                />
                              </clipPath>
                              <marker
                                id={`haul-arrow-${id}`}
                                viewBox="0 0 10 10"
                                refX="9"
                                refY="5"
                                markerWidth="5"
                                markerHeight="5"
                                orient="auto-start-reverse"
                              >
                                <path d="M0,0 L10,5 L0,10 z" fill="context-stroke" />
                              </marker>
                            </defs>
                            {nearbyMovements.map((movement, index) => {
                              const fromX = frame.x(movement.fromChainage),
                                toX = frame.x(movement.toChainage),
                                y = index * 24 + 18
                              const detail = `${movement.kind}: ${formatRoadStation(movement.fromChainage)} to ${formatRoadStation(movement.toChainage)}; ${format(movement.transportedVolumeM3)} ${movement.volumeBasis} m³; ${format(movement.distanceM)} m; ${haulLabel(movement.category)}; CAD ${format(movement.haulCost, 2)} haul cost.`
                              return (
                                <g key={movement.id}>
                                  <title>{detail}</title>
                                  <text x={3} y={y + 3} fontSize="9" fill="hsl(var(--muted-foreground))">
                                    {movement.kind === 'cut-to-fill' ? 'C → F' : movement.kind}
                                  </text>
                                  <g clipPath={`url(#haul-range-${id})`}>
                                    <line
                                      x1={fromX}
                                      x2={toX}
                                      y1={y}
                                      y2={y}
                                      stroke={haulColor(movement.category)}
                                      strokeWidth={2}
                                      markerEnd={`url(#haul-arrow-${id})`}
                                    />
                                    <text
                                      x={(fromX + toX) / 2}
                                      y={y - 5}
                                      textAnchor="middle"
                                      fontSize="8"
                                      fill="hsl(var(--muted-foreground))"
                                    >
                                      {format(movement.transportedVolumeM3, 0)} {movement.volumeBasis} m³ ·{' '}
                                      {haulLabel(movement.category)}
                                    </text>
                                    {[
                                      { x: fromX, chainage: movement.fromChainage, name: 'source' },
                                      { x: toX, chainage: movement.toChainage, name: 'destination' },
                                    ]
                                      .filter(
                                        (endpoint) => endpoint.chainage >= rangeStart && endpoint.chainage <= rangeEnd,
                                      )
                                      .map((endpoint) => (
                                        <g
                                          key={endpoint.name}
                                          role="button"
                                          tabIndex={0}
                                          aria-label={`${movement.kind} ${endpoint.name} at ${formatRoadStation(endpoint.chainage)}`}
                                          className="cursor-pointer outline-none focus-visible:[&>circle]:stroke-foreground"
                                          onClick={() => onStation(endpoint.chainage)}
                                          onKeyDown={(event) => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                              event.preventDefault()
                                              onStation(endpoint.chainage)
                                            }
                                          }}
                                        >
                                          <circle cx={endpoint.x} cy={y} r={7} fill="transparent" />
                                          <circle cx={endpoint.x} cy={y} r={3} fill={haulColor(movement.category)} />
                                        </g>
                                      ))}
                                  </g>
                                </g>
                              )
                            })}
                            <line
                              x1={frame.x(station)}
                              x2={frame.x(station)}
                              y1={0}
                              y2={nearbyMovements.length * 24 + 4}
                              stroke={ROAD_CHART_COLORS.selected}
                              strokeWidth={1}
                              pointerEvents="none"
                            />
                          </svg>
                        )
                      }}
                    </SizedChart>
                  )}
                </div>
              )}
            </>
          )}
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
            data-range-start={rangeStart}
            data-range-end={rangeEnd}
            className="select-none touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
              <SelectionBand range={selectedRange} frame={f} />
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

export function CableChart({
  analysis,
  distance = 0,
  onDistance,
}: {
  analysis: CableAnalysis
  distance?: number
  onDistance?: (distance: number) => void
}) {
  const points = analysis.samples.map((s) => ({ x: s.distance, ground: s.ground, design: s.cable }))
  const [low, high] = extent(points.flatMap((p) => [p.ground, p.design]))
  const domain: Domain = [0, Math.max(1, analysis.length), low, high]
  const active = analysis.samples.reduce<(typeof analysis.samples)[number] | undefined>(
    (best, sample) =>
      !best || Math.abs(sample.distance - distance) < Math.abs(best.distance - distance) ? sample : best,
    undefined,
  )
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
          {onDistance && (
            <p className="text-[10px] text-muted-foreground">
              Cursor {format(active?.distance)} m · ground {format(active?.ground)} m · cable {format(active?.cable)} m
              · clearance {format(active?.clearance)} m. Click or drag to inspect the same point on the plan.
            </p>
          )}
        </>
      }
    >
      {(width, height) => {
        const f = chartFrame(width, height, domain)
        return (
          <svg
            width={width}
            height={height}
            role={onDistance ? 'group' : 'img'}
            tabIndex={onDistance ? 0 : undefined}
            className={onDistance ? 'touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring' : undefined}
            aria-label="Cable deflection line and ground profile"
            data-testid="road-cable-chart"
            data-distance={active?.distance ?? distance}
            onPointerDown={
              onDistance
                ? (event) => {
                    if (event.button !== 0) return
                    event.currentTarget.setPointerCapture(event.pointerId)
                    onDistance(eventValue(event, event.currentTarget, domain)[0])
                  }
                : undefined
            }
            onPointerMove={
              onDistance
                ? (event) => {
                    if (event.buttons === 1) onDistance(eventValue(event, event.currentTarget, domain)[0])
                  }
                : undefined
            }
            onKeyDown={
              onDistance ? (event) => selectWithKeyboard(event, distance, analysis.length, onDistance) : undefined
            }
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
            {onDistance && active && (
              <g pointerEvents="none">
                <line
                  x1={f.x(active.distance)}
                  x2={f.x(active.distance)}
                  y1={f.top}
                  y2={height - f.bottom}
                  stroke={ROAD_CHART_COLORS.selected}
                  strokeWidth={1.4}
                />
                {finite(active.cable) && (
                  <circle cx={f.x(active.distance)} cy={f.y(active.cable)} r={4} fill={ROAD_CHART_COLORS.selected} />
                )}
              </g>
            )}
          </svg>
        )
      }}
    </ChartSlot>
  )
}
