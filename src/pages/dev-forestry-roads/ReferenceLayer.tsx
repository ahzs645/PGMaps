import type { LayerSpecification } from 'maplibre-gl'
import { MapMarker, MarkerContent } from '@/components/ui/map'
import type { PlanLegendSection } from './planLegendModel'
import { referenceShape, type ReferenceFeature } from './referenceFeatures'

/** Point names drawn on the plan; beyond this the dots stay and the sidebar list names them. */
export const MAX_REFERENCE_LABELS = 80
const LINE_COLOR = '#334155',
  POINT_COLOR = '#f59e0b'

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
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'fill-color': LINE_COLOR, 'fill-opacity': 0.06 },
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
    paint: { 'line-color': LINE_COLOR, 'line-width': 1.75, 'line-dasharray': [4, 2.5] },
  },
  {
    id: 'road-reference-point',
    type: 'circle',
    source: REFERENCE_SOURCE,
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-radius': 6,
      'circle-color': POINT_COLOR,
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
  const has = (shape: ReturnType<typeof referenceShape>) => features.some((f) => referenceShape(f) === shape)
  const entries = [
    ...(has('line')
      ? [
          {
            id: 'reference-line',
            label: 'Reference line',
            color: LINE_COLOR,
            shape: 'dashed-line' as const,
            dash: [4, 2.5] as [number, number],
          },
        ]
      : []),
    ...(has('area')
      ? [{ id: 'reference-area', label: 'Reference area', color: LINE_COLOR, shape: 'area' as const }]
      : []),
    ...(has('point')
      ? [{ id: 'reference-point', label: 'Named point', color: POINT_COLOR, shape: 'circle' as const }]
      : []),
  ]
  return entries.length ? [{ id: 'reference', title: 'Reference layers', entries }] : []
}

/** The names of the project's reference points, beside their dots. Display only. */
export function ReferenceLabels({ features, visible }: { features: readonly ReferenceFeature[]; visible: boolean }) {
  if (!visible) return null
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
