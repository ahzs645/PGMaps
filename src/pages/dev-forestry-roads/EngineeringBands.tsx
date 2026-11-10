import { useEffect, useMemo, useRef } from 'react'
import { SizedChart } from '@pgmaps/geo-toolkit/visualizations/react'
import { horizontalCurveSummary, verticalCurveSummary } from './engine'
import { horizontalCurveEvents } from './planAnnotations'
import { reviewRoadSight } from './sightDistance'
import type { Alignment, RoadAnalysis } from './types'

interface BandSpan {
  id: string
  start: number
  end: number
  label: string
  detail: string
  color: string
  invalid?: boolean
  /** Stronger inner span distinguishes the circular arc from its spiral transitions. */
  circularSpan?: { start: number; end: number }
}
interface BandRow {
  name: string
  spans: BandSpan[]
}
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const number = (value: number, digits = 1) => value.toLocaleString('en-CA', { maximumFractionDigits: digits })

export function profileGradeSpans(analysis: RoadAnalysis, alignment: Alignment, terrainOnly = false): BandSpan[] {
  const length = analysis.length
  const vertical = [...alignment.vertical].sort((a, b) => a.chainage - b.chainage)
  const designGrades = !terrainOnly && vertical.length > 0
  const cuts = designGrades
    ? [0, ...(vertical.length > 1 ? vertical.map((p) => p.chainage).filter((s) => s > 0 && s < length) : []), length]
    : Array.from({ length: 9 }, (_, i) => (length * i) / 8)
  const gradeSpans: BandSpan[] = cuts.slice(1).flatMap((end, i) => {
    const start = cuts[i]
    if (end - start < 0.001) return []
    let grade: number | null = null
    if (designGrades) {
      if (vertical.length === 1) grade = 0
      else {
        const midpoint = (start + end) / 2
        let index = 0
        while (index < vertical.length - 2 && vertical[index + 1].chainage <= midpoint) index++
        const a = vertical[index],
          b = vertical[index + 1]
        if (b.chainage > a.chainage) grade = (100 * (b.elevation - a.elevation)) / (b.chainage - a.chainage)
      }
    } else {
      const candidates = analysis.stations.filter((s) => s.chainage >= start - 0.001 && s.chainage <= end + 0.001)
      const groundAt = (target: number): number | null => {
        const exact = analysis.stations.find((s) => Math.abs(s.chainage - target) < 1e-7)
        if (exact) return finite(exact.groundElevation) ? exact.groundElevation : null
        for (let j = 1; j < analysis.stations.length; j++) {
          const a = analysis.stations[j - 1],
            b = analysis.stations[j]
          if (target >= a.chainage && target <= b.chainage && finite(a.groundElevation) && finite(b.groundElevation))
            return (
              a.groundElevation +
              ((b.groundElevation - a.groundElevation) * (target - a.chainage)) / (b.chainage - a.chainage)
            )
        }
        return null
      }
      const a = groundAt(start),
        b = groundAt(end)
      if (finite(a) && finite(b) && candidates.every((s) => finite(s.groundElevation)))
        grade = (100 * (b - a)) / (end - start)
    }
    const label = `${grade === null ? 'Unknown' : `${grade > 0 ? '+' : ''}${number(grade)}%`} · ${number(end - start)} m`
    return [
      {
        id: `grade-${i}`,
        start,
        end,
        label,
        detail: `${designGrades ? 'Design tangent' : 'Mean sampled ground grade'} ${label}; station ${number(start)}–${number(end)} m${designGrades ? (vertical.length === 1 ? '. A single vertical control defines constant formation.' : '. Vertical curves vary the grade near PVIs.') : '. Terrain gaps remain unknown.'}`,
        color: grade === null ? '#94a3b8' : '#0d9488',
      },
    ]
  })
  return gradeSpans
}

/** Known horizontal geometry remains inspectable when terrain is missing. */
export function profileHorizontalCurveSpans(
  analysis: RoadAnalysis,
  alignment: Alignment,
  terrainOnly = false,
): BandSpan[] {
  if (terrainOnly || !finite(analysis.length) || analysis.length <= 0) return []
  try {
    return horizontalCurveSummary(alignment)
      .map((curve, index) => {
        const events = horizontalCurveEvents(curve)
          .map((event) => `${event.label} ${number(event.chainage)} m`)
          .join('; ')
        const spiralled = curve.spiralInLengthM > 0 || curve.spiralOutLengthM > 0
        return {
          id: `horizontal-${index}`,
          start: Math.max(0, curve.fullStart),
          end: Math.min(analysis.length, curve.fullEnd),
          label: `H${index + 1} ${curve.direction === 'left' ? 'L' : 'R'} · R ${number(curve.radius)} · Δ ${number(curve.deflectionDegrees)}°`,
          detail: `H${index + 1}: ${curve.direction} turn; radius ${number(curve.radius)} m; full deflection ${number(curve.deflectionDegrees)}°; circular arc ${number(curve.length)} m; full curve ${number(curve.fullLength)} m. ${events}.${spiralled ? ` Entry/exit spirals ${number(curve.spiralInLengthM)}/${number(curve.spiralOutLengthM)} m; the darker span is the circular arc.` : ''}`,
          color: '#0369a1',
          ...(spiralled ? { circularSpan: { start: curve.start, end: curve.end } } : {}),
        }
      })
      .filter((span) => span.end > span.start)
  } catch {
    // Invalid intermediate geometry is reported by the workspace, not drawn as a fitted curve.
    return []
  }
}

/** What the sight band needs beyond the road: the project's design speed and station spacing. */
export interface SightBandInput {
  standards?: { designSpeedKmh: number | null } | null
  stationIntervalM?: number
}

/**
 * Stopping sight distance at each eye station, both ways (`sightDistance.ts`): short where the surface
 * or trees cut the view below what is needed, unknown where a sightline crosses missing terrain.
 */
export function sightSpans(analysis: RoadAnalysis, alignment: Alignment, input: SightBandInput): BandSpan[] {
  const review = reviewRoadSight({
    analysis,
    alignment,
    standards: input.standards,
    stationIntervalM: input.stationIntervalM,
  })
  if (review.status !== 'checked') return []
  const byStation = new Map<number, typeof review.eyes>()
  for (const eye of review.eyes) byStation.set(eye.chainage, [...(byStation.get(eye.chainage) ?? []), eye])
  const half = review.eyeSpacingM / 2
  return [...byStation].map(([chainage, eyes]) => {
    const short = eyes.filter((eye) => review.short.includes(eye)),
      unknown = eyes.filter((eye) => review.unknown.includes(eye))
    const state = short.length ? 'short' : unknown.length ? 'unknown' : 'clear'
    const text = eyes
      .map(
        (eye) =>
          `${eye.direction} ${eye.limitedBy === 'unknown' ? 'unknown' : `${eye.limitedBy === 'clear' ? '≥ ' : ''}${number(eye.availableM, 0)} m`} of ${eye.requiredM === null ? 'unknown' : `${number(eye.requiredM, 0)} m`}${eye.limitedBy === 'clear' ? '' : ` (${eye.limitedBy})`}`,
      )
      .join('; ')
    return {
      id: `sight-${chainage}`,
      start: Math.max(0, chainage - half),
      end: Math.min(analysis.length, chainage + half),
      label: state === 'short' ? 'Short' : state === 'unknown' ? '?' : '',
      detail: `Sight distance at ${number(chainage)} m: ${text}. Measured along the road.`,
      color: state === 'short' ? '#dc2626' : state === 'unknown' ? '#94a3b8' : '#16a34a',
      invalid: state === 'short',
    }
  })
}

/** Explicit design ranges and sampled terrain spans share the profile's horizontal scale. */
function rowsFor(
  analysis: RoadAnalysis,
  alignment: Alignment,
  terrainOnly: boolean,
  sight?: SightBandInput,
): BandRow[] {
  const length = analysis.length
  const rows: BandRow[] = [
    {
      name: !terrainOnly && alignment.vertical.length > 0 ? 'Tangent' : 'Ground',
      spans: profileGradeSpans(analysis, alignment, terrainOnly),
    },
  ]
  if (terrainOnly) return rows
  const horizontal = profileHorizontalCurveSpans(analysis, alignment)
  if (horizontal.length) rows.push({ name: 'H curve', spans: horizontal })
  const curves = (() => {
    try {
      return verticalCurveSummary(alignment)
    } catch {
      return []
    }
  })()
  if (curves.length)
    rows.push({
      name: 'V curve',
      spans: curves
        .map((curve) => ({
          id: curve.pviId,
          start: Math.max(0, curve.start),
          end: Math.min(length, curve.end),
          label: `${curve.valid ? 'VC' : 'Unfitted'} ${number(curve.length, 0)} m${curve.k === null ? '' : ` · K ${number(curve.k)}`}`,
          detail: `${curve.valid ? 'Fitted vertical curve' : 'Requested curve not fitted; tangent grades retained'} at ${number(curve.chainage)} m. Length ${number(curve.length)} m; grades ${curve.g1 === null ? 'unknown' : number(curve.g1)}% to ${curve.g2 === null ? 'unknown' : number(curve.g2)}%; K ${curve.k === null ? 'undefined (equal or unavailable grades)' : number(curve.k) + ' m/%'}.`,
          color: curve.valid ? '#7c3aed' : '#dc2626',
          invalid: !curve.valid,
        }))
        .filter((span) => span.end >= span.start),
    })
  const engineering = alignment.engineering
  if (engineering?.assignments.length) {
    for (const side of ['left', 'right'] as const)
      rows.push({
        name: side === 'left' ? 'Tpl L' : 'Tpl R',
        spans: engineering.assignments
          .filter((a) => a.side === side || a.side === 'both')
          .map((a) => {
            const name = engineering.templates.find((t) => t.id === a.templateId)?.name ?? 'Missing template'
            return {
              id: a.id,
              start: a.start,
              end: a.end,
              label: name,
              detail: `${side} template ${name}: ${number(a.start)}–${number(a.end)} m; transition ${number(a.transitionM)} m. Unassigned ranges use the base section.`,
              color: '#0f766e',
            }
          }),
      })
  } else
    rows.push({
      name: 'Template',
      spans: [
        {
          id: 'base',
          start: 0,
          end: length,
          label: 'Base section',
          detail: 'The base cross-section is used along the road, with any listed widening added.',
          color: '#0f766e',
        },
      ],
    })
  if (alignment.overrides.length)
    rows.push({
      name: 'Widen',
      spans: alignment.overrides.map((w) => ({
        id: w.id,
        start: w.start,
        end: w.end,
        label: `${w.name} · ${w.side}`,
        detail: `${w.kind}: ${w.side}, +${number(w.extraWidth)} m, ${number(w.start)}–${number(w.end)} m, ${number(w.taper)} m tapers. ${w.kind === 'landing' ? 'Added landing width is unsurfaced.' : 'Turnout is surfaced.'}`,
        color: w.kind === 'landing' ? '#a16207' : '#2563eb',
      })),
    })
  if (engineering?.strata.length) {
    const depths = [...new Set(engineering.strata.map((layer) => layer.topDepthM))].sort((a, b) => a - b)
    for (const depth of depths)
      rows.push({
        name: `Gnd ${number(depth)}m`,
        spans: engineering.strata
          .filter((s) => s.topDepthM === depth)
          .map((s) => {
            const material = engineering.materials.find((m) => m.id === s.materialId)
            const label = material?.name ?? 'Missing material'
            return {
              id: s.id,
              start: s.start,
              end: s.end,
              label,
              detail: `User-entered ${label}: ${number(s.topDepthM)} m to ${s.bottomDepthM === null ? 'unbounded depth' : `${number(s.bottomDepthM)} m`} below original ground; station ${number(s.start)}–${number(s.end)} m. Not inferred from LiDAR.`,
              color: material?.color ?? '#94a3b8',
            }
          }),
      })
  }
  if (sight) {
    const spans = sightSpans(analysis, alignment, sight)
    if (spans.length) rows.push({ name: 'Sight', spans })
  }
  if (analysis.engineering?.culverts.length)
    rows.push({
      name: 'Drainage',
      spans: analysis.engineering.culverts.map((c) => {
        const design = engineering?.culverts.find((d) => d.id === c.id)
        return {
          id: c.id,
          start: c.chainage,
          end: c.chainage,
          label: c.name,
          detail: `${c.name} at ${number(c.chainage)} m${design ? `; diameter ${number(design.diameterM * 1000, 0)} mm` : ''}; cover ${c.coverM === null ? 'unknown' : `${number(c.coverM)} m`}. ${c.warnings.join(' ')}`,
          color: c.warnings.length ? '#dc2626' : '#0284c7',
          invalid: c.warnings.length > 0,
        }
      }),
    })
  return rows
}
export function EngineeringBands({
  analysis,
  alignment,
  station,
  onStation,
  terrainOnly = false,
  range,
  sight,
}: {
  analysis: RoadAnalysis
  alignment: Alignment
  station: number
  onStation: (station: number) => void
  terrainOnly?: boolean
  range?: [number, number]
  /** Adds the stopping sight distance row; absent leaves it out. */
  sight?: SightBandInput
}) {
  const drag = useRef<{
    pointerId: number
    start: number
    end: number
    plotLeft: number
    plotWidth: number
  } | null>(null)
  // A hidden/replaced band cannot retain a gesture from its previous SVG.
  useEffect(
    () => () => {
      drag.current = null
    },
    [alignment.id],
  )
  const inspectPointer = (pointerId: number, clientX: number) => {
    const active = drag.current
    if (!active || active.pointerId !== pointerId) return
    onStation(
      Math.max(
        active.start,
        Math.min(
          active.end,
          active.start + ((clientX - active.plotLeft) / active.plotWidth) * (active.end - active.start),
        ),
      ),
    )
  }
  const rows = useMemo(
    () => rowsFor(analysis, alignment, terrainOnly, sight),
    [analysis, alignment, terrainOnly, sight],
  )
  const start = range?.[0] ?? 0,
    end = range?.[1] ?? Math.max(1, analysis.length)
  if (analysis.length <= 0) return null
  return (
    // The chart's header toggle mounts this; it has no fold of its own.
    <div data-testid="road-engineering-bands" data-range-start={start} data-range-end={end}>
      {/* No scroller of its own: the chart's band area scrolls, and a second scrollbar here narrowed
          these bands and put their stations left of the profile's. */}
      <div>
        <SizedChart height={rows.length * 22}>
          {(width) => {
            const left = width < 380 ? 48 : 58,
              right = 16
            const x = (value: number) =>
              left + Math.max(0, Math.min(1, (value - start) / (end - start))) * Math.max(1, width - left - right)
            return (
              <svg
                width={width}
                height={rows.length * 22}
                role="group"
                tabIndex={0}
                aria-label="Connected profile data bands; click or drag to inspect a station"
                className="cursor-ew-resize select-none touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onPointerDown={(event) => {
                  if (event.button !== 0 || !event.isPrimary || drag.current) return
                  event.preventDefault()
                  const box = event.currentTarget.getBoundingClientRect()
                  // Keep the displayed station domain fixed throughout the gesture, even
                  // while its live shared station causes the connected views to render.
                  drag.current = {
                    pointerId: event.pointerId,
                    start,
                    end,
                    plotLeft: box.left + (left / width) * box.width,
                    plotWidth: Math.max(1, ((width - left - right) / width) * box.width),
                  }
                  event.currentTarget.setPointerCapture(event.pointerId)
                  event.currentTarget.focus({ preventScroll: true })
                  inspectPointer(event.pointerId, event.clientX)
                }}
                onPointerMove={(event) => {
                  if (drag.current?.pointerId !== event.pointerId) return
                  event.preventDefault()
                  inspectPointer(event.pointerId, event.clientX)
                }}
                onPointerUp={(event) => {
                  if (drag.current?.pointerId !== event.pointerId) return
                  inspectPointer(event.pointerId, event.clientX)
                  drag.current = null
                  if (event.currentTarget.hasPointerCapture(event.pointerId))
                    event.currentTarget.releasePointerCapture(event.pointerId)
                }}
                onPointerCancel={(event) => {
                  if (drag.current?.pointerId !== event.pointerId) return
                  drag.current = null
                  if (event.currentTarget.hasPointerCapture(event.pointerId))
                    event.currentTarget.releasePointerCapture(event.pointerId)
                }}
                onLostPointerCapture={(event) => {
                  if (drag.current?.pointerId === event.pointerId) drag.current = null
                }}
                onKeyDown={(event) => {
                  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                  event.preventDefault()
                  onStation(
                    event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? analysis.length
                        : Math.max(0, Math.min(analysis.length, station + (event.key === 'ArrowRight' ? 10 : -10))),
                  )
                }}
              >
                {rows.map((row, index) => (
                  <g key={row.name}>
                    <text x={3} y={index * 22 + 14} fontSize="9" fill="hsl(var(--muted-foreground))">
                      {row.name}
                    </text>
                    <rect
                      x={left}
                      y={index * 22 + 2}
                      width={width - left - right}
                      height={18}
                      fill="hsl(var(--muted))"
                    />
                    {row.spans
                      .filter((s) => s.end >= start && s.start <= end)
                      .map((span) => {
                        const spanWidth = Math.max(2, x(span.end) - x(span.start))
                        const selected = station >= span.start && station <= span.end
                        return (
                          <g key={span.id}>
                            <rect
                              x={x(span.start) - (spanWidth <= 2 ? 2 : 0)}
                              y={index * 22 + 2}
                              width={spanWidth <= 2 ? 4 : spanWidth}
                              height={18}
                              fill={span.color}
                              opacity={selected ? 0.37 : 0.19}
                              stroke={span.invalid ? span.color : 'hsl(var(--background))'}
                              strokeDasharray={span.invalid ? '3 2' : undefined}
                            />
                            {span.circularSpan && span.circularSpan.end >= start && span.circularSpan.start <= end && (
                              <rect
                                x={x(span.circularSpan.start)}
                                y={index * 22 + 2}
                                width={Math.max(0, x(span.circularSpan.end) - x(span.circularSpan.start))}
                                height={18}
                                fill={span.color}
                                opacity={selected ? 0.3 : 0.18}
                              />
                            )}
                            {spanWidth > span.label.length * 5 + 8 && (
                              <text
                                x={x(span.start) + spanWidth / 2}
                                y={index * 22 + 14}
                                fontSize="9"
                                textAnchor="middle"
                                fill="hsl(var(--foreground))"
                                pointerEvents="none"
                              >
                                {span.label}
                              </text>
                            )}
                            <title>{span.detail}</title>
                          </g>
                        )
                      })}
                  </g>
                ))}
                {station >= start && station <= end && (
                  <line
                    x1={x(station)}
                    x2={x(station)}
                    y1={0}
                    y2={rows.length * 22}
                    stroke="#e11d48"
                    strokeWidth={1.4}
                    pointerEvents="none"
                  />
                )}
              </svg>
            )
          }}
        </SizedChart>
      </div>
    </div>
  )
}
