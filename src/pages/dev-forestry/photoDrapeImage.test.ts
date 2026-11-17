import { describe, expect, it } from 'vitest'

import { drawnForLine, headingGap } from './photoDrapeCardText'
import { closedFootprint, drapeEdges, drapeLookImage, hiddenGroundTile } from './photoDrapeImage'
import { hexBytes, PHOTO_PLAN_SYMBOLS } from './photoPlanStyle'
import type { Rgba } from './photoViews'

/** A drape whose left half is dark timber and right half a pale clearing, with a transparent border column. */
function splitDrape(width = 20, height = 12): Rgba {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (x === 0) continue // out of frame
      const v = x < width / 2 ? 40 : 200
      data[i] = v
      data[i + 1] = v
      data[i + 2] = v
      data[i + 3] = 255
    }
  return { width, height, data }
}

describe('photo drape looks', () => {
  it('finds the photo edge and never the frame border', () => {
    const drape = splitDrape()
    const edges = drapeEdges(drape)
    const columns = new Set<number>()
    edges.forEach((on, k) => on && columns.add(k % drape.width))
    expect([...columns].sort((a, b) => a - b)).toEqual([9, 10])
    // The border between drawn and out-of-frame cells (x = 0 → 1) is no edge.
    expect(columns.has(1)).toBe(false)
  })

  it('finds nothing in flat ground, however faint the threshold share', () => {
    const flat = splitDrape()
    for (let k = 0; k < flat.width * flat.height; k++) if (flat.data[k * 4 + 3]) flat.data.fill(120, k * 4, k * 4 + 3)
    expect(drapeEdges(flat, { share: 0.9 }).some(Boolean)).toBe(false)
  })

  it('draws edges in the shared edge colour and leaves the rest transparent', () => {
    const drape = splitDrape()
    const image = drapeLookImage(drape, 'edges')!
    const [r, g, b] = hexBytes(PHOTO_PLAN_SYMBOLS.edges.color)
    const edge = (5 * drape.width + 9) * 4
    expect([...image.data.slice(edge, edge + 4)]).toEqual([r, g, b, 255])
    expect(image.data[(5 * drape.width + 3) * 4 + 3]).toBe(0)
  })

  it('keeps the photo for the filled look, hatches hidden ground only, and draws nothing for the footprint', () => {
    const drape = splitDrape()
    const hidden = new Uint8Array(drape.width * drape.height)
    // The out-of-frame column is hidden ground in this test; a drawn cell marked hidden keeps its photo.
    for (let y = 0; y < drape.height; y++) hidden[y * drape.width] = 1
    hidden[5 * drape.width + 4] = 1
    const hatch = hiddenGroundTile()!
    expect(hatch.data.some((value, i) => i % 4 === 3 && value > 0)).toBe(true)
    const image = drapeLookImage(drape, 'filled', { hiddenMask: hidden, hatch })!
    expect([...image.data.slice((5 * drape.width + 4) * 4, (5 * drape.width + 4) * 4 + 4)]).toEqual([40, 40, 40, 255])
    const hatchedColumn = Array.from({ length: drape.height }, (_, y) => image.data[y * drape.width * 4 + 3])
    expect(hatchedColumn.some((alpha) => alpha > 0)).toBe(true)
    // The hatch is faint: never fully opaque.
    expect(Math.max(...hatchedColumn)).toBeLessThan(255)
    expect(drapeLookImage(drape, 'footprint')).toBeNull()
    // The drape it was made from is untouched.
    expect(drape.data[3]).toBe(0)
  })

  it('closes a footprint ring and refuses one with too few corners', () => {
    expect(
      closedFootprint([
        [0, 0],
        [1, 0],
        [1, 1],
      ]),
    ).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ])
    expect(
      closedFootprint([
        [0, 0],
        [Number.NaN, 0],
        [1, 1],
      ]),
    ).toBeNull()
  })
})

describe('the card line about the drawn camera', () => {
  it('says the heading drawn for, and the heading now once it has moved past 0.5°', () => {
    expect(headingGap(359, 1)).toBe(2)
    expect(drawnForLine(null, 10)).toBeNull()
    expect(drawnForLine(212.2, 212.4)).toEqual({ text: 'Drawn for heading 212°', moved: false })
    expect(drawnForLine(212, 218)).toEqual({ text: 'Drawn for heading 212°, now 218°', moved: true })
    expect(drawnForLine(359.6, 0.4)?.text).toBe('Drawn for heading 359.6°, now 0.4°')
  })
})
