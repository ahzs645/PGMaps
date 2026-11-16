/**
 * Small SVG charts for a stand prescription. Kept, removed and protected trees take the colours the
 * road view draws them in under *Tree colours: by treatment* (`TREATMENT_TINTS`), so a chart and the
 * view read alike; the stand before harvest and the target are neutral. Each chart scales to its
 * container's width, names itself for assistive technology and carries its numbers in a visually
 * hidden table, and every bar group answers the pointer with its values.
 */

import { useId, type ReactNode } from 'react'

import { DEFAULT_LOCALE } from '@/lib/format'
import { cn } from '@/lib/utils'

import {
  niceTicks,
  type ClumpRow,
  type ProfileStatus,
  type SpeciesRow,
  type StackedClass,
  type StandProfile as StandProfileData,
} from './prescriptionCharts'
import { TREATMENT_TINTS } from './prescribedCells'

const css = ([r, g, b]: readonly [number, number, number]) =>
  `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`

/** Chart colours: the road view's treatment tints. */
export const CHART_COLORS = {
  kept: css(TREATMENT_TINTS.kept),
  removed: css(TREATMENT_TINTS.marked),
  protected: css(TREATMENT_TINTS.protected),
} as const

const STATUS_LABELS: Record<ProfileStatus, string> = { kept: 'Kept', removed: 'Removed', protected: 'Protected' }

const whole = new Intl.NumberFormat(DEFAULT_LOCALE, { maximumFractionDigits: 0 })
const oneDecimal = new Intl.NumberFormat(DEFAULT_LOCALE, { maximumFractionDigits: 1 })
const percent = new Intl.NumberFormat(DEFAULT_LOCALE, { style: 'percent', maximumFractionDigits: 0 })
const tick = (value: number) => (Math.abs(value) >= 10 || Number.isInteger(value) ? whole : oneDecimal).format(value)

// The plot frame in viewBox units; the SVG scales to its container.
const WIDTH = 480
const HEIGHT = 200
const MARGIN = { top: 20, right: 8, bottom: 34, left: 40 }
const PLOT_W = WIDTH - MARGIN.left - MARGIN.right
const PLOT_H = HEIGHT - MARGIN.top - MARGIN.bottom
/** Bars never fill their slot: at most 24 units thick, the rest is air. */
const MAX_BAR = 24
/** Gap between touching marks, units. */
const GAP = 2
const AXIS_FONT = 10

/** A bar from `y` (top) down to `y + h`, rounded at its data end only. */
function barPath(x: number, y: number, w: number, h: number, roundTop: boolean): string {
  if (h <= 0 || w <= 0) return ''
  const r = roundTop ? Math.min(3, w / 2, h) : 0
  if (r === 0) return `M${x},${y}h${w}v${h}h${-w}Z`
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

type LegendItem = { label: string; swatch: ReactNode }

const Swatch = ({ color, className }: { color?: string; className?: string }) => (
  <span
    aria-hidden="true"
    className={cn('inline-block size-2.5 rounded-sm', className)}
    style={{ background: color }}
  />
)
const BeforeSwatch = () => <Swatch className="bg-muted-foreground/50" />
const TargetSwatch = () => <span aria-hidden="true" className="inline-block h-0.5 w-3 rounded-full bg-foreground" />

function ChartFrame({
  title,
  legend,
  note,
  children,
}: {
  title: string
  legend?: LegendItem[]
  note?: ReactNode
  children: ReactNode
}) {
  return (
    <figure className="min-w-0 space-y-1.5">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-xs font-semibold text-foreground">{title}</span>
        {legend && (
          <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground">
            {legend.map((item) => (
              <li key={item.label} className="flex items-center gap-1.5">
                {item.swatch}
                {item.label}
              </li>
            ))}
          </ul>
        )}
      </figcaption>
      {children}
      {note && <p className="text-2xs text-muted-foreground">{note}</p>}
    </figure>
  )
}

/** Recessive horizontal gridlines with their values, and the axis titles. */
function ValueAxis({ ticks, top, unit, xTitle }: { ticks: number[]; top: number; unit: string; xTitle: string }) {
  const y = (value: number) => MARGIN.top + PLOT_H - (value / top) * PLOT_H
  return (
    <g className="text-muted-foreground" fill="currentColor" fontSize={AXIS_FONT}>
      {ticks.map((value) => (
        <g key={value}>
          <line
            x1={MARGIN.left}
            x2={WIDTH - MARGIN.right}
            y1={y(value)}
            y2={y(value)}
            stroke="currentColor"
            strokeOpacity={value === 0 ? 0.5 : 0.15}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          <text x={MARGIN.left - 4} y={y(value)} dy="0.32em" textAnchor="end">
            {tick(value)}
          </text>
        </g>
      ))}
      <text x={0} y={MARGIN.top - 10} textAnchor="start">
        {unit}
      </text>
      <text x={MARGIN.left + PLOT_W / 2} y={HEIGHT - 2} textAnchor="middle">
        {xTitle}
      </text>
    </g>
  )
}

/** The chart's numbers for screen readers: the table view of every chart here. */
function DataTable({ caption, head, rows }: { caption: string; head: string[]; rows: Array<Array<string>> }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {head.map((cell) => (
            <th key={cell} scope="col">
              {cell}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) =>
              j === 0 ? (
                <th key={j} scope="row">
                  {cell}
                </th>
              ) : (
                <td key={j}>{cell}</td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Labels every `step`-th slot so the axis never crowds. */
const labelStep = (count: number, room = 12) => Math.max(1, Math.ceil(count / room))

/**
 * Stems/ha by class, each bar the stems kept (below) and removed (above): a diameter or height
 * distribution before harvest, split by what the prescription does.
 */
export function StackedClassBars({
  title,
  rows,
  measureLabel,
  unit,
}: {
  title: string
  rows: StackedClass[]
  /** "Diameter at breast height", "Height". */
  measureLabel: string
  /** "cm", "m". */
  unit: string
}) {
  const id = useId()
  const top = niceTicks(Math.max(0, ...rows.map((row) => row.kept + row.removed)))
  const max = top[top.length - 1]
  const band = PLOT_W / Math.max(1, rows.length)
  const barW = Math.min(MAX_BAR, band * 0.78)
  const y = (value: number) => (value / max) * PLOT_H
  const step = labelStep(rows.length)
  const range = (row: StackedClass) => `${tick(row.from)}–${tick(row.to)} ${unit}`
  const total = rows.reduce((sum, row) => sum + row.kept + row.removed, 0)
  const removed = rows.reduce((sum, row) => sum + row.removed, 0)
  return (
    <ChartFrame
      title={title}
      legend={[
        { label: 'Kept', swatch: <Swatch color={CHART_COLORS.kept} /> },
        { label: 'Removed', swatch: <Swatch color={CHART_COLORS.removed} /> },
      ]}
    >
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        role="img"
        aria-labelledby={`${id}-title`}
        className="block h-auto overflow-visible"
      >
        <title id={`${id}-title`}>
          {`${title}: ${whole.format(total)} stems/ha in ${rows.length} classes of ${tick(rows[0]?.to ?? 0)} ${unit}, ${whole.format(removed)} stems/ha removed.`}
        </title>
        <ValueAxis ticks={top} top={max} unit="stems/ha" xTitle={`${measureLabel} (${unit})`} />
        {rows.map((row, i) => {
          const x = MARGIN.left + i * band + (band - barW) / 2
          const base = MARGIN.top + PLOT_H
          const keptH = y(row.kept)
          const removedH = y(row.removed)
          const gap = keptH > 0 && removedH > 0 ? GAP : 0
          return (
            <g key={row.from}>
              <title>{`${range(row)}: ${whole.format(row.kept)} kept, ${whole.format(row.removed)} removed stems/ha`}</title>
              {/* The hit target is the whole slot, taller than the bar. */}
              <rect x={MARGIN.left + i * band} y={MARGIN.top} width={band} height={PLOT_H} fill="transparent" />
              <path d={barPath(x, base - keptH, barW, keptH, removedH <= 0)} fill={CHART_COLORS.kept} />
              <path
                d={barPath(x, base - keptH - removedH, barW, Math.max(0, removedH - gap), true)}
                fill={CHART_COLORS.removed}
              />
              {i % step === 0 && (
                <text
                  x={MARGIN.left + i * band}
                  y={base + 12}
                  textAnchor="middle"
                  fontSize={AXIS_FONT}
                  fill="currentColor"
                  className="text-muted-foreground"
                >
                  {tick(row.from)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      <DataTable
        caption={title}
        head={[`${measureLabel} (${unit})`, 'Kept (stems/ha)', 'Removed (stems/ha)']}
        rows={rows.map((row) => [range(row), whole.format(row.kept), whole.format(row.removed)])}
      />
    </ChartFrame>
  )
}

type GroupedSeries<T> = {
  key: string
  label: string
  value: (row: T) => number
  /** A bar fill, or `target` for a level drawn as a line across the group. */
  mark: { fill: string } | { fillClass: string } | 'target'
}

function GroupedBars<T>({
  title,
  rows,
  rowLabel,
  series,
  unit,
  xTitle,
  format,
  maxValue,
  legend,
  note,
}: {
  title: string
  rows: T[]
  rowLabel: (row: T) => string
  series: GroupedSeries<T>[]
  unit: string
  xTitle: string
  format: (value: number) => string
  maxValue?: number
  legend: LegendItem[]
  note?: ReactNode
}) {
  const id = useId()
  const top = niceTicks(maxValue ?? Math.max(0, ...rows.flatMap((row) => series.map((s) => s.value(row)))))
  const max = top[top.length - 1]
  const band = PLOT_W / Math.max(1, rows.length)
  const bars = series.filter((s) => s.mark !== 'target')
  const barW = Math.min(MAX_BAR, (band * 0.8 - GAP * (bars.length - 1)) / Math.max(1, bars.length))
  const groupW = bars.length * barW + GAP * (bars.length - 1)
  const base = MARGIN.top + PLOT_H
  const h = (value: number) => (value / max) * PLOT_H
  return (
    <ChartFrame title={title} legend={legend} note={note}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        role="img"
        aria-labelledby={`${id}-title`}
        className="block h-auto overflow-visible"
      >
        <title id={`${id}-title`}>
          {`${title}: ${rows.map((row) => `${rowLabel(row)} ${series.map((s) => `${s.label.toLowerCase()} ${format(s.value(row))}`).join(', ')}`).join('; ')}.`}
        </title>
        <ValueAxis ticks={top} top={max} unit={unit} xTitle={xTitle} />
        {rows.map((row, i) => {
          const left = MARGIN.left + i * band + (band - groupW) / 2
          return (
            <g key={rowLabel(row)}>
              <title>{`${rowLabel(row)}: ${series.map((s) => `${s.label} ${format(s.value(row))}`).join(', ')}`}</title>
              <rect x={MARGIN.left + i * band} y={MARGIN.top} width={band} height={PLOT_H} fill="transparent" />
              {bars.map((s, k) => {
                const value = h(s.value(row))
                const mark = s.mark as { fill: string } | { fillClass: string }
                return (
                  <path
                    key={s.key}
                    d={barPath(left + k * (barW + GAP), base - value, barW, value, true)}
                    {...('fill' in mark ? { fill: mark.fill } : { fill: 'currentColor', className: mark.fillClass })}
                  />
                )
              })}
              {series
                .filter((s) => s.mark === 'target')
                .map((s) => {
                  const level = base - h(s.value(row))
                  return (
                    <line
                      key={s.key}
                      x1={left - 3}
                      x2={left + groupW + 3}
                      y1={level}
                      y2={level}
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      className="text-foreground"
                    />
                  )
                })}
              <text
                x={MARGIN.left + i * band + band / 2}
                y={base + 12}
                textAnchor="middle"
                fontSize={AXIS_FONT}
                fill="currentColor"
                className="text-muted-foreground"
              >
                {rowLabel(row)}
              </text>
            </g>
          )
        })}
      </svg>
      <DataTable
        caption={title}
        head={[xTitle, ...series.map((s) => `${s.label} (${unit})`)]}
        rows={rows.map((row) => [rowLabel(row), ...series.map((s) => format(s.value(row)))])}
      />
    </ChartFrame>
  )
}

/** Stems/ha of each species before harvest and kept after it. */
export function SpeciesBars({ rows }: { rows: SpeciesRow[] }) {
  return (
    <GroupedBars
      title="Species"
      rows={rows}
      rowLabel={(row) => row.label}
      unit="stems/ha"
      xTitle="Species"
      format={(value) => whole.format(value)}
      series={[
        { key: 'before', label: 'Before', value: (row) => row.before, mark: { fillClass: 'text-muted-foreground/50' } },
        { key: 'after', label: 'Kept', value: (row) => row.after, mark: { fill: CHART_COLORS.kept } },
      ]}
      legend={[
        { label: 'Before', swatch: <BeforeSwatch /> },
        { label: 'Kept', swatch: <Swatch color={CHART_COLORS.kept} /> },
      ]}
    />
  )
}

/** Share of trees in each ICO clump class: the stand before, the target and the trees kept. */
export function ClumpDistributionBars({
  rows,
  distanceMeters,
  showTarget = true,
}: {
  rows: ClumpRow[]
  /** Trees nearer than this stand in one clump, metres. */
  distanceMeters: number
  showTarget?: boolean
}) {
  const series: GroupedSeries<ClumpRow>[] = [
    {
      key: 'before',
      label: 'Before',
      value: (row) => row.before * 100,
      mark: { fillClass: 'text-muted-foreground/50' },
    },
    { key: 'kept', label: 'Kept', value: (row) => row.kept * 100, mark: { fill: CHART_COLORS.kept } },
  ]
  if (showTarget) series.push({ key: 'target', label: 'Target', value: (row) => row.target * 100, mark: 'target' })
  return (
    <GroupedBars
      title="Clump sizes"
      rows={rows}
      rowLabel={(row) => row.label}
      unit="% of trees"
      xTitle={`Clump size (trees within ${oneDecimal.format(distanceMeters)} m)`}
      format={(value) => percent.format(value / 100)}
      maxValue={Math.max(...rows.flatMap((row) => [row.before, row.kept, showTarget ? row.target : 0])) * 100}
      series={series}
      legend={[
        { label: 'Before', swatch: <BeforeSwatch /> },
        { label: 'Kept', swatch: <Swatch color={CHART_COLORS.kept} /> },
        ...(showTarget ? [{ label: 'Target', swatch: <TargetSwatch /> }] : []),
      ]}
    />
  )
}

const PROFILE_WIDTH = 640
const PROFILE_HEIGHT = 220
const PROFILE_MARGIN = { top: 20, right: 10, bottom: 30, left: 36 }

/**
 * A side view of the trees in a strip through the block: stems as lines and crowns as ellipses at
 * their own heights and widths, coloured by what the prescription does with each.
 */
export function StandProfile({ profile }: { profile: StandProfileData }) {
  const id = useId()
  const plotW = PROFILE_WIDTH - PROFILE_MARGIN.left - PROFILE_MARGIN.right
  const plotH = PROFILE_HEIGHT - PROFILE_MARGIN.top - PROFILE_MARGIN.bottom
  const tallest = Math.max(1, ...profile.trees.map((tree) => tree.heightMeters))
  const xTicks = niceTicks(Math.max(1, profile.lengthMeters), 6)
  const yTicks = niceTicks(tallest, 3)
  const xMax = xTicks[xTicks.length - 1]
  const yMax = yTicks[yTicks.length - 1]
  const sx = plotW / xMax
  const sy = plotH / yMax
  const x = (meters: number) => PROFILE_MARGIN.left + meters * sx
  const y = (meters: number) => PROFILE_MARGIN.top + plotH - meters * sy
  const ground = y(0)
  const exaggeration = sy / sx
  // Far side of the strip first, so nearer trees draw over them.
  const order = [...profile.trees].sort((a, b) => b.across - a.across)
  const statuses: ProfileStatus[] = ['kept', 'removed', 'protected']
  const shown = statuses.filter((status) => profile.counts[status] > 0)
  const bearing = whole.format(profile.bearingDegrees)
  const along =
    profile.bearingDegrees === profile.axisBearingDegrees ? `${bearing}° (the block's long axis)` : `${bearing}°`
  return (
    <ChartFrame
      title="Stand profile"
      legend={shown.map((status) => ({
        label: STATUS_LABELS[status],
        swatch: <Swatch color={CHART_COLORS[status]} />,
      }))}
      note={
        <>
          A {whole.format(profile.widthMeters)} m strip through the block&rsquo;s centre along {along}
          {exaggeration > 1.05 && <>, heights drawn ×{oneDecimal.format(exaggeration)}</>}.
          {profile.leftOut > 0 && (
            <>
              {' '}
              {whole.format(profile.trees.length)} of {whole.format(profile.inStrip)} trees drawn, evenly spaced;{' '}
              {whole.format(profile.leftOut)} left out.
            </>
          )}
        </>
      }
    >
      {profile.trees.length === 0 ? (
        <p className="text-xs text-muted-foreground">No trees stand in the strip.</p>
      ) : (
        <svg
          viewBox={`0 0 ${PROFILE_WIDTH} ${PROFILE_HEIGHT}`}
          width="100%"
          role="img"
          aria-labelledby={`${id}-title`}
          className="block h-auto overflow-visible"
        >
          <title id={`${id}-title`}>
            {`Stand profile along ${bearing}°: ${profile.inStrip} trees in a ${whole.format(profile.widthMeters)} m strip, ${statuses.map((status) => `${profile.counts[status]} ${STATUS_LABELS[status].toLowerCase()}`).join(', ')}.`}
          </title>
          <g className="text-muted-foreground" fill="currentColor" fontSize={AXIS_FONT}>
            {yTicks.map((value) => (
              <g key={`y${value}`}>
                {value > 0 && (
                  <line
                    x1={PROFILE_MARGIN.left}
                    x2={PROFILE_WIDTH - PROFILE_MARGIN.right}
                    y1={y(value)}
                    y2={y(value)}
                    stroke="currentColor"
                    strokeOpacity={0.15}
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                <text x={PROFILE_MARGIN.left - 4} y={y(value)} dy="0.32em" textAnchor="end">
                  {tick(value)}
                </text>
              </g>
            ))}
            {xTicks.map((value) => (
              <text key={`x${value}`} x={x(value)} y={ground + 12} textAnchor="middle">
                {tick(value)}
              </text>
            ))}
            <text x={0} y={PROFILE_MARGIN.top - 10} textAnchor="start">
              m
            </text>
            <text x={PROFILE_MARGIN.left + plotW / 2} y={PROFILE_HEIGHT - 2} textAnchor="middle">
              Distance along the strip (m)
            </text>
          </g>
          {order.map((tree) => {
            const color = CHART_COLORS[tree.status]
            const crownLength = tree.heightMeters * 0.45
            const ry = (crownLength / 2) * sy
            const rx = Math.max(0.8, (tree.crownWidthMeters / 2) * sx)
            const cx = x(tree.along)
            const cy = y(tree.heightMeters) + ry
            const faded = tree.status === 'removed'
            return (
              <g key={tree.id} opacity={faded ? 0.6 : 0.9}>
                <title>{`${STATUS_LABELS[tree.status]} · ${oneDecimal.format(tree.heightMeters)} m tall, crown ${oneDecimal.format(tree.crownWidthMeters)} m · ${oneDecimal.format(tree.along)} m along`}</title>
                <line
                  x1={cx}
                  x2={cx}
                  y1={ground}
                  y2={y(tree.heightMeters)}
                  stroke={color}
                  strokeWidth={1.5}
                  strokeLinecap="round"
                />
                <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={color} fillOpacity={0.55} />
              </g>
            )
          })}
          <line
            x1={PROFILE_MARGIN.left}
            x2={PROFILE_WIDTH - PROFILE_MARGIN.right}
            y1={ground}
            y2={ground}
            stroke="currentColor"
            strokeWidth={1.5}
            className="text-muted-foreground"
          />
        </svg>
      )}
      <DataTable
        caption="Trees in the strip"
        head={['Status', 'Trees', 'Mean height (m)']}
        rows={statuses.map((status) => {
          const trees = profile.trees.filter((tree) => tree.status === status)
          const mean = trees.length ? trees.reduce((sum, tree) => sum + tree.heightMeters, 0) / trees.length : 0
          return [
            STATUS_LABELS[status],
            whole.format(profile.counts[status]),
            trees.length ? oneDecimal.format(mean) : '–',
          ]
        })}
      />
    </ChartFrame>
  )
}
