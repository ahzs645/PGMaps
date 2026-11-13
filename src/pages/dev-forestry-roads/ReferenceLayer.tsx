import type { ExpressionSpecification, LayerSpecification } from 'maplibre-gl'
import { MapMarker, MarkerContent } from '@/components/ui/map'
import { MapImageLayer } from '@/components/ui/map-layers'
import type { PlanLegendSection } from './planLegendModel'
import { referenceGeoJson, referenceLayers, referenceShape, type ReferenceFeature } from './referenceFeatures'

/** Point names drawn on the plan; beyond this the dots stay and the sidebar list names them. */
export const MAX_REFERENCE_LABELS = 80
const LINE_COLOR = '#334155',
  POINT_COLOR = '#f59e0b'
const LAYER_COLORS = ['#2563eb', '#7c3aed', '#047857', '#b45309', '#be185d', '#0891b2', '#4338ca', '#a21caf', '#0f766e']

export function referenceLayerColor(key: string): string {
  let hash = 0
  for (const char of key.split('/').at(-1) ?? '') hash = (Math.imul(31, hash) + char.charCodeAt(0)) | 0
  return key ? LAYER_COLORS[(hash >>> 0) % LAYER_COLORS.length] : LINE_COLOR
}

export function referencePlanData(features: readonly ReferenceFeature[]) {
  const data = referenceGeoJson(features, false)
  for (const feature of data.features) {
    const key = String(feature.properties?.source ?? '')
    if (key) feature.properties = { ...feature.properties, layerColor: referenceLayerColor(key) }
  }
  return data
}

const layerColor = (fallback: string): ExpressionSpecification => ['coalesce', ['get', 'layerColor'], fallback]

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
    filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['!=', ['get', 'imageFrame'], true]],
    paint: { 'fill-color': layerColor(LINE_COLOR), 'fill-opacity': 0.13 },
  },
  {
    id: 'road-reference-casing',
    type: 'line',
    source: REFERENCE_SOURCE,
    filter: ['!=', ['geometry-type'], 'Point'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': 4, 'line-opacity': 0.75 },
  },
  {
    id: 'road-reference-line',
    type: 'line',
    source: REFERENCE_SOURCE,
    filter: ['!=', ['geometry-type'], 'Point'],
    layout: { 'line-join': 'round' },
    paint: { 'line-color': layerColor(LINE_COLOR), 'line-width': 1.75, 'line-dasharray': [4, 2.5] },
  },
  {
    id: 'road-reference-point',
    type: 'circle',
    source: REFERENCE_SOURCE,
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-radius': 6,
      'circle-color': layerColor(POINT_COLOR),
      'circle-stroke-color': '#0f172a',
      'circle-stroke-width': 2,
    },
  },
] as const satisfies readonly LayerSpecification[]
/** Linework and area layers, drawn under the plan's context; the point layer is drawn under the road. */
export const REFERENCE_LINEWORK_LAYER_IDS = ['road-reference-fill', 'road-reference-casing', 'road-reference-line']
export const REFERENCE_POINT_LAYER_ID = 'road-reference-point'
/** The legend section for the reference features on the plan; empty when there are none. */
export function referenceLegend(features: readonly ReferenceFeature[]): PlanLegendSection[] {
  const entries = referenceLayers(features.filter((f) => !f.classGrid)).flatMap(({ key, name, features }) => {
    const shapes = [...new Set(features.map(referenceShape))]
    return shapes.map((shape) => ({
      id: `${key}:${shape}`,
      label: key ? name : shape === 'point' ? 'Named point' : `Reference ${shape}`,
      color: key ? referenceLayerColor(key) : shape === 'point' ? POINT_COLOR : LINE_COLOR,
      shape: shape === 'line' ? ('dashed-line' as const) : shape === 'point' ? ('circle' as const) : ('area' as const),
      dash: [4, 2.5] as [number, number],
    }))
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
