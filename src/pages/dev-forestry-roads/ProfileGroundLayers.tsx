import { memo } from 'react'
import type { EngineeringStation } from './engineeringTypes'
import type { RoadStation } from './types'

/**
 * The ground layers (horizons) the person entered, shaded below the profile's ground line at the
 * centreline: each bounded layer as a band from its top to its bottom depth, and every horizon's top
 * as a line in its colour. Display only; where ground is unknown nothing is drawn.
 */
export const ProfileGroundLayers = memo(function ProfileGroundLayers({
  stations,
  engineering,
  x,
  y,
}: {
  stations: readonly RoadStation[]
  engineering: readonly EngineeringStation[] | undefined
  x: (chainage: number) => number
  y: (elevation: number) => number
}) {
  if (!engineering?.some((s) => s.layers.length)) return null
  // Runs of stations where a layer is present and the ground is known, by layer id.
  const runs = new Map<
    string,
    { name: string; color: string; bounded: boolean; parts: { c: number; top: number; bottom: number | null }[][] }
  >()
  stations.forEach((s, i) => {
    const e = engineering[i]
    const ground = s.groundElevation
    const present = new Set<string>()
    if (e && ground !== null && Number.isFinite(ground))
      for (const layer of e.layers) {
        present.add(layer.id)
        let run = runs.get(layer.id)
        if (!run) runs.set(layer.id, (run = { name: layer.name, color: layer.color, bounded: true, parts: [] }))
        if (layer.bottomDepthM === null) run.bounded = false
        const point = {
          c: s.chainage,
          top: ground - layer.topDepthM,
          bottom: layer.bottomDepthM === null ? null : ground - layer.bottomDepthM,
        }
        const last = run.parts.at(-1)
        if (last && last.at(-1)!.c === stations[i - 1]?.chainage) last.push(point)
        else run.parts.push([point])
      }
    for (const [id, run] of runs)
      if (!present.has(id) && run.parts.at(-1)?.at(-1)?.c === stations[i - 1]?.chainage) run.parts.push([])
  })
  return (
    <g data-testid="road-profile-ground-layers" pointerEvents="none">
      {[...runs.entries()].map(([id, run]) =>
        run.parts
          .filter((part) => part.length > 1)
          .map((part, k) => {
            const top = part.map((p) => `${x(p.c).toFixed(1)},${y(p.top).toFixed(1)}`)
            const bounded = part.every((p) => p.bottom !== null)
            return (
              <g key={`${id}-${k}`}>
                {bounded && (
                  <polygon
                    points={[
                      ...top,
                      ...[...part].reverse().map((p) => `${x(p.c).toFixed(1)},${y(p.bottom!).toFixed(1)}`),
                    ].join(' ')}
                    fill={run.color}
                    opacity={0.18}
                  >
                    <title>{run.name}: entered ground layer below original ground</title>
                  </polygon>
                )}
                {part[0].top !== undefined && (
                  <polyline
                    points={top.join(' ')}
                    fill="none"
                    stroke={run.color}
                    strokeWidth={1}
                    strokeDasharray="4 3"
                    opacity={0.8}
                  >
                    <title>Top of {run.name}</title>
                  </polyline>
                )}
              </g>
            )
          }),
      )}
    </g>
  )
})
