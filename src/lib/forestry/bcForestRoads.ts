/**
 * BC's forest tenure road sections (Forest Service Roads and road permits), as every tool that
 * reads them live names them: the road designer's existing roads
 * (`src/pages/dev-forestry-roads/existingRoads.ts`) and the outdoors planner's forest road layer
 * (`src/maps/outdoors/`). A tenure record says a road was authorised, never that it was built, is
 * open or can be driven. No DOM or network access.
 */

/** Layer 196 of the current BCGW service: Forest Tenure Road Section Lines. */
export const BC_ROADS_SERVICE = 'https://delivery.maps.gov.bc.ca/arcgis/rest/services/mpcm/bcgwpub/MapServer/196'
export const BC_ROADS_CATALOGUE = 'https://catalogue.data.gov.bc.ca/dataset/243c94a1-f275-41dc-bc37-91d8a2b26e10'
/** The tenure file type of a Forest Service Road. */
export const FSR_FILE_TYPE_CODE = 'B40'
/** The tenure file type of a road permit. */
export const ROAD_PERMIT_FILE_TYPE_CODE = 'B01'

/** What a tenure file type says about a road, as the designer classes it; anything else is unclassed. */
export function tenureRoadClass(fileTypeCode: unknown): 'fsr' | 'permit' | undefined {
  if (fileTypeCode === FSR_FILE_TYPE_CODE) return 'fsr'
  if (fileTypeCode === ROAD_PERMIT_FILE_TYPE_CODE) return 'permit'
  return undefined
}
