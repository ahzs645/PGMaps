import { useMemo } from 'react'
import { MapCircleLayer, MapFillLayer } from '@/components/ui/map-layers'
import { mapTooltipHtml } from '@/components/ui/map-tooltip-card'
import { provincialEvidenceGeoJson, type ProvincialStreamData } from './provincialStreamData'

const escape = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
const evidence = (p: Record<string, unknown>) => ({
  title: String(p.name ?? ''),
  lines:
    p.kind === 'fish-observation'
      ? [
          `Fish observation · ${String(p.observed_on ?? 'date not recorded')}`,
          String(p.waterbody ?? 'waterbody not recorded'),
          'Source evidence; review its relevance to this stream.',
        ]
      : [
          `Community watershed · ${String(p.code ?? '')}`,
          String(p.legislation ?? ''),
          'Mapped designation; review the reach against the boundary.',
        ],
})
/** The click popup brings its own frame. */
const evidenceHtml = (p: Record<string, unknown>) => {
  const { title, lines } = evidence(p)
  return [`<strong>${escape(title)}</strong>`, ...lines.map(escape)].join('<br>')
}
/** The hover popup has no frame, so it draws the shared card. */
const evidenceHover = (p: Record<string, unknown>) => mapTooltipHtml(evidence(p))

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
        hoverHtml={evidenceHover}
      />
      <MapCircleLayer
        sourceKey="road-provincial-fish"
        data={collections.fish}
        color="#7c3aed"
        radius={4}
        hoverHtml={evidenceHover}
        clickHtml={evidenceHtml}
      />
    </>
  )
}
