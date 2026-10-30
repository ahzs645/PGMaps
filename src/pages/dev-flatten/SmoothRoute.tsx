import { memo, useMemo, useState } from 'react'
import { MapRoute } from '@/components/ui/map'

/** Two persistent line buffers let MapLibre crossfade on the GPU. */
export const SmoothRoute = memo(function SmoothRoute({ coordinates }: { coordinates: [number, number][] }) {
  const [buffers, setBuffers] = useState<{ active: number; coordinates: [number, number][][] }>({
    active: 0,
    coordinates: [coordinates, []],
  })
  const transition = useMemo(() => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 160), [])
  // Derive the next buffer before committing children so MapLibre never sees a
  // frame with new route coordinates and the previous buffer's visibility.
  if (buffers.coordinates[buffers.active] !== coordinates) {
    const next = 1 - buffers.active
    const updated = buffers.coordinates.slice()
    updated[next] = coordinates
    setBuffers({ active: next, coordinates: updated })
  }
  return (
    <>
      {buffers.coordinates.map((points, index) => (
        <RouteBuffer
          key={index}
          index={index}
          coordinates={points}
          active={buffers.active === index}
          transition={transition}
        />
      ))}
    </>
  )
})

function RouteBuffer({
  index,
  coordinates,
  active,
  transition,
}: {
  index: number
  coordinates: [number, number][]
  active: boolean
  transition: number
}) {
  const suffix = index === 0 ? '' : '-next'
  return (
    <>
      <MapRoute
        id={`flatten-casing${suffix}`}
        coordinates={coordinates}
        color="#ffffff"
        width={8}
        opacity={active ? 0.92 : 0}
        opacityTransitionMs={transition}
        interactive={false}
      />
      <MapRoute
        id={`flatten-selected${suffix}`}
        coordinates={coordinates}
        color="#059669"
        width={4}
        opacity={active ? 1 : 0}
        opacityTransitionMs={transition}
        interactive={false}
      />
    </>
  )
}
