export type NetworkTileProvider = 'bell' | 'rogers' | 'telus'

/** Saved ranges, not the higher limits advertised by live source services. */
export function networkSourceLevels(provider: NetworkTileProvider, layerId: string, selectedLevel: string = 'auto') {
  const saved = provider === 'bell' ? { min: 4, max: 10 }
    : provider === 'rogers' ? { min: 3, max: 10 }
    : { min: 0, max: layerId === 'telus-lte' ? 6 : 5 }
  if (selectedLevel === 'auto') return saved
  const zoom = Number(selectedLevel)
  if (!Number.isInteger(zoom) || zoom < saved.min || zoom > saved.max) return null
  return { min: zoom, max: zoom }
}
