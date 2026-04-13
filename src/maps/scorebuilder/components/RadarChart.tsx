import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { SCORE_METRICS } from '../constants'
import type { ScoredBoundaryRegion, ScoreMetricKey, ScoreMetricWeightMap } from '../types'

interface RadarChartProps {
  regions: ScoredBoundaryRegion[]
  weights: ScoreMetricWeightMap
  className?: string
}

const COLORS = [
  { stroke: '#06b6d4', fill: 'rgba(6, 182, 212, 0.15)' },
  { stroke: '#f59e0b', fill: 'rgba(245, 158, 11, 0.15)' },
  { stroke: '#10b981', fill: 'rgba(16, 185, 129, 0.15)' },
]

const SIZE = 280
const CENTER = SIZE / 2
const RADIUS = 110

function polarToXY(angle: number, r: number): [number, number] {
  // Start from top (-90 degrees)
  const rad = ((angle - 90) * Math.PI) / 180
  return [CENTER + r * Math.cos(rad), CENTER + r * Math.sin(rad)]
}

export function RadarChart({ regions, weights, className }: RadarChartProps) {
  const activeMetrics = useMemo(
    () => SCORE_METRICS.filter((m) => weights[m.key] !== 0),
    [weights],
  )

  const axes = useMemo(() => {
    const count = activeMetrics.length
    if (count === 0) return []
    const step = 360 / count
    return activeMetrics.map((metric, i) => {
      const angle = i * step
      const [x, y] = polarToXY(angle, RADIUS)
      const [lx, ly] = polarToXY(angle, RADIUS + 18)
      return { metric, angle, x, y, lx, ly }
    })
  }, [activeMetrics])

  const polygons = useMemo(() => {
    if (axes.length < 3) return []
    const count = axes.length
    const step = 360 / count

    return regions.map((region, regionIdx) => {
      const points = axes.map((axis, i) => {
        const value = region.normalizedMetrics[axis.metric.key as ScoreMetricKey]
        const r = value * RADIUS
        const [x, y] = polarToXY(i * step, r)
        return `${x},${y}`
      })
      return {
        region,
        pointsStr: points.join(' '),
        color: COLORS[regionIdx % COLORS.length],
      }
    })
  }, [regions, axes])

  // Grid rings
  const rings = [0.25, 0.5, 0.75, 1]

  if (axes.length < 3) {
    return (
      <div className={cn('flex items-center justify-center text-xs text-muted-foreground p-4', className)}>
        Need at least 3 active metrics for radar chart.
      </div>
    )
  }

  return (
    <div className={className}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-full max-w-[280px] mx-auto">
        {/* Grid rings */}
        {rings.map((r) => (
          <polygon
            key={r}
            points={axes
              .map((_, i) => {
                const [x, y] = polarToXY(i * (360 / axes.length), RADIUS * r)
                return `${x},${y}`
              })
              .join(' ')}
            fill="none"
            stroke="currentColor"
            strokeWidth={0.5}
            className="text-border"
            opacity={0.5}
          />
        ))}

        {/* Axis lines */}
        {axes.map((axis) => (
          <line
            key={axis.metric.key}
            x1={CENTER}
            y1={CENTER}
            x2={axis.x}
            y2={axis.y}
            stroke="currentColor"
            strokeWidth={0.5}
            className="text-border"
            opacity={0.4}
          />
        ))}

        {/* Data polygons */}
        {polygons.map((p) => (
          <polygon
            key={p.region.region.id}
            points={p.pointsStr}
            fill={p.color.fill}
            stroke={p.color.stroke}
            strokeWidth={1.5}
          />
        ))}

        {/* Data points */}
        {polygons.map((p, regionIdx) =>
          axes.map((axis, i) => {
            const value = p.region.normalizedMetrics[axis.metric.key as ScoreMetricKey]
            const r = value * RADIUS
            const [x, y] = polarToXY(i * (360 / axes.length), r)
            return (
              <circle
                key={`${p.region.region.id}-${axis.metric.key}`}
                cx={x}
                cy={y}
                r={2.5}
                fill={COLORS[regionIdx % COLORS.length].stroke}
              />
            )
          }),
        )}

        {/* Labels */}
        {axes.map((axis) => (
          <text
            key={`label-${axis.metric.key}`}
            x={axis.lx}
            y={axis.ly}
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-muted-foreground text-[7px]"
          >
            {axis.metric.shortLabel}
          </text>
        ))}
      </svg>

      {/* Legend */}
      <div className="mt-2 flex flex-wrap justify-center gap-3 text-[11px]">
        {polygons.map((p, i) => (
          <div key={p.region.region.id} className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: COLORS[i % COLORS.length].stroke }}
            />
            <span className="text-foreground font-medium">
              #{p.region.rank} {p.region.region.name.slice(0, 20)}
            </span>
            <span className="text-muted-foreground">({p.region.score.toFixed(1)})</span>
          </div>
        ))}
      </div>
    </div>
  )
}
