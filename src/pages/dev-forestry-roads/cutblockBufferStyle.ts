import { patternHatches, patternMarkerFill } from '@/lib/mapSheet/symbolStyle'
import type { AreaSymbol } from '@/lib/mapSheet/symbols'
import { CUTBLOCK_BUFFER_COLOR, type CutblockBuffer } from './cutblockBuffers'

/** A buffer's symbol on the plan, in its legend and in the pattern picker: one definition for all three. */
export function cutblockBufferSymbol(setting: Pick<CutblockBuffer, 'color' | 'pattern'>): AreaSymbol {
  const color = setting.color ?? CUTBLOCK_BUFFER_COLOR
  const pattern = setting.pattern ?? 'solid'
  const markerFill = patternMarkerFill(pattern, color, 7)
  return {
    kind: 'area',
    label: 'Cutblock buffer',
    fill: color,
    fillOpacity: 0.09,
    hatches: patternHatches(pattern, { color, width: 0.65, opacity: 0.6 }, 7),
    ...(markerFill ? { markerFill } : {}),
    outline: [{ color, width: 1, dash: [3, 2] }],
  }
}
