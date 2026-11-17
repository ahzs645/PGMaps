import { useMemo } from 'react'
import { SizedChart } from '@pgmaps/geo-toolkit/visualizations/react'
import { niceStep } from './chartScale'
import { attributeCosts } from './costAttribution'
import { costBreakdownRows } from './costBreakdownRows'
import { formatRoadStation, ROAD_CHART_COLORS } from './Charts'
import { cumulativeCost, earthworkBins, gradeDistribution } from './reviewCharts'
import type { Alignment, RoadAnalysis, RoadSettings } from './types'

const whole = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 0 })
const money = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 })
const LEFT = 52,
  RIGHT = 12,
  TOP = 8,
  BOTTOM = 22
const axis = 'hsl(var(--muted-foreground))'
const grid = 'hsl(var(--border))'

function ticks(max: number, count = 4) {
  const step = niceStep(Math.max(max, 1e-9), count)
  const out: number[] = []
  for (let v = 0; v <= max + step * 1e-6; v += step) out.push(v)
  return { values: out, top: out.at(-1)! }
}

function Frame({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-1">
      <h4 className="text-xs font-medium">{title}</h4>
      {children}
      {note && <p className="text-2xs text-muted-foreground">{note}</p>}
    </section>
  )
}

/** Share of road length by grade class, stacked by up-station (climbing) and down-station. */
function GradeHistogram({ analysis, limitPct }: { analysis: RoadAnalysis; limitPct: number }) {
  const data = useMemo(() => gradeDistribution(analysis, 2), [analysis])
  const height = 150
  const maxShare = Math.max(0.01, ...data.bins.map((b) => b.share))
  const t = ticks(maxShare * 100)
  return (
    <Frame
      title="Grade distribution"
      note={`Share of the ${whole.format(data.knownLengthM)} m with a design grade, in 2% classes. Darker: climbing up-station. Classes past the ${limitPct}% limit are red.${data.unknownLengthM > 1 ? ` ${whole.format(data.unknownLengthM)} m has no design grade.` : ''}`}
    >
      <SizedChart height={height}>
        {(width) => {
          const plotW = Math.max(10, width - LEFT - RIGHT),
            plotH = height - TOP - BOTTOM
          const barW = plotW / data.bins.length
          const y = (pct: number) => TOP + plotH - (pct / t.top) * plotH
          return (
            <svg
              width={width}
              height={height}
              role="img"
              aria-label="Road length by grade class"
              data-testid="road-grade-histogram"
            >
              {t.values.map((v) => (
                <g key={v}>
                  <line x1={LEFT} x2={LEFT + plotW} y1={y(v)} y2={y(v)} stroke={grid} />
                  <text x={LEFT - 4} y={y(v) + 3} fontSize="9" textAnchor="end" fill={axis}>
                    {whole.format(v)}%
                  </text>
                </g>
              ))}
              {data.bins.map((b, k) => {
                const over = b.fromPct >= limitPct
                const x0 = LEFT + k * barW + 1
                const known = data.knownLengthM || 1
                const up = (100 * b.adverseM) / known,
                  down = (100 * b.favourableM) / known
                const fill = over ? '#dc2626' : ROAD_CHART_COLORS.design
                return (
                  <g key={k}>
                    <rect
                      x={x0}
                      width={Math.max(1, barW - 2)}
                      y={y(down)}
                      height={y(0) - y(down)}
                      fill={fill}
                      opacity={0.45}
                    />
                    <rect
                      x={x0}
                      width={Math.max(1, barW - 2)}
                      y={y(down + up)}
                      height={y(down) - y(down + up)}
                      fill={fill}
                    />
                    <title>
                      {b.fromPct}–{b.toPct}%: {whole.format(b.lengthM)} m ({(b.share * 100).toFixed(1)}%) · climbing{' '}
                      {whole.format(b.adverseM)} m · descending {whole.format(b.favourableM)} m
                    </title>
                    {(k % Math.ceil(data.bins.length / 10) === 0 || k === data.bins.length - 1) && (
                      <text x={x0 + barW / 2} y={height - 8} fontSize="9" textAnchor="middle" fill={axis}>
                        {data.bins.length <= 12 ? `${b.fromPct}–${b.toPct}` : b.fromPct}
                      </text>
                    )}
                  </g>
                )
              })}
              <text x={LEFT + plotW} y={height - 1} fontSize="9" textAnchor="end" fill={axis}>
                grade %
              </text>
            </svg>
          )
        }}
      </SizedChart>
    </Frame>
  )
}

/** The estimate spent so far along the road, by the cost dialog's own attribution. */
function CumulativeCost({
  analysis,
  alignment,
  settings,
  onStation,
}: {
  analysis: RoadAnalysis
  alignment: Alignment
  settings: RoadSettings
  onStation: (chainage: number) => void
}) {
  const data = useMemo(() => {
    try {
      return cumulativeCost(
        attributeCosts({ analysis, alignment, breakdown: costBreakdownRows({ analysis, alignment, settings }) }),
      )
    } catch {
      return null
    }
  }, [analysis, alignment, settings])
  if (!data || data.points.length < 2) return null
  const height = 150
  const t = ticks(data.placedTotal)
  const length = data.points.at(-1)![0] || 1
  return (
    <Frame
      title="Cumulative cost along the road"
      note={`Placed on the road: ${money.format(data.placedTotal)} of ${money.format(data.totalAmount)}. ${data.unplacedTotal > 0.5 ? `${money.format(data.unplacedTotal)} has no place on the road (mobilization, contingency, shared costs). ` : ''}${data.incompleteM > 1 ? `${whole.format(data.incompleteM)} m with incomplete sections adds only located items. ` : ''}Spread as the cost dialog's "Where it falls".`}
    >
      <SizedChart height={height}>
        {(width) => {
          const plotW = Math.max(10, width - LEFT - RIGHT),
            plotH = height - TOP - BOTTOM
          const x = (c: number) => LEFT + (c / length) * plotW
          const y = (v: number) => TOP + plotH - (v / (t.top || 1)) * plotH
          const step = niceStep(length, 5)
          const xs: number[] = []
          for (let c = 0; c <= length + 1e-6; c += step) xs.push(c)
          return (
            <svg
              width={width}
              height={height}
              role="img"
              aria-label="Cumulative estimate along the road"
              data-testid="road-cumulative-cost"
              onClick={(event) => {
                const box = event.currentTarget.getBoundingClientRect()
                const c = ((event.clientX - box.left - LEFT) / plotW) * length
                if (c >= 0 && c <= length) onStation(c)
              }}
              className="cursor-crosshair"
            >
              {t.values.map((v) => (
                <g key={v}>
                  <line x1={LEFT} x2={LEFT + plotW} y1={y(v)} y2={y(v)} stroke={grid} />
                  <text x={LEFT - 4} y={y(v) + 3} fontSize="9" textAnchor="end" fill={axis}>
                    {v >= 1000 ? `$${whole.format(v / 1000)}k` : `$${whole.format(v)}`}
                  </text>
                </g>
              ))}
              {xs.map((c) => (
                <text key={c} x={x(c)} y={height - 8} fontSize="9" textAnchor="middle" fill={axis}>
                  {formatRoadStation(c)}
                </text>
              ))}
              <path
                d={data.points.map(([c, v], i) => `${i ? 'L' : 'M'}${x(c).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}
                fill="none"
                stroke={ROAD_CHART_COLORS.mass}
                strokeWidth={2}
              />
            </svg>
          )
        }}
      </SizedChart>
    </Frame>
  )
}

/** Cut above and fill below the axis, summed over round stretches. */
function EarthworkBars({ analysis, onStation }: { analysis: RoadAnalysis; onStation: (chainage: number) => void }) {
  const bins = useMemo(() => earthworkBins(analysis), [analysis])
  if (!bins.length) return null
  const height = 160
  const max = Math.max(1, ...bins.flatMap((b) => [b.cutM3, b.fillM3]))
  const t = ticks(max, 2)
  const span = bins[0].end - bins[0].start
  return (
    <Frame
      title="Earthwork by station"
      note={`Bank cut above the line and compacted fill below, per ${whole.format(span)} m. Hatched: a stretch with unknown earthwork, counted only where known.`}
    >
      <SizedChart height={height}>
        {(width) => {
          const plotW = Math.max(10, width - LEFT - RIGHT),
            plotH = height - TOP - BOTTOM
          const mid = TOP + plotH / 2
          const h = (v: number) => (v / t.top) * (plotH / 2)
          const barW = plotW / bins.length
          return (
            <svg
              width={width}
              height={height}
              role="img"
              aria-label="Cut and fill by stretch"
              data-testid="road-earthwork-bars"
            >
              <defs>
                <pattern
                  id="road-earthwork-unknown"
                  width="4"
                  height="4"
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(45)"
                >
                  <line x1="0" y1="0" x2="0" y2="4" stroke="#b45309" strokeWidth="1" opacity="0.5" />
                </pattern>
              </defs>
              {[-t.top, 0, t.top].map((v) => (
                <g key={v}>
                  <line x1={LEFT} x2={LEFT + plotW} y1={mid - h(v)} y2={mid - h(v)} stroke={v === 0 ? axis : grid} />
                  <text x={LEFT - 4} y={mid - h(v) + 3} fontSize="9" textAnchor="end" fill={axis}>
                    {whole.format(Math.abs(v))}
                  </text>
                </g>
              ))}
              <text x={4} y={TOP + 8} fontSize="9" fill={ROAD_CHART_COLORS.cut}>
                cut m³
              </text>
              <text x={4} y={TOP + plotH - 2} fontSize="9" fill={ROAD_CHART_COLORS.fill}>
                fill m³
              </text>
              {bins.map((b, k) => {
                const x0 = LEFT + k * barW + 1,
                  w = Math.max(1, barW - 2)
                return (
                  <g key={k} className="cursor-pointer" onClick={() => onStation((b.start + b.end) / 2)}>
                    {b.unknownM > 1e-6 && (
                      <rect x={x0} width={w} y={TOP} height={plotH} fill="url(#road-earthwork-unknown)" />
                    )}
                    <rect x={x0} width={w} y={mid - h(b.cutM3)} height={h(b.cutM3)} fill={ROAD_CHART_COLORS.cut} />
                    <rect x={x0} width={w} y={mid} height={h(b.fillM3)} fill={ROAD_CHART_COLORS.fill} />
                    <title>
                      {formatRoadStation(b.start)}–{formatRoadStation(b.end)}: cut {whole.format(b.cutM3)} m³ · fill{' '}
                      {whole.format(b.fillM3)} m³{b.unknownM > 1e-6 ? ` · ${whole.format(b.unknownM)} m unknown` : ''}
                    </title>
                    {k % Math.ceil(bins.length / 6) === 0 && (
                      <text x={x0} y={height - 8} fontSize="9" fill={axis}>
                        {formatRoadStation(b.start)}
                      </text>
                    )}
                  </g>
                )
              })}
            </svg>
          )
        }}
      </SizedChart>
    </Frame>
  )
}

/** Review charts in the Quantities pane: none is a deliverable the manuals require; each helps review. */
export function ReviewCharts({
  analysis,
  alignment,
  settings,
  onStation,
}: {
  analysis: RoadAnalysis
  alignment?: Alignment
  settings: RoadSettings
  onStation: (chainage: number) => void
}) {
  return (
    <div className="grid gap-4" data-testid="road-review-charts">
      <GradeHistogram analysis={analysis} limitPct={settings.maxGradePercent} />
      {alignment && (
        <CumulativeCost analysis={analysis} alignment={alignment} settings={settings} onStation={onStation} />
      )}
      <EarthworkBars analysis={analysis} onStation={onStation} />
    </div>
  )
}
