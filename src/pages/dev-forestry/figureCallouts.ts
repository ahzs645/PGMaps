/**
 * Where each block's callout points on a captured road view, and what it says, from the run's own
 * sightlines at the station the view stands at. A block the station sees anchors at the screen
 * centroid of its visible samples; a hidden one at its footprint, so "Likely Not Visible" still
 * points at the ground it would clear, as the reference figures do. The box layout itself is the
 * composer's (`layoutCallouts` in `composeFigure.ts`), which needs the printed text sizes.
 * Takes numbers and an injected projector only: no DOM, network or MapLibre access.
 */
import type { FigureCallout } from '@/lib/forestry/viaFigure/composeFigure'

/** Below this share of its samples seen, a block is a possible glimpse rather than visible, percent. */
export const GLIMPSE_PERCENT = 5

export type BlockSight = {
  id: string
  name: string
  /** Sample positions as [lng, lat, lng, lat, …], their ground elevations, and the count. */
  positions: ArrayLike<number>
  elevations: ArrayLike<number>
  sampleCount: number
  /** 1 visible, 2 unknown (missing terrain), else hidden, for every station's samples in a row. */
  visibleByStation: ArrayLike<number>
  /** A point inside the footprint and its ground elevation, for a block nothing of which is seen. */
  interior: { lng: number; lat: number; elevation: number } | null
}

export type CalloutStatus = 'visible' | 'possible glimpses' | 'not visible' | 'unknown'

export const STATUS_TEXT: Record<CalloutStatus, string> = {
  visible: 'Visible',
  'possible glimpses': 'Possible Glimpses',
  'not visible': 'Likely Not Visible',
  unknown: 'Unknown (missing terrain)',
}

/** A block's status at one station, from the share of its samples seen and unknown. */
export function calloutStatus(visiblePercent: number, unknownPercent: number): CalloutStatus {
  if (visiblePercent <= 0) return unknownPercent > 0 ? 'unknown' : 'not visible'
  return visiblePercent < GLIMPSE_PERCENT ? 'possible glimpses' : 'visible'
}

/** Projects a ground point to image pixels; null when it falls behind the camera. */
export type Projector = (lng: number, lat: number, elevation: number) => [number, number] | null

export type BlockCallout = FigureCallout & {
  blockId: string
  status: CalloutStatus
  visiblePercent: number
}

/**
 * One callout per block whose anchor falls inside the `width` × `height` image. `prefix` goes before
 * the block's name ("Block "), unless the name already starts with it.
 */
export function blockCallouts(
  blocks: readonly BlockSight[],
  stationIndex: number,
  project: Projector,
  size: { width: number; height: number },
  prefix = 'Block ',
): BlockCallout[] {
  const inside = (p: [number, number] | null): p is [number, number] =>
    !!p && p[0] >= 0 && p[1] >= 0 && p[0] < size.width && p[1] < size.height
  return blocks.flatMap((block) => {
    const row = stationIndex * block.sampleCount
    let visible = 0,
      unknown = 0,
      sx = 0,
      sy = 0,
      projected = 0
    for (let i = 0; i < block.sampleCount; i++) {
      const state = block.visibleByStation[row + i]
      if (state === 2) unknown++
      if (state !== 1) continue
      visible++
      const p = project(block.positions[i * 2], block.positions[i * 2 + 1], block.elevations[i])
      if (!inside(p)) continue
      sx += p[0]
      sy += p[1]
      projected++
    }
    const total = Math.max(1, block.sampleCount)
    const visiblePercent = (100 * visible) / total
    const status = calloutStatus(visiblePercent, (100 * unknown) / total)
    let anchor: [number, number] | null = projected ? [sx / projected, sy / projected] : null
    if (!anchor && block.interior) {
      const p = project(block.interior.lng, block.interior.lat, block.interior.elevation)
      anchor = inside(p) ? p : null
    }
    if (!anchor) return []
    const title = block.name.toLowerCase().startsWith(prefix.trim().toLowerCase())
      ? block.name
      : `${prefix}${block.name}`
    return [{ blockId: block.id, title, body: STATUS_TEXT[status], anchor, status, visiblePercent }]
  })
}
