/**
 * The riparian screen as it is drawn: one dissolved zone per band instead of one buffer per stream reach.
 *
 * Provincial stream data arrives as short reaches, and `riparianMapFeatures` buffers each one with
 * round ends, so a creek of 27 reaches drew 27 overlapping outlines: circles at every joint and the
 * hatch drawn twice wherever buffers overlapped, which read as a denser class. Printed block-map
 * sheets show one zone with one outer edge. Bands are stacked by precedence (reserve, then
 * management, then the unresolved screen) and each is drawn only outside the bands above it, since a
 * stream's management feature is its whole outer envelope, reserve included.
 *
 * Display only: the per-reach features stay the data for the riparian register, route screening,
 * Review and exports. If a union fails on odd geometry the per-reach shapes are returned unchanged,
 * so the map still draws the screen. Free of DOM access.
 */
import clipping, { type MultiPolygon as ClipMultiPolygon, type Polygon as ClipPolygon } from 'polygon-clipping'

export type RiparianDisplayBand = 'reserve' | 'management' | 'uncertain'

/** Strictest first: a band is drawn only where no band before it is. */
export const RIPARIAN_BAND_PRECEDENCE: readonly RiparianDisplayBand[] = ['reserve', 'management', 'uncertain']

export interface RiparianMergeResult {
  /** One Polygon feature per part of each band's dissolved zone (MapLibre 6 filters on `Polygon`). */
  features: GeoJSON.Feature<GeoJSON.Polygon>[]
  /** False when a union failed and the per-reach shapes were kept. */
  merged: boolean
}

const asClip = (geometry: GeoJSON.Geometry): ClipMultiPolygon | null =>
  geometry.type === 'Polygon'
    ? [geometry.coordinates as ClipPolygon]
    : geometry.type === 'MultiPolygon'
      ? (geometry.coordinates as ClipMultiPolygon)
      : null

/**
 * Dissolves riparian screening features by band. `bandOf` reads a feature's band; pass a mapping to
 * merge two bands into one (a block sheet draws the unresolved screen as management).
 */
export function mergeRiparianZones(
  features: readonly GeoJSON.Feature[],
  bandOf: (feature: GeoJSON.Feature) => RiparianDisplayBand | null = (feature) => {
    const band = feature.properties?.riparianBand
    return band === 'reserve' || band === 'management' || band === 'uncertain' ? band : null
  },
): RiparianMergeResult {
  const byBand = new Map<RiparianDisplayBand, { shapes: ClipMultiPolygon[]; reaches: number; classes: Set<string> }>()
  for (const feature of features) {
    const band = bandOf(feature)
    const shape = feature.geometry ? asClip(feature.geometry) : null
    if (!band || !shape) continue
    const entry = byBand.get(band) ?? { shapes: [], reaches: 0, classes: new Set<string>() }
    entry.shapes.push(shape)
    entry.reaches += 1
    const riparianClass = feature.properties?.riparianClass
    if (typeof riparianClass === 'string') entry.classes.add(riparianClass)
    byBand.set(band, entry)
  }
  try {
    const out: GeoJSON.Feature<GeoJSON.Polygon>[] = []
    let above: ClipMultiPolygon = []
    for (const band of RIPARIAN_BAND_PRECEDENCE) {
      const entry = byBand.get(band)
      if (!entry?.shapes.length) continue
      const [first, ...rest] = entry.shapes
      const zone = rest.length ? clipping.union(first, ...rest) : first
      const visible = above.length ? clipping.difference(zone, above) : zone
      above = above.length ? clipping.union(above, zone) : zone
      for (const part of visible)
        out.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: part },
          properties: {
            kind: 'stream',
            screening: true,
            preliminary: true,
            riparianBand: band,
            riparianMerged: true,
            reaches: entry.reaches,
            riparianClasses: [...entry.classes].sort().join(', '),
          },
        })
    }
    return { features: out, merged: true }
  } catch {
    return {
      merged: false,
      features: features.flatMap((feature) => {
        const band = bandOf(feature)
        const geometry = feature.geometry
        if (!band || !geometry) return []
        const polygons =
          geometry.type === 'Polygon'
            ? [geometry.coordinates]
            : geometry.type === 'MultiPolygon'
              ? geometry.coordinates
              : []
        return polygons.map((coordinates) => ({
          type: 'Feature' as const,
          geometry: { type: 'Polygon' as const, coordinates },
          properties: { ...feature.properties, riparianBand: band },
        }))
      }),
    }
  }
}
