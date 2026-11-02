import { uid, type Bookmark, type Camera, type Mission } from './model'
export function captureSite(mission: Mission, name: string, camera: Camera, includeLayers = true): Bookmark {
  return {
    id: uid(),
    name: name.trim().slice(0, 200),
    camera: structuredClone(camera),
    ...(includeLayers
      ? {
          layers: mission.layers.map(({ id, visible, opacity, style, filter }) =>
            structuredClone({ id, visible, opacity, style, filter }),
          ),
          tiles: mission.tiles.map(({ id, visible, opacity }) => ({ id, visible, opacity })),
          time: { ...mission.time },
          view: mission.view,
          terrain: mission.terrain,
        }
      : {}),
  }
}
export function restoreSite(mission: Mission, site: Bookmark): Mission {
  return {
    ...mission,
    camera: site.camera,
    layers: mission.layers.map((l) => {
      const saved = site.layers?.find((s) => s.id === l.id)
      return saved ? { ...l, ...structuredClone(saved) } : l
    }),
    tiles: mission.tiles.map((l) => {
      const saved = site.tiles?.find((s) => s.id === l.id)
      return saved ? { ...l, ...saved } : l
    }),
    time: site.time ?? mission.time,
    view: site.view ?? mission.view,
    terrain: site.terrain ?? mission.terrain,
  }
}
