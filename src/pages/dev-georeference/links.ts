/** Keep capability-scoped collection URLs in the fragment, never in public source defaults. */
export function georeferenceLink(catalogue?: string, map?: string, source?: string): string {
  const params = new URLSearchParams()
  if (catalogue) params.set('catalog', catalogue)
  if (map) params.set('map', map)
  if (source) params.set('source', source)
  return '/dev/georeference' + (params.size ? '#' + params.toString() : '')
}
