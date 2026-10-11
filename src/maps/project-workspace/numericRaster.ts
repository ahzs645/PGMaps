export type RasterColor = [number, number, number, number]
export type NumericRasterStyle = {
  interpolation: 'linear'
  clip: boolean
  opacity: number
  stops: Array<{ value: number; color: RasterColor; label?: string }>
}
export type NumericRasterManifest = {
  format: 'numeric-raster-polygons-v1'
  label: string
  units: string
  scenario: string
  percentile: string
  period: string
  baseline: string
  attribution: string
  style: NumericRasterStyle
  tiles: Array<{ id: string; path: string; bounds: [number, number, number, number] }>
}

export function parseNumericRasterManifest(value: unknown): NumericRasterManifest {
  const m = value as NumericRasterManifest | null
  if (
    !m ||
    m.format !== 'numeric-raster-polygons-v1' ||
    !['label', 'units', 'scenario', 'percentile', 'period', 'baseline', 'attribution'].every(
      (k) => typeof m[k as keyof NumericRasterManifest] === 'string',
    ) ||
    !Array.isArray(m.tiles) ||
    m.style?.interpolation !== 'linear' ||
    typeof m.style.clip !== 'boolean' ||
    !Number.isFinite(m.style.opacity) ||
    m.style.opacity < 0 ||
    m.style.opacity > 1 ||
    !Array.isArray(m.style.stops) ||
    m.style.stops.length < 2 ||
    m.style.stops.some(
      (stop, i, stops) =>
        !Number.isFinite(stop?.value) ||
        (i > 0 && stop.value <= stops[i - 1].value) ||
        !Array.isArray(stop.color) ||
        stop.color.length !== 4 ||
        stop.color.some((c) => !Number.isInteger(c) || c < 0 || c > 255),
    ) ||
    m.tiles.some(
      (tile) =>
        typeof tile?.id !== 'string' ||
        typeof tile.path !== 'string' ||
        !Array.isArray(tile.bounds) ||
        tile.bounds.length !== 4 ||
        tile.bounds.some((c) => !Number.isFinite(c)),
    )
  ) {
    throw new Error('Invalid numeric raster manifest or source colour ramp')
  }
  return m
}

/** Matches QgsColorRampShader's interpolated Float32 arithmetic and integer channel truncation. */
export function numericRasterColor(style: NumericRasterStyle, value: number): RasterColor {
  const stops = style.stops
  if (!Number.isFinite(value)) return [0, 0, 0, 0]
  if (style.clip && (value < stops[0].value || value > stops[stops.length - 1].value)) return [0, 0, 0, 0]
  const high = stops.findIndex((stop) => stop.value >= value)
  if (high === 0) return stops[0].color
  if (high < 0) return stops[stops.length - 1].color
  const a = stops[high - 1],
    b = stops[high]
  if (value === b.value) return b.color
  const scale = Math.fround(Math.fround(value - a.value) / Math.fround(b.value - a.value))
  return a.color.map((c, i) => c + Math.trunc(Math.fround((b.color[i] - c) * scale))) as RasterColor
}

export function numericRasterGradient(style: NumericRasterStyle): string[] {
  const min = style.stops[0].value,
    max = style.stops[style.stops.length - 1].value
  return style.stops.map(
    ({ value, color: [r, g, b, a] }) => `rgba(${r}, ${g}, ${b}, ${a / 255}) ${((value - min) / (max - min)) * 100}%`,
  )
}
