import { describe, expect, it } from 'vitest'

import { panoramaBand } from '../figureFraming'
import { layoutBlockMarks, markRows, type BlockMark, type PlacedBlockMark } from './blockMarks'

const W = 2000
const H = 600

const meet = (a: NonNullable<PlacedBlockMark['box']>, b: NonNullable<PlacedBlockMark['box']>) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** Every placed label is inside the shown rows and the picture's width, and no two labels meet. */
function expectTidy(placed: PlacedBlockMark[], top = 0, bottom = H) {
  const boxes = placed.flatMap((mark) => (mark.box ? [mark.box] : []))
  for (const box of boxes) {
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.w).toBeLessThanOrEqual(W)
    expect(box.y).toBeGreaterThanOrEqual(top)
    expect(box.y + box.h).toBeLessThanOrEqual(bottom)
  }
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) expect(meet(boxes[i], boxes[j])).toBe(false)
  // The labels run in their marks' left-to-right order, so no leader crosses another.
  const order = placed.filter((mark) => mark.box).sort((a, b) => a.anchor[0] - b.anchor[0])
  for (let i = 1; i < order.length; i++) expect(order[i].box!.x).toBeGreaterThan(order[i - 1].box!.x)
}

describe('block marks on a report picture', () => {
  it('keeps a label at the picture’s edge inside it (01, Rock: Block FP4 at the left edge)', () => {
    const marks: BlockMark[] = [
      { x: 0.01, y: 0.5, label: 'Block FP4', status: 'visible' },
      { x: 0.03, y: 0.55, label: 'Block FP1', status: 'not visible' },
      { x: 0.22, y: 0.6, label: 'Block FP2', status: 'not visible' },
      { x: 0.4, y: 0.55, label: 'Block FP3', status: 'visible' },
    ]
    const placed = layoutBlockMarks(marks, W, H, { all: true })
    expect(placed.every((mark) => mark.box)).toBe(true)
    expectTidy(placed)
    // Each label sits above its mark, led to it.
    for (const mark of placed) {
      expect(mark.box!.y + mark.box!.h).toBeLessThanOrEqual(mark.anchor[1])
      expect(mark.leader).not.toBeNull()
    }
  })

  it('wraps and shrinks crowded labels before any gives way (06, Argenta Beach: five blocks bunched together)', () => {
    const marks: BlockMark[] = [2, 20, 21, 22, 3].map((id, i) => ({
      x: 0.45 + i * 0.03,
      y: 0.62 + (i % 2) * 0.02,
      label: `Block ${id}`,
      status: 'not visible',
    }))
    const placed = layoutBlockMarks(marks, 1600, H, { all: false })
    expect(placed.every((mark) => mark.box)).toBe(true)
    expect(placed[0].lines).toEqual(['Block 2', '(not visible)'])
    expect(placed.map((mark) => mark.box!.x + mark.box!.w).every((right) => right <= 1600)).toBe(true)
    const boxes = placed.map((mark) => mark.box!)
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) expect(meet(boxes[i], boxes[j])).toBe(false)
  })

  it('keeps labels and rings inside a panorama’s band (26, Figure 3)', () => {
    const band = { y: 200, height: 160 }
    const marks: BlockMark[] = [
      { x: 0.2, y: 0.6, label: 'Block 2', status: 'possible glimpses' },
      { x: 0.4, y: 0.57, label: 'Block 22', status: 'possible glimpses' },
      { x: 0.45, y: 0.57, label: 'Block 21', status: 'possible glimpses' },
      { x: 0.6, y: 0.62, label: 'Block 20', status: 'not visible' },
    ]
    const placed = layoutBlockMarks(marks, W, H, { all: false, band })
    expectTidy(placed, band.y, band.y + band.height)
    for (const mark of placed) {
      expect(mark.anchor[1] + mark.ring).toBeLessThanOrEqual(band.y + band.height)
      expect(mark.anchor[1] - mark.ring).toBeGreaterThanOrEqual(band.y)
    }
  })

  it('marks the blocks in view as well as the hidden ones inside a panorama’s band (26, Figure 2)', () => {
    // The memo says Blocks 2 and 3 are in view: each gets its name and an arrow; 20, 21 and 22 a ring.
    const width = 2400,
      height = 2867
    const marks: BlockMark[] = [
      { x: 0.965, y: 0.583, label: 'Block 2', status: 'visible' },
      { x: 0.522, y: 0.504, label: 'Block 3', status: 'visible' },
      { x: 0.408, y: 0.598, label: 'Block 20', status: 'not visible' },
      { x: 0.391, y: 0.546, label: 'Block 21', status: 'not visible' },
      { x: 0.434, y: 0.482, label: 'Block 22', status: 'not visible' },
    ]
    // The landform (rows 513-2106) is taller than a 2.4:1 band: the band keeps the marks and stays 2.4:1.
    const band = panoramaBand({ y: 513, height: 1593 }, width, height, 2.4, markRows(marks, width, height))!
    expect(band.height).toBe(1000)
    const placed = layoutBlockMarks(marks, width, height, { all: true, band })
    expect(placed.map((mark) => mark.lines.join(' '))).toEqual([
      'Block 2',
      'Block 3',
      'Block 20 (not visible)',
      'Block 21 (not visible)',
      'Block 22 (not visible)',
    ])
    expect(placed.map((mark) => mark.unseen)).toEqual([false, false, true, true, true])
    for (const mark of placed) {
      expect(mark.box).not.toBeNull()
      expect(mark.leader).not.toBeNull()
      expect(mark.box!.x).toBeGreaterThanOrEqual(0)
      expect(mark.box!.x + mark.box!.w).toBeLessThanOrEqual(width)
      expect(mark.box!.y).toBeGreaterThanOrEqual(band.y)
      expect(mark.box!.y + mark.box!.h).toBeLessThanOrEqual(band.y + band.height)
    }
    // A seen block's arrow ends on the block itself, and every block is drawn where it lies, its ring whole.
    expect(placed[1].leader![1]).toEqual(placed[1].anchor)
    placed.forEach((mark, i) => {
      expect(mark.anchor[1]).toBeCloseTo(marks[i].y * height, 6)
      expect(mark.anchor[1] - mark.ring).toBeGreaterThanOrEqual(band.y)
      expect(mark.anchor[1] + mark.ring).toBeLessThanOrEqual(band.y + band.height)
    })
  })

  it('gives a panorama the rows its marks need: each ring, and a two-line label above the topmost', () => {
    const rows = markRows([{ y: 0.5 }, { y: 0.6 }], 2400, 2867)!
    // 52.8 px type: a 63 px ring, a 16 px margin and 253 px of label and leader above.
    expect(rows.y).toBe(Math.round(0.5 * 2867 - 52.8 * (1.2 + 0.3 + 2 * 1.15 + 2.5)))
    expect(rows.y + rows.height).toBe(Math.round(0.6 * 2867 + 52.8 * 1.5))
    expect(markRows([], 2400, 2867)).toBeNull()
  })

  it('lets the least-seen block’s label give way only when the row cannot hold every label at the smallest type', () => {
    const marks: BlockMark[] = Array.from({ length: 14 }, (_, i) => ({
      x: 0.05 + i * 0.065,
      y: 0.7,
      label: `Block EGG${100 + i} (TA0333, other planned)`,
      status: i === 3 ? 'not visible' : 'visible',
    }))
    const placed = layoutBlockMarks(marks, W, H, { all: true })
    expectTidy(placed)
    const dropped = placed.filter((mark) => !mark.box)
    expect(dropped.length).toBeGreaterThan(0)
    expect(placed[3].box).toBeNull()
  })

  it('marks only the blocks not plainly seen unless every block is asked for', () => {
    const marks: BlockMark[] = [
      { x: 0.3, y: 0.5, label: 'Block A', status: 'visible' },
      { x: 0.6, y: 0.5, label: 'Block B', status: 'unknown' },
    ]
    expect(layoutBlockMarks(marks, W, H, { all: false }).map((mark) => mark.lines)).toEqual([['Block B (not known)']])
  })
})
