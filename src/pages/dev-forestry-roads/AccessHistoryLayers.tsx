import { MapCircleLayer, MapLineLayer } from '@/components/ui/map-layers'
import type { historicalMapFeatures } from './accessHistoryMap'
import type { AccessHistorySelection } from './AccessHistorySelection'

const escape = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  )
const routeHtml = (p: Record<string, unknown>) =>
  `<strong>${escape(p.name)}</strong><br>${escape(p.relationship)} · ${escape(p.date)}<br>Status: ${escape(p.status)}<br>${Number(p.roadCount)} roads · ${Number(p.structureCount)} structures<br>${escape(p.explanation)}`
const structureHtml = (p: Record<string, unknown>) =>
  `<strong>${escape(p.name)}</strong><br>${escape(p.kind)} · ${escape(p.date)}<br>Site: ${escape(p.crossingSiteId)}<br>Structure: ${escape(p.structureId)}<br>Source row: ${escape(p.sourceRowId)}<br>Attachment: ${escape(p.attachment)}<br>Status: ${escape(p.status)}<br>${escape(p.explanation)}`
const anchorHtml = (p: Record<string, unknown>) =>
  `<strong>${escape(p.name)}</strong><br>${escape(p.role)}<br>${escape(p.road)}<br>${escape(p.block)}<br>${Number(p.sourceCount)} source records<br>${escape(p.explanation)}`

/** Shared toolkit layers handle cleanup, style reloads and scoped map sources. */
export function AccessHistoryLayers({
  data,
  selection,
}: {
  data: ReturnType<typeof historicalMapFeatures>
  selection?: AccessHistorySelection
}) {
  return (
    <>
      <MapLineLayer
        sourceKey="road-access-history-route"
        data={data.route}
        color={['get', 'color']}
        width={5}
        opacity={0.9}
        dashArray={[2, 1]}
        layerOrder={60}
        hoverHtml={routeHtml}
        clickHtml={routeHtml}
      />
      <MapCircleLayer
        sourceKey="road-access-history-structures"
        data={data.structures}
        color={['get', 'color']}
        radius={['case', ['get', 'onSelectedRoute'], 7, 4]}
        strokeColor="#ffffff"
        strokeWidth={2}
        layerOrder={61}
        hoverHtml={structureHtml}
        clickHtml={structureHtml}
        selectedId={selection?.kind === 'structure' ? selection.id : null}
      />
      <MapCircleLayer
        sourceKey="road-access-history-anchors"
        data={data.anchors}
        color={['get', 'color']}
        radius={['case', ['get', 'onSelectedRoute'], 6, 4]}
        strokeColor="#ffffff"
        strokeWidth={2}
        layerOrder={62}
        hoverHtml={anchorHtml}
        clickHtml={anchorHtml}
      />
    </>
  )
}
