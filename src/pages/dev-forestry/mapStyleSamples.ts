/**
 * The map styles Save & export offers, each with what its sample map is drawn with (`styleSample.ts`,
 * `MapStyleField`): the symbols the style really gives each area, so a sample shows the choice before a map is
 * written. Built once: the styles are a fixed catalogue. No DOM or network access.
 */
import { BLOCK_OF_INTEREST } from '@/lib/forestry/blockSheet/styles'
import type { MapStyleChoice } from '@/lib/mapSheet/styleSample'

import { REPORT_MAP_SYMBOLS } from './reportMaps'
import { figureMapStyle, reportMapStyles, visualsSheetStyles, visualsSheetSymbols } from './visualsBlockSheet'

let reportChoices: MapStyleChoice[] | null = null
let sheetChoices: MapStyleChoice[] | null = null

/**
 * The VIA report's map styles. A figure style changes only the proposed blocks and the existing openings on the
 * report's maps, so the sample draws those two: in the style's symbols where it has them, else the maps' own.
 */
export function reportMapStyleChoices(): readonly MapStyleChoice[] {
  reportChoices ??= reportMapStyles().map((style) => {
    const symbols = figureMapStyle(style.value)
    return {
      ...style,
      sample: {
        block: symbols?.block ?? REPORT_MAP_SYMBOLS.block,
        opening: symbols?.opening ?? REPORT_MAP_SYMBOLS.opening,
      },
    }
  })
  return reportChoices
}

/** The block map sheet's map styles: every area of the scene as the sheet draws it under each style. */
export function visualsSheetStyleChoices(): readonly MapStyleChoice[] {
  sheetChoices ??= visualsSheetStyles().map((style) => {
    const symbols = visualsSheetSymbols(style.value)
    return {
      ...style,
      sample: {
        landform: symbols.landform,
        // Null is the sheet's own block symbol.
        block: symbols.block ?? BLOCK_OF_INTEREST.default,
        opening: symbols.opening,
        privateLand: symbols.privateLand,
        rock: symbols.rock,
      },
    }
  })
  return sheetChoices
}
