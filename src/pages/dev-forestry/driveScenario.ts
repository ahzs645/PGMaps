import { createEmptyScene, createSampleScene, type ForestryScene } from './scene'
import { roadPath, roadPlacement } from './driveMath'

export const ROADSIDE_DEMO_ID = 'roadside-harvest-demo'
export const DEMO_OPENING_START = 350
export const DEMO_OPENING_END = 850

/** An explicitly hypothetical harvest next to the sample valley road, on real
 * terrain. The near boundary meets the 20 m road clearing, opening a side view
 * without widening the whole corridor or hiding foreground trees. */
export function createRoadsideDriveScene(): ForestryScene {
  const scene = createEmptyScene()
  const start = roadPlacement(roadPath(createSampleScene().viewpoint.coordinates), 3000)!
  const angle = (start.travelBearing * Math.PI) / 180
  const point = (along: number, right: number): [number, number] => [
    start.lng + (along * Math.sin(angle) + right * Math.cos(angle)) / (111320 * Math.cos((start.lat * Math.PI) / 180)),
    start.lat + (along * Math.cos(angle) - right * Math.sin(angle)) / 111320,
  ]
  const rectangle = (a: number, b: number, near: number, far: number): GeoJSON.Polygon => ({
    type: 'Polygon',
    coordinates: [[point(a, near), point(b, near), point(b, far), point(a, far), point(a, near)]],
  })
  const landformId = `${ROADSIDE_DEMO_ID}-landform`
  return {
    ...scene,
    activeLandformId: landformId,
    viewpoint: {
      id: ROADSIDE_DEMO_ID,
      name: 'Roadside harvest demo — illustrative route',
      mode: 'corridor',
      coordinates: [point(0, 0), point(1200, 0)],
    },
    settings: { ...scene.settings, stationSpacingMeters: 25, demZoom: 14, maxViewDistanceMeters: 3000 },
    targets: [
      {
        id: `${ROADSIDE_DEMO_ID}-block`,
        name: 'Roadside opening — hypothetical harvest',
        role: 'block',
        objectiveId: 'partial-retention',
        vac: null,
        harvestYear: null,
        clearcutPercent: null,
        geometry: rectangle(DEMO_OPENING_START, DEMO_OPENING_END, 10, 240),
        source: 'Illustrative driving demo; not a recorded or proposed harvest',
      },
      {
        id: landformId,
        name: 'Demo hillside — illustrative assessment boundary',
        role: 'landscape',
        objectiveId: 'partial-retention',
        vac: 'medium',
        harvestYear: null,
        clearcutPercent: null,
        geometry: rectangle(150, 1050, 0, 600),
        source: 'Illustrative driving demo; not a verified landform',
      },
    ],
  }
}

export function roadsideDriveCue(distance: number): string {
  if (distance < DEMO_OPENING_START)
    return `Opening on your right in ${Math.round(DEMO_OPENING_START - distance)} m. Trees screen it on the approach.`
  if (distance <= DEMO_OPENING_END)
    return 'Alongside the opening. Look right, or face the cutblock, then compare before and after.'
  return 'Past the opening. Roadside timber closes the view again; look back to see the trailing edge.'
}
