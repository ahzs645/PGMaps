/**
 * The fields a sheet's setup form shows for a sheet type: the title bar's typed fields, then the
 * block information its panel prints, each worked out from the block or the terrain, or typed.
 * Every tool that prints a block sheet builds its form from this, so the form lists what the sheet
 * prints. No DOM or network access.
 */
import type { BlockFacts } from './blockFacts'
import {
  ENTERED_FIELD_LABELS,
  infoFieldLabel,
  MAX_SHEET_FIELD_LENGTH,
  SHEET_PRESETS,
  type EnteredFieldId,
  type FieldOrigin,
  type SheetKind,
} from './sheets'

/** A field of the setup form (`MapSheetField` in `map-sheet-setup.tsx`). */
export interface SheetSetupField {
  id: string
  label: string
  origin: FieldOrigin
  /** The worked-out value, or null when it cannot be worked out. */
  computed?: string | null
  maxLength?: number
}

const TITLE_FIELDS: EnteredFieldId[] = ['forestLicence', 'cuttingPermit', 'blockId']

/**
 * The form's fields for `kind`. `facts` are the chosen block's; `elevationPending` is shown for the
 * elevations of a tool that reads its terrain only when the sheet is written.
 */
export function sheetSetupFields(
  kind: SheetKind,
  facts: BlockFacts | null,
  elevationPending?: string,
): SheetSetupField[] {
  const shown = new Set(SHEET_PRESETS[kind].info.columns.flat())
  return [
    ...TITLE_FIELDS.map((id) => ({ id, label: ENTERED_FIELD_LABELS[id], origin: 'entered' as const })),
    ...[...shown].map((id): SheetSetupField => {
      const label = infoFieldLabel(id, kind)
      if (id === 'mapsheet') return { id, label, origin: 'geometry', computed: facts?.mapsheet ?? null }
      if (id === 'grossArea')
        return { id, label, origin: 'geometry', computed: facts ? `${facts.areaHa.toFixed(1)} (BC Albers)` : null }
      if (id === 'minElev' || id === 'maxElev')
        return {
          id,
          label,
          origin: 'terrain',
          computed: facts?.elevation
            ? String(Math.round(id === 'minElev' ? facts.elevation.min : facts.elevation.max))
            : (elevationPending ?? null),
        }
      return { id, label, origin: 'entered', maxLength: MAX_SHEET_FIELD_LENGTH }
    }),
  ]
}
