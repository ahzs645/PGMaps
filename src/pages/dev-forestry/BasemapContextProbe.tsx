import { useEffect, useRef } from 'react'

import { useMap } from '@/components/ui/map'

import { collectWaterFromMap, corridorRoadClass } from './basemapContext'
import { collectRoadsFromMap } from './roadSnap'
import type { PolygonGeometry } from './visibility'

export type BasemapContext = {
  water: PolygonGeometry[]
  /** Class of the drawn road the corridor follows, or null when none does. */
  roadClass: string | null
}

type Props = {
  /** Read only while the map shows the overview; eye level loads a few tiles around the camera. */
  enabled: boolean
  corridor: Array<[number, number]>
  /** The area the drive can see, west/south/east/north. */
  bounds: [number, number, number, number] | null
  onChange: (context: BasemapContext) => void
}

/**
 * Reads water and the road's class from the basemap each time the overview
 * map settles, so the eye-level preview can keep timber off lakes and size the
 * roadside clearing to the road. Renders nothing.
 */
export function BasemapContextProbe({ enabled, corridor, bounds, onChange }: Props) {
  const { map, isLoaded } = useMap()
  const onChangeRef = useRef(onChange)
  const lastKey = useRef('')
  useEffect(() => {
    onChangeRef.current = onChange
  })

  useEffect(() => {
    if (!map || !isLoaded || !enabled) return
    const read = () => {
      const water = collectWaterFromMap(map, bounds ?? undefined)
      const roadClass = corridor.length > 1 ? corridorRoadClass(collectRoadsFromMap(map), corridor) : null
      const key = `${water.length}:${roadClass}:${water.map((geometry) => JSON.stringify(geometry.coordinates).length).join(',')}`
      if (key === lastKey.current) return
      lastKey.current = key
      onChangeRef.current({ water, roadClass })
    }
    read()
    map.on('idle', read)
    return () => {
      map.off('idle', read)
    }
  }, [map, isLoaded, enabled, corridor, bounds])

  return null
}
