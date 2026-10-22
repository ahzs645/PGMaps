import { useState } from 'react'
import { SizedChart } from '@pgmaps/geo-toolkit/visualizations/react'
import { verticalCurveSummary } from './engine'
import type { Alignment, RoadAnalysis } from './types'

interface BandSpan {
  id: string
  start: number
  end: number
  label: string
  detail: string
  color: string
  invalid?: boolean
}
interface BandRow {
  name: string
  spans: BandSpan[]
}
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const number = (value: number, digits = 1) => value.toLocaleString('en-CA', { maximumFractionDigits: digits })

/** Explicit design ranges and sampled terrain spans share the profile's horizontal scale. */
function rowsFor(analysis: RoadAnalysis, alignment: Alignment, terrainOnly: boolean): BandRow[] {
  const length = analysis.length
  const vertical = [...alignment.vertical].sort((a, b) => a.chainage - b.chainage)
  const designGrades = !terrainOnly && vertical.length > 1
  const cuts = designGrades
    ? [0, ...vertical.map((p) => p.chainage).filter((s) => s > 0 && s < length), length]
    : Array.from({ length: 9 }, (_, i) => (length * i) / 8)
  const gradeSpans: BandSpan[] = cuts.slice(1).flatMap((end, i) => {
    const start = cuts[i]
    if (end - start < 0.001) return []
    let grade: number | null = null
    if (designGrades) {
      const midpoint = (start + end) / 2
      let index = 0
      while (index < vertical.length - 2 && vertical[index + 1].chainage <= midpoint) index++
      const a = vertical[index],
        b = vertical[index + 1]
      if (b.chainage > a.chainage) grade = (100 * (b.elevation - a.elevation)) / (b.chainage - a.chainage)
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
        detail: `${designGrades ? 'Design tangent' : 'Mean sampled ground grade'} ${label}; station ${number(start)}–${number(end)} m${designGrades ? '. Vertical curves vary the grade near PVIs.' : '. Terrain gaps remain unknown.'}`,
        color: grade === null ? '#94a3b8' : '#0d9488',
      },
    ]
  })
  const rows: BandRow[] = [{ name: designGrades ? 'Tangent' : 'Ground', spans: gradeSpans }]
  if (terrainOnly) return rows
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
export function profileGradeSpans(analysis: RoadAnalysis, alignment: Alignment, terrainOnly = false) {
  return rowsFor(analysis, alignment, terrainOnly)[0]?.spans ?? []
}

export function EngineeringBands({
  analysis,
  alignment,
  station,
  onStation,
  terrainOnly = false,
  range,
}: {
  analysis: RoadAnalysis
  alignment: Alignment
  station: number
  onStation: (station: number) => void
  terrainOnly?: boolean
  range?: [number, number]
}) {
  const [expanded, setExpanded] = useState(false)
  const rows = rowsFor(analysis, alignment, terrainOnly)
  const start = range?.[0] ?? 0,
    end = range?.[1] ?? Math.max(1, analysis.length)
  if (analysis.length <= 0) return null
  return (
    <div className="-mx-3 border-t" data-testid="road-engineering-bands" data-range-start={start} data-range-end={end}>
      <button
        className="flex w-full items-center justify-between px-3 py-1 text-[10px] text-muted-foreground hover:bg-muted"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span>{terrainOnly ? 'Ground grade & distance bands' : 'Grade, curve, template & material bands'}</span>
        <span>{expanded ? 'Hide −' : 'Show +'}</span>
      </button>
      {expanded && (
        <div className="max-h-[112px] overflow-y-auto overscroll-contain">
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
                  aria-label="Connected profile data bands; click to inspect a station"
                  className="touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onPointerDown={(event) => {
                    const box = event.currentTarget.getBoundingClientRect()
                    onStation(
                      Math.max(
                        start,
                        Math.min(
                          end,
                          start +
                            ((event.clientX - box.left - left) / Math.max(1, width - left - right)) * (end - start),
                        ),
                      ),
                    )
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
      )}
    </div>
  )
}
