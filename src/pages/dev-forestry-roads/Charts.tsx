import { RoadSelect } from './Controls'
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
import { ChevronLeft, ChevronRight, PanelBottom, Rows3, TableProperties } from 'lucide-react'
import { ChartViewport, SizedChart } from '@pgmaps/geo-toolkit/visualizations/react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { ReadoutGrid, type ReadoutItem } from '@/components/ui/readout-grid'
import { axisTicks } from './chartScale'
import { averageSlopePercent } from './chartSlope'
import { EngineeringBands, profileGradeSpans, type SightBandInput } from './EngineeringBands'
import {
  ProfileCurvePoints,
  ProfileGradeTrouble,
  PviDragReadoutBox,
  GRADE_TROUBLE_COLOR,
  SHORT_PITCH_COLOR,
} from './ProfileOverlays'
import {
  curvePoints,
  isGradeTrouble,
  pviDragReadout,
  signedValue,
  tangentGrades,
  type ProfileGradeLimits,
} from './profileAnnotations'
import { ProfileValueBands, useStoredFlag } from './ProfileValueBands'
import { SightDistanceBand } from './SightDistanceBand'
import { verticalCurveSummary } from './engine'
import { templateAt } from './templates'
import { constrainPviDrag, MIN_PVI_GAP_M } from './verticalTools'
import {
  JUNCTION_LABEL_FONT_PX,
  junctionLabelText,
  junctionMarkerY,
  useProfileEditing,
  type JunctionLabelPlacement,
} from './ProfileEditing'
import {
  CROSSING_CLUSTER_PX,
  clusterByPixels,
  junctionDifferenceShown,
  junctionLabelNames,
  placeLabels,
  rotatedTextBox,
  textBox,
  type LabelBox,
  type LabelCandidate,
} from './profileLabelLayout'
import { JUNCTION_SNAP_M } from './junctionTurn'
import type { ProfileJunction } from './profileJunctions'
import { classifySectionOffset, sectionCodePoints, sectionSampleAt } from './sectionGeometry'
import { massHaulDiagram, ordinateAt, type HaulClassBand } from './massHaul'
import {
  gradeDiagram,
  groundGradeIntervals,
  rollingGrade,
  steepestAverage,
  GROUND_GRADE_CHORD_M,
  type GradeAverageSettings,
  type RollingGradePoint,
} from './gradeDiagram'
import { GradeAverageOptions } from './GradeAverageOptions'
import type { GradeRule } from './designStandards'
import {
  heldSectionDomain,
  holdSectionFrame,
  pinnedSectionOutline,
  pinnedShiftText,
  roadSectionFrame,
  sectionExceedsFrame,
  type HeldSectionFrame,
} from './sectionFrame'
import { BalanceLineOverlay, BalanceWhatIfPanel, useBalanceWhatIf } from './MassHaulBalanceLine'
import {
  CHART_MEASURE_HINT,
  ChartMeasurementBand,
  ChartMeasurementReadout,
  useChartMeasurement,
  type MeasurementSlope,
} from './ChartMeasurement'
import type { CableLayoutOverlay } from './cableLayout/overlay'
import type { CableChartEdit } from './cableLayout/useLayoutEdit'
import { CableLayoutChartLayer } from './CableLayoutChartLayer'
import type {
  Alignment,
  AlignmentEngineering,
  CableAnalysis,
  RoadAnalysis,
  RoadStation,
  SectionLayer,
  VerticalControl,
  VerticalPoint,
} from './types'

export const ROAD_CHART_COLORS = {
  ground: '#a07845',
  design: '#0d9488',
  cut: '#d97706',
  fill: '#3b82f6',
  selected: '#e11d48',
  mass: '#7c3aed',
  ditch: '#0369a1',
}

/** The section's top-of-rock and blasting-level lines. */
const ROCK_COLOR = '#57534e'
const BLAST_COLOR = '#be123c'
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

/** Closest two drawn PVI handles come on the profile; crowded handles between them are left out until zoomed. */
export const PVI_HANDLE_MIN_GAP_PX = 28

function extent(values: Array<number | null>, minimumSpan = 4): [number, number] {
  const usable = values.filter(finite)
  if (!usable.length) return [0, minimumSpan]
  const low = Math.min(...usable),
    high = Math.max(...usable)
  const span = Math.max(minimumSpan, high - low)
  return [(low + high) / 2 - span * 0.6, (low + high) / 2 + span * 0.6]
}

/** `bottom` is the band under the plot for the station axis; a chart sharing another's axis passes less. */
function chartFrame(width: number, height: number, domain: Domain, top = 24, bottom = 36) {
  const left = width < 380 ? 48 : 58,
    right = 16
  const plotWidth = Math.max(1, width - left - right),
    plotHeight = Math.max(1, height - top - bottom)
  const x = (value: number) => left + ((value - domain[0]) / Math.max(0.001, domain[1] - domain[0])) * plotWidth
  const y = (value: number) => top + ((domain[3] - value) / Math.max(0.001, domain[3] - domain[2])) * plotHeight
  return { left, right, top, bottom, plotWidth, plotHeight, x, y }
}

function eventValue(
  event: { clientX: number; clientY: number },
  svg: SVGSVGElement,
  domain: Domain,
  top = 24,
  bottom = 36,
) {
  const bounds = svg.getBoundingClientRect()
  const frame = chartFrame(bounds.width, bounds.height, domain, top, bottom)
  return [
    domain[0] + clamp((event.clientX - bounds.left - frame.left) / frame.plotWidth, 0, 1) * (domain[1] - domain[0]),
    domain[3] - clamp((event.clientY - bounds.top - frame.top) / frame.plotHeight, 0, 1) * (domain[3] - domain[2]),
  ] as const
}

/** Chart units per screen pixel along each axis. */
function metresPerPixel(svg: SVGSVGElement, domain: Domain, top = 24, bottom = 36) {
  const bounds = svg.getBoundingClientRect()
  const frame = chartFrame(bounds.width, bounds.height, domain, top, bottom)
  return {
    chainageM: (domain[1] - domain[0]) / frame.plotWidth,
    elevationM: (domain[3] - domain[2]) / frame.plotHeight,
  }
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

/** Hatches road lengths with something missing, at least two pixels wide so a short one still shows. */
function HatchedSpans({
  spans,
  x,
  top,
  height,
  title,
}: {
  spans: Array<[number, number]>
  x: (value: number) => number
  top: number
  height: number
  title: (start: number, end: number) => string
}) {
  const id = `terrain-gap-${useId().replace(/:/g, '')}`
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
          <title>{title(start, end)}</title>
        </rect>
      ))}
    </g>
  )
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
  const spans: Array<[number, number]> = []
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i]
    if (finite(a.ground) && finite(b.ground)) continue
    const previous = spans[spans.length - 1]
    if (previous?.[1] === a.x) previous[1] = b.x
    else spans.push([a.x, b.x])
  }
  return (
    <HatchedSpans
      spans={spans}
      x={x}
      top={top}
      height={height}
      title={(start, end) => `Missing terrain between ${format(start, 2)} and ${format(end, 2)} m`}
    />
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
  frameBottom = 36,
  hideXAxis = false,
  yFloor,
}: {
  width: number
  height: number
  domain: Domain
  xLabel: string
  yLabel: string
  stationTicks?: boolean
  top?: number
  frameBottom?: number
  /** Gridlines only: the station labels and title are drawn by a chart under this one that shares the axis. */
  hideXAxis?: boolean
  /** No y tick below this value: the plot below it holds something other than the axis's quantity. */
  yFloor?: number
}) {
  const f = chartFrame(width, height, domain, top, frameBottom)
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
            {!hideXAxis && (
              <>
                <line x1={f.x(value)} x2={f.x(value)} y1={bottom} y2={bottom + 5} stroke={tick} />
                <text x={f.x(value)} y={bottom + 15} textAnchor="middle">
                  {xLabelText(value)}
                </text>
              </>
            )}
          </g>
        ))}
      {!hideXAxis &&
        xTicks.minor
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
        .filter((v) => inside(v, yFloor ?? domain[2], domain[3]))
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
        .filter((v) => inside(v, yFloor ?? domain[2], domain[3]))
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
      {/* Centred under the plot, as the elevation title is centred beside it. */}
      {!hideXAxis && (
        <text x={f.left + f.plotWidth / 2} y={height - 3} textAnchor="middle">
          {xLabel}
        </text>
      )}
    </g>
  )
}

function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-muted-foreground">
      {items.map((item) => (
        <span className="inline-flex items-center gap-1.5" key={item.label}>
          <span className="h-0.5 w-4" style={{ backgroundColor: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  )
}

/**
 * The chart alone, or with its legend and readouts under it. There is no readouts-only view: a
 * legend and a station readout mean nothing without the lines they describe.
 */
export type ChartView = 'chart' | 'both'
// 'details' was a readouts-only view; a browser that saved it gets the details back under the chart.
const readStoredView = (saved: string | null): ChartView | null =>
  saved === 'chart' ? 'chart' : saved === 'both' || saved === 'details' ? 'both' : null
type ChartHeaderValue = {
  /** Where the chart's own controls (zoom, scale) go, ahead of the panel toggles. */
  controls: HTMLElement | null
  target: HTMLElement | null
  view: ChartView | null
  setView: (view: ChartView) => void
}
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
  const [controls, setControls] = useState<HTMLElement | null>(null)
  const [target, setTarget] = useState<HTMLElement | null>(null)
  const [view, setStoredView] = useState<ChartView | null>(() => {
    try {
      return readStoredView(storageKey ? localStorage.getItem(storageKey) : null)
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
    <ChartHeaderContext.Provider value={{ controls, target, view, setView }}>
      {children(
        <span className="contents">
          <span ref={setControls} className="contents" />
          <span ref={setTarget} className="contents" />
        </span>,
      )}
    </ChartHeaderContext.Provider>
  )
}

/**
 * The panel header's slot for a view's own controls, or null outside a `ChartHeader`. A table or
 * editor in a detail panel portals its toolbar there instead of taking a row above its content.
 */
export function useChartHeaderControls() {
  return useContext(ChartHeaderContext)?.controls ?? null
}

function ChartSlot({
  children,
  footer,
  notice,
  bands,
  valueBands,
  measurement,
}: {
  /** May return absolutely positioned controls beside the svg; they float over the chart. */
  children: (width: number, height: number) => ReactNode
  footer?: ReactNode
  /**
   * Status outside the plot, still visible when the legend and readouts are folded: first among the
   * panel header's chart controls, or in the toggle row above the plot outside a `ChartHeader`.
   */
  notice?: ReactNode
  /** Data bands that line up under the plot, folded until the header toggle opens them. */
  bands?: { label: string; content: ReactNode }
  /** A second set of bands under the plot with its own header toggle, remembered in this browser. */
  valueBands?: { label: string; storageKey: string; content: ReactNode }
  measurement?: {
    reading: ReturnType<typeof useChartMeasurement>
    formatEndpoint: (value: number) => string
    slopes?: (start: number, end: number) => MeasurementSlope[]
  }
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [compact, setCompact] = useState(false)
  const header = useContext(ChartHeaderContext)
  const [localView, setLocalView] = useState<ChartView | null>(null)
  const [bandsOpen, setBandsOpen] = useState(false)
  const [valueBandsOpen, setValueBandsOpen] = useStoredFlag(valueBands?.storageKey ?? 'pgmaps-chart-value-bands')
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
  const showDetails = view === 'both'
  const bandsShown = (!!bands && bandsOpen) || (!!valueBands && valueBandsOpen)
  const toggle = (pressed: boolean) =>
    `size-8 ${pressed ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'}`
  const bandsToggle = bands && (
    <Button
      size="icon"
      variant="ghost"
      className={toggle(bandsOpen)}
      aria-label={bands.label}
      aria-pressed={bandsOpen}
      title={`${bandsOpen ? 'Hide' : 'Show'} ${bands.label.toLowerCase()}`}
      onClick={() => setBandsOpen(!bandsOpen)}
    >
      <Rows3 className="size-3.5" />
    </Button>
  )
  const valueBandsToggle = valueBands && (
    <Button
      size="icon"
      variant="ghost"
      className={toggle(valueBandsOpen)}
      aria-label={valueBands.label}
      aria-pressed={valueBandsOpen}
      title={`${valueBandsOpen ? 'Hide' : 'Show'} ${valueBands.label.toLowerCase()}`}
      onClick={() => setValueBandsOpen(!valueBandsOpen)}
    >
      <TableProperties className="size-3.5" />
    </Button>
  )
  const detailsToggle = footer && (
    <Button
      size="icon"
      variant="ghost"
      className={toggle(showDetails)}
      aria-label="Details below chart"
      aria-pressed={showDetails}
      title={showDetails ? 'Hide legend & readouts' : 'Show legend & readouts below the chart'}
      onClick={() => (header ? header.setView : setLocalView)(showDetails ? 'chart' : 'both')}
    >
      <PanelBottom className="size-3.5" />
    </Button>
  )
  const switcher = (notice || bandsToggle || valueBandsToggle || detailsToggle) && (
    <>
      {notice}
      {bandsToggle}
      {valueBandsToggle}
      {detailsToggle}
    </>
  )
  return (
    <div
      ref={ref}
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
      data-chart-slot
      data-compact={compact || undefined}
      data-chart-view={view}
      // Nothing under the plot: its axis title is the slot's last row, which can share the resize grip's.
      data-axis-at-bottom={(!bandsShown && !showDetails) || undefined}
    >
      {switcher &&
        (header?.target ? (
          createPortal(switcher, header.target)
        ) : (
          <div className="flex shrink-0 items-center justify-end gap-1 pb-1">{switcher}</div>
        ))}
      {/* The plot keeps 160 px (half a short slot) however many bands are open; with bands open it reserves the
          scrollbar gutter the bands' scroller does, so a station sits at the same x in both. */}
      <div
        className={`relative flex min-h-[min(160px,50%)] flex-1 flex-col ${bandsShown ? 'overflow-hidden [scrollbar-gutter:stable]' : ''}`}
      >
        <ChartViewport className="min-h-0 flex-1" minHeight={1} initialHeight={230}>
          {(height) => (
            <SizedChart height={height}>
              {(width) => (
                <>
                  {children(width, height)}
                  {measurement && (
                    <ChartMeasurementReadout
                      measurement={measurement.reading}
                      frame={{ left: width < 380 ? 48 : 58, right: 16, bottom: 36 }}
                      formatEndpoint={measurement.formatEndpoint}
                      slopes={measurement.slopes}
                    />
                  )}
                </>
              )}
            </SizedChart>
          )}
        </ChartViewport>
      </div>
      {/* Both band sets share one capped scroller, so a short panel keeps its plot; the bands scroll instead. */}
      {bandsShown && (
        <div className="max-h-[45%] min-h-0 shrink overflow-y-auto overscroll-none [scrollbar-gutter:stable]">
          {bands && bandsOpen && <div className="border-t">{bands.content}</div>}
          {valueBands && valueBandsOpen && <div className="border-t">{valueBands.content}</div>}
        </div>
      )}
      {footer && (
        <div
          className={
            showDetails ? `flex min-h-0 shrink flex-col border-t ${compact ? 'max-h-[45%]' : 'max-h-[50%]'}` : 'hidden'
          }
        >
          <div className="min-h-0 space-y-1 overflow-y-auto overscroll-none px-3 py-2">{footer}</div>
        </div>
      )}
    </div>
  )
}

/** Screen length a tangent needs for its "grade · length" label, and for the grade alone. */
const FULL_GRADE_LABEL_PX = 100
const GRADE_ONLY_LABEL_PX = 40

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
  selectedStation,
  onStation,
  onVerticalChange,
  onViewRangeChange,
  selectedCulvertId,
  onSelectCulvert,
  terrainOnly = false,
  sight,
  gradeLimits,
  junctions,
  onAddControl,
  rangePick,
  onEditGesture,
  sharedXAxis = false,
  sharedMeasurement,
}: {
  selectedRange?: RoadSelectionRange
  analysis: RoadAnalysis
  alignment: Alignment
  station: number
  /** The selected station's record, when it was typed and lies between calculated stations. */
  selectedStation?: RoadStation
  onStation: (chainage: number) => void
  onVerticalChange?: (points: VerticalPoint[]) => void
  onViewRangeChange?: (range: [number, number]) => void
  selectedCulvertId?: string
  onSelectCulvert?: (id: string) => void
  terrainOnly?: boolean
  /** The project's design speed and station spacing, for the sight distance band. */
  sight?: SightBandInput
  /** The project's grade rule: tangents over it are drawn red. Absent judges only the road's vertical standards. */
  gradeLimits?: ProfileGradeLimits
  /** Where other project roads meet or cross this one (`profileJunctions.ts`). */
  junctions?: ProfileJunction[]
  /** Add a vertical control, from a junction's **Add control here**. */
  onAddControl?: (control: VerticalControl) => void
  /** While set, a drag on the plot marks a station range (`SectionPaneTools`) instead of moving the station. */
  rangePick?: { range: [number, number] | null; onRange: (range: [number, number]) => void }
  /** Brackets a PVI or tangent drag as one undo step that Escape cancels (`useProfileEditing`). */
  onEditGesture?: (phase: 'start' | 'end' | 'cancel') => void
  /** A grade strip under the profile draws the station axis for both, so the profile leaves it out. */
  sharedXAxis?: boolean
  /** One Shift-click measurement shared with the grade strip under the profile. */
  sharedMeasurement?: ReturnType<typeof useChartMeasurement>
}) {
  const id = useId().replace(/:/g, '')
  const editable = !terrainOnly && !!onVerticalChange
  const ownMeasurement = useChartMeasurement(`${alignment.id}:${analysis.length}:${terrainOnly}:${!!rangePick}`)
  const measurement = sharedMeasurement ?? ownMeasurement
  // Under the plot only a hair of room when the strip below carries the station axis.
  const profileBottom = sharedXAxis ? 6 : 36
  const rangeDrag = useRef<number | null>(null)
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
  const active =
    selectedStation ??
    analysis.stations.reduce<RoadStation | undefined>(
      (best, s) => (!best || Math.abs(s.chainage - station) < Math.abs(best.chainage - station) ? s : best),
      undefined,
    )
  const sorted = terrainOnly ? [] : [...alignment.vertical].sort((a, b) => a.chainage - b.chainage)
  const editing = useProfileEditing({
    sorted,
    editable,
    roadLength: analysis.length,
    controls: alignment.verticalControls,
    onVerticalChange,
    onStation,
    freezeDomain: setFixedDomain,
    junctions: terrainOnly ? undefined : junctions,
    onAddControl: editable ? onAddControl : undefined,
    onEditGesture,
  })
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
  const tangents = useMemo(
    () => (terrainOnly ? [] : tangentGrades(alignment, analysis.length, gradeLimits)),
    [terrainOnly, alignment, analysis.length, gradeLimits],
  )
  const troubleIds = new Set(tangents.filter(isGradeTrouble).map((t) => t.id))
  const curvePointList = useMemo(
    () => (terrainOnly ? [] : curvePoints(alignment, analysis.length, analysis.engineering?.culverts)),
    [terrainOnly, alignment, analysis.length, analysis.engineering?.culverts],
  )
  // The PVI the editing hook is dragging, from the press, so the readout shows before the first move.
  const draggedPviId = !terrainOnly ? (editing.draggedPviId ?? undefined) : undefined
  const dragReadout = draggedPviId ? pviDragReadout(analysis, alignment, draggedPviId) : null
  const profileGrades = analysis.stations.map((s) => s.gradePercent).filter(finite)
  const first = analysis.stations.find((s) => finite(terrainOnly ? s.groundElevation : s.designElevation))
  const last = [...analysis.stations].reverse().find((s) => finite(terrainOnly ? s.groundElevation : s.designElevation))
  // Length, maximum grade and the elevation range already show in the header tiles and on the
  // axes; the footer adds only what appears nowhere else.
  const roadStats = [
    first && last
      ? `Elev diff ${format(((terrainOnly ? last.groundElevation : last.designElevation) ?? 0) - ((terrainOnly ? first.groundElevation : first.designElevation) ?? 0))} m`
      : null,
    profileGrades.length ? `Min grade ${format(Math.min(...profileGrades.map(Math.abs)))}%` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const failingCurve = (chainage: number) =>
    (analysis.verticalChecks ?? []).some(
      (check) => (check.kind === 'k' || check.kind === 'curve-length') && Math.abs(check.chainage - chainage) < 0.01,
    )
  // In a panel, zoom and vertical scale sit in its header beside the panel toggles, so the plot
  // starts right under the title. Without one they float over the chart's top edge.
  const header = useContext(ChartHeaderContext)
  const headerControls = header?.controls ?? null
  // The plot's top margin: room for the floating bar, or just the top tick label.
  const profileTop = headerControls ? 14 : 30
  // Grow to a tappable size on touch screens; the mouse layout stays compact.
  const control = headerControls
    ? 'h-8 min-w-8 px-1.5 text-sm leading-none'
    : 'h-5 min-w-5 rounded-md px-1 text-3xs leading-none touch:h-8 touch:min-w-8 touch:text-xs'
  // Each control shows only while it can act: the full-road view needs no pan, reset or range
  // readout (the axis already says it), which keeps the bar small enough for a narrow pane.
  const zoomed = viewRange !== null
  const canPanBack = zoomed && visibleStart > 0
  const canPanForward = zoomed && visibleEnd < analysis.length
  // Pan arrows sit on the plot's own left and right edges, where the hidden road continues.
  const edge =
    'pointer-events-auto absolute flex h-10 w-5 -translate-y-1/2 items-center justify-center rounded-md border bg-background/80 text-muted-foreground opacity-70 shadow-sm backdrop-blur-sm transition-opacity hover:text-foreground hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring touch:h-12 touch:w-8 [&_svg]:size-3.5'
  const toolbar = (exaggeration: number, width: number, frame: ReturnType<typeof chartFrame>) => {
    const bar = (
      <div
        role="toolbar"
        aria-label="Profile view"
        className={
          headerControls
            ? 'flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground'
            : 'pointer-events-auto flex shrink-0 items-center gap-0.5 rounded-md border bg-background/90 p-0.5 text-3xs text-muted-foreground shadow-sm backdrop-blur-sm'
        }
      >
        {/* In the header it shares the row with the panel title, so it waits for a wide panel. */}
        {zoomed && width >= (headerControls ? 720 : 420) && (
          <span className="px-1 tabular-nums" data-testid="road-profile-range">
            {formatRoadStation(visibleStart)}–{formatRoadStation(visibleEnd)}
          </span>
        )}
        {editing.snapToggle(control)}
        <Button className={control} size="sm" variant="ghost" aria-label="Zoom profile in" onClick={() => zoom(0.5)}>
          +
        </Button>
        <Button
          className={control}
          size="sm"
          variant="ghost"
          aria-label="Zoom profile out"
          disabled={!zoomed}
          onClick={() => zoom(2)}
        >
          −
        </Button>
        {(zoomed || verticalScale !== 'fit') && (
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
        )}
        <RoadSelect
          ariaLabel="Profile vertical exaggeration"
          title={`Vertical exaggeration${verticalScale === 'fit' ? ` · auto ×${format(exaggeration, 1)}` : ''} · display only`}
          className={
            headerControls
              ? 'h-8 rounded-md border-0 bg-transparent px-1.5 text-xs text-foreground'
              : 'h-5 rounded-md border-0 bg-transparent px-0.5 text-3xs text-foreground touch:h-8 touch:text-xs'
          }
          value={verticalScale}
          onValueChange={(value) => setVerticalScale(value)}
          options={[
            {
              value: 'fit',
              label: `Auto (×${format(exaggeration, 1)})`,
              selectedLabel: (
                <>
                  V ×{format(exaggeration, exaggeration >= 10 ? 0 : 1)}{' '}
                  <span className="text-muted-foreground">auto</span>
                </>
              ),
            },
            { value: '1', label: '×1 · true scale', selectedLabel: 'V ×1' },
            ...['2', '5', '10'].map((value) => ({ value, label: `×${value}`, selectedLabel: `V ×${value}` })),
          ]}
        />
        {/* Separates the chart's own controls from the panel's toggles after it. */}
        {headerControls && <span aria-hidden className="mx-1 h-5 w-px bg-border" />}
      </div>
    )
    return (
      <>
        {headerControls ? (
          createPortal(bar, headerControls)
        ) : (
          <div className="pointer-events-none absolute inset-x-1 top-0.5 flex justify-end">{bar}</div>
        )}
        {canPanBack && (
          <button
            type="button"
            className={edge}
            style={{ left: frame.left + 2, top: frame.top + frame.plotHeight / 2 }}
            aria-label="Pan profile backward"
            title="Pan back"
            onClick={() => pan(-1)}
          >
            <ChevronLeft aria-hidden />
          </button>
        )}
        {canPanForward && (
          <button
            type="button"
            className={edge}
            style={{ right: frame.right + 2, top: frame.top + frame.plotHeight / 2 }}
            aria-label="Pan profile forward"
            title="Pan forward"
            onClick={() => pan(1)}
          >
            <ChevronRight aria-hidden />
          </button>
        )}
      </>
    )
  }
  const handleMove = (event: PointerEvent<SVGSVGElement>, displayedDomain: Domain) => {
    const [chainage, elevation] = eventValue(event, event.currentTarget, displayedDomain, profileTop, profileBottom)
    if (measurement.move(event, chainage)) return
    if (rangeDrag.current !== null) {
      if (Math.abs(chainage - rangeDrag.current) > 1e-6)
        rangePick?.onRange([Math.min(rangeDrag.current, chainage), Math.max(rangeDrag.current, chainage)])
      return
    }
    const scale = metresPerPixel(event.currentTarget, displayedDomain, profileTop, profileBottom)
    if (editing.move(event, chainage, elevation, scale)) return
    if (event.buttons === 1) onStation(chainage)
  }
  return (
    <ChartSlot
      measurement={
        !rangePick
          ? {
              reading: measurement,
              formatEndpoint: formatRoadStation,
              slopes: (start, end) => [
                { label: 'Avg ground slope', percent: averageSlopePercent(points, 'ground', start, end) },
                ...(!terrainOnly
                  ? [{ label: 'Avg formation grade', percent: averageSlopePercent(points, 'design', start, end) }]
                  : []),
              ],
            }
          : undefined
      }
      bands={{
        label: terrainOnly ? 'Ground grade & distance bands' : 'Grade, curve, template & material bands',
        content: (
          <>
            <EngineeringBands
              analysis={analysis}
              alignment={alignment}
              station={station}
              onStation={onStation}
              terrainOnly={terrainOnly}
              range={[domain[0], domain[1]]}
              sight={terrainOnly ? undefined : sight}
            />
            {!terrainOnly && sight && (
              <SightDistanceBand
                analysis={analysis}
                alignment={alignment}
                sight={sight}
                station={station}
                onStation={onStation}
                range={[domain[0], domain[1]]}
              />
            )}
          </>
        ),
      }}
      valueBands={{
        label: 'Value bands',
        storageKey: 'pgmaps-road-profile-value-bands',
        content: (
          <ProfileValueBands
            analysis={analysis}
            alignment={alignment}
            start={domain[0]}
            end={domain[1]}
            station={station}
            onStation={onStation}
            terrainOnly={terrainOnly}
          />
        ),
      }}
      footer={
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Legend
              items={
                terrainOnly
                  ? [{ label: 'Ground', color: ROAD_CHART_COLORS.ground }]
                  : [
                      { label: 'Ground', color: ROAD_CHART_COLORS.ground },
                      {
                        label: alignment.vertical.length ? 'Formation' : 'Formation · follows ground',
                        color: ROAD_CHART_COLORS.design,
                      },
                      { label: 'Cut', color: ROAD_CHART_COLORS.cut },
                      { label: 'Fill', color: ROAD_CHART_COLORS.fill },
                      ...(ditches.some((ditch) => ditch.points.some((p) => finite(p.design)))
                        ? [{ label: 'L/R ditch bottoms', color: ROAD_CHART_COLORS.ditch }]
                        : []),
                    ]
              }
            />
            <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-2xs tabular-nums text-muted-foreground">
              <span>
                {formatRoadStation(active?.chainage ?? station)} · {format(active?.gradePercent)}% · ground{' '}
                {format(active?.groundElevation)} m
              </span>
              {roadStats && (
                <span data-testid="road-profile-summary" title="Whole road, start to end">
                  Road: {roadStats}
                </span>
              )}
            </div>
          </div>
        </>
      }
    >
      {(width, height) => {
        const frame = chartFrame(width, height, domain, profileTop, profileBottom)
        const targetScale = verticalScale === 'fit' ? 1 : Number(verticalScale)
        const halfSpan = ((domain[1] - domain[0]) * frame.plotHeight) / frame.plotWidth / (2 * targetScale)
        const displayedDomain: Domain =
          fixedDomain ??
          (verticalScale === 'fit'
            ? domain
            : [domain[0], domain[1], (low + high) / 2 - halfSpan, (low + high) / 2 + halfSpan])
        const f = chartFrame(width, height, displayedDomain, profileTop, profileBottom)
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
        // A profile with a PVI at every station (Full bench writes one) draws as a row of overlapping
        // rings. Where they crowd, draw a handle only every PVI_HANDLE_MIN_GAP_PX, plus the ends and the
        // selected one; the grade line is unchanged and zooming in brings every handle back.
        const shownPviIds = new Set<string>()
        {
          const visible = sorted.filter((p) => p.chainage >= displayedDomain[0] && p.chainage <= displayedDomain[1])
          let lastX = -Infinity
          visible.forEach((p, i) => {
            const x = f.x(p.chainage)
            const keep =
              typicalGap >= PVI_HANDLE_MIN_GAP_PX ||
              i === 0 ||
              i === visible.length - 1 ||
              p.id === editing.selectedId ||
              x - lastX >= PVI_HANDLE_MIN_GAP_PX
            if (!keep) return
            shownPviIds.add(p.id)
            lastX = x
          })
        }
        // Ground grades split by the room on screen; design tangents stay PVI to PVI.
        const gradeSpans = profileGradeSpans(analysis, alignment, terrainOnly, {
          range: [displayedDomain[0], displayedDomain[1]],
          plotWidthPx: f.plotWidth,
        })
        // One placement pass for every text label on the plot (`profileLabelLayout.ts`): the station
        // flag first, then red grades, junctions whose level differs, other grades, other junctions.
        // A label that would cover a higher one is left to its tooltip.
        const plotBox: LabelBox = { left: f.left, top: f.top, right: width - f.right, bottom: height - f.bottom }
        const stationFlipped = f.x(station) > width - f.right - 70
        const stationText = formatRoadStation(active?.chainage ?? station)
        const shownJunctions = (terrainOnly ? [] : (junctions ?? [])).filter(
          (j) => j.chainage >= displayedDomain[0] && j.chainage <= displayedDomain[1],
        )
        const junctionMarks = shownJunctions.map((j) => ({
          j,
          x: f.x(j.chainage),
          y: junctionMarkerY(f, j, height, f.bottom),
        }))
        type PlacedLabel =
          | { kind: 'station' }
          | { kind: 'grade'; x: number; y: number; angle: number; text: string }
          | { kind: 'junction'; placement: JunctionLabelPlacement }
        const labelCandidates: LabelCandidate<PlacedLabel>[] = [
          {
            id: 'station',
            priority: 100,
            options: [
              {
                box: textBox(
                  f.x(station) + (stationFlipped ? -4 : 4),
                  f.top + 10,
                  stationText,
                  9.5,
                  stationFlipped ? 'end' : 'start',
                ),
                value: { kind: 'station' },
              },
            ],
          },
        ]
        for (const span of gradeSpans) {
          // Label the part of the span on screen, so a long tangent keeps its grade when zoomed in.
          const from = Math.max(span.start, displayedDomain[0]),
            to = Math.min(span.end, displayedDomain[1])
          const spanPx = f.x(to) - f.x(from)
          // A tangent too short on screen for "grade · length" still shows its grade.
          if (spanPx <= GRADE_ONLY_LABEL_PX) continue
          const level = (chainage: number) => {
            const nearest = nearestOf(analysis.stations, chainage)
            return terrainOnly ? nearest?.groundElevation : nearest?.designElevation
          }
          const midpoint = (from + to) / 2
          const elevation = level(midpoint),
            a = level(from + (to - from) * 0.25),
            b = level(from + (to - from) * 0.75)
          if (!finite(elevation)) continue
          // Label along the drawn tangent, as on a plotted profile sheet.
          const angle =
            finite(a) && finite(b)
              ? clamp(
                  (Math.atan2(f.y(b) - f.y(a), f.x(from + (to - from) * 0.75) - f.x(from + (to - from) * 0.25)) * 180) /
                    Math.PI,
                  -60,
                  60,
                )
              : 0
          const x = f.x(midpoint)
          const above = Math.max(f.top + 10, f.y(elevation) - 7),
            below = Math.min(height - f.bottom - 4, f.y(elevation) + 15)
          const short = span.label.split(' · ')[0]
          const texts = spanPx > FULL_GRADE_LABEL_PX && short !== span.label ? [span.label, short] : [short]
          labelCandidates.push({
            id: span.id,
            priority: troubleIds.has(span.id) ? 90 : 70,
            options: texts.flatMap((text) =>
              [above, below].map((y) => ({
                box: rotatedTextBox(x, y, text, 9, angle),
                value: { kind: 'grade' as const, x, y, angle, text },
              })),
            ),
          })
        }
        for (const { j, x, y } of junctionMarks) {
          const baseline = y + 3
          labelCandidates.push({
            id: `junction-${j.id}`,
            priority: junctionDifferenceShown(j.difference) ? 80 : 60,
            // Beside the diamond, then over or under it and further out in tiers (the ground line
            // beside it is where grade labels sit), each with the full name before the short one.
            options: junctionLabelNames(j.otherRoadName).flatMap((name) => {
              const text = junctionLabelText(j, name)
              return (
                [
                  [x + 8, baseline, 'start'],
                  [x - 8, baseline, 'end'],
                  [x + 3, y - 9, 'start'],
                  [x - 3, y - 9, 'end'],
                  [x + 3, y + 16, 'start'],
                  [x - 3, y + 16, 'end'],
                  [x + 3, y - 21, 'start'],
                  [x - 3, y - 21, 'end'],
                  [x + 3, y + 28, 'start'],
                  [x - 3, y + 28, 'end'],
                  [x + 3, y - 33, 'start'],
                  [x - 3, y - 33, 'end'],
                ] as const
              ).map(([labelX, labelY, anchor]) => ({
                box: textBox(labelX, labelY, text, JUNCTION_LABEL_FONT_PX, anchor),
                value: { kind: 'junction' as const, placement: { x: labelX, y: labelY, anchor, text } },
              }))
            }),
          })
        }
        const placedLabels = placeLabels(labelCandidates, {
          bounds: plotBox,
          obstacles: [
            // The diamond's own extent: its label starts 8 px out, clear of it by the placement gap.
            ...junctionMarks.map(({ x, y }) => ({ left: x - 6, top: y - 6, right: x + 6, bottom: y + 6 })),
            ...sorted
              .filter((p) => p.chainage >= displayedDomain[0] && p.chainage <= displayedDomain[1])
              .map((p) => {
                const x = f.x(p.chainage),
                  y = f.y(p.elevation),
                  r = handleRadius + 1
                return { left: x - r, top: y - r, right: x + r, bottom: y + r }
              }),
          ],
        })
        const junctionLabels = new Map<string, JunctionLabelPlacement>()
        for (const { j } of junctionMarks) {
          const placed = placedLabels.get(`junction-${j.id}`)
          if (placed?.kind === 'junction') junctionLabels.set(j.id, placed.placement)
        }
        // Crossings a project road already marks as a junction are drawn once, as the junction; the
        // rest share a tick where they fall within a few pixels of each other.
        const crossingGroups = clusterByPixels(
          analysis.crossings.filter(
            (crossing) =>
              crossing.chainage >= displayedDomain[0] &&
              crossing.chainage <= displayedDomain[1] &&
              !shownJunctions.some(
                (j) =>
                  j.otherContextIds?.includes(crossing.featureId) &&
                  Math.abs(j.chainage - crossing.chainage) <= 2 * JUNCTION_SNAP_M,
              ),
          ),
          (crossing) => f.x(crossing.chainage),
          CROSSING_CLUSTER_PX,
        )
        const annotationFrame = {
          x: f.x,
          y: f.y,
          top: f.top,
          bottom: height - f.bottom,
          left: f.left,
          right: width - f.right,
        }
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
              data-range-pick={!!rangePick}
              role="group"
              tabIndex={0}
              aria-label={`${terrainOnly ? 'Terrain' : 'Road'} longitudinal profile. Click or drag to inspect; left and right arrows select station; scroll to zoom, scroll sideways to pan. ${CHART_MEASURE_HINT}${editable ? ' Double-click adds a vertical control; drag a control to edit, Shift-drag to hold a grade; drag a tangent grip to raise or lower it.' : ''}`}
              onKeyDown={(event) => {
                if (measurement.key(event)) return
                if (event.target === event.currentTarget) selectWithKeyboard(event, station, analysis.length, onStation)
              }}
              onPointerDown={(event) => {
                event.preventDefault()
                if (event.button !== 0) return
                const chainage = eventValue(event, event.currentTarget, displayedDomain, profileTop, profileBottom)[0]
                if (!rangePick && measurement.start(event, chainage, f)) return
                event.currentTarget.setPointerCapture(event.pointerId)
                editing.deselect()
                if (rangePick) rangeDrag.current = chainage
                else onStation(chainage)
              }}
              onPointerMove={(event) => handleMove(event, displayedDomain)}
              onPointerUp={(event) => {
                if (measurement.end(event)) return
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  event.currentTarget.releasePointerCapture(event.pointerId)
                editing.end()
                rangeDrag.current = null
                setFixedDomain(null)
              }}
              onPointerCancel={() => {
                measurement.cancel()
                editing.end()
                rangeDrag.current = null
                setFixedDomain(null)
              }}
              onDoubleClick={(event) => {
                if (
                  !onVerticalChange ||
                  event.shiftKey ||
                  rangePick ||
                  terrainOnly ||
                  analysis.length < 1 ||
                  (event.target as Element).getAttribute('data-pvi') === 'true'
                )
                  return
                const [chainage, elevation] = eventValue(
                  event,
                  event.currentTarget,
                  displayedDomain,
                  profileTop,
                  profileBottom,
                )
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
                top={profileTop}
                frameBottom={profileBottom}
                hideXAxis={sharedXAxis}
              />
              <g clipPath={`url(#profile-${id})`}>
                <TerrainGapBands points={points} x={f.x} top={f.top} height={f.plotHeight} />
                <SelectionBand range={selectedRange} frame={f} />
                {rangePick?.range && (
                  <rect
                    data-testid="road-profile-range-pick"
                    pointerEvents="none"
                    x={f.x(rangePick.range[0])}
                    y={f.top}
                    width={Math.max(2, f.x(rangePick.range[1]) - f.x(rangePick.range[0]))}
                    height={f.plotHeight}
                    fill={ROAD_CHART_COLORS.design}
                    fillOpacity={0.14}
                    stroke={ROAD_CHART_COLORS.design}
                    strokeDasharray="4 3"
                  />
                )}
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
                <ProfileGradeTrouble
                  tangents={tangents}
                  stations={analysis.stations}
                  frame={annotationFrame}
                  domain={[displayedDomain[0], displayedDomain[1]]}
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
                {crossingGroups.map((group) => {
                  const [crossing] = group
                  const x = f.x(crossing.chainage)
                  const names =
                    group.length === 1
                      ? `${crossing.name} at ${formatRoadStation(crossing.chainage)}`
                      : `${group.length} crossings, ${formatRoadStation(crossing.chainage)} to ${formatRoadStation(group[group.length - 1].chainage)}: ${group
                          .slice(0, 8)
                          .map((c) => `${c.name} at ${formatRoadStation(c.chainage)}`)
                          .join('; ')}${group.length > 8 ? `; and ${group.length - 8} more` : ''}`
                  return (
                    <g
                      key={crossing.id}
                      role="button"
                      tabIndex={0}
                      aria-label={
                        group.length === 1
                          ? `Inspect ${crossing.name} crossing at ${formatRoadStation(crossing.chainage)}`
                          : `Inspect ${group.length} crossings from ${formatRoadStation(crossing.chainage)}`
                      }
                      data-crossing-count={group.length}
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
                      <rect x={x - 5} y={f.top} width={10} height={f.plotHeight} fill="transparent" />
                      <line
                        x1={x}
                        x2={x}
                        y1={f.top}
                        y2={height - f.bottom}
                        stroke={group.some((c) => c.kind === 'stream') ? ROAD_CHART_COLORS.fill : ROAD_CHART_COLORS.cut}
                        strokeWidth={group.length > 1 ? 1.8 : 1}
                        strokeDasharray="3 3"
                        opacity={0.6}
                      />
                      <title>{names}</title>
                    </g>
                  )
                })}
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
                  {stationText}
                </text>
                {active && finite(terrainOnly ? active.groundElevation : active.designElevation) && (
                  <circle
                    cx={f.x(active.chainage)}
                    cy={f.y((terrainOnly ? active.groundElevation : active.designElevation)!)}
                    r={4}
                    fill={ROAD_CHART_COLORS.selected}
                  />
                )}
                {gradeSpans.map((span) => {
                  const label = placedLabels.get(span.id)
                  if (label?.kind !== 'grade') return null
                  return (
                    <text
                      key={span.id}
                      x={label.x}
                      y={label.y}
                      transform={`rotate(${label.angle.toFixed(1)} ${label.x.toFixed(1)} ${label.y.toFixed(1)})`}
                      fontSize="9"
                      fill={troubleIds.has(span.id) ? GRADE_TROUBLE_COLOR : 'hsl(var(--foreground))'}
                      fontWeight={troubleIds.has(span.id) ? 700 : undefined}
                      stroke="hsl(var(--background))"
                      strokeWidth={3}
                      paintOrder="stroke"
                      textAnchor="middle"
                      pointerEvents="none"
                      data-grade-label
                      data-grade-trouble={troubleIds.has(span.id) || undefined}
                    >
                      {label.text}
                      <title>{span.detail}</title>
                    </text>
                  )
                })}
                <ProfileCurvePoints
                  points={curvePointList}
                  frame={annotationFrame}
                  domain={[displayedDomain[0], displayedDomain[1]]}
                  onStation={onStation}
                />
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
              {editing.layers(f, height, f.bottom, displayedDomain, junctionLabels)}
              {sorted
                .map((p, index) => ({ p, index }))
                .filter(
                  ({ p }) =>
                    shownPviIds.has(p.id) &&
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
                      fill={editing.selectedId === p.id ? ROAD_CHART_COLORS.design : 'hsl(var(--background))'}
                      stroke={ROAD_CHART_COLORS.design}
                      strokeWidth={2}
                      aria-keyshortcuts={editable ? 'Delete Backspace Alt+ArrowLeft Alt+ArrowRight' : undefined}
                      className={
                        editable ? 'cursor-ns-resize outline-none focus-visible:stroke-[4]' : 'pointer-events-none'
                      }
                      tabIndex={editable ? 0 : undefined}
                      role={editable ? 'slider' : undefined}
                      aria-label={`PVI ${index + 1} elevation`}
                      aria-valuemin={-12000}
                      aria-valuemax={12000}
                      aria-valuenow={p.elevation}
                      aria-valuetext={`${format(p.elevation, 2)} metres at station ${formatRoadStation(p.chainage)}`}
                      onPointerDown={(event) => {
                        if (!editable) return
                        event.stopPropagation()
                        editing.startPvi(event, p.id, displayedDomain)
                        event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId)
                      }}
                      onBlur={() => {
                        if (!editing.dragging) editing.deselect()
                      }}
                      onKeyDown={(event) => {
                        if (!editable || editing.pviKeyDown(event, p.id)) return
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
                        PVI {index + 1}: {formatRoadStation(p.chainage)} / {format(p.elevation, 2)} m.
                        {editable
                          ? ' Drag or use arrow keys; Shift-drag (Alt+arrows) holds a grade; Delete removes it.'
                          : ' Preview only.'}
                      </title>
                    </circle>
                  </g>
                ))}
              {!rangePick && <ChartMeasurementBand measurement={measurement} frame={f} />}
              {dragReadout && (
                <PviDragReadoutBox
                  readout={dragReadout}
                  tangents={tangents}
                  stations={analysis.stations}
                  frame={annotationFrame}
                />
              )}
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
              {editing.cursor(f, width)}
            </svg>
            {toolbar(actualExaggeration, width, f)}
            {editing.html(f)}
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
  holdScale = false,
  roadScale = false,
  pinnedStation,
}: {
  station: RoadStation | undefined
  onShift?: (meters: number) => void
  onVerticalShift?: (metres: number) => void
  alignment?: Alignment
  analysis?: RoadAnalysis
  terrainOnly?: boolean
  selectedCulvertId?: string
  onSelectCulvert?: (id: string) => void
  /** Keep the frame's spans from when this turned on, following the formation (`sectionFrame.ts`). */
  holdScale?: boolean
  /** One frame for every station of `analysis`, following the formation (`roadSectionFrame`). */
  roadScale?: boolean
  /** One station's section drawn faintly behind this one, at this one's formation level. */
  pinnedStation?: RoadStation
}) {
  const id = useId().replace(/:/g, '')
  const drag = useRef<number | null>(null)
  const measurement = useChartMeasurement(`${alignment?.id}:${station?.chainage}:${terrainOnly}`)
  const [shiftPreview, setShiftPreview] = useState(0)
  const [hoverOffset, setHoverOffset] = useState<number | null>(null)
  const onShift = terrainOnly ? undefined : shiftAlignment
  const engineering =
    !terrainOnly && station
      ? analysis?.engineering?.stations.find((s) => Math.abs(s.chainage - station.chainage) < 0.001)
      : undefined
  // A station typed between calculation stations has no engineering record; it still takes the
  // template assigned at its own chainage.
  const template =
    engineering?.template.template ??
    (alignment && station && !terrainOnly ? templateAt(alignment, station.chainage).template : alignment?.template)
  // The courses above the subgrade: an explicit stack, or the template's single surfacing depth
  // per side, so the surfacing that is measured and priced is also drawn.
  const courses: SectionLayer[] =
    terrainOnly || !template
      ? []
      : (template.layers ??
        (['left', 'right'] as const).flatMap((side) => {
          const depthM = template[`${side}SurfaceDepth`] ?? template.surfaceDepth
          return depthM > 0 ? [{ id: `surfacing-${side}`, name: 'Surfacing', side, depthM }] : []
        }))
  const courseStackM = Math.max(
    0,
    ...(['left', 'right'] as const).map((side) =>
      courses.filter((l) => l.side === side || l.side === 'both').reduce((sum, l) => sum + l.depthM, 0),
    ),
  )
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
  const preparedPoints =
    station?.section.map((p) => ({
      x: p.offset,
      ground: p.preparedGround === undefined ? p.ground : p.preparedGround,
      design: terrainOnly ? null : p.design,
    })) ?? []
  const hasPreparation = !terrainOnly && station?.section.some((p) => p.preparedGround !== undefined)
  // Top of rock and the blasting level, drawn where a rock horizon is entered (`rockExcavation.ts`).
  const rockPoints = terrainOnly
    ? []
    : (station?.section
        .filter((p) => p.rockTop !== undefined || p.blastLevel !== undefined)
        .map((p) => ({ x: p.offset, ground: p.rockTop ?? null, design: p.blastLevel ?? null })) ?? [])
  const hasRockTop = rockPoints.some((p) => finite(p.ground))
  const hasBlastLevel = rockPoints.some((p) => finite(p.design))
  const codePoints = !terrainOnly && station && template ? sectionCodePoints(station, template) : []
  const hoverSample = hoverOffset === null || !station ? null : sectionSampleAt(station, hoverOffset)
  const hovered = hoverSample
    ? { x: hoverSample.offset, ground: hoverSample.ground, design: terrainOnly ? null : hoverSample.design }
    : null
  const hoverGround = hoverSample?.preparedGround === undefined ? hovered?.ground : hoverSample.preparedGround
  const hoveredDepth = finite(hoverGround) && finite(hovered?.design) ? hoverGround - hovered.design : null
  const hoveredCode = terrainOnly
    ? 'ground transect'
    : station && template && hovered
      ? classifySectionOffset(station, template, hovered.x)
      : 'unknown-design'
  // Section codes read as words: `left-ditch-bottom` → `left ditch bottom`.
  const hoveredPlace =
    hoveredCode === 'outside-designed-section'
      ? 'outside the road'
      : hoveredCode === 'unknown-design'
        ? 'no design here'
        : hoveredCode.replace(/-/g, ' ')
  const designFloor = Math.min(Infinity, ...points.flatMap((p) => (finite(p.design) ? [p.design] : [])))
  const [low, high] = extent([
    ...points.flatMap((p) => [p.ground, p.design]),
    ...preparedPoints.map((p) => p.ground),
    ...points.flatMap((p) => (finite(p.design) ? [p.design + courseStackM] : [])),
    ...pipeSections.flatMap((pipe) => pipe.points.flatMap((p) => [p.ground, p.design])),
    // The blasting level, and the top of rock where it is within 3 m below the lowest design point.
    ...rockPoints.map((p) => p.design),
    ...rockPoints.map((p) => p.ground).filter((z) => finite(z) && z >= designFloor - 3),
  ])
  const halfWidth = Math.max(
    15,
    ...points.map((p) => Math.abs(p.x)),
    ...pipeSections.flatMap((pipe) => pipe.points.map((p) => Math.abs(p.x))),
  )
  const autoDomain: Domain = [-halfWidth, halfWidth, low, high]
  // Hold scale: the spans shown when it was turned on, placed on each station's formation.
  const [held, setHeld] = useState<HeldSectionFrame | null>(null)
  if (holdScale && !held && station) {
    const frame = holdSectionFrame(autoDomain, station)
    if (frame) setHeld(frame)
  } else if (!holdScale && held) setHeld(null)
  // Whole-road scale: one frame that fits every station of the road, placed on each formation.
  const roadStations = roadScale ? analysis?.stations : undefined
  const roadFrame = useMemo(
    () => (roadStations ? roadSectionFrame(roadStations, { terrainOnly, courseStackM }) : null),
    [roadStations, terrainOnly, courseStackM],
  )
  const frame = roadScale ? roadFrame : holdScale ? held : null
  const framed = frame && heldSectionDomain(frame, station)
  const domain: Domain = framed || autoDomain
  const clipped = !!framed && sectionExceedsFrame(points, domain)
  const pinned = pinnedStation && station ? pinnedSectionOutline(pinnedStation, station, terrainOnly) : null
  const side = (left: number | undefined, right: number | undefined, digits = 1) =>
    `${fixed(left, digits)} / ${fixed(right, digits)}`
  const centreDepth =
    finite(station?.groundElevation) && finite(station?.designElevation)
      ? station.groundElevation - station.designElevation
      : null
  const preparedCentre = station ? sectionSampleAt(station, 0).preparedGround : undefined
  const preparedDepth =
    finite(preparedCentre) && finite(station?.designElevation) ? preparedCentre - station.designElevation : null
  const incompleteLabel =
    station && !terrainOnly && !station.complete
      ? `Incomplete section: ${station.incompleteReasons?.join('; ') || 'terrain coverage or daylight limit'}`
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
            title:
              'Original ground minus formation at the centreline; negative is fill. This is not the maximum cut or fill across the section.',
          },
          ...(hasPreparation
            ? [
                {
                  label: 'Prep Dp',
                  value: `${fixed(preparedDepth, 2)} m`,
                  title:
                    'Prepared ground minus formation at the centreline; negative is replacement or embankment fill',
                },
              ]
            : []),
          {
            label: 'Grade',
            value: `${fixed(station.gradePercent)}%`,
            title:
              alignment && !alignment.vertical.length
                ? 'Sampled ground grade; no vertical design has been set'
                : 'Design grade at this station',
          },
          {
            label: 'Grd Z',
            value: fixed(station.groundElevation, 2),
            title: 'Ground elevation at the centreline (m)',
          },
          {
            label: 'Fmn Z',
            value: fixed(station.designElevation, 2),
            title:
              alignment && !alignment.vertical.length
                ? 'Formation follows sampled ground; no vertical design has been set (m)'
                : 'Formation (subgrade) elevation at the centreline (m)',
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
            label: 'Tmpl cut H:V',
            value: side(template.leftCutSlope ?? template.cutSlope, template.rightCutSlope ?? template.cutSlope, 2),
            title:
              'Template cut batter H:V, left / right. Entered materials and components can change actual section slopes.',
          },
          template && {
            label: 'Tmpl fill H:V',
            value: side(template.leftFillSlope ?? template.fillSlope, template.rightFillSlope ?? template.fillSlope, 2),
            title:
              'Template fill batter H:V, left / right. Entered materials and components can change actual section slopes.',
          },
          {
            label: 'Dayl L/R',
            value: side(
              station.leftDaylightM == null ? undefined : Math.abs(station.leftDaylightM),
              station.rightDaylightM ?? undefined,
            ),
            title: station.complete
              ? 'Daylight offsets left / right of the centreline (m)'
              : `Daylight offsets left / right (m); — means unresolved. ${incompleteLabel}`,
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
      measurement={
        station
          ? {
              reading: measurement,
              formatEndpoint: (value) => `${fixed(value)} m`,
              slopes: (start, end) => [
                { label: 'Avg ground slope', percent: averageSlopePercent(points, 'ground', start, end) },
                ...(!terrainOnly
                  ? [{ label: 'Avg formation slope', percent: averageSlopePercent(points, 'design', start, end) }]
                  : []),
              ],
            }
          : undefined
      }
      notice={
        incompleteLabel && (
          // An amber triangle among the header's chart controls; the reason is behind it on hover.
          <span
            role="status"
            data-testid="road-section-incomplete"
            className="inline-flex size-8 items-center justify-center"
          >
            <span className="sr-only">{incompleteLabel}. It is left out of quantities.</span>
            <InfoTip tone="warning" label="Incomplete section">
              <span className="block font-medium">Incomplete section</span>
              <span className="mt-1 block">
                {station?.incompleteReasons?.join('; ') || 'Terrain coverage or daylight limit'}.
              </span>
              <span className="mt-1 block text-muted-foreground">It is left out of quantities.</span>
            </InfoTip>
          </span>
        )
      }
      footer={
        <>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <Legend
              items={
                terrainOnly
                  ? [{ label: 'Ground', color: ROAD_CHART_COLORS.ground }]
                  : [
                      { label: 'Ground', color: ROAD_CHART_COLORS.ground },
                      { label: 'Template', color: ROAD_CHART_COLORS.design },
                      ...(courses.length ? [{ label: 'Surfacing', color: '#d6a84b' }] : []),
                      ...(hasPreparation ? [{ label: 'Prepared ground', color: '#a16207' }] : []),
                      ...(hasRockTop ? [{ label: 'Top of rock', color: ROCK_COLOR }] : []),
                      ...(hasBlastLevel ? [{ label: 'Blasting level', color: BLAST_COLOR }] : []),
                      { label: 'Cut', color: ROAD_CHART_COLORS.cut },
                      { label: 'Fill', color: ROAD_CHART_COLORS.fill },
                    ]
              }
            />
            {pinned && (
              <span
                className="text-3xs text-muted-foreground"
                data-testid="road-section-pinned-label"
                title={pinnedShiftText(pinned)}
              >
                <span
                  aria-hidden
                  className="mr-1 inline-block w-3 border-t border-dashed border-current align-middle"
                />
                Pinned {formatRoadStation(pinned.chainage)}
              </span>
            )}
            {/* Values under the pointer; nothing while it is off the section. */}
            {hovered && (
              <p
                className="hidden min-w-0 truncate text-3xs tabular-nums text-muted-foreground md:block"
                data-testid="road-section-probe"
              >
                Offset {format(hovered.x, 2)} m · ground {format(hovered.ground, 2)} m
                {!terrainOnly && finite(hovered.design) && (
                  <>
                    {' '}
                    · design {format(hovered.design, 2)} m
                    {hoveredDepth !== null &&
                      ` · ${hoveredDepth >= 0 ? 'cut' : 'fill'} ${format(Math.abs(hoveredDepth), 2)} m`}
                  </>
                )}{' '}
                · {hoveredPlace}
              </p>
            )}
          </div>
          <ReadoutGrid data-testid="road-section-readout" items={sectionReadout} />
          {clipped && (
            <p role="status" data-testid="road-section-clipped" className="text-3xs leading-4 text-muted-foreground">
              {roadScale
                ? 'Whole-road scale: part of this section lies outside the frame. Turn Whole-road scale off to fit it.'
                : 'Held scale: part of this section lies outside the frame. Turn Hold scale off to fit it.'}
            </p>
          )}
          {(onShift || (!terrainOnly && onVerticalShift)) && (
            <div
              role="group"
              aria-label="Road section adjustments"
              className="flex flex-nowrap items-center gap-x-5 gap-y-1 pt-1 text-3xs text-muted-foreground md:flex-wrap"
            >
              {onShift && (
                <div role="group" aria-label="Shift alignment" className="flex shrink-0 items-center gap-1">
                  <span className="sr-only md:not-sr-only md:mr-1">Shift alignment</span>
                  <Button
                    size="2xs"
                    variant="outline"
                    className="text-3xs"
                    aria-label="Shift road left one metre"
                    onClick={() => onShift(-1)}
                  >
                    ← 1 m
                  </Button>
                  <Button
                    size="2xs"
                    variant="outline"
                    className="text-3xs"
                    aria-label="Shift road right one metre"
                    onClick={() => onShift(1)}
                  >
                    1 m →
                  </Button>
                </div>
              )}
              {!terrainOnly && onVerticalShift && (
                <div role="group" aria-label="Formation level" className="flex shrink-0 items-center gap-1">
                  <span className="sr-only md:not-sr-only md:mr-1">Formation level</span>
                  <Button
                    size="2xs"
                    variant="outline"
                    className="text-3xs"
                    aria-label="Lower formation 0.25 metres"
                    onClick={() => onVerticalShift(-0.25)}
                  >
                    ↓ 0.25 m
                  </Button>
                  <Button
                    size="2xs"
                    variant="outline"
                    className="text-3xs"
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
            <p className="text-3xs text-muted-foreground">
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
          {culverts.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-label={`Select section culvert ${c.name}`}
              aria-pressed={selectedCulvertId === c.id}
              onClick={() => onSelectCulvert?.(c.id)}
              className={`block w-full rounded-md border px-1 py-0.5 text-left text-3xs ${selectedCulvertId === c.id ? 'border-rose-500 bg-rose-500/10 text-rose-700 dark:text-rose-300' : c.warnings.length ? 'border-transparent text-warning' : 'border-transparent text-muted-foreground'}`}
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
            data-held-scale={holdScale && !!held}
            data-road-scale={roadScale && !!roadFrame}
            data-domain={domain.map((n) => Number(n.toFixed(3))).join(',')}
            role="group"
            tabIndex={0}
            aria-label={`${terrainOnly ? 'Terrain' : 'Road'} cross-section at ${formatRoadStation(station?.chainage ?? 0)}. Negative offsets are left looking forward. ${CHART_MEASURE_HINT}`}
            onKeyDown={(event) => measurement.key(event)}
            onPointerDown={(event) => {
              if (event.button !== 0) return
              const offset = eventValue(event, event.currentTarget, domain)[0]
              if (station && measurement.start(event, offset, f)) return
              if (onShift) {
                drag.current = offset
                event.currentTarget.setPointerCapture(event.pointerId)
              }
            }}
            onPointerMove={(event) => {
              const offset = eventValue(event, event.currentTarget, domain)[0]
              if (measurement.move(event, offset)) return
              setHoverOffset(offset)
              if (onShift && drag.current !== null) setShiftPreview(clamp(offset - drag.current, -20, 20))
            }}
            onPointerLeave={() => {
              if (drag.current === null) setHoverOffset(null)
            }}
            onPointerUp={(event) => {
              if (measurement.end(event)) return
              if (onShift && drag.current !== null) {
                const delta = clamp(eventValue(event, event.currentTarget, domain)[0] - drag.current, -20, 20)
                if (Math.abs(delta) > 0.1) onShift(Math.round(delta * 10) / 10)
                drag.current = null
                setShiftPreview(0)
              }
            }}
            onPointerCancel={() => {
              measurement.cancel()
              drag.current = null
              setShiftPreview(0)
            }}
          >
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
              {pinned && (
                <g data-testid="road-section-pinned" pointerEvents="none" opacity={0.45}>
                  <path
                    d={linePath(pinned.points, 'ground', f.x, f.y)}
                    fill="none"
                    stroke="currentColor"
                    className="text-muted-foreground"
                    strokeWidth={1.4}
                    strokeDasharray="4 3"
                  />
                  <path
                    d={linePath(pinned.points, 'design', f.x, f.y)}
                    fill="none"
                    stroke={ROAD_CHART_COLORS.design}
                    strokeWidth={1.6}
                    strokeDasharray="4 3"
                  />
                  <title>Pinned section at {formatRoadStation(pinned.chainage)}</title>
                </g>
              )}
              {engineering?.layers.flatMap((layer) =>
                points.slice(1).flatMap((b, index) => {
                  const a = points[index]
                  if (!finite(a.ground) || !finite(b.ground)) return []
                  const az = a.ground - layer.topDepthM,
                    bz = b.ground - layer.topDepthM
                  const bottomA = layer.bottomDepthM === null ? domain[2] : a.ground - layer.bottomDepthM
                  const bottomB = layer.bottomDepthM === null ? domain[2] : b.ground - layer.bottomDepthM
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
              {differencePolygons(hasPreparation ? preparedPoints : points, f.x, f.y).map((p, i) => (
                <polygon key={i} points={p.points} fill={p.color} opacity={0.3} />
              ))}
              <path
                d={linePath(points, 'ground', f.x, f.y)}
                fill="none"
                stroke={ROAD_CHART_COLORS.ground}
                strokeWidth={1.8}
              />
              {hasPreparation && (
                <path
                  d={linePath(preparedPoints, 'ground', f.x, f.y)}
                  fill="none"
                  stroke="#a16207"
                  strokeDasharray="5 3"
                  strokeWidth={1.8}
                  data-testid="road-prepared-ground"
                >
                  <title>Ground after stripping and key excavation</title>
                </path>
              )}
              {hasRockTop && (
                <path
                  d={linePath(rockPoints, 'ground', f.x, f.y)}
                  fill="none"
                  stroke={ROCK_COLOR}
                  strokeDasharray="2 3"
                  strokeWidth={1.6}
                  data-testid="road-rock-top"
                >
                  <title>Top of rock: ground less the depth of the shallowest rock horizon</title>
                </path>
              )}
              {hasBlastLevel && (
                <path
                  d={linePath(rockPoints, 'design', f.x, f.y)}
                  fill="none"
                  stroke={BLAST_COLOR}
                  strokeDasharray="6 2 1 2"
                  strokeWidth={1.4}
                  data-testid="road-blast-level"
                >
                  <title>Blasting level: rock above it and below the template is blasted and refilled</title>
                </path>
              )}
              {!terrainOnly &&
                courses.map((layer, layerIndex) => {
                  const widthLeft = station?.leftWidth ?? 0,
                    widthRight = station?.rightWidth ?? 0
                  return (['left', 'right'] as const).flatMap((side) => {
                    if (layer.side !== 'both' && layer.side !== side) return []
                    const below = courses.slice(0, layerIndex).filter((l) => l.side === side || l.side === 'both')
                    const lower = below.reduce((sum, l) => sum + l.depthM, 0)
                    const a = side === 'left' ? -widthLeft : 0,
                      b = side === 'left' ? 0 : widthRight
                    const za = station && sectionSampleAt(station, a).design,
                      zb = station && sectionSampleAt(station, b).design
                    if (!finite(za) || !finite(zb)) return []
                    return [
                      <polygon
                        key={`${layer.id}-${side}`}
                        points={`${f.x(a)},${f.y(za + lower)} ${f.x(b)},${f.y(zb + lower)} ${f.x(b)},${f.y(zb + lower + layer.depthM)} ${f.x(a)},${f.y(za + lower + layer.depthM)}`}
                        // Coloured by its place in this side's stack, so a course matches across the crown.
                        fill={['#d6a84b', '#a3a36e', '#8296b3'][below.length % 3]}
                        data-testid="road-section-course"
                        opacity={0.5}
                      >
                        <title>
                          {layer.name}: {layer.depthM} m{layer.materialId ? `; material ${layer.materialId}` : ''}
                        </title>
                      </polygon>,
                    ]
                  })
                })}
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
            <ChartMeasurementBand measurement={measurement} frame={f} />
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

const HAUL_CLASS_COLORS = { freehaul: '#0d9488', overhaul: '#d97706', endhaul: '#7c3aed' } as const
const HAUL_CLASS_LABELS = { freehaul: 'Free haul', overhaul: 'Overhaul', endhaul: 'End haul' } as const
/** The balance after borrow and waste: the foreground colour, so it reads in both themes. */
const AFTER_SITES_COLOR = 'hsl(var(--foreground))'
/** A diagram that ends within this of zero has closed: every surplus and deficit found a site. */
const MASS_CLOSED_M3 = 0.05

export function MassHaulChart({
  selectedRange,
  analysis,
  engineeringInputs,
  station,
  onStation,
  viewRange,
}: {
  selectedRange?: RoadSelectionRange
  analysis: RoadAnalysis
  /** The road's entered haul settings and sites, which name the pits and give the classes their limits. */
  engineeringInputs?: Pick<AlignmentEngineering, 'haul' | 'sites'>
  station: number
  onStation: (chainage: number) => void
  viewRange?: [number, number]
}) {
  const id = useId().replace(/:/g, '')
  const [showMovements, setShowMovements] = useState(false)
  const measurement = useChartMeasurement(analysis.centerline)
  const engineering = analysis.engineering
  const diagram = useMemo(() => massHaulDiagram(analysis, engineeringInputs), [analysis, engineeringInputs])
  // A hand-set balance line, read only (`balanceLine.ts`); null while the what-if is off.
  const [whatIfLevel, setWhatIfLevel] = useState<number | null>(null)
  const whatIf = useBalanceWhatIf(diagram.balance, whatIfLevel, engineeringInputs?.haul.freeHaulDistanceM ?? null)
  const haul = diagram.haul
  const rangeStart = viewRange ? clamp(viewRange[0], 0, Math.max(0, analysis.length - 1)) : 0
  const rangeEnd = viewRange
    ? clamp(viewRange[1], rangeStart + 1, Math.max(1, analysis.length))
    : Math.max(1, analysis.length)
  const points = diagram.balance.map(([x, mass]) => ({ x, ground: mass, design: 0 }))
  // Borrow and waste move the line only where a site took some; without that it is the balance itself.
  const afterSites = haul?.afterSites.some((p, i, line) => i > 0 && line[i - 1][0] === p[0]) ? haul.afterSites : null
  const balanceHere = ordinateAt(diagram.balance, station)
  const afterHere = afterSites ? ordinateAt(afterSites, station) : null
  const unknownHere = diagram.unknown.some((span) => station > span.start + 1e-6 && station < span.end - 1e-6)
  const closed = !!haul && Math.abs(haul.closingM3) <= MASS_CLOSED_M3
  const unplaced = [
    (engineering?.haul.unallocatedBorrowM3 ?? 0) > MASS_CLOSED_M3 &&
      `${format(engineering!.haul.unallocatedBorrowM3)} compacted m³ of fill has no borrow site with room`,
    (engineering?.haul.unallocatedWasteM3 ?? 0) > MASS_CLOSED_M3 &&
      `${format(engineering!.haul.unallocatedWasteM3)} bank m³ of cut has no waste site with room`,
  ]
    .filter(Boolean)
    .join(' and ')
  const classBands = haul?.classes.some((band) => band.spans.length) ? haul.classes : []
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
  const inView = <T extends readonly [number, number]>(line: readonly T[]) =>
    line
      .filter(
        (p, i) =>
          (p[0] >= rangeStart && p[0] <= rangeEnd) ||
          (p[0] < rangeStart && line[i + 1]?.[0] > rangeStart) ||
          (p[0] > rangeEnd && line[i - 1]?.[0] < rangeEnd),
      )
      .map((p) => p[1])
  const values = [0, ...inView(diagram.balance), ...inView(afterSites ?? [])]
  const [paddedLow, paddedHigh] = extent(values, 10)
  // Zero is a real edge of the balance: a line that never goes negative starts the axis at 0 rather
  // than padding into a deficit it never has, and one that never goes positive ends it there.
  const valueLow = Math.min(...values) >= 0 ? 0 : paddedLow
  const high = Math.max(...values) <= 0 && valueLow < 0 ? 0 : paddedHigh
  // The class bands take the foot of the plot, so the curve is kept clear of them; that strip is
  // not balance, so the axis gives it no ticks.
  const low = classBands.length ? valueLow - (high - valueLow) * 0.12 : valueLow
  const domain: Domain = [rangeStart, rangeEnd, low, high]
  const classRange = (band: HaulClassBand) =>
    band.fromM === null
      ? ''
      : band.toM === null
        ? ` over ${format(band.fromM)} m`
        : ` ${format(band.fromM)}–${format(band.toM)} m`
  return (
    <ChartSlot
      measurement={{ reading: measurement, formatEndpoint: formatRoadStation }}
      footer={
        <>
          <Legend
            items={[
              {
                label: engineering ? 'Usable compacted cut − fill' : 'Cumulative cut × factor − fill',
                color: ROAD_CHART_COLORS.mass,
              },
              ...(afterSites ? [{ label: 'After borrow and waste', color: AFTER_SITES_COLOR }] : []),
              { label: 'Surplus', color: ROAD_CHART_COLORS.cut },
              { label: 'Deficit', color: ROAD_CHART_COLORS.fill },
              ...(diagram.unknown.length ? [{ label: 'Earthwork unknown (hatched)', color: '#b45309' }] : []),
            ]}
          />
          <p className="text-3xs" data-testid="road-mass-cursor">
            {formatRoadStation(station)} · balance {format(balanceHere)} m³
            {afterHere !== null && ` · after borrow and waste ${format(afterHere)} m³`}
            {unknownHere && ' · earthwork unknown here, so the balance is carried across'}
          </p>
          <p className="text-3xs" data-testid="road-mass-end">
            End balance {format(diagram.endBalanceM3)} m³
            {diagram.unknownLengthM > 0 &&
              ` · excludes ${format(diagram.unknownLengthM)} m of road with unknown earthwork`}
            {haul &&
              ` · after borrow and waste ${closed ? 'the diagram closes at 0 m³' : `it ends at ${format(haul.closingM3)} m³`}`}
            {haul && unplaced && ` · ${unplaced}`}
          </p>
          <BalanceWhatIfPanel
            result={whatIf.result}
            range={whatIf.range}
            freeHaulM={engineeringInputs?.haul.freeHaulDistanceM ?? null}
            onLevel={setWhatIfLevel}
            onOpen={() => setWhatIfLevel(0)}
            onClose={() => setWhatIfLevel(null)}
            onStation={onStation}
          />
          {haul && haul.pits.length > 0 && (
            <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-3xs" data-testid="road-mass-pits">
              {haul.pits.map((pit) => (
                <button
                  key={pit.siteId}
                  className="underline decoration-dotted"
                  title="Select this site's road station"
                  onClick={() => onStation(pit.chainage)}
                >
                  {pit.kind === 'borrow' ? 'Borrow' : 'Waste'} · {pit.name} at {formatRoadStation(pit.chainage)}:{' '}
                  {format(pit.volumeM3)} {pit.volumeBasis} m³
                </button>
              ))}
            </p>
          )}
          {haul && (
            <p
              className="flex flex-wrap gap-x-3 gap-y-0.5 text-3xs text-muted-foreground"
              data-testid="road-haul-classes"
            >
              {haul.classes.map((band) => (
                <span key={band.category} className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-3" style={{ backgroundColor: HAUL_CLASS_COLORS[band.category] }} />
                  {band.label}
                  {classRange(band)}: {format(band.compactedM3)} compacted m³
                  {band.bankM3 > 0 && ` + ${format(band.bankM3)} bank m³ waste`}
                </span>
              ))}
            </p>
          )}
          <p className="text-3xs text-muted-foreground">
            {engineering
              ? 'Material reuse and compaction follow the entered assumptions. '
              : 'Balance of computed earthwork. '}
            The balance counts known earthwork only.
            {afterSites &&
              ' Each site steps the dashed line at its road station; above zero the net haul runs up-station, below zero down-station.'}
            {classBands.length > 0 &&
              ' The bars at the foot of the plot mark the road each haul class moves material over.'}
          </p>
          {engineering?.haul.enabled && nearbyMovements.length > 0 && (
            <div className="-mx-3 border-t" data-testid="road-haul-movements">
              <button
                className="flex w-full justify-between px-3 py-1 text-3xs text-muted-foreground hover:bg-muted"
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
                          const detail = `${movement.kind}: ${formatRoadStation(movement.fromChainage)} to ${formatRoadStation(movement.toChainage)}; ${format(movement.transportedVolumeM3)} ${movement.volumeBasis} m³; ${format(movement.distanceM)} m; ${HAUL_CLASS_LABELS[movement.category]}; CAD ${format(movement.haulCost, 2)} haul cost.`
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
                                  stroke={HAUL_CLASS_COLORS[movement.category]}
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
                                  {HAUL_CLASS_LABELS[movement.category]}
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
                                      <circle
                                        cx={endpoint.x}
                                        cy={y}
                                        r={3}
                                        fill={HAUL_CLASS_COLORS[movement.category]}
                                      />
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
      }
    >
      {(width, height) => {
        const f = chartFrame(width, height, domain)
        const bandTop = f.top + f.plotHeight - classBands.length * 5 - 1
        return (
          <svg
            width={width}
            height={height}
            role="group"
            tabIndex={0}
            aria-label={`Earthwork mass balance. Click or use left and right arrows to select a road station. ${CHART_MEASURE_HINT}`}
            data-testid="road-mass-chart"
            data-range-start={rangeStart}
            data-range-end={rangeEnd}
            className="select-none touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onPointerDown={(event) => {
              if (event.button !== 0) return
              const chainage = eventValue(event, event.currentTarget, domain)[0]
              if (measurement.start(event, chainage, f)) return
              event.currentTarget.setPointerCapture(event.pointerId)
              onStation(chainage)
            }}
            onPointerMove={(event) => {
              const chainage = eventValue(event, event.currentTarget, domain)[0]
              if (measurement.move(event, chainage)) return
              if (event.buttons === 1) onStation(chainage)
            }}
            onPointerUp={(event) => measurement.end(event)}
            onPointerCancel={() => measurement.cancel()}
            onKeyDown={(event) => {
              if (!measurement.key(event)) selectWithKeyboard(event, station, analysis.length, onStation)
            }}
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
              yFloor={classBands.length ? valueLow : undefined}
            />
            <g clipPath={`url(#mass-${id})`}>
              <SelectionBand range={selectedRange} frame={f} />
              <g data-testid="road-mass-unknown">
                <HatchedSpans
                  spans={diagram.unknown.map((span) => [span.start, span.end])}
                  x={f.x}
                  top={f.top}
                  height={f.plotHeight}
                  title={(start, end) =>
                    `Earthwork unknown between ${formatRoadStation(start)} and ${formatRoadStation(end)}: an incomplete section. The balance is carried across.`
                  }
                />
              </g>
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
              {afterSites && (
                <path
                  data-testid="road-mass-after-sites"
                  d={afterSites
                    .map(([x, y], i) => `${i ? 'L' : 'M'}${f.x(x).toFixed(2)},${f.y(y).toFixed(2)}`)
                    .join(' ')}
                  stroke={AFTER_SITES_COLOR}
                  strokeWidth={1.6}
                  strokeDasharray="5 3"
                  fill="none"
                />
              )}
              {afterSites &&
                haul!.pits.map((pit, index) => {
                  const x = f.x(pit.chainage)
                  const before = ordinateAt(afterSites, pit.chainage, 'before') ?? 0,
                    after = ordinateAt(afterSites, pit.chainage) ?? 0
                  const borrow = pit.kind === 'borrow'
                  const color = borrow ? ROAD_CHART_COLORS.fill : ROAD_CHART_COLORS.cut
                  // A label sits beside its pit, flipping near the right edge and stepping down when pits crowd.
                  const flip = x > f.left + f.plotWidth - 120
                  return (
                    <g key={pit.siteId} data-testid="road-mass-pit" data-kind={pit.kind} data-chainage={pit.chainage}>
                      <title>
                        {`${borrow ? 'Borrow' : 'Waste'} · ${pit.name} at ${formatRoadStation(pit.chainage)}: ${format(pit.volumeM3)} ${pit.volumeBasis} m³. The balance steps ${format(pit.stepM3)} m³ here.`}
                      </title>
                      <line x1={x} x2={x} y1={f.y(before)} y2={f.y(after)} stroke={color} strokeWidth={3} />
                      <path
                        d={
                          borrow
                            ? `M${x - 5},${f.top + 9} L${x + 5},${f.top + 9} L${x},${f.top + 1} z`
                            : `M${x - 5},${f.top + 1} L${x + 5},${f.top + 1} L${x},${f.top + 9} z`
                        }
                        fill={color}
                      />
                      <text
                        x={x + (flip ? -8 : 8)}
                        y={f.top + 9 + (index % 3) * 10}
                        textAnchor={flip ? 'end' : 'start'}
                        fontSize="9"
                        fill="hsl(var(--foreground))"
                      >
                        {borrow ? 'Borrow' : 'Waste'} {format(pit.volumeM3, 0)} m³
                      </text>
                    </g>
                  )
                })}
              {classBands.map((band, row) =>
                band.spans.map((span) => (
                  <rect
                    key={`${band.category}-${span.start}`}
                    data-testid="road-mass-class-span"
                    data-class={band.category}
                    x={f.x(span.start)}
                    y={bandTop + row * 5}
                    width={Math.max(1, f.x(span.end) - f.x(span.start))}
                    height={4}
                    fill={HAUL_CLASS_COLORS[band.category]}
                  >
                    <title>
                      {`${band.label}${classRange(band)}: material moves over ${formatRoadStation(span.start)}–${formatRoadStation(span.end)}`}
                    </title>
                  </rect>
                )),
              )}
              {whatIf.result && (
                <BalanceLineOverlay
                  result={whatIf.result}
                  range={whatIf.range}
                  frame={f}
                  domainY={[low, high]}
                  onLevel={setWhatIfLevel}
                  onClose={() => setWhatIfLevel(null)}
                />
              )}
              <line
                x1={f.x(station)}
                x2={f.x(station)}
                y1={f.top}
                y2={height - f.bottom}
                stroke={ROAD_CHART_COLORS.selected}
                strokeWidth={1.4}
              />
            </g>
            <ChartMeasurementBand measurement={measurement} frame={f} />
          </svg>
        )
      }}
    </ChartSlot>
  )
}

/**
 * The road's grade along its length (`gradeDiagram.ts`): the design grade as steps over the
 * intervals its stations describe, the ground grade over chords of at least
 * `GROUND_GRADE_CHORD_M`, and dashed lines at the grade standard's limits for each direction.
 * Red and amber bands are the stretches the grade standard flags, the same rows as the Review.
 */
export function GradeChart({
  selectedRange,
  analysis,
  alignment,
  rule,
  terrainOnly = false,
  station,
  onStation,
  viewRange,
  average,
  onAverageChange,
  strip = false,
  sharedMeasurement,
}: {
  selectedRange?: RoadSelectionRange
  analysis: RoadAnalysis
  alignment: Pick<Alignment, 'vertical'>
  /** `gradeRule(project.settings, project.standards)`, as the profile and Review read it. */
  rule: GradeRule
  terrainOnly?: boolean
  station: number
  onStation: (chainage: number) => void
  viewRange?: [number, number]
  /** The page's rolling-average settings (`useGradeAverage`), shared by every grade chart. */
  average: GradeAverageSettings
  onAverageChange: (patch: Partial<GradeAverageSettings>) => void
  strip?: boolean
  /** One Shift-click measurement shared with the profile above the strip; the profile prints its readout. */
  sharedMeasurement?: ReturnType<typeof useChartMeasurement>
}) {
  const id = useId().replace(/:/g, '')
  const headerControls = useChartHeaderControls()
  const ownMeasurement = useChartMeasurement(analysis.centerline)
  const measurement = sharedMeasurement ?? ownMeasurement
  // As a strip under the profile the plot starts just below it, so the two read as one chart.
  const top = strip ? 6 : 24
  const diagram = useMemo(
    () => gradeDiagram(analysis.stations, alignment, rule, { terrainOnly }),
    [analysis.stations, alignment, rule, terrainOnly],
  )
  const showDesign = !terrainOnly && !diagram.groundFollowing
  // Each averaged line is drawn in its own grade line's colour; the lines under it are faded.
  const averages = useMemo(() => {
    if (!average.enabled) return []
    const coverage = average.minCoveragePercent / 100
    const series = showDesign ? average.series : 'ground'
    const lines: { key: 'ground' | 'design'; label: string; color: string; points: RollingGradePoint[] }[] = []
    if (series !== 'design')
      lines.push({
        key: 'ground',
        label: 'Ground',
        color: ROAD_CHART_COLORS.ground,
        points: rollingGrade(groundGradeIntervals(analysis.stations), average.windowM, coverage),
      })
    if (series !== 'ground')
      lines.push({
        key: 'design',
        label: 'Design',
        color: ROAD_CHART_COLORS.design,
        points: rollingGrade(diagram.design, average.windowM, coverage),
      })
    return lines
  }, [average, showDesign, analysis.stations, diagram.design])
  const averaged = averages.length > 0
  const elevations = useMemo(
    () => analysis.stations.map((s) => ({ x: s.chainage, ground: s.groundElevation, design: s.designElevation })),
    [analysis.stations],
  )
  const averageAt = (points: RollingGradePoint[]) =>
    points.reduce<RollingGradePoint | null>(
      (best, p) => (!best || Math.abs(p.chainage - station) < Math.abs(best.chainage - station) ? p : best),
      null,
    )?.gradePercent ?? null
  const windowText = `${format(average.windowM, 0)} m average`
  const rangeStart = viewRange ? clamp(viewRange[0], 0, Math.max(0, analysis.length - 1)) : 0
  const rangeEnd = viewRange
    ? clamp(viewRange[1], rangeStart + 1, Math.max(1, analysis.length))
    : Math.max(1, analysis.length)
  const inView = (start: number, end: number) => end >= rangeStart && start <= rangeEnd
  const values = [
    0,
    diagram.limits.rising.percent,
    diagram.limits.falling.percent,
    ...diagram.design.filter((s) => inView(s.start, s.end)).map((s) => s.gradePercent),
    ...diagram.ground.filter((p) => inView(p.start, p.end)).map((p) => p.gradePercent),
    ...averages.flatMap((line) => line.points.filter((p) => inView(p.start, p.end)).map((p) => p.gradePercent)),
  ]
  const [low, high] = extent(values, 4)
  const domain: Domain = [rangeStart, rangeEnd, low, high]
  const designHere = diagram.design.find((s) => station >= s.start - 1e-6 && station < s.end)?.gradePercent ?? null
  // The chord whose middle is nearest the cursor among those that span it.
  const groundHere =
    diagram.ground
      .filter((p) => station >= p.start - 1e-6 && station <= p.end + 1e-6)
      .sort((a, b) => Math.abs(a.chainage - station) - Math.abs(b.chainage - station))[0] ?? null
  const flaggedHere = diagram.spans.find((s) => station >= s.start - 1e-6 && station <= s.end + 1e-6)
  const sideText = (side: 'adverse' | 'favourable' | 'either') => (side === 'either' ? '' : ` ${side}`)
  const limitLabel = (line: { percent: number; side: 'adverse' | 'favourable' | 'either' }) =>
    `${signedValue(line.percent)}${sideText(line.side)}`
  const groundGaps = (() => {
    const gaps: Array<[number, number]> = []
    for (const p of diagram.ground) {
      if (p.gradePercent !== null) continue
      const previous = gaps.at(-1)
      if (previous && p.start <= previous[1]) previous[1] = Math.max(previous[1], p.end)
      else gaps.push([p.start, p.end])
    }
    return gaps
  })()
  const options = (
    <GradeAverageOptions
      settings={average}
      onChange={onAverageChange}
      designShown={showDesign}
      inHeader={!!headerControls}
    />
  )
  return (
    <ChartSlot
      measurement={
        sharedMeasurement
          ? undefined
          : {
              reading: measurement,
              formatEndpoint: formatRoadStation,
              // The same readings as the profile's measurement: net rise over the measured run.
              slopes: (start, end) => [
                { label: 'Avg ground slope', percent: averageSlopePercent(elevations, 'ground', start, end) },
                ...(showDesign
                  ? [{ label: 'Avg formation grade', percent: averageSlopePercent(elevations, 'design', start, end) }]
                  : []),
              ],
            }
      }
      footer={
        !strip && (
          <>
            <Legend
              items={[
                ...(showDesign ? [{ label: 'Design grade', color: ROAD_CHART_COLORS.design }] : []),
                { label: `Ground grade (over ${GROUND_GRADE_CHORD_M} m or more)`, color: ROAD_CHART_COLORS.ground },
                { label: 'Grade limit', color: 'hsl(var(--muted-foreground))' },
                ...(diagram.spans.some((s) => s.kind === 'breach')
                  ? [{ label: 'Over the standard', color: GRADE_TROUBLE_COLOR }]
                  : []),
                ...(diagram.spans.some((s) => s.kind === 'pitch')
                  ? [{ label: 'Short pitch allowed', color: SHORT_PITCH_COLOR }]
                  : []),
                ...(groundGaps.length ? [{ label: 'Terrain missing (hatched)', color: '#b45309' }] : []),
                ...averages.map((line) => ({ label: `${line.label} · ${windowText}`, color: line.color })),
              ]}
            />
            <p className="text-3xs" data-testid="road-grade-cursor">
              {formatRoadStation(station)}
              {showDesign && ` · design ${designHere === null ? '—' : signedValue(designHere)}`}
              {` · ground ${groundHere?.gradePercent == null ? 'unknown' : signedValue(groundHere.gradePercent)}`}
              {flaggedHere && (flaggedHere.kind === 'breach' ? ' · over the standard' : ' · short pitch allowed')}
              {averages.map((line) => {
                const here = averageAt(line.points)
                return ` · ${line.label.toLowerCase()} ${windowText} ${here === null ? 'unknown' : signedValue(here)}`
              })}
            </p>
            <p className="text-3xs" data-testid="road-grade-summary">
              Limits {limitLabel(diagram.limits.rising)} climbing, {limitLabel(diagram.limits.falling)} descending
              {diagram.shortPitch &&
                ` · short pitches to ${format(diagram.shortPitch.percent)}% for ${format(diagram.shortPitch.maxLengthM)} m`}
              {diagram.steepest &&
                ` · steepest ${signedValue(diagram.steepest.percent)} at ${formatRoadStation(diagram.steepest.chainage)}`}
              {!terrainOnly &&
                (diagram.breachLengthM > 0
                  ? ` · ${format(diagram.breachLengthM, 0)} m over the standard`
                  : diagram.steepest
                    ? ' · within the standard'
                    : '')}
              {averages.map((line) => {
                const steepest = steepestAverage(line.points)
                return steepest
                  ? ` · steepest ${line.label.toLowerCase()} ${windowText} ${signedValue(steepest.percent)} at ${formatRoadStation(steepest.chainage)}`
                  : ''
              })}
            </p>
            <p className="text-3xs text-muted-foreground">
              {terrainOnly
                ? 'Ground grade along the terrain profile. '
                : diagram.groundFollowing
                  ? 'No profile is designed, so the road follows the ground and is judged on its grade between stations. '
                  : 'Each design grade holds over the interval ahead of its station. '}
              Positive grades climb up-station. The ground line reads each chord between calculated stations, never
              between them.
              {averaged &&
                ` The ${windowText} is the length-weighted mean grade centred on each point, for reading only: the standard still judges the station grades.`}
            </p>
          </>
        )
      }
    >
      {(width, height) => {
        const f = chartFrame(width, height, domain, top)
        const designPath = diagram.design
          .map((s, i, steps) => {
            const joined = i > 0 && Math.abs(steps[i - 1].end - s.start) < 1e-6
            const y = f.y(s.gradePercent).toFixed(2)
            return `${joined ? 'L' : 'M'}${f.x(s.start).toFixed(2)},${y} L${f.x(s.end).toFixed(2)},${y}`
          })
          .join(' ')
        let groundPath = ''
        let open = false
        for (const p of diagram.ground) {
          if (p.gradePercent === null) {
            open = false
            continue
          }
          groundPath += `${open ? 'L' : 'M'}${f.x(p.chainage).toFixed(2)},${f.y(p.gradePercent).toFixed(2)} `
          open = true
        }
        const averagePaths = averages.map((line) => {
          let d = ''
          let joined = false
          for (const p of line.points) {
            if (p.gradePercent === null) {
              joined = false
              continue
            }
            d += `${joined ? 'L' : 'M'}${f.x(p.chainage).toFixed(2)},${f.y(p.gradePercent).toFixed(2)} `
            joined = true
          }
          return { ...line, d }
        })
        const limitLines = [diagram.limits.rising, diagram.limits.falling]
        const pitchLines = diagram.shortPitch
          ? [diagram.shortPitch.percent, -diagram.shortPitch.percent].filter(
              (percent) =>
                Math.abs(percent) >
                Math.abs(percent > 0 ? diagram.limits.rising.percent : diagram.limits.falling.percent) + 1e-6,
            )
          : []
        return (
          <>
            {!headerControls && <div className="absolute right-1 top-0 z-10">{options}</div>}
            <svg
              width={width}
              height={height}
              role="group"
              tabIndex={0}
              aria-label={`Road grade along its length. Click or use left and right arrows to select a road station. ${CHART_MEASURE_HINT}`}
              data-testid="road-grade-chart"
              data-range-start={rangeStart}
              data-range-end={rangeEnd}
              className="select-none touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onPointerDown={(event) => {
                if (event.button !== 0) return
                const chainage = eventValue(event, event.currentTarget, domain, top)[0]
                if (measurement.start(event, chainage, f)) return
                event.currentTarget.setPointerCapture(event.pointerId)
                onStation(chainage)
              }}
              onPointerMove={(event) => {
                const chainage = eventValue(event, event.currentTarget, domain, top)[0]
                if (measurement.move(event, chainage)) return
                if (event.buttons === 1) onStation(chainage)
              }}
              onPointerUp={(event) => measurement.end(event)}
              onPointerCancel={() => measurement.cancel()}
              onKeyDown={(event) => {
                if (!measurement.key(event)) selectWithKeyboard(event, station, analysis.length, onStation)
              }}
            >
              <defs>
                <clipPath id={`grade-${id}`}>
                  <rect x={f.left} y={f.top} width={f.plotWidth} height={f.plotHeight} />
                </clipPath>
              </defs>
              <Grid
                width={width}
                height={height}
                domain={domain}
                xLabel="Chainage (m)"
                yLabel="Grade (%)"
                stationTicks
                top={top}
              />
              <g clipPath={`url(#grade-${id})`}>
                <SelectionBand range={selectedRange} frame={f} />
                <g data-testid="road-grade-flags">
                  {diagram.spans.map((span) => (
                    <rect
                      key={`${span.kind}-${span.start}`}
                      data-kind={span.kind}
                      x={f.x(span.start)}
                      y={f.top}
                      width={Math.max(1, f.x(span.end) - f.x(span.start))}
                      height={f.plotHeight}
                      fill={span.kind === 'breach' ? GRADE_TROUBLE_COLOR : SHORT_PITCH_COLOR}
                      opacity={0.14}
                    >
                      <title>
                        {`${span.kind === 'breach' ? 'Over the grade standard' : 'Short pitch allowed'}: ${formatRoadStation(span.start)}–${formatRoadStation(span.end)}`}
                      </title>
                    </rect>
                  ))}
                </g>
                <HatchedSpans
                  spans={groundGaps}
                  x={f.x}
                  top={f.top}
                  height={f.plotHeight}
                  title={(start, end) =>
                    `Ground grade unknown between ${formatRoadStation(start)} and ${formatRoadStation(end)}: terrain is missing.`
                  }
                />
                <line
                  x1={f.left}
                  x2={width - f.right}
                  y1={f.y(0)}
                  y2={f.y(0)}
                  stroke="hsl(var(--muted-foreground))"
                  strokeOpacity={0.6}
                />
                {limitLines.map((line) => (
                  <g key={line.percent} data-testid="road-grade-limit" data-percent={line.percent}>
                    <line
                      x1={f.left}
                      x2={width - f.right}
                      y1={f.y(line.percent)}
                      y2={f.y(line.percent)}
                      stroke="hsl(var(--muted-foreground))"
                      strokeDasharray="5 4"
                    />
                    <text
                      x={width - f.right - 4}
                      y={f.y(line.percent) + (line.percent > 0 ? -4 : 11)}
                      textAnchor="end"
                      fontSize="9"
                      fill="hsl(var(--muted-foreground))"
                    >
                      Limit {limitLabel(line)}
                    </text>
                  </g>
                ))}
                {pitchLines.map((percent) => (
                  <line
                    key={percent}
                    data-testid="road-grade-pitch-limit"
                    x1={f.left}
                    x2={width - f.right}
                    y1={f.y(percent)}
                    y2={f.y(percent)}
                    stroke={SHORT_PITCH_COLOR}
                    strokeDasharray="2 3"
                  />
                ))}
                {groundPath && (
                  <path
                    data-testid="road-grade-ground"
                    d={groundPath}
                    stroke={ROAD_CHART_COLORS.ground}
                    strokeWidth={showDesign ? 1.2 : 1.8}
                    strokeOpacity={averaged ? 0.35 : showDesign ? 0.75 : 1}
                    fill="none"
                  />
                )}
                {showDesign && designPath && (
                  <path
                    data-testid="road-grade-design"
                    d={designPath}
                    stroke={ROAD_CHART_COLORS.design}
                    strokeWidth={2}
                    strokeOpacity={averaged ? 0.4 : 1}
                    fill="none"
                  />
                )}
                {averagePaths.map(
                  (line) =>
                    line.d && (
                      <path
                        key={line.key}
                        data-testid="road-grade-average"
                        data-series={line.key}
                        d={line.d}
                        stroke={line.color}
                        strokeWidth={2.8}
                        strokeLinejoin="round"
                        fill="none"
                      >
                        <title>{`${line.label} grade · ${windowText}`}</title>
                      </path>
                    ),
                )}
                <line
                  x1={f.x(station)}
                  x2={f.x(station)}
                  y1={f.top}
                  y2={height - f.bottom}
                  stroke={ROAD_CHART_COLORS.selected}
                  strokeWidth={1.4}
                />
              </g>
              <ChartMeasurementBand measurement={measurement} frame={f} />
            </svg>
            {headerControls && createPortal(options, headerControls)}
          </>
        )
      }}
    </ChartSlot>
  )
}

export function CableChart({
  analysis,
  distance = 0,
  onDistance,
  layout,
  edit,
}: {
  analysis: CableAnalysis
  distance?: number
  onDistance?: (distance: number) => void
  /** Intermediate supports (`cableLayout/overlay.ts`): a found layout replaces the single span. */
  layout?: CableLayoutOverlay
  /** Edits the support layout from the chart (`CableLayoutChartLayer.tsx`). */
  edit?: CableChartEdit
}) {
  // A found support layout, else a solved skyline, replaces the assumed line: the load path is what
  // clears (or hits) the ground.
  const measurement = useChartMeasurement(analysis.samples)
  const multi = layout?.loadPath.length ? layout : null
  const mechanics = !multi && analysis.mechanics?.span ? analysis.mechanics : null
  const points = multi
    ? multi.loadPath.map((p) => ({ x: p.x, ground: p.ground, design: p.z }))
    : analysis.samples.map((s, i) => ({
        x: s.distance,
        ground: s.ground,
        design: mechanics ? mechanics.samples[i].loadPath : s.cable,
      }))
  const emptyRope = multi
    ? multi.emptyRope.map((p) => ({ x: p.x, ground: null, design: p.z }))
    : mechanics
      ? analysis.samples.map((s, i) => ({ x: s.distance, ground: null, design: mechanics.samples[i].emptyRope }))
      : []
  const [low, high] = extent([
    ...points.flatMap((p) => [p.ground, p.design]),
    ...emptyRope.map((p) => p.design),
    ...(layout?.supports.flatMap((s) => [s.ground, s.top]) ?? []),
  ])
  const domain: Domain = [0, Math.max(1, analysis.length), low, high]
  const activeIndex = points.reduce(
    (best, sample, i) => (best < 0 || Math.abs(sample.x - distance) < Math.abs(points[best].x - distance) ? i : best),
    -1,
  )
  const active =
    activeIndex < 0
      ? undefined
      : multi
        ? {
            distance: points[activeIndex].x,
            ground: points[activeIndex].ground,
            cable: points[activeIndex].design,
            clearance:
              finite(points[activeIndex].design) && finite(points[activeIndex].ground)
                ? points[activeIndex].design! - points[activeIndex].ground!
                : null,
          }
        : {
            ...analysis.samples[activeIndex],
            cable: points[activeIndex].design,
            clearance: mechanics
              ? mechanics.samples[activeIndex].loadClearance
              : analysis.samples[activeIndex].clearance,
          }
  const kN = (n: number) => format(n / 1000, 0)
  return (
    <ChartSlot
      measurement={
        !edit
          ? {
              reading: measurement,
              formatEndpoint: (value) => `${fixed(value)} m`,
              slopes: (start, end) => [
                { label: 'Avg ground slope', percent: averageSlopePercent(points, 'ground', start, end) },
              ],
            }
          : undefined
      }
      footer={
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Legend
              items={
                multi
                  ? [
                      { label: 'Ground', color: ROAD_CHART_COLORS.ground },
                      { label: 'Loaded carriage path', color: ROAD_CHART_COLORS.design },
                      { label: 'Empty skyline', color: ROAD_CHART_COLORS.mass },
                      { label: 'Supports', color: ROAD_CHART_COLORS.selected },
                    ]
                  : mechanics
                    ? [
                        { label: 'Ground', color: ROAD_CHART_COLORS.ground },
                        { label: 'Loaded carriage path', color: ROAD_CHART_COLORS.design },
                        { label: 'Empty skyline', color: ROAD_CHART_COLORS.mass },
                      ]
                    : [
                        { label: 'Ground', color: ROAD_CHART_COLORS.ground },
                        { label: 'Assumed cable geometry', color: ROAD_CHART_COLORS.design },
                      ]
              }
            />
            <span className="text-2xs" data-testid="road-cable-clearance">
              {multi
                ? multi.summary
                : mechanics
                  ? `Minimum load clearance ${format(mechanics.minLoadClearance)} m${mechanics.complete ? (mechanics.clearanceOk ? '' : ` · below ${format(mechanics.rigging.minClearanceM)} m`) : ' · incomplete terrain'}`
                  : `Minimum clearance ${format(analysis.minClearance)} m${analysis.complete ? '' : ' · incomplete terrain'}`}
            </span>
          </div>
          {multi ? (
            <p className="text-3xs text-muted-foreground" data-testid="road-cable-layout">
              Static multi-span skyline at one pre-tension; carriage path with the load moved along each span. No
              dynamic loads, anchors, trees or equipment ratings.
            </p>
          ) : mechanics?.span ? (
            <p className="text-3xs text-muted-foreground" data-testid="road-cable-mechanics">
              Max tension {kN(mechanics.span.maxTension.tensionN)} kN at the{' '}
              {mechanics.span.maxTension.atSupport === 'near' ? 'start' : 'end'} support (allowable{' '}
              {kN(mechanics.span.allowableN)} kN{mechanics.tensionOk ? '' : ' · exceeded'}) · mid-span sag{' '}
              {format(mechanics.span.midSpan.sagBelowChordM)} m (
              {format((100 * mechanics.span.midSpan.sagBelowChordM) / Math.max(1, analysis.length))}% of span). Static
              single span; no anchors, guylines, carriage or equipment rating.
            </p>
          ) : (
            <p className="text-3xs text-muted-foreground">
              {analysis.mechanics?.error ? `Rope mechanics: ${analysis.mechanics.error} Showing the assumed sag. ` : ''}
              Geometric deflection screen. Cable tension, payload and equipment capacity require a separate design.
            </p>
          )}
          {onDistance && (
            <p className="text-3xs text-muted-foreground">
              Cursor {format(active?.distance)} m · ground {format(active?.ground)} m ·{' '}
              {mechanics ? 'carriage' : 'cable'} {format(active?.cable)} m · clearance {format(active?.clearance)} m.
              Click or drag to inspect the same point on the plan.
            </p>
          )}
          {edit && (
            <p className="text-3xs text-muted-foreground" data-testid="road-cable-edit-hint">
              {edit.edited ? 'Drag a support handle to move it or change its height. ' : ''}Double-click the profile to
              add a support; Shift-drag along it to draw a no-support sector; Escape cancels.
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
            role="group"
            tabIndex={0}
            className="select-none touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Cable deflection line and ground profile, with negative-clearance conflicts highlighted. ${edit ? 'Shift-drag draws a no-support sector.' : CHART_MEASURE_HINT}`}
            data-testid="road-cable-chart"
            data-distance={active?.distance ?? distance}
            onPointerDown={(event) => {
              if (event.button !== 0) return
              const value = eventValue(event, event.currentTarget, domain)[0]
              if (!edit && measurement.start(event, value, f)) return
              if (onDistance) {
                event.currentTarget.setPointerCapture(event.pointerId)
                onDistance(value)
              }
            }}
            onPointerMove={(event) => {
              const value = eventValue(event, event.currentTarget, domain)[0]
              if (measurement.move(event, value)) return
              if (event.buttons === 1) onDistance?.(value)
            }}
            onPointerUp={(event) => measurement.end(event)}
            onPointerCancel={() => measurement.cancel()}
            onKeyDown={(event) => {
              if (!measurement.key(event) && onDistance)
                selectWithKeyboard(event, distance, analysis.length, onDistance)
            }}
          >
            <Grid width={width} height={height} domain={domain} xLabel="Horizontal span (m)" yLabel="Elevation (m)" />
            {layout?.sectors.map(([a, b], i) => (
              <rect
                key={`sector-${i}`}
                data-testid="road-cable-sector"
                x={f.x(a)}
                y={f.top}
                width={Math.max(1, f.x(b) - f.x(a))}
                height={Math.max(0, height - f.bottom - f.top)}
                fill={ROAD_CHART_COLORS.cut}
                opacity={0.08}
              >
                <title>{`No supports ${format(a, 0)}–${format(b, 0)} m`}</title>
              </rect>
            ))}
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
            {(mechanics || multi) && (
              <path
                d={linePath(emptyRope, 'design', f.x, f.y)}
                stroke={ROAD_CHART_COLORS.mass}
                strokeWidth={1.4}
                strokeDasharray="5 3"
                fill="none"
              />
            )}
            <path
              d={linePath(points, 'design', f.x, f.y)}
              stroke={ROAD_CHART_COLORS.design}
              strokeWidth={2.3}
              fill="none"
            />
            {layout?.supports.map((s, i) => (
              <g key={`support-${i}`} data-testid="road-cable-support" data-kind={s.kind}>
                <title>{`${s.kind === 'anchor' ? 'Anchor' : s.kind === 'ground-anchor' ? 'Ground anchor' : s.kind === 'yarder' ? 'Yarder' : /^\d+$/.test(s.label) ? `Support ${s.label}` : s.label === 'S' ? 'Start support' : 'End support'} at ${format(s.x, 0)} m, ${format(s.top - s.ground)} m high`}</title>
                <line
                  x1={f.x(s.x)}
                  x2={f.x(s.x)}
                  y1={f.y(s.ground)}
                  y2={f.y(s.top)}
                  stroke={ROAD_CHART_COLORS.selected}
                  strokeWidth={s.kind === 'anchor' || s.kind === 'ground-anchor' ? 1 : 3}
                />
                {s.kind !== 'anchor' && s.kind !== 'ground-anchor' && (
                  <text x={f.x(s.x)} y={f.y(s.top) - 4} textAnchor="middle" fontSize="9" fill="hsl(var(--foreground))">
                    {s.label}
                  </text>
                )}
              </g>
            ))}
            {layout?.fixed.map((p, i) => (
              <path
                key={`fixed-${i}`}
                data-testid="road-cable-fixed-support"
                d={`M${f.x(p.x) - 4},${f.top} L${f.x(p.x) + 4},${f.top} L${f.x(p.x)},${f.top + 7} z`}
                fill={ROAD_CHART_COLORS.selected}
              >
                <title>{`Fixed support at ${format(p.x, 0)} m${p.heightM === undefined ? '' : `, ${format(p.heightM)} m high`}`}</title>
              </path>
            ))}
            {layout?.peaks.map((x, i) => (
              <line
                key={`peak-${i}`}
                x1={f.x(x)}
                x2={f.x(x)}
                y1={height - f.bottom}
                y2={height - f.bottom - 5}
                stroke={ROAD_CHART_COLORS.ground}
                strokeWidth={1.5}
              >
                <title>{`Convexity peak (support candidate) at ${format(x, 0)} m`}</title>
              </line>
            ))}
            {!multi &&
              [points[0], points[points.length - 1]]
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
            {layout && (
              <CableLayoutChartLayer
                layout={layout}
                edit={edit}
                frame={f}
                domain={domain}
                height={height}
                onDistance={onDistance}
              />
            )}
            {!edit && <ChartMeasurementBand measurement={measurement} frame={f} />}
          </svg>
        )
      }}
    </ChartSlot>
  )
}
