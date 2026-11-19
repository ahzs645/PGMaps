/**
 * The DataBC WFS layers BC's viewpoint inventory is read from (`viewpointInventory.ts` says what each
 * holds and how it is read). A leaf on purpose: an e2e spec stubs these layers by name and imports them
 * from here without pulling the page's modules into Node.
 */
export const VIEWPOINT_LAYERS = {
  viewpoints: 'WHSE_FOREST_VEGETATION.REC_VIEWPOINT_POINT_SVW',
  arrows: 'WHSE_FOREST_VEGETATION.REC_VIEWING_DIRECTION_LIN',
  screenings: 'WHSE_FOREST_VEGETATION.REC_SCREENINGS_POLY',
  recSites: 'WHSE_FOREST_TENURE.FTEN_REC_SITE_POINTS_SVW',
  roads: 'WHSE_FOREST_TENURE.FTEN_ROAD_SECTION_LINES_SVW',
} as const
