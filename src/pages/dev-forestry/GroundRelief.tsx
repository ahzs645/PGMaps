/**
 * Puts the road view's relief shading over the ground it draws.
 *
 * The map's hillshade sits under the first label, and the road view's ground (forest floor, open
 * cover, cut soil, road scars) is draped over it at 82–95%: the relief was all but hidden, so a
 * cutblock on a hillside was one flat tan shape and bare ground had no form. This lifts the same
 * layer above those fills while the road view draws its own ground, and lights it from where the
 * trees are lit from, fixed to the map rather than to the screen: with the default anchor the light
 * turned with the head.
 *
 * Mounted after the ground fills and the block's own cut ground, which is drawn after the road and
 * the water: those lie under it too, and a lake is level, so it shades none. It moves and re-lights
 * the terrain component's own layer; it adds none. Display only.
 */
import { useEffect } from 'react'
import { useMap } from '@/components/ui/map'

const HILLSHADE_LAYER = 'forestry-hillshade'
/** A shaded slope's tint over the drawn ground: a dark forest green, well short of opaque. */
const GROUND_SHADOW_COLOR = 'rgba(14, 26, 20, 0.55)'

/** The bearing a light comes from, degrees clockwise from north, for a direction in the mercator frame (x east, y south). */
export function lightBearing(direction: readonly [number, number, number]): number {
  return ((Math.atan2(direction[0], -direction[1]) * 180) / Math.PI + 360) % 360
}

export function GroundRelief({ active, light }: { active: boolean; light: readonly [number, number, number] }) {
  const { map, isLoaded } = useMap()
  useEffect(() => {
    if (!active || !isLoaded || !map || !map.getLayer(HILLSHADE_LAYER)) return
    // To the top as the layers stand now: over everything mounted before this, under what is
    // mounted after it.
    map.moveLayer(HILLSHADE_LAYER)
    map.setPaintProperty(HILLSHADE_LAYER, 'hillshade-illumination-anchor', 'map')
    // The plan's shadow colour is near black at full strength: a metre from the eye one steep cell
    // of it is a black band across the foreground. A shaded slope here is a darker ground, not ink.
    const shadow = map.getPaintProperty(HILLSHADE_LAYER, 'hillshade-shadow-color')
    map.setPaintProperty(HILLSHADE_LAYER, 'hillshade-shadow-color', GROUND_SHADOW_COLOR)
    return () => {
      try {
        if (!map.getLayer(HILLSHADE_LAYER)) return
        const firstLabel = map.getStyle().layers.find((layer) => layer.type === 'symbol')?.id
        map.moveLayer(HILLSHADE_LAYER, firstLabel)
        map.setPaintProperty(HILLSHADE_LAYER, 'hillshade-illumination-anchor', 'viewport')
        if (shadow !== undefined) map.setPaintProperty(HILLSHADE_LAYER, 'hillshade-shadow-color', shadow)
      } catch {
        // The map was removed first: React runs a removed tree's cleanups parent first.
      }
    }
  }, [active, isLoaded, map])
  const bearing = Math.round(lightBearing(light))
  useEffect(() => {
    if (!active || !isLoaded || !map || !map.getLayer(HILLSHADE_LAYER)) return
    map.setPaintProperty(HILLSHADE_LAYER, 'hillshade-illumination-direction', bearing)
  }, [active, bearing, isLoaded, map])
  return null
}
