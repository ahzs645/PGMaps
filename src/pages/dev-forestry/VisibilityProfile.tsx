import { useCallback, useMemo, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

import type { StationResult } from './types'

const VIEW_WIDTH = 320
const VIEW_HEIGHT = 120
const PADDING = { top: 10, right: 8, bottom: 20, left: 26 }

const PLOT_WIDTH = VIEW_WIDTH - PADDING.left - PADDING.right
const PLOT_HEIGHT = VIEW_HEIGHT - PADDING.top - PADDING.bottom

/** One series, so identity needs no legend — the heading names it. */
const SERIES_COLOR = '#ef4444'

type VisibilityProfileProps = {
  stations: StationResult[]
  /** Highlighted with a dashed rule: where the perspective numbers were measured. */
  assessmentIndex: number
  /** Solid rule following drive playback, in metres along the corridor. */
  positionMeters?: number | null
  onSeek?: (distanceMeters: number) => void
  className?: string
}

/**
 * How much of the block is in view at each point along the road.
 *
 * The shape is the useful part: a flat line means the block is equally exposed
 * for the whole drive, a spike means one bend does all the damage. Clicking
 * seeks drive mode there, so the chart doubles as the scrubber.
 */
export function VisibilityProfile({
  stations,
  assessmentIndex,
  positionMeters = null,
  onSeek,
  className,
}: VisibilityProfileProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  const totalMeters = stations.length > 0 ? stations[stations.length - 1].distanceAlongMeters : 0

  const xFor = useCallback(
    (distanceMeters: number) =>
      PADDING.left + (totalMeters > 0 ? (distanceMeters / totalMeters) * PLOT_WIDTH : PLOT_WIDTH / 2),
    [totalMeters],
  )
  const yFor = useCallback(
    (percent: number) => PADDING.top + PLOT_HEIGHT - (Math.max(0, Math.min(100, percent)) / 100) * PLOT_HEIGHT,
    [],
  )

  const { linePath, areaPath, peak } = useMemo(() => {
    if (stations.length === 0) return { linePath: '', areaPath: '', peak: null }

    const points = stations.map((station) => ({
      x: xFor(station.distanceAlongMeters),
      y: yFor(station.visiblePercent),
    }))
    const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`).join(' ')
    const baseline = PADDING.top + PLOT_HEIGHT
    const area = `${line} L${points[points.length - 1].x} ${baseline} L${points[0].x} ${baseline} Z`

    const peakStation = stations.reduce((best, station) =>
      station.visiblePercent > best.visiblePercent ? station : best,
    )
    return {
      linePath: line,
      areaPath: area,
      peak: peakStation.visiblePercent > 0 ? peakStation : null,
    }
  }, [stations, xFor, yFor])

  const indexAtClientX = useCallback(
    (clientX: number): number | null => {
      const svg = svgRef.current
      if (!svg || stations.length === 0) return null
      const rect = svg.getBoundingClientRect()
      if (rect.width === 0) return null

      const viewX = ((clientX - rect.left) / rect.width) * VIEW_WIDTH
      const fraction = (viewX - PADDING.left) / PLOT_WIDTH
      const distance = Math.max(0, Math.min(1, fraction)) * totalMeters

      let closest = 0
      let smallestGap = Infinity
      stations.forEach((station, index) => {
        const gap = Math.abs(station.distanceAlongMeters - distance)
        if (gap < smallestGap) {
          smallestGap = gap
          closest = index
        }
      })
      return closest
    },
    [stations, totalMeters],
  )

  if (stations.length === 0) return null

  const hovered = hoverIndex === null ? null : stations[hoverIndex]
  const assessment = stations[assessmentIndex] ?? null

  return (
    <div className={cn('select-none', className)}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        className="h-auto w-full touch-none"
        role="img"
        aria-label={`Visible share of the block along ${(totalMeters / 1000).toFixed(1)} kilometres of road`}
        onPointerMove={(event) => setHoverIndex(indexAtClientX(event.clientX))}
        onPointerLeave={() => setHoverIndex(null)}
        onPointerDown={(event) => {
          const index = indexAtClientX(event.clientX)
          if (index !== null) onSeek?.(stations[index].distanceAlongMeters)
        }}
      >
        {/* Recessive grid: three rules is enough to read a percentage against. */}
        {[0, 50, 100].map((percent) => (
          <g key={percent}>
            <line
              x1={PADDING.left}
              x2={VIEW_WIDTH - PADDING.right}
              y1={yFor(percent)}
              y2={yFor(percent)}
              className="stroke-border"
              strokeWidth={percent === 0 ? 1 : 0.5}
            />
            <text
              x={PADDING.left - 4}
              y={yFor(percent) + 3}
              textAnchor="end"
              className="fill-muted-foreground text-[7px]"
            >
              {percent}
            </text>
          </g>
        ))}

        <path d={areaPath} fill={SERIES_COLOR} fillOpacity={0.16} />
        <path
          d={linePath}
          fill="none"
          stroke={SERIES_COLOR}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {assessment && (
          <line
            x1={xFor(assessment.distanceAlongMeters)}
            x2={xFor(assessment.distanceAlongMeters)}
            y1={PADDING.top}
            y2={PADDING.top + PLOT_HEIGHT}
            className="stroke-foreground/45"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}

        {positionMeters != null && (
          <line
            x1={xFor(positionMeters)}
            x2={xFor(positionMeters)}
            y1={PADDING.top}
            y2={PADDING.top + PLOT_HEIGHT}
            stroke="#0ea5e9"
            strokeWidth={2}
          />
        )}

        {/* One direct label, on the worst point — a number on every station would
            be unreadable at this size. */}
        {peak && !hovered && (
          <text
            x={Math.min(VIEW_WIDTH - PADDING.right, Math.max(PADDING.left + 12, xFor(peak.distanceAlongMeters)))}
            y={Math.max(8, yFor(peak.visiblePercent) - 5)}
            textAnchor="middle"
            className="fill-foreground text-[8px] font-semibold"
          >
            {peak.visiblePercent.toFixed(0)}%
          </text>
        )}

        {hovered && (
          <g>
            <line
              x1={xFor(hovered.distanceAlongMeters)}
              x2={xFor(hovered.distanceAlongMeters)}
              y1={PADDING.top}
              y2={PADDING.top + PLOT_HEIGHT}
              className="stroke-foreground/30"
              strokeWidth={1}
            />
            <circle
              cx={xFor(hovered.distanceAlongMeters)}
              cy={yFor(hovered.visiblePercent)}
              r={3.5}
              fill={SERIES_COLOR}
              className="stroke-background"
              strokeWidth={2}
            />
          </g>
        )}

        <text x={PADDING.left} y={VIEW_HEIGHT - 6} className="fill-muted-foreground text-[7px]">
          0 km
        </text>
        <text
          x={VIEW_WIDTH - PADDING.right}
          y={VIEW_HEIGHT - 6}
          textAnchor="end"
          className="fill-muted-foreground text-[7px]"
        >
          {(totalMeters / 1000).toFixed(1)} km
        </text>
      </svg>

      <p className="mt-1 text-[11px] text-muted-foreground">
        {hovered ? (
          <>
            <span className="font-medium text-foreground">{hovered.visiblePercent.toFixed(1)}%</span> visible at{' '}
            {(hovered.distanceAlongMeters / 1000).toFixed(2)} km
          </>
        ) : positionMeters != null ? (
          // Two rules, and only one of them was ever named.
          <>
            <span className="font-medium text-foreground">Dashed</span> rule marks the assessment viewpoint,{' '}
            <span className="font-medium text-sky-600 dark:text-sky-400">blue</span> where you are standing. Click to
            move.
          </>
        ) : (
          'Dashed rule marks the assessment viewpoint. Click to drive from a point.'
        )}
      </p>
    </div>
  )
}
