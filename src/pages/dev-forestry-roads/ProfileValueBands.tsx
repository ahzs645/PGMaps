import { useMemo, useState, type KeyboardEvent } from 'react'
import { SizedChart } from '@pgmaps/geo-toolkit/visualizations/react'
import {
  BAND_VALUE_MIN_GAP_PX,
  bandTextWidth,
  bandValueAnchor,
  profileValueBands,
  superelevationDiagram,
  type BandValue,
} from './profileBands'
import { roadSidehill, SIDEHILL_CLASSES, type SidehillClass } from './sectionSideSlope'
import { formatStation } from './verticalStandards'
import type { Alignment, RoadAnalysis } from './types'

/** Height of one numeric row and of the curvature diagram, in pixels. */
const ROW_PX = 16
const CURVATURE_PX = 30
/** The superelevation diagram: both edges' crossfall about the centreline. */
const SUPER_PX = 34
/** The profile chart's plot margins (`chartFrame`, `Charts.tsx`), so values sit under their stations. */
const plotLeft = (width: number) => (width < 380 ? 48 : 58)
const PLOT_RIGHT = 16
/**
 * Three rows (ground, ground grade, sidehill) on a terrain profile; seven and the curvature diagram on
 * a road.
 */
const bandsHeight = (terrainOnly: boolean) => (terrainOnly ? 3 * ROW_PX : 7 * ROW_PX + CURVATURE_PX + SUPER_PX) + 2

/** The sidehill strip's fill by class: none on gentle ground, rising tints, then amber and red. */
const SIDEHILL_FILL: Record<SidehillClass, string | null> = {
  gentle: null,
  moderate: 'hsl(var(--foreground) / 0.07)',
  steep: 'hsl(var(--foreground) / 0.16)',
  'past-appraisal': 'hsl(var(--warning) / 0.3)',
  'full-bench': 'hsl(var(--destructive) / 0.3)',
}

const TONE_FILL: Record<NonNullable<BandValue['tone']>, string> = {
  cut: '#d97706',
  fill: '#3b82f6',
  unknown: 'hsl(var(--muted-foreground))',
  super: 'hsl(var(--foreground))',
  appraisal: 'hsl(var(--warning))',
  bench: 'hsl(var(--destructive))',
}

/**
 * Remembers a yes/no choice in this browser under `key`. Private windows can refuse storage; the
 * choice then holds for the session.
 */
export function useStoredFlag(key: string, initial = false): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState(() => {
    try {
      const saved = localStorage.getItem(key)
      return saved === null ? initial : saved === '1'
    } catch {
      return initial
    }
  })
  return [
    value,
    (next: boolean) => {
      setValue(next)
      try {
        localStorage.setItem(key, next ? '1' : '0')
      } catch {
        // Storage refused: the choice still holds until the page reloads.
      }
    },
  ]
}

/**
 * Ground, design, cut/fill, grade and crossfall values at calculated stations, with a curvature
 * diagram, lined up under the profile's plot over the same station window. Values thin with zoom so
 * they never overlap; click a value or use the arrow keys to select its station.
 */
export function ProfileValueBands({
  analysis,
  alignment,
  start,
  end,
  station,
  onStation,
  terrainOnly = false,
}: {
  analysis: RoadAnalysis
  alignment: Alignment
  start: number
  end: number
  station: number
  onStation: (chainage: number) => void
  terrainOnly?: boolean
}) {
  if (!(analysis.length > 0) || !(end > start)) return null
  return (
    <div data-testid="road-profile-value-bands" data-range-start={start} data-range-end={end}>
      <SizedChart height={bandsHeight(terrainOnly)}>
        {(width) => (
          <ValueBandsSvg
            width={width}
            analysis={analysis}
            alignment={alignment}
            start={start}
            end={end}
            station={station}
            onStation={onStation}
            terrainOnly={terrainOnly}
          />
        )}
      </SizedChart>
    </div>
  )
}

function ValueBandsSvg({
  width,
  analysis,
  alignment,
  start,
  end,
  station,
  onStation,
  terrainOnly,
}: {
  width: number
  analysis: RoadAnalysis
  alignment: Alignment
  start: number
  end: number
  station: number
  onStation: (chainage: number) => void
  terrainOnly: boolean
}) {
  const left = plotLeft(width)
  const plotWidth = Math.max(1, width - left - PLOT_RIGHT)
  const metresPerPx = (end - start) / plotWidth
  // Round the spacing to whole pixels' worth of metres so a resize by a pixel does not reshuffle values.
  const minSpacingM = Number((BAND_VALUE_MIN_GAP_PX * metresPerPx).toPrecision(2))
  // Every station's sidehill once per analysis; panning and zooming only re-window it.
  const sidehill = useMemo(() => roadSidehill(analysis.stations), [analysis.stations])
  const bands = useMemo(
    () => profileValueBands(analysis, alignment, { start, end, minSpacingM, terrainOnly, sidehill }),
    [analysis, alignment, start, end, minSpacingM, terrainOnly, sidehill],
  )
  const x = (chainage: number) => left + ((chainage - start) / Math.max(1e-9, end - start)) * plotWidth
  const showCurvature = !terrainOnly
  const height = bandsHeight(terrainOnly)
  const chainages = bands.stations.map((s) => s.chainage)
  const step = (event: KeyboardEvent<SVGSVGElement>) => {
    const forward = event.key === 'ArrowRight',
      back = event.key === 'ArrowLeft'
    if (!forward && !back) return
    event.preventDefault()
    const next = forward
      ? chainages.find((c) => c > station + 1e-6)
      : [...chainages].reverse().find((c) => c < station - 1e-6)
    if (next !== undefined) onStation(next)
  }
  const superelevation = useMemo(
    () => (terrainOnly ? [] : superelevationDiagram(analysis, alignment, start, end)),
    [analysis, alignment, start, end, terrainOnly],
  )
  const curveTop = bands.rows.length * ROW_PX + 1
  const superTop = curveTop + CURVATURE_PX
  const superMid = superTop + SUPER_PX / 2 - 1
  const superMax = Math.max(2, ...superelevation.flatMap((v) => [Math.abs(v.left ?? 0), Math.abs(v.right ?? 0)]))
  const superScale = (SUPER_PX / 2 - 4) / superMax
  // Edge rise relative to the centreline: crossfall is positive falling away, so the edge sits below.
  const superPath = (side: 'left' | 'right') => {
    let pen = false
    return superelevation
      .map((v) => {
        const value = v[side]
        if (value === null) {
          pen = false
          return ''
        }
        const command = pen ? 'L' : 'M'
        pen = true
        return `${command}${x(v.chainage).toFixed(1)},${(superMid + value * superScale).toFixed(1)}`
      })
      .join(' ')
  }
  const zeroY = curveTop + CURVATURE_PX / 2
  const scale = bands.maxCurvaturePerKm > 0 ? (CURVATURE_PX / 2 - 3) / bands.maxCurvaturePerKm : 0
  return (
    <svg
      width={width}
      height={height}
      role="group"
      tabIndex={0}
      aria-label={`Profile value bands at ${bands.stations.length} stations: ${bands.rows.map((r) => r.title).join(', ')}${showCurvature ? ', curvature' : ''}. Left and right arrows step between labelled stations.`}
      className="select-none outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onKeyDown={step}
    >
      {bands.rows.map((row, index) => {
        const y = index * ROW_PX
        return (
          <g key={row.key} data-band={row.key}>
            <rect x={left} y={y + 1} width={plotWidth} height={ROW_PX - 2} fill="hsl(var(--muted))" opacity={0.5} />
            {row.key === 'sidehill' &&
              bands.sidehillSpans.map((span) => {
                const fill = span.sidehillClass && SIDEHILL_FILL[span.sidehillClass]
                if (!fill) return null
                const label = SIDEHILL_CLASSES.find((c) => c.id === span.sidehillClass)!.label
                return (
                  <rect
                    key={span.start}
                    x={x(span.start)}
                    y={y + 1}
                    width={Math.max(1, x(span.end) - x(span.start))}
                    height={ROW_PX - 2}
                    fill={fill}
                    data-sidehill-class={span.sidehillClass}
                  >
                    <title>
                      Sidehill {label}: {formatStation(span.start)}–{formatStation(span.end)}
                    </title>
                  </rect>
                )
              })}
            <text x={3} y={y + 11} fontSize="9" fill="hsl(var(--muted-foreground))">
              {row.title}
              <title>{row.detail}</title>
            </text>
            {row.values.map((value) => {
              const at = bandValueAnchor(x(value.chainage), bandTextWidth(value.text, 9), left, left + plotWidth)
              return (
                <text
                  key={value.chainage}
                  x={at.x}
                  y={y + 11}
                  fontSize="9"
                  textAnchor={at.anchor}
                  className="cursor-pointer tabular-nums"
                  fill={value.tone ? TONE_FILL[value.tone] : 'hsl(var(--foreground))'}
                  fontWeight={value.tone === 'super' ? 700 : undefined}
                  data-band-value={value.value === null ? 'unknown' : value.value}
                  data-station={value.chainage}
                  onPointerDown={(event) => {
                    event.preventDefault()
                    onStation(value.chainage)
                  }}
                >
                  {value.text}
                  <title>
                    {row.title} at {formatStation(value.chainage)}: {value.value === null ? 'unknown' : value.text}
                  </title>
                </text>
              )
            })}
          </g>
        )
      })}
      {showCurvature && (
        <g data-band="curvature">
          <rect
            x={left}
            y={curveTop}
            width={plotWidth}
            height={CURVATURE_PX - 2}
            fill="hsl(var(--muted))"
            opacity={0.5}
          />
          <text x={3} y={curveTop + 11} fontSize="9" fill="hsl(var(--muted-foreground))">
            Curvature
            <title>Horizontal curvature, 1/R: right turns above the line, left turns below; spirals ramp.</title>
          </text>
          <line x1={left} x2={left + plotWidth} y1={zeroY} y2={zeroY} stroke="hsl(var(--border))" />
          {bands.curvature.length > 1 && (
            <path
              d={bands.curvature
                .map((v, i) => `${i ? 'L' : 'M'}${x(v.chainage).toFixed(1)},${(zeroY - v.perKm * scale).toFixed(1)}`)
                .join(' ')}
              fill="none"
              stroke="#0369a1"
              strokeWidth={1.4}
            />
          )}
          {bands.curvatureLabels
            .filter((label) => x(label.end) - x(label.start) > label.text.length * 5 + 6)
            .map((label) => (
              <text
                key={`${label.start}-${label.end}`}
                x={x(label.chainage)}
                y={label.direction === 'right' ? zeroY + 10 : zeroY - 4}
                fontSize="8.5"
                textAnchor="middle"
                fill="#0369a1"
                stroke="hsl(var(--background))"
                strokeWidth={2.5}
                paintOrder="stroke"
                pointerEvents="none"
              >
                {label.text}
              </text>
            ))}
        </g>
      )}
      {showCurvature && (
        <g data-band="superelevation">
          <rect x={left} y={superTop} width={plotWidth} height={SUPER_PX - 2} fill="hsl(var(--muted))" opacity={0.5} />
          {superelevation.map((v, i) => {
            const next = superelevation[i + 1]
            if (!v.superelevated || !next) return null
            return (
              <rect
                key={v.chainage}
                x={x(v.chainage)}
                y={superTop}
                width={Math.max(0.5, x(next.chainage) - x(v.chainage))}
                height={SUPER_PX - 2}
                fill="#7c3aed"
                opacity={0.08}
              />
            )
          })}
          <text x={3} y={superTop + 11} fontSize="9" fill="hsl(var(--muted-foreground))">
            Super e
            <title>
              Superelevation diagram: each edge of the running surface relative to the centreline, from its crossfall
              (%). Solid left edge, dashed right edge; tinted where the curve is superelevated. Scale ±
              {Math.round(superMax)}%.
            </title>
          </text>
          <line x1={left} x2={left + plotWidth} y1={superMid} y2={superMid} stroke="hsl(var(--border))" />
          <path d={superPath('left')} fill="none" stroke="#7c3aed" strokeWidth={1.3} />
          <path d={superPath('right')} fill="none" stroke="#7c3aed" strokeWidth={1.3} strokeDasharray="3 2" />
          <text x={left + plotWidth - 2} y={superTop + 9} fontSize="8" textAnchor="end" fill="#7c3aed">
            L — · R - -
          </text>
        </g>
      )}
      {station >= start && station <= end && (
        <line
          x1={x(station)}
          x2={x(station)}
          y1={0}
          y2={height}
          stroke="#e11d48"
          strokeWidth={1.2}
          opacity={0.7}
          pointerEvents="none"
        />
      )}
    </svg>
  )
}
