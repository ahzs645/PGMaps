import type { AreaSymbol } from '@/lib/mapSheet/symbols'
import { CUTBLOCK_BUFFER_COLOR, type CutblockBuffer } from './cutblockBuffers'

export function cutblockBufferSymbol(setting: CutblockBuffer): AreaSymbol {
  const color = setting.color ?? CUTBLOCK_BUFFER_COLOR
  const angles = setting.pattern === 'crosshatch' ? [45, 135] : setting.pattern === 'diagonal' ? [45] : []
  return {
    kind: 'area',
    label: 'Cutblock buffer',
    fill: color,
    fillOpacity: 0.09,
    hatches: angles.map((angleDeg) => ({ angleDeg, spacing: 7, stroke: { color, width: 0.65, opacity: 0.6 } })),
    outline: [{ color, width: 1, dash: [3, 2] }],
  }
}
