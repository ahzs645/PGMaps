/** The active map layout owns revealing and focusing its search control. */
export const MAP_SEARCH_REQUEST = 'pgmaps:request-panel-search'

export function requestMapSearch(): boolean {
  const layout = document.querySelector('[data-map-layout-root="true"]')
  if (!layout) return false
  return !layout.dispatchEvent(new CustomEvent(MAP_SEARCH_REQUEST, { cancelable: true }))
}
