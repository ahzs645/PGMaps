/**
 * Keeps MapLibre's compact attribution folded to its ⓘ button until the user opens it.
 *
 * MapLibre opens the compact attribution when the map loads, and again when the first source with an
 * attribution arrives, and folds it only after the map is dragged. On a map that is not dragged (a
 * fitted plan, an export) the open box covered the bottom of the map and printed into the map PDF.
 * The credits stay one click away, and exports print them in their own footer.
 *
 * Opt in with `keepAttributionFolded(map.getContainer())`; it returns a disposer.
 */
export function keepAttributionFolded(container: HTMLElement): () => void {
  let userOpened = false
  const fold = () => {
    const attribution = container.querySelector<HTMLElement>('.maplibregl-ctrl-attrib.maplibregl-compact')
    if (!attribution || userOpened || !attribution.classList.contains('maplibregl-compact-show')) return
    attribution.classList.remove('maplibregl-compact-show')
    // MapLibre's own fold leaves `open` set on the <details>; match it so its toggle keeps working.
    attribution.setAttribute('open', '')
  }
  const onClick = (event: Event) => {
    const target = event.target as Element | null
    if (target?.closest('.maplibregl-ctrl-attrib-button')) userOpened = true
  }
  const observer = new MutationObserver(fold)
  observer.observe(container, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true })
  container.addEventListener('click', onClick, true)
  fold()
  return () => {
    observer.disconnect()
    container.removeEventListener('click', onClick, true)
  }
}
