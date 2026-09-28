import { createContext } from 'react'

export type EditorialBasemap = 'source' | 'pgmaps-dark' | 'pgmaps'
export const EditorialBasemapContext = createContext<EditorialBasemap>('source')
/** Local cartography; tile and font services are shared with the rest of PGMaps. */
export const EDITORIAL_BASEMAP_STYLE = '/map-styles/story-charcoal.json'
