export type RasterLevel = {
  id: string
  label: string
  minZoom: number
  manifest: string
  overview: boolean
}

/** A small deadband prevents repeated fetch/swap work at a zoom boundary. */
export function selectRasterLevel(levels: RasterLevel[], zoom: number, current?: RasterLevel): RasterLevel {
  const candidate = [...levels].reverse().find((level) => zoom >= level.minZoom) ?? levels[0]
  if (current && candidate !== current) {
    const boundary = candidate.minZoom > current.minZoom ? levels[levels.indexOf(current) + 1].minZoom : current.minZoom
    if (Math.abs(zoom - boundary) < 0.2) return current
  }
  return candidate
}

/** Keep the previous level until the replacement covers the visible viewport. */
export function canPublishRasterLevel(current: string | undefined, next: string, loaded: number, total: number) {
  return !current || current === next || loaded === total
}
