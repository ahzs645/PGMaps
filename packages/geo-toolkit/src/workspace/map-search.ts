export const MAP_SEARCH_REQUEST = 'pgmaps:request-panel-search'
/** Explicit root prevents search actions selecting another embedded workspace. */
export function requestMapSearch(root: HTMLElement): boolean {
  return !root.dispatchEvent(new CustomEvent(MAP_SEARCH_REQUEST, { cancelable: true }))
}
