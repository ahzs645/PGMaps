import { MapCircleLayer, MapLineLayer } from '@/components/ui/map-layers'
import { mapTooltipHtml } from '@/components/ui/map-tooltip-card'
import type { historicalMapFeatures } from './accessHistoryMap'
import type { AccessHistorySelection } from './AccessHistorySelection'

const escape = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  )
type Card = { title: string; lines: string[] }
const text = (value: unknown) => String(value ?? '')
const route = (p: Record<string, unknown>): Card => ({
  title: text(p.name),
  lines: [
    `${text(p.relationship)} · ${text(p.date)}`,
    `Status: ${text(p.status)}`,
    `${Number(p.roadCount)} roads · ${Number(p.structureCount)} structures`,
    text(p.explanation),
  ],
})
const structure = (p: Record<string, unknown>): Card => ({
  title: text(p.name),
  lines: [
    `${text(p.kind)} · ${text(p.date)}`,
    `Site: ${text(p.crossingSiteId)}`,
    `Structure: ${text(p.structureId)}`,
    `Source row: ${text(p.sourceRowId)}`,
    `Attachment: ${text(p.attachment)}`,
    `Status: ${text(p.status)}`,
    text(p.explanation),
  ],
})
const anchor = (p: Record<string, unknown>): Card => ({
  title: text(p.name),
  lines: [text(p.role), text(p.road), text(p.block), `${Number(p.sourceCount)} source records`, text(p.explanation)],
})
/** The click popup brings its own frame; the hover popup has none, so it draws the shared card. */
const clickHtml = (card: (p: Record<string, unknown>) => Card) => (p: Record<string, unknown>) => {
  const { title, lines } = card(p)
  return [`<strong>${escape(title)}</strong>`, ...lines.map(escape)].join('<br>')
}
const hoverHtml = (card: (p: Record<string, unknown>) => Card) => (p: Record<string, unknown>) =>
  mapTooltipHtml(card(p))
const routeHtml = clickHtml(route)
const structureHtml = clickHtml(structure)
const anchorHtml = clickHtml(anchor)
const routeHover = hoverHtml(route)
const structureHover = hoverHtml(structure)
const anchorHover = hoverHtml(anchor)

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
        hoverHtml={routeHover}
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
        hoverHtml={structureHover}
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
        hoverHtml={anchorHover}
        clickHtml={anchorHtml}
      />
    </>
  )
}
