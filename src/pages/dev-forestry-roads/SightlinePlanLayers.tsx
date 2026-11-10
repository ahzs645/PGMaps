import { MapCircleLayer, MapLineLayer } from '@/components/ui/map-layers'

const escape = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
const labelHtml = (p: Record<string, unknown>) => (p.label ? escape(p.label) : null)

/** Seen, blocked and unknown, in the colours the sight band uses. */
export const SIGHT_PLAN_COLORS = {
  seen: '#16a34a',
  blocked: '#dc2626',
  unknown: '#94a3b8',
  clearTo: '#d97706',
  eye: '#0f172a',
} as const

const byState = [
  'match',
  ['get', 'state'],
  'clear',
  SIGHT_PLAN_COLORS.seen,
  'unknown',
  SIGHT_PLAN_COLORS.unknown,
  SIGHT_PLAN_COLORS.blocked,
]

/**
 * The Sight distance section's plan layer (`sightPresentation.ts`): from the selected station, the
 * line to the farthest target seen (green), the line to the distance needed where it is blocked
 * (red dashed), what blocks it, and the strip to clear (orange); and each turnout pair's sightline.
 */
export function SightlinePlanLayers({ data }: { data?: GeoJSON.FeatureCollection | null }) {
  if (!data?.features.length) return null
  return (
    <>
      <MapLineLayer
        sourceKey="road-sightlines-turnouts"
        data={data}
        filter={['==', ['get', 'role'], 'turnout-sight']}
        color={byState}
        width={2}
        opacity={0.85}
        dashArray={[2, 2]}
        layerOrder={66}
        hoverHtml={labelHtml}
      />
      <MapLineLayer
        sourceKey="road-sightlines-seen"
        data={data}
        filter={['==', ['get', 'role'], 'sight-seen']}
        color={SIGHT_PLAN_COLORS.seen}
        width={3}
        opacity={0.95}
        layerOrder={67}
        hoverHtml={labelHtml}
      />
      <MapLineLayer
        sourceKey="road-sightlines-needed"
        data={data}
        filter={['==', ['get', 'role'], 'sight-needed']}
        color={byState}
        width={2.5}
        opacity={0.95}
        dashArray={[3, 2]}
        layerOrder={67}
        hoverHtml={labelHtml}
      />
      <MapLineLayer
        sourceKey="road-sightlines-clear-to"
        data={data}
        filter={['==', ['get', 'role'], 'sight-clear-to']}
        color={SIGHT_PLAN_COLORS.clearTo}
        width={5}
        opacity={0.9}
        lineCap="butt"
        layerOrder={67}
        hoverHtml={labelHtml}
      />
      <MapCircleLayer
        sourceKey="road-sightlines-points"
        data={data}
        filter={['==', ['geometry-type'], 'Point']}
        color={[
          'match',
          ['get', 'role'],
          'sight-eye',
          SIGHT_PLAN_COLORS.eye,
          'sight-block',
          SIGHT_PLAN_COLORS.blocked,
          'sight-hidden',
          '#ffffff',
          'turnout',
          '#0369a1',
          SIGHT_PLAN_COLORS.seen,
        ]}
        radius={['match', ['get', 'role'], 'sight-block', 6, 'turnout', 4, 5]}
        strokeColor={['match', ['get', 'role'], 'sight-hidden', SIGHT_PLAN_COLORS.blocked, '#ffffff']}
        strokeWidth={2}
        layerOrder={68}
        hoverHtml={labelHtml}
      />
    </>
  )
}
