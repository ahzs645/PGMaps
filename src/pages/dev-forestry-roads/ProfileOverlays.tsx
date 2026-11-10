import type { KeyboardEvent } from 'react'
import {
  curvePointDetail,
  curvePointLabel,
  curvePointPriority,
  earthworkText,
  isGradeTrouble,
  placeLabels,
  signedValue,
  type CurvePoint,
  type PviDragReadout,
  type TangentEarthwork,
  type TangentGrade,
} from './profileAnnotations'
import { CURSOR_LINES_BELOW_PX, cursorOnLeft } from './ProfileEditing'
import { formatStation } from './verticalStandards'
import type { RoadStation } from './types'

/** Where the profile's plot sits: station and elevation to pixels, and the plot's edges. */
export interface ProfilePlotFrame {
  x: (chainage: number) => number
  y: (elevation: number) => number
  top: number
  /** Pixel y of the plot's bottom edge. */
  bottom: number
  left: number
  /** Pixel x of the plot's right edge. */
  right: number
}

export const GRADE_TROUBLE_COLOR = '#dc2626'
const SHORT_PITCH_COLOR = '#ca8a04'
// The profile's cut and fill colours (`ROAD_CHART_COLORS`, `Charts.tsx`).
const CUT_COLOR = '#d97706'
const FILL_COLOR = '#3b82f6'
/** Rotated labels need this much room across the station axis. */
const ROTATED_LABEL_GAP_PX = 13
/** Markers closer than this on screen are thinned, highest priority kept. */
const MARKER_GAP_PX = 5
const CHAR_PX = 4.9

const finite = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value)
const signedPct = (value: number | null) => (value === null ? '—' : signedValue(value, 1))
const inView = (chainage: number, domain: readonly [number, number]) =>
  chainage >= domain[0] - 1e-6 && chainage <= domain[1] + 1e-6

/** The design line drawn over each tangent that breaks a grade limit, red; an allowed short pitch amber. */
export function ProfileGradeTrouble({
  tangents,
  stations,
  frame,
  domain,
}: {
  tangents: readonly TangentGrade[]
  stations: readonly RoadStation[]
  frame: ProfilePlotFrame
  domain: readonly [number, number]
}) {
  const flagged = tangents.filter((t) => t.verdict !== 'ok' && t.end >= domain[0] - 1e-6 && t.start <= domain[1] + 1e-6)
  if (!flagged.length) return null
  return (
    <g pointerEvents="none" data-testid="road-profile-grade-trouble">
      {flagged.map((tangent) => {
        let pen = false
        const d = stations
          .filter((s) => s.chainage >= tangent.start - 1e-6 && s.chainage <= tangent.end + 1e-6)
          .map((s) => {
            if (!finite(s.designElevation)) {
              pen = false
              return ''
            }
            const out = `${pen ? 'L' : 'M'}${frame.x(s.chainage).toFixed(1)},${frame.y(s.designElevation).toFixed(1)}`
            pen = true
            return out
          })
          .join(' ')
        if (!d.trim()) return null
        const trouble = isGradeTrouble(tangent)
        return (
          <path
            key={tangent.id}
            d={d}
            fill="none"
            stroke={trouble ? GRADE_TROUBLE_COLOR : SHORT_PITCH_COLOR}
            strokeWidth={3.6}
            strokeDasharray={trouble ? undefined : '6 3'}
            opacity={0.85}
            data-grade-verdict={tangent.verdict}
          >
            <title>{tangent.message}</title>
          </path>
        )
      })}
    </g>
  )
}

/**
 * BVC and EVC ticks, crest high (▲) and sag low (▼) points on the design line, each with a rotated
 * "name station · elevation" label. A sag with no culvert near it is red and says so. Labels thin
 * with zoom (a flagged sag first, curve ends last) so none overlaps; every marker's tooltip keeps the
 * full text. High and low points are buttons that select their station.
 */
export function ProfileCurvePoints({
  points,
  frame,
  domain,
  onStation,
}: {
  points: readonly CurvePoint[]
  frame: ProfilePlotFrame
  domain: readonly [number, number]
  onStation: (chainage: number) => void
}) {
  const visible = points.filter((p) => inView(p.chainage, domain))
  if (!visible.length) return null
  const items = visible.map((point) => ({
    point,
    x: frame.x(point.chainage),
    y: frame.y(point.elevation),
    priority: curvePointPriority(point),
  }))
  const markers = placeLabels(items, MARKER_GAP_PX)
  const labelled = new Set(placeLabels(markers, ROTATED_LABEL_GAP_PX).map((item) => item.point.id))
  const select = (event: KeyboardEvent<SVGGElement>, chainage: number) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    event.stopPropagation()
    onStation(chainage)
  }
  return (
    <g data-testid="road-profile-curve-points">
      {markers.map(({ point, x, y }) => {
        const color = point.noCulvert
          ? GRADE_TROUBLE_COLOR
          : point.kind === 'bvc' || point.kind === 'evc'
            ? '#7c3aed'
            : '#0f766e'
        const text = curvePointLabel(point)
        const length = text.length * CHAR_PX
        // Above the line when the label fits under the plot's top, else below it.
        const above = y - 9 - length >= frame.top
        const labelY = above ? y - 9 : y + 9
        const interactive = point.kind === 'high' || point.kind === 'low'
        return (
          <g
            key={point.id}
            data-curve-point={point.kind}
            data-no-culvert={point.noCulvert || undefined}
            {...(interactive
              ? {
                  role: 'button',
                  tabIndex: 0,
                  'aria-label': curvePointDetail(point),
                  className: 'cursor-pointer outline-none focus-visible:[&>path]:stroke-[3]',
                  onPointerDown: (event: { stopPropagation: () => void }) => {
                    event.stopPropagation()
                    onStation(point.chainage)
                  },
                  onKeyDown: (event: KeyboardEvent<SVGGElement>) => select(event, point.chainage),
                }
              : { pointerEvents: 'none' })}
          >
            {interactive ? (
              <path
                d={
                  point.kind === 'high'
                    ? `M${x - 5},${y + 1} L${x + 5},${y + 1} L${x},${y - 7} Z`
                    : `M${x - 5},${y - 1} L${x + 5},${y - 1} L${x},${y + 7} Z`
                }
                fill={color}
                stroke="hsl(var(--background))"
                strokeWidth={1}
              />
            ) : (
              <line x1={x} x2={x} y1={y - 5} y2={y + 5} stroke={color} strokeWidth={1.6} />
            )}
            {labelled.has(point.id) && (
              <text
                x={x + 3}
                y={labelY}
                transform={`rotate(-90 ${(x + 3).toFixed(1)} ${labelY.toFixed(1)})`}
                textAnchor={above ? 'start' : 'end'}
                fontSize="8.5"
                fill={color}
                stroke="hsl(var(--background))"
                strokeWidth={2.5}
                paintOrder="stroke"
                pointerEvents="none"
                data-curve-point-label
              >
                {text}
              </text>
            )}
            <title>{curvePointDetail(point)}</title>
          </g>
        )
      })}
    </g>
  )
}

function EarthworkMarks({
  tangent,
  stations,
  frame,
}: {
  tangent: TangentEarthwork | null
  stations: readonly RoadStation[]
  frame: ProfilePlotFrame
}) {
  if (!tangent) return null
  return (
    <>
      {(['cut', 'fill'] as const).map((which) => {
        const deepest = which === 'cut' ? tangent.deepestCut : tangent.deepestFill
        const station = deepest && stations.find((s) => Math.abs(s.chainage - deepest.chainage) < 1e-6)
        if (!deepest || !station || !finite(station.groundElevation) || !finite(station.designElevation)) return null
        const x = frame.x(deepest.chainage),
          y1 = frame.y(station.groundElevation),
          y2 = frame.y(station.designElevation)
        const color = which === 'cut' ? CUT_COLOR : FILL_COLOR
        return (
          <g key={which} data-deepest={which}>
            <line x1={x} x2={x} y1={y1} y2={y2} stroke={color} strokeWidth={2.4} />
            <text
              x={x + 3}
              y={(y1 + y2) / 2 + 3}
              fontSize="9"
              fontWeight={600}
              fill={color}
              stroke="hsl(var(--background))"
              strokeWidth={2.5}
              paintOrder="stroke"
            >
              {which === 'cut' ? 'C' : 'F'} {deepest.depthM.toFixed(2)}
            </text>
          </g>
        )
      })}
    </>
  )
}

/**
 * While a PVI is dragged: a box at the handle with the PVI's station and elevation, the grade in and
 * out (red when that tangent breaks a limit), and the deepest centreline cut and fill on the tangent
 * each side, which are also marked on the profile.
 */
/**
 * Where the dragged PVI's readout box goes: above the handle; else below the drag cursor's own lines
 * ("Grade in +7.00 % · snapped", held reasons), which sit under the handle; else beside the handle on
 * the side away from those lines. Clamped into the plot only when none fits. Before, a PVI near the top
 * of the plot pushed the box down over the snapped-grade line.
 */
export function pviReadoutBoxAt(
  hx: number,
  hy: number,
  width: number,
  height: number,
  frame: Pick<ProfilePlotFrame, 'top' | 'bottom' | 'left' | 'right'>,
): { x: number; y: number } {
  const fitsX = (x: number) => x >= frame.left + 2 && x + width <= frame.right - 2
  const fitsY = (y: number) => y >= frame.top + 2 && y + height <= frame.bottom - 2
  const sideX = fitsX(hx + 12) ? hx + 12 : hx - 12 - width
  const above = hy - height - 10
  if (fitsY(above) && fitsX(sideX)) return { x: sideX, y: above }
  const below = hy + CURSOR_LINES_BELOW_PX
  if (fitsY(below) && fitsX(sideX)) return { x: sideX, y: below }
  const away = cursorOnLeft(hx, frame.right) ? hx + 12 : hx - 12 - width
  const middle = Math.min(Math.max(frame.top + 2, hy - height / 2), frame.bottom - height - 2)
  if (fitsX(away)) return { x: away, y: middle }
  return {
    x: Math.max(frame.left + 2, sideX),
    y: Math.min(Math.max(frame.top + 2, above), frame.bottom - height - 2),
  }
}

export function PviDragReadoutBox({
  readout,
  tangents,
  stations,
  frame,
}: {
  readout: PviDragReadout
  tangents: readonly TangentGrade[]
  stations: readonly RoadStation[]
  frame: ProfilePlotFrame
}) {
  const verdictOf = (chainage: number) => tangents.find((t) => chainage > t.start && chainage < t.end)
  const back = verdictOf(readout.chainage - 0.01),
    ahead = verdictOf(readout.chainage + 0.01)
  const lines: Array<{ text: string; color?: string; title?: string }> = [
    { text: `PVI ${formatStation(readout.chainage)} · ${readout.elevation.toFixed(2)} m` },
    {
      text: `In ${signedPct(readout.gradeInPercent)}`,
      color: back && isGradeTrouble(back) ? GRADE_TROUBLE_COLOR : undefined,
      title: back?.message,
    },
    {
      text: `Out ${signedPct(readout.gradeOutPercent)}`,
      color: ahead && isGradeTrouble(ahead) ? GRADE_TROUBLE_COLOR : undefined,
      title: ahead?.message,
    },
    ...(readout.back
      ? [{ text: `Back ${earthworkText(readout.back, 'cut')} · ${earthworkText(readout.back, 'fill')}` }]
      : []),
    ...(readout.ahead
      ? [{ text: `Ahead ${earthworkText(readout.ahead, 'cut')} · ${earthworkText(readout.ahead, 'fill')}` }]
      : []),
  ]
  const boxWidth = Math.max(...lines.map((line) => line.text.length)) * 5.2 + 12
  const boxHeight = lines.length * 12 + 6
  const { x, y } = pviReadoutBoxAt(frame.x(readout.chainage), frame.y(readout.elevation), boxWidth, boxHeight, frame)
  return (
    <g pointerEvents="none" data-testid="road-profile-pvi-readout">
      <EarthworkMarks tangent={readout.back} stations={stations} frame={frame} />
      <EarthworkMarks tangent={readout.ahead} stations={stations} frame={frame} />
      <rect
        x={x}
        y={y}
        width={boxWidth}
        height={boxHeight}
        rx={3}
        fill="hsl(var(--background))"
        fillOpacity={0.94}
        stroke="hsl(var(--border))"
      />
      {lines.map((line, i) => (
        <text
          key={i}
          x={x + 6}
          y={y + 13 + i * 12}
          fontSize="9.5"
          fontWeight={i === 0 ? 600 : undefined}
          className="tabular-nums"
          fill={line.color ?? 'hsl(var(--foreground))'}
        >
          {line.text}
          {line.title && <title>{line.title}</title>}
        </text>
      ))}
    </g>
  )
}
