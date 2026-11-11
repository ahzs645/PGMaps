import { createEmptyScene, createId, type ForestryScene } from './scene'

export const PURDEN_LAKE_SAMPLE_ID = 'purden-lake-hwy16-sample'

/**
 * Hwy 16 along Purden Lake, about 60 km east of Prince George, from the road
 * atlas (DRA), simplified to 15 m.
 */
const HWY_16: Array<[number, number]> = [
  [-121.99, 53.89785],
  [-121.98615, 53.89488],
  [-121.98281, 53.89321],
  [-121.97803, 53.89222],
  [-121.97533, 53.89216],
  [-121.97293, 53.89238],
  [-121.94523, 53.89728],
  [-121.93018, 53.90211],
  [-121.92599, 53.90411],
  [-121.92349, 53.90482],
  [-121.91148, 53.90595],
  [-121.90564, 53.90565],
  [-121.90294, 53.90598],
  [-121.90128, 53.9066],
  [-121.89583, 53.90993],
  [-121.89408, 53.91068],
  [-121.89228, 53.91114],
  [-121.88847, 53.91168],
  [-121.88343, 53.91327],
  [-121.87756, 53.91442],
  [-121.87613, 53.9151],
  [-121.87312, 53.91719],
  [-121.87164, 53.91785],
  [-121.86925, 53.91809],
  [-121.86516, 53.9176],
  [-121.86358, 53.91786],
  [-121.862, 53.91854],
]

/**
 * The lake's north face as the Visual Landscape Inventory maps it: polygon 337
 * (Retention) with the Partial Retention band 350 across it, joined and
 * simplified to 40 m.
 */
const NORTH_FACE: Array<[number, number]> = [
  [-121.97562, 53.92184],
  [-121.96781, 53.92397],
  [-121.96434, 53.92576],
  [-121.95782, 53.92769],
  [-121.95335, 53.93312],
  [-121.93359, 53.93705],
  [-121.92644, 53.94076],
  [-121.92306, 53.94095],
  [-121.91531, 53.93965],
  [-121.91071, 53.93991],
  [-121.90452, 53.9392],
  [-121.90149, 53.93984],
  [-121.89496, 53.94324],
  [-121.8908, 53.94298],
  [-121.8882, 53.9418],
  [-121.8852, 53.9418],
  [-121.8815, 53.94034],
  [-121.89039, 53.93677],
  [-121.8987, 53.93129],
  [-121.90593, 53.92958],
  [-121.91254, 53.92644],
  [-121.91498, 53.92577],
  [-121.91982, 53.92556],
  [-121.92555, 53.92361],
  [-121.93241, 53.92269],
  [-121.94145, 53.92435],
  [-121.94598, 53.92233],
  [-121.9563, 53.91915],
  [-121.96634, 53.91372],
  [-121.97088, 53.91303],
  [-121.97461, 53.91342],
  [-121.96947, 53.91783],
  [-121.96811, 53.92077],
  [-121.97027, 53.92173],
  [-121.97562, 53.92184],
]

/** About 59 ha laid along the contour: two thirds over the Retention polygon, a third over the PR band. */
const BLOCK: Array<[number, number]> = [
  [-121.936, 53.9258],
  [-121.929, 53.9246],
  [-121.922, 53.9262],
  [-121.9205, 53.929],
  [-121.926, 53.9312],
  [-121.933, 53.931],
  [-121.9375, 53.9288],
  [-121.936, 53.9258],
]

/**
 * A realistic planner's case on real ground: a hypothetical cutblock on the
 * north face of Purden Lake, 2.2 km across the water from Hwy 16, where the
 * inventory's highway viewpoints aim their arrows. The block is invented; the
 * road, the landform and everything **Load around the block** finds (VLI
 * viewpoints and arrows, EVQO, openings, rec sites) are BC's own records.
 */
export function createPurdenLakeScene(): ForestryScene {
  const scene = createEmptyScene()
  const landformId = createId('landscape')
  return {
    ...scene,
    activeLandformId: landformId,
    viewpoint: { id: PURDEN_LAKE_SAMPLE_ID, name: 'Hwy 16 along Purden Lake', mode: 'corridor', coordinates: HWY_16 },
    targets: [
      {
        id: createId('block'),
        name: 'PL-1 — Purden Lake north face',
        role: 'block',
        objectiveId: 'retention',
        vac: null,
        harvestYear: null,
        clearcutPercent: null,
        geometry: { type: 'Polygon', coordinates: [BLOCK] },
        source: 'Sample scenario: a hypothetical block, not a recorded or proposed harvest',
        planning: { blockId: 'PL-1' },
      },
      {
        id: landformId,
        name: 'Purden Lake north face (VLI 337 and 350)',
        role: 'landscape',
        objectiveId: 'retention',
        // Polygon 337's VAC; the PR band, 350, is rated medium.
        vac: 'low',
        harvestYear: null,
        clearcutPercent: null,
        geometry: { type: 'Polygon', coordinates: [NORTH_FACE] },
        source: 'BC Visual Landscape Inventory polygons 337 and 350, joined',
      },
    ],
  }
}
