import { LegendItem, MapLegendSection } from '@/components/ui/map-panels'
import { SheetSymbolSwatch } from '@/components/ui/sheet-symbol-swatch'

import { PHOTO_PLAN_SYMBOLS } from './photoPlanStyle'
import { photoLegendRows, type PhotoLegendShown, type PlanLegendKey } from './planLayers'

/**
 * The plan legend's *Own photo* section: one row for each photo layer drawn now (`photoLegendRows`), each a
 * button that hides its layer, as the other sections' rows are. The drape's opacity is not here: it has one
 * control, in the photo's card on the plan (`PhotoDrapeCard`).
 */
export function PhotoLegendSection({
  shown,
  hidden,
  onToggle,
}: {
  shown: PhotoLegendShown
  hidden: ReadonlySet<PlanLegendKey>
  onToggle?: (key: PlanLegendKey) => void
}) {
  const rows = photoLegendRows(shown)
  if (!rows.length) return null
  return (
    <MapLegendSection title="Own photo" data-legend-section="photo">
      {rows.map((row) => {
        const active = !hidden.has(row.key)
        return (
          <div key={row.key}>
            <LegendItem
              color={PHOTO_PLAN_SYMBOLS.edges.color}
              swatch={<SheetSymbolSwatch symbol={PHOTO_PLAN_SYMBOLS[row.symbol]} widthPt={14} heightPt={9} />}
              label={row.label}
              active={active}
              onClick={onToggle ? () => onToggle(row.key) : undefined}
              title={onToggle ? (active ? 'Hide from the map' : 'Show on the map') : undefined}
              data-plan-layer={row.key}
              className="[&>div>span:last-child]:whitespace-normal"
            />
            {row.note && active && <p className="pl-6 text-2xs text-muted-foreground">{row.note}</p>}
          </div>
        )
      })}
    </MapLegendSection>
  )
}
