import { LegendItem, MapLegendNote, MapLegendPanel, MapSteppedLegend } from '@/components/ui/map-panels'
import { SPECIES_NAMES } from './allometry'
import {
  INVENTORY_OTHER_SPECIES_COLOUR,
  INVENTORY_RAMP,
  INVENTORY_RAMP_SCALES,
  INVENTORY_REVIEW_COLOURS,
  INVENTORY_SELECTION_COLOUR,
  INVENTORY_SPECIES_COLOURS,
  INVENTORY_UNAVAILABLE_COLOUR,
} from './summary'

export const INVENTORY_COLOUR_OPTIONS = [
  { value: 'height', label: 'Height' },
  { value: 'species', label: 'Species assumption' },
  { value: 'dbh', label: 'Estimated / entered DBH' },
  { value: 'volume', label: 'Modelled total volume' },
  { value: 'texture', label: 'Crown texture' },
  { value: 'review', label: 'Review status' },
] as const

const REVIEW_LABELS: Record<keyof typeof INVENTORY_REVIEW_COLOURS, string> = {
  accepted: 'Accepted',
  excluded: 'Excluded',
  split: 'Suspected split',
  merged: 'Suspected merged',
  unreviewed: 'Unreviewed',
}

/** The crown map's colours, read from the same constants `inventoryMapFeatures` paints with. */
export function InventoryLegend({ colour }: { colour: string }) {
  const title = INVENTORY_COLOUR_OPTIONS.find((option) => option.value === colour)?.label ?? 'Crowns'
  const scale = INVENTORY_RAMP_SCALES[colour]
  return (
    <MapLegendPanel
      title={title}
      description={scale ? `${scale.label}${scale.unit ? ` (${scale.unit})` : ''}` : undefined}
      collapsible
      defaultCollapsed="mobile"
      width="md"
      // The comparison map sits in its own toolkit workspace, so its attribution height never
      // reaches this panel's variables; clear the compact attribution directly.
      className="bottom-8 workspace-desktop:bottom-8"
      aria-label="Inventory map legend"
    >
      <div className="space-y-1.5 text-xs text-muted-foreground">
        {colour === 'species' ? (
          <>
            {Object.entries(INVENTORY_SPECIES_COLOURS).map(([code, fill]) => (
              <LegendItem key={code} color={fill} swatchShape="square" label={SPECIES_NAMES[code] ?? code} />
            ))}
            <LegendItem color={INVENTORY_OTHER_SPECIES_COLOUR} swatchShape="square" label="Other species" />
          </>
        ) : colour === 'review' ? (
          Object.entries(INVENTORY_REVIEW_COLOURS).map(([status, fill]) => (
            <LegendItem
              key={status}
              color={fill}
              swatchShape="square"
              label={REVIEW_LABELS[status as keyof typeof REVIEW_LABELS]}
            />
          ))
        ) : scale ? (
          <>
            <MapSteppedLegend
              aria-label={`${scale.label} classes`}
              bands={INVENTORY_RAMP.map((fill, index) => ({ color: fill, label: index * (scale.max / 5) }))}
              labels={[0, scale.max / 2, `${scale.max}+${scale.unit ? ` ${scale.unit}` : ''}`]}
            />
            <LegendItem color={INVENTORY_UNAVAILABLE_COLOUR} swatchShape="square" label="Unavailable" />
          </>
        ) : null}
        <LegendItem color={INVENTORY_SELECTION_COLOUR} swatchShape="line" label="Selection boundary" />
        <MapLegendNote>Counts use canopy-apex membership, not fractional crowns.</MapLegendNote>
      </div>
    </MapLegendPanel>
  )
}
