import { GState, jsPDF } from 'jspdf'
import { describe, expect, it, vi } from 'vitest'
import {
  arrowHeadOps,
  balloonRing,
  calloutOps,
  calloutSize,
  leaderOps,
  placeClear,
  textOps,
  type CalloutBoxStyle,
} from './callouts'
import type { DrawOp, Point } from './drawOps'
import { createSheetPdf, drawSheetPdf } from './renderPdf'
import { sheetSvg } from './renderSvg'
import { textWidth } from './textMetrics'

const STYLE: CalloutBoxStyle = {
  box: { kind: 'area', label: 'Callout', fill: '#00c5ff', outline: [{ color: '#9c9c9c', width: 0.96 }] },
  padding: { x: 2, y: 2 },
  title: { size: 10, style: 'bold', color: '#000000' },
  body: { size: 10, color: '#000000' },
  pointer: { kind: 'wedge', base: 6 },
}

const paths = (ops: DrawOp[]) => ops.filter((op): op is Extract<DrawOp, { op: 'path' }> => op.op === 'path')

describe('figure annotation primitives', () => {
  it('draws text with its halo, and an underline the width of the text', () => {
    const ops = textOps(
      100,
      50,
      'Landform 1',
      {
        size: 10,
        color: '#c500ff',
        halo: { color: '#ffffff', width: 1.92 },
        underline: { width: 1 },
      },
      'center',
    )
    expect(ops[0]).toMatchObject({ op: 'text', halo: { color: '#ffffff', width: 1.92 }, align: 'center' })
    const [rule] = paths(ops)
    const width = textWidth('Landform 1', 10)
    expect(rule.parts[0][0][0]).toBeCloseTo(100 - width / 2)
    expect(rule.parts[0][1][0]).toBeCloseTo(100 + width / 2)
  })

  it('measures bold italic as the bold face and prints it bold and italic', () => {
    expect(textWidth('Viewpoint', 12, 'bolditalic')).toBe(textWidth('Viewpoint', 12, 'bold'))
    const op: DrawOp = { op: 'text', x: 0, y: 10, text: 'Viewpoint', size: 12, color: '#000', style: 'bolditalic' }
    expect(sheetSvg([op], 100, 20)).toContain('font-weight="bold" font-style="italic"')
    const pdf = createSheetPdf({ jsPDF, GState }, 100, 20)
    const setFont = vi.spyOn(pdf, 'setFont')
    drawSheetPdf(pdf, { jsPDF, GState }, [op])
    expect(setFont).toHaveBeenCalledWith('helvetica', 'bolditalic')
  })

  it('points an arrowhead at the tip, open or filled', () => {
    const filled = arrowHeadOps([0, 0], [10, 0], { length: 4, width: 3, filled: true }, '#000', 0.5)
    expect(filled).toHaveLength(1)
    const [left, tip, right] = (filled[0] as Extract<DrawOp, { op: 'path' }>).parts[0]
    expect(tip).toEqual([10, 0])
    expect(left[0]).toBeCloseTo(6)
    expect(Math.abs(left[1] - right[1])).toBeCloseTo(3)
    expect(filled[0]).toMatchObject({ closed: true, fill: '#000' })
    const open = arrowHeadOps([0, 0], [10, 0], { length: 4, width: 3, filled: false }, '#000', 0.5)
    expect(open[0]).toMatchObject({ closed: false, stroke: { color: '#000', width: 0.5 } })
    expect(arrowHeadOps([5, 5], [5, 5], { length: 4, width: 3, filled: true }, '#000', 1)).toEqual([])
  })

  it('stops a leader short of its feature and inside a filled head', () => {
    const ops = leaderOps(
      [0, 0],
      [0, 20],
      { stroke: { color: '#fff', width: 1.4 }, head: { length: 5, width: 4, filled: true } },
      3,
    )
    const [shaft, head] = paths(ops)
    expect(shaft.parts[0][1][1]).toBeCloseTo(17 - 3)
    expect(head.parts[0][1]).toEqual([0, 17])
    expect(leaderOps([0, 0], [0, 2], { stroke: { color: '#000', width: 1 } }, 3)).toEqual([])
  })

  it('builds a balloon whose pointer leaves the face nearest the anchor', () => {
    const box = { x: 0, y: 0, w: 40, h: 20 }
    const right = balloonRing(box, [80, 10], 6)
    expect(right).toContainEqual([80, 10])
    // The pointer's base sits on the right edge, 6 pt wide.
    const onRight = right.filter(([x]) => x === 40)
    expect(onRight.length).toBeGreaterThanOrEqual(4)
    const below = balloonRing(box, [20, 60], 6)
    const base = below.filter(([, y]) => y === 20 && below.indexOf([20, 60] as Point) < 0)
    expect(below).toContainEqual([20, 60])
    expect(base.length).toBeGreaterThanOrEqual(4)
    expect(balloonRing(box, [10, 10], 6)).toHaveLength(4)
  })

  it('sizes and draws a callout: box, then title and body', () => {
    const size = calloutSize(STYLE, 'Block 1', 'Visible')
    expect(size.w).toBeCloseTo(textWidth('Block 1', 10, 'bold') + 4)
    const ops = calloutOps(STYLE, { x: 0, y: 0, ...size }, [100, 80], 'Block 1', 'Visible')
    const texts = ops.filter((op) => op.op === 'text').map((op) => (op as { text: string }).text)
    expect(texts).toEqual(['Block 1', 'Visible'])
    const outline = paths(ops).find((op) => op.stroke)
    expect(outline?.parts[0]).toContainEqual([100, 80])
    const boxed = calloutOps(
      { ...STYLE, pointer: { kind: 'leader', leader: { stroke: { color: '#fff', width: 1.4 } } } },
      { x: 0, y: 0, ...size },
      [100, 80],
      'Block 1',
    )
    // The leader is drawn before the box, so the box covers its root.
    expect(paths(boxed)[0].stroke?.color).toBe('#fff')
  })

  it('places boxes clear of each other inside the bounds', () => {
    const bounds = { x: 0, y: 0, w: 100, h: 100 }
    const first = placeClear({ x: 10, y: 10, w: 30, h: 10 }, [], bounds)!
    expect(first).toEqual({ x: 10, y: 10, w: 30, h: 10 })
    const second = placeClear({ x: 15, y: 12, w: 30, h: 10 }, [first], bounds)!
    expect(second.x).toBeGreaterThanOrEqual(first.x + first.w + 4)
    const third = placeClear({ x: 15, y: 12, w: 30, h: 10 }, [first, second], bounds)!
    expect(third.y).toBeGreaterThanOrEqual(first.y + first.h + 4)
    expect(placeClear({ x: 95, y: -5, w: 30, h: 10 }, [], bounds)).toEqual({ x: 70, y: 0, w: 30, h: 10 })
    expect(placeClear({ x: 0, y: 0, w: 200, h: 10 }, [], bounds)).toBeNull()
  })
})
