/** Each road its own colour on the map, the legend and the Compare table. */
/** Colours the map already gives other meaning: within grade, over grade, no terrain, streams. */
const RESERVED = new Set(['#d97706', '#dc2626', '#9ca3af', '#0284c7'])
const PALETTE = ['#2563eb', '#9333ea', '#0d9488', '#db2777', '#65a30d', '#4f46e5', '#b45309', '#0891b2', '#be185d']

/** Keeps a road's stored colour unless a reserved colour or an earlier road already has it. */
export function distinctRoadColors(roads: readonly { id: string; color: string }[]) {
  const colors = new Map<string, string>()
  const used = new Set<string>()
  for (const road of roads) {
    const color = road.color.toLowerCase()
    if (RESERVED.has(color) || used.has(color)) continue
    colors.set(road.id, road.color)
    used.add(color)
  }
  const spare = PALETTE.filter((color) => !used.has(color))
  let next = 0
  for (const road of roads) {
    if (colors.has(road.id)) continue
    colors.set(road.id, spare[next % Math.max(1, spare.length)] ?? PALETTE[next % PALETTE.length])
    next++
  }
  return colors
}
