import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { climbText, distanceText, type RouteMember, type Units } from './routing'

export function ElevationProfile({ member, units, onHover }: { member: RouteMember; units: Units; onHover: (index: number | null) => void }) {
  const [hoverState, setHoverState] = useState<{ member: RouteMember; index: number | null }>({ member, index: null })
  const cursor = hoverState.member === member ? hoverState.index : null
  const { d, z } = member.stats.profile
  const low = Math.min(...z), high = Math.max(...z), span = Math.max(10, high - low)
  const target = useMemo(() => {
    let at = 0
    return Array.from({ length: 96 }, (_, index) => {
      const distance = index / 95 * member.stats.distance_m
      while (at < d.length - 2 && d[at + 1] < distance) at++
      const fraction = d[at + 1] > d[at] ? (distance - d[at]) / (d[at + 1] - d[at]) : 0
      return 88 - (z[at] + (z[at + 1] - z[at]) * fraction - low) / span * 70
    })
  }, [member, d, z, low, span])
  const shapeText = (shape: number[]) => shape.map((y, index) => `${(8 + index / 95 * 344).toFixed(2)},${y.toFixed(2)}`).join(' ')
  const initial = useRef(shapeText(target))
  const displayed = useRef(target)
  const line = useRef<SVGPolylineElement>(null)
  const area = useRef<SVGPolygonElement>(null)
  useLayoutEffect(() => {
    const from = displayed.current
    if (from === target) return
    let frame = 0
    const started = performance.now()
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
    const draw = (now: number) => {
      const progress = reducedMotion ? 1 : Math.min(1, (now - started) / 180)
      const eased = 1 - (1 - progress) ** 3
      const current = progress === 1 ? target : target.map((value, index) => from[index] + (value - from[index]) * eased)
      displayed.current = current
      const points = shapeText(current)
      line.current?.setAttribute('points', points)
      area.current?.setAttribute('points', `8,94 ${points} 352,94`)
      if (progress < 1) frame = requestAnimationFrame(draw)
    }
    draw(started)
    return () => cancelAnimationFrame(frame)
  }, [target])
  const hover = (index: number | null) => { setHoverState({ member, index }); onHover(index) }
  return <div className="rounded-lg border border-border bg-muted/30 p-2">
    <svg viewBox="0 0 360 100" className="w-full touch-none text-emerald-600 dark:text-emerald-400" tabIndex={0} role="slider"
      aria-label="Elevation profile" aria-valuemin={0} aria-valuemax={d.length - 1} aria-valuenow={cursor ?? 0}
      aria-valuetext={`${distanceText(d[cursor ?? 0], units)}, elevation ${climbText(z[cursor ?? 0], units)}`}
      onPointerMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        const target = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * member.stats.distance_m
        const next = d.findIndex((distance) => distance >= target)
        hover(next < 0 ? d.length - 1 : next)
      }}
      onPointerLeave={() => hover(null)} onBlur={() => hover(null)}
      onKeyDown={(event) => {
        if (['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) {
          event.preventDefault()
          hover(event.key === 'Home' ? 0 : event.key === 'End' ? d.length - 1 : Math.max(0, Math.min(d.length - 1, (cursor ?? 0) + (event.key === 'ArrowRight' ? 1 : -1))))
        }
      }}>
      <polygon ref={area} points={`8,94 ${initial.current} 352,94`} fill="currentColor" opacity={0.12} />
      <polyline ref={line} points={initial.current} fill="none" stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      {cursor !== null && <circle cx={8 + d[cursor] / member.stats.distance_m * 344} cy={88 - (z[cursor] - low) / span * 70} r={4} fill="currentColor" />}
    </svg>
    <div className="flex justify-between gap-2 text-xs tabular-nums text-muted-foreground"><span>{climbText(member.stats.start_elev_m, units)}</span><span>{cursor === null ? distanceText(member.stats.distance_m, units) : `${distanceText(d[cursor], units)} · ${climbText(z[cursor], units)}`}</span><span>{climbText(member.stats.end_elev_m, units)}</span></div>
  </div>
}
