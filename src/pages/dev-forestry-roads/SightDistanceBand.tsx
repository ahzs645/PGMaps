import { useMemo } from 'react'
import { SizedChart } from '@pgmaps/geo-toolkit/visualizations/react'
import type { SightBandInput } from './EngineeringBands'
import { reviewRoadSight } from './sightDistance'
import { sightBandSeries, type SightBandPoint } from './sightPresentation'
import type { Alignment, RoadAnalysis } from './types'

const HEIGHT = 46
const STATE_COLORS: Record<SightBandPoint['state'], string> = {
  clear: '#16a34a',
  short: '#dc2626',
  unknown: '#94a3b8',
  'near-end': '#cbd5e1',
}
const n = (value: number) => Math.round(value).toLocaleString('en-CA')

/**
 * Distance seen against distance needed at each eye station, under the profile on its horizontal
 * scale: a bar to the distance seen (the worse of the two looks) and a tick at the distance needed.
 * It reads the same cached review as the Sight band row, so it costs nothing more. Absent without a
 * design speed.
 */
export function SightDistanceBand({
  analysis,
  alignment,
  sight,
  station,
  onStation,
  range,
}: {
  analysis: RoadAnalysis
  alignment: Alignment
  sight: SightBandInput
  station: number
  onStation: (station: number) => void
  range?: [number, number]
}) {
  const review = useMemo(
    () =>
      reviewRoadSight({
        analysis,
        alignment,
        standards: sight.standards,
        stationIntervalM: sight.stationIntervalM,
      }),
    [analysis, alignment, sight],
  )
  const series = useMemo(() => (review.status === 'checked' ? sightBandSeries(review) : []), [review])
  if (!series.length || analysis.length <= 0) return null
  const start = range?.[0] ?? 0,
    end = range?.[1] ?? Math.max(1, analysis.length)
  const top = Math.max(1, ...series.map((p) => Math.max(p.requiredM ?? 0, p.availableM))) * 1.1
  const half = review.eyeSpacingM / 2
  const shortCount = series.filter((p) => p.state === 'short').length
  return (
    <div data-testid="road-sight-band" data-short={shortCount}>
      <SizedChart height={HEIGHT}>
        {(width) => {
          const left = width < 380 ? 48 : 58,
            right = 16
          const plotWidth = Math.max(1, width - left - right)
          const x = (value: number) => left + Math.max(0, Math.min(1, (value - start) / (end - start))) * plotWidth
          const y = (value: number) => 2 + (1 - Math.min(1, value / top)) * (HEIGHT - 4)
          const pick = (clientX: number, box: DOMRect) =>
            onStation(
              Math.max(
                0,
                Math.min(
                  analysis.length,
                  start +
                    ((clientX - box.left - (left / width) * box.width) / ((plotWidth / width) * box.width)) *
                      (end - start),
                ),
              ),
            )
          return (
            <svg
              width={width}
              height={HEIGHT}
              role="group"
              tabIndex={0}
              aria-label={`Sight distance seen against needed at each eye station; ${shortCount} short. Click or use left and right arrows to select a station.`}
              className="cursor-ew-resize select-none touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onPointerDown={(event) => {
                if (event.button !== 0 || !event.isPrimary) return
                event.currentTarget.setPointerCapture(event.pointerId)
                pick(event.clientX, event.currentTarget.getBoundingClientRect())
              }}
              onPointerMove={(event) => {
                if (event.buttons === 1) pick(event.clientX, event.currentTarget.getBoundingClientRect())
              }}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
                event.preventDefault()
                // Steps from one eye station to the next, where the band has values.
                const next =
                  event.key === 'ArrowRight'
                    ? series.find((p) => p.chainage > station + 1e-6)
                    : [...series].reverse().find((p) => p.chainage < station - 1e-6)
                if (next) onStation(next.chainage)
              }}
            >
              <text x={3} y={14} fontSize="9" fill="hsl(var(--muted-foreground))">
                Sight m
              </text>
              <text x={3} y={26} fontSize="8" fill="hsl(var(--muted-foreground))">
                seen/need
              </text>
              <rect x={left} y={0} width={plotWidth} height={HEIGHT} fill="hsl(var(--muted))" />
              {series
                .filter((p) => p.chainage + half >= start && p.chainage - half <= end)
                .map((p) => {
                  const x0 = x(Math.max(0, p.chainage - half)),
                    x1 = x(Math.min(analysis.length, p.chainage + half))
                  const seen = p.requiredM !== null && p.state === 'clear' ? p.requiredM : p.availableM
                  return (
                    <g key={p.chainage} data-testid="road-sight-band-bar" data-state={p.state}>
                      <title>
                        {`${n(p.chainage)} m looking ${p.direction}: ${p.state === 'clear' ? 'sees at least' : 'sees'} ${n(seen)} m of ${p.requiredM === null ? 'unknown' : `${n(p.requiredM)} m`} needed${p.state === 'unknown' ? ' (missing terrain)' : p.state === 'near-end' ? ' (near a road end, not judged)' : ''}`}
                      </title>
                      <rect
                        x={x0}
                        y={y(seen)}
                        width={Math.max(1, x1 - x0 - 0.5)}
                        height={Math.max(0, HEIGHT - 2 - y(seen))}
                        fill={STATE_COLORS[p.state]}
                        opacity={0.75}
                      />
                      {p.requiredM !== null && (
                        <line
                          x1={x0}
                          x2={x1}
                          y1={y(p.requiredM)}
                          y2={y(p.requiredM)}
                          stroke="hsl(var(--foreground))"
                          strokeWidth={1.4}
                        />
                      )}
                    </g>
                  )
                })}
              <line
                x1={x(station)}
                x2={x(station)}
                y1={0}
                y2={HEIGHT}
                stroke="hsl(var(--foreground))"
                strokeWidth={1}
                pointerEvents="none"
              />
            </svg>
          )
        }}
      </SizedChart>
    </div>
  )
}
