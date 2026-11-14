import type { ExpressionSpecification, LayerSpecification } from 'maplibre-gl'
import { MapMarker, MarkerContent } from '@/components/ui/map'
import { MapImageLayer } from '@/components/ui/map-layers'
import type { PlanLegendSection } from './planLegendModel'
import { PX_PER_PT } from '@/lib/mapSheet/symbolRaster'
import { LINE_DASH_PRESETS, LINE_DASH_UNITS, LINE_MARKER_SPACING } from '@/lib/mapSheet/symbolStyle'
import {
  referenceGeoJson,
  referenceLayers,
  referenceShape,
  type ReferenceFeature,
  type ReferenceShape,
} from './referenceFeatures'
import {
  REFERENCE_LINE_COLOR,
  REFERENCE_POINT_COLOR,
  referenceLayerColor,
  referenceLayerSymbol,
  referenceStyleFor,
  referenceStyleProperties,
  type ReferenceLayerStyle,
} from './referenceStyles'

/** Point names drawn on the plan; beyond this the dots stay and the sidebar list names them. */
export const MAX_REFERENCE_LABELS = 80
const LINE_COLOR = REFERENCE_LINE_COLOR,
  POINT_COLOR = REFERENCE_POINT_COLOR

export { referenceLayerColor }

/**
 * The plan's reference source. Each feature carries its layer's colour, and a layer the person
 * has restyled adds only what they set (`referenceStyleProperties`), so the layers below draw an
 * unstyled layer from their own defaults.
 */
export function referencePlanData(features: readonly ReferenceFeature[], styles?: readonly ReferenceLayerStyle[]) {
  const data = referenceGeoJson(features, false)
  for (const feature of data.features) {
    const key = String(feature.properties?.source ?? '')
    const style = referenceStyleFor(styles, key)
    if (!key && !style) continue
    feature.properties = {
      ...feature.properties,
      ...(key || style?.color ? { layerColor: referenceLayerColor(key, styles) } : {}),
      ...referenceStyleProperties(
        key,
        feature.properties?.shape as ReferenceShape,
        style,
        firstLatitude(feature.geometry),
      ),
    }
  }
  return data
}

/** The latitude of a geometry's first vertex: near enough for the Mercator scale across one feature. */
function firstLatitude(geometry: GeoJSON.Geometry): number {
  let at: unknown = 'coordinates' in geometry ? geometry.coordinates : []
  while (Array.isArray(at) && Array.isArray(at[0])) at = at[0]
  return Array.isArray(at) && typeof at[1] === 'number' ? at[1] : 0
}

const layerColor = (fallback: string): ExpressionSpecification => ['coalesce', ['get', 'layerColor'], fallback]
/** A layer's own fill opacity where the person set it, else the reference default. */
export const REFERENCE_FILL_OPACITY: ExpressionSpecification = ['coalesce', ['get', 'fillOpacity'], 0.13]
/** Web Mercator metres to a pixel at zoom 0, on MapLibre's 512 px world. */
const MERCATOR_M_PER_PX_AT_ZOOM_0 = (2 * Math.PI * 6378137) / 512
const MAX_ZOOM = 24
/**
 * A reference line's width in pixels: the width the person set, else 1.75 px; `extra` px wider
 * for the casing; 1.75 px wider for the feature being located. A layer with a ground width is
 * drawn to scale instead. MapLibre takes `zoom` only at the top of an expression, so both kinds
 * share one exponential interpolation: base 2 between zoom 0 and 24 is exact for a width that
 * doubles each zoom, and a pixel width is the same at both ends, so it stays constant.
 */
export function referenceLineWidth(extra = 0, focusedId?: string | null): ExpressionSpecification {
  const pixels: ExpressionSpecification = ['coalesce', ['get', 'lineWidth'], 1.75]
  const bonus: ExpressionSpecification = ['+', extra, ['case', ['==', ['get', 'id'], focusedId ?? ''], 1.75, 0]]
  const at = (zoom: number): ExpressionSpecification => [
    '+',
    bonus,
    ['case', ['has', 'lineWidthM'], ['*', ['get', 'lineWidthM'], 2 ** zoom / MERCATOR_M_PER_PX_AT_ZOOM_0], pixels],
  ]
  return ['interpolate', ['exponential', 2], ['zoom'], 0, at(0), MAX_ZOOM, at(MAX_ZOOM)]
}
/**
 * GeoJSON properties cannot carry an array to the style, so the dash travels by name: a preset by
 * its id, a custom dash by a key the project's styles map back to its lengths.
 */
export function referenceLineDash(custom: ReadonlyMap<string, readonly number[]> = new Map()) {
  return [
    'match',
    ['get', 'lineDash'],
    ...LINE_DASH_PRESETS.flatMap((dash) => [dash, ['literal', LINE_DASH_UNITS[dash] ?? [1, 0]]]),
    ...[...custom].flatMap(([key, lengths]) => [key, ['literal', lengths]]),
    ['literal', [4, 2.5]],
  ] as unknown as ExpressionSpecification
}
const NOT_IMAGE_FRAME: ExpressionSpecification = ['!=', ['get', 'imageFrame'], true]

export const REFERENCE_SOURCE = 'road-reference'
/**
 * The reference layers, bottom first: grey dashed linework with a light casing so it reads on
 * hillshade and basemap alike, and each point as a ringed dot. `PlanView` adds them to its ordered
 * layer group, the linework under streams and constraints and the points under the road, so a
 * terrain image or a later edit cannot change what they sit under.
 */
export const REFERENCE_LAYERS = [
  {
    id: 'road-reference-fill',
    type: 'fill',
    source: REFERENCE_SOURCE,
    filter: ['all', ['==', ['geometry-type'], 'Polygon'], NOT_IMAGE_FRAME, ['!', ['has', 'pattern']]],
    paint: { 'fill-color': layerColor(LINE_COLOR), 'fill-opacity': REFERENCE_FILL_OPACITY },
  },
  {
    // A hatched or dotted area: the tile carries the tint as well as the pattern.
    id: 'road-reference-pattern',
    type: 'fill',
    source: REFERENCE_SOURCE,
    filter: ['all', ['==', ['geometry-type'], 'Polygon'], NOT_IMAGE_FRAME, ['has', 'pattern']],
    paint: { 'fill-pattern': ['get', 'pattern'] },
  },
  {
    id: 'road-reference-casing',
    type: 'line',
    source: REFERENCE_SOURCE,
    filter: ['!=', ['geometry-type'], 'Point'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': referenceLineWidth(2.25), 'line-opacity': 0.75 },
  },
  {
    id: 'road-reference-line',
    type: 'line',
    source: REFERENCE_SOURCE,
    filter: ['!=', ['geometry-type'], 'Point'],
    layout: { 'line-join': 'round' },
    paint: {
      'line-color': layerColor(LINE_COLOR),
      'line-width': referenceLineWidth(),
      'line-dasharray': referenceLineDash(),
    },
  },
  {
    // Arrows, ticks or dots repeated along a line; the image is in the layer's colour.
    id: 'road-reference-marker',
    type: 'symbol',
    source: REFERENCE_SOURCE,
    filter: ['has', 'lineMarker'],
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': LINE_MARKER_SPACING * PX_PER_PT,
      'icon-image': ['get', 'lineMarker'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  },
  {
    id: 'road-reference-point',
    type: 'circle',
    source: REFERENCE_SOURCE,
    filter: ['all', ['==', ['geometry-type'], 'Point'], ['!', ['has', 'pointIcon']]],
    paint: {
      'circle-radius': 6,
      'circle-color': layerColor(POINT_COLOR),
      'circle-stroke-color': '#0f172a',
      'circle-stroke-width': 2,
    },
  },
  {
    id: 'road-reference-icon',
    type: 'symbol',
    source: REFERENCE_SOURCE,
    filter: ['all', ['==', ['geometry-type'], 'Point'], ['has', 'pointIcon']],
    layout: { 'icon-image': ['get', 'pointIcon'], 'icon-allow-overlap': true, 'icon-ignore-placement': true },
  },
] satisfies readonly LayerSpecification[]
/** Linework and area layers, drawn under the plan's context; the point layer is drawn under the road. */
export const REFERENCE_LINEWORK_LAYER_IDS = [
  'road-reference-fill',
  'road-reference-pattern',
  'road-reference-casing',
  'road-reference-line',
  'road-reference-marker',
]
export const REFERENCE_POINT_LAYER_ID = 'road-reference-point'
/** A point layer given a shape or a size draws as its icon instead of the ringed dot. */
export const REFERENCE_ICON_LAYER_ID = 'road-reference-icon'
/** The legend section for the reference features on the plan; empty when there are none. */
export function referenceLegend(
  features: readonly ReferenceFeature[],
  styles?: readonly ReferenceLayerStyle[],
): PlanLegendSection[] {
  const entries = referenceLayers(features.filter((f) => !f.classGrid)).flatMap(({ key, name, features }) => {
    const shapes = [...new Set(features.map(referenceShape))]
    const style = referenceStyleFor(styles, key)
    return shapes.map((shape) => {
      const label = key ? name : shape === 'point' ? 'Named point' : `Reference ${shape}`
      return {
        id: `${key}:${shape}`,
        label,
        color: key || style?.color ? referenceLayerColor(key, styles) : shape === 'point' ? POINT_COLOR : LINE_COLOR,
        shape:
          shape === 'line' ? ('dashed-line' as const) : shape === 'point' ? ('circle' as const) : ('area' as const),
        dash: [4, 2.5] as [number, number],
        // A restyled layer's key is its own symbol, so a hatch or a solid line reads as one.
        ...(style && (shape !== 'point' || style.icon !== undefined || style.size !== undefined)
          ? { sheetSymbol: referenceLayerSymbol(key, label, shape, style) }
          : {}),
      }
    })
  })
  const rasters = features.flatMap((feature) =>
    feature.classGrid
      ? [
          {
            id: `pdf-classes-${feature.id}`,
            title: `${feature.name} · PDF`,
            entries: [
              ...feature.classGrid.legend.map((range, i) => ({
                id: `${feature.id}-${i}`,
                label: `${range.label} ${feature.classGrid!.unit}`,
                color: `#${range.color.map((c) => c.toString(16).padStart(2, '0')).join('')}`,
                shape: 'square' as const,
              })),
              {
                id: `${feature.id}-unknown`,
                label: 'Unknown transparent; JPEG estimates faded',
                color: '#64748b',
                shape: 'square' as const,
              },
            ],
          },
        ]
      : [],
  )
  return [...(entries.length ? [{ id: 'reference', title: 'Reference layers', entries }] : []), ...rasters]
}

/** The names of the project's reference points, beside their dots. Display only. */
export function ReferenceLabels({ features }: { features: readonly ReferenceFeature[] }) {
  return (
    <>
      {features
        .filter((feature) => feature.geometry.type === 'Point')
        .slice(0, MAX_REFERENCE_LABELS)
        .map((feature) => {
          const [longitude, latitude] = (feature.geometry as GeoJSON.Point).coordinates
          return (
            <MapMarker key={feature.id} longitude={longitude} latitude={latitude}>
              <MarkerContent>
                <span
                  className="pointer-events-none block translate-x-[calc(50%+10px)] whitespace-nowrap rounded-sm bg-background/90 px-1 text-2xs font-medium leading-4 text-foreground shadow-sm"
                  data-reference-point={feature.id}
                >
                  {feature.name}
                </span>
              </MarkerContent>
            </MapMarker>
          )
        })}
    </>
  )
}

/** Source-sheet previews share their reference layer's visibility; no numerical raster is created. */
export function ReferenceSheets({ features }: { features: readonly ReferenceFeature[] }) {
  return (
    <>
      {features
        .filter((feature) => feature.sheet)
        .map((feature) => (
          <MapImageLayer
            key={feature.id}
            id={`road-source-sheet-${feature.id}`}
            url={feature.sheet!.image}
            coordinates={feature.sheet!.corners}
            opacity={0.8}
            beforeId="road-contours"
          />
        ))}
    </>
  )
}
