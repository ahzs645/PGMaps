import { useMemo } from 'react'
import { MapCircleLayer, MapFillLayer } from '@/components/ui/map-layers'
import { provincialEvidenceGeoJson, type ProvincialStreamData } from './provincialStreamData'

const escape = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
const evidenceHtml = (p: Record<string, unknown>) =>
  p.kind === 'fish-observation'
    ? `<strong>${escape(p.name)}</strong><br>Fish observation · ${escape(p.observed_on ?? 'date not recorded')}<br>${escape(p.waterbody ?? 'waterbody not recorded')}<br>Source evidence; review its relevance to this stream.`
    : `<strong>${escape(p.name)}</strong><br>Community watershed · ${escape(p.code)}<br>${escape(p.legislation)}<br>Mapped designation; review the reach against the boundary.`

export function ProvincialStreamLayers({ data }: { data?: ProvincialStreamData }) {
  const collections = useMemo(() => {
    const all = data ? provincialEvidenceGeoJson(data) : { type: 'FeatureCollection' as const, features: [] }
    return {
      fish: {
        type: 'FeatureCollection' as const,
        features: all.features
          .filter((f) => f.geometry.type === 'Point')
          .map((f) => ({ ...f, properties: { ...f.properties, id: f.id } })),
      },
      watersheds: {
        type: 'FeatureCollection' as const,
        features: all.features
          .filter((f) => f.geometry.type !== 'Point')
          .map((f) => ({ ...f, properties: { ...f.properties, id: f.id } })),
      },
    }
  }, [data])
  if (!data) return null
  return (
    <>
      <MapFillLayer
        sourceKey="road-provincial-watersheds"
        data={collections.watersheds}
        fillColor="#d97706"
        fillOpacity={0.04}
        lineColor="#d97706"
        lineOpacity={0.8}
        lineWidth={1.5}
        hoverHtml={evidenceHtml}
      />
      <MapCircleLayer
        sourceKey="road-provincial-fish"
        data={collections.fish}
        color="#7c3aed"
        radius={4}
        hoverHtml={evidenceHtml}
        clickHtml={evidenceHtml}
      />
    </>
  )
}
