import { GState, jsPDF } from 'jspdf'
import { describe, expect, it, vi } from 'vitest'
import {
  ARROW_LABEL,
  arrowHeadOps,
  balloonRing,
  CALLOUT_MAX_TITLE_LINES,
  calloutOps,
  calloutSize,
  calloutText,
  fitCalloutLines,
  LABEL_STYLES,
  labelOps,
  lineHeight,
  type FigureLabel,
  leaderOps,
  placeClear,
  textOps,
  type CalloutBoxStyle,
} from './callouts'
import { CONTRAST, contrastRuns, INK_COLOR, inkStates } from './contrastRuns'
import type { DrawOp, Point } from './drawOps'
import { createSheetPdf, drawSheetPdf, pdfText } from './renderPdf'
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

describe('callout text sizing and label styles', () => {
  const CYAN: CalloutBoxStyle = { ...STYLE, padding: { x: 2.2, y: 2.4 } }

  it('sizes a box from the text as it prints, an em dash included', () => {
    const title = 'Block B — over the height of land'
    const text = calloutText(CYAN, title, 'Likely Not Visible')
    // The PDF prints "—" as " - ": the box is measured on that.
    const printedWidth = textWidth(pdfText(title).replace(/\s+/g, ' '), 10, 'bold')
    expect(text.w).toBeGreaterThanOrEqual(printedWidth + CYAN.padding.x * 2 - 1e-9)
    // And it draws exactly the text it measured, never the raw em dash.
    const drawn = calloutOps(
      CYAN,
      { x: 0, y: 0, w: text.w, h: text.h },
      [200, 200],
      title,
      'Likely Not Visible',
      {},
      text,
    )
    expect(drawn.some((op) => op.op === 'text' && op.text === 'Block B - over the height of land')).toBe(true)
    expect(text.h).toBeCloseTo(2 * lineHeight(CYAN.title) + CYAN.padding.y * 2)
  })

  it('wraps a long name at words, then shrinks it, then cuts it', () => {
    const long = 'Block 12 — the long north-facing cutblock above the creek draw and the old landing'
    const wrapped = calloutText(CYAN, long, undefined, 160)
    expect(wrapped.title.lines.length).toBeGreaterThan(1)
    expect(wrapped.title.lines.length).toBeLessThanOrEqual(CALLOUT_MAX_TITLE_LINES)
    for (const line of wrapped.title.lines)
      expect(textWidth(line, wrapped.title.style.size, 'bold')).toBeLessThanOrEqual(160 - CYAN.padding.x * 2 + 1e-9)
    expect(wrapped.w).toBeLessThanOrEqual(160 + 1e-9)
    const tight = fitCalloutLines(long, CYAN.title, 60, 2)
    expect(tight.style.size).toBeCloseTo(10 * 0.85)
    expect(tight.lines.at(-1)).toMatch(/\.\.\.$/)
  })

  const clustered: FigureLabel[] = Array.from({ length: 6 }, (_, i) => ({
    title: `Block ${String.fromCharCode(65 + i)} — cutblock`,
    body: i % 2 ? 'Visible' : 'Possible Glimpses',
    anchor: [300 + i * 6, 220 + (i % 3) * 4] as Point,
  }))
  const area = { x: 0, y: 0, w: 600, h: 300 }
  const overlap = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

  for (const style of LABEL_STYLES.map((entry) => entry.id))
    it(`places six clustered labels without overlap, inside the area (${style})`, () => {
      const { boxes, dropped, ops } = labelOps(clustered, {
        style,
        area,
        maxWidth: 160,
        ceilingAt: () => 200,
        box: CYAN,
      })
      expect(dropped).toBe(0)
      expect(boxes).toHaveLength(6)
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i]
        expect(b.x).toBeGreaterThanOrEqual(area.x)
        expect(b.y).toBeGreaterThanOrEqual(area.y)
        expect(b.x + b.w).toBeLessThanOrEqual(area.x + area.w + 1e-9)
        expect(b.y + b.h).toBeLessThanOrEqual(area.y + area.h + 1e-9)
        for (let j = i + 1; j < boxes.length; j++) expect(overlap(b, boxes[j])).toBe(false)
      }
      expect(ops.length).toBeGreaterThan(6)
    })

  it('drops an underlined label’s leader from the underline, straight down to an anchor under it', () => {
    const { ops, boxes } = labelOps([{ title: 'Block 1', anchor: [100, 200] }], {
      style: 'underlined',
      area,
      maxWidth: 160,
      ceilingAt: () => 150,
    })
    const leader = ops.find(
      (op) => op.op === 'path' && !op.closed && op.stroke && op.parts[0].at(-1)![1] > boxes[0].y + boxes[0].h,
    ) as Extract<DrawOp, { op: 'path' }>
    const [[x0], [x1]] = leader.parts[0]
    expect(x0).toBeCloseTo(100)
    expect(x1).toBeCloseTo(100)
    expect(ops.some((op) => op.op === 'text' && op.text === 'Block 1' && op.style === 'bold')).toBe(true)
  })

  it('draws secondary features as small white text with an arrowhead leader', () => {
    const { ops } = labelOps([{ title: 'Opening 1998', anchor: [100, 200], secondary: true }], {
      style: 'underlined',
      area,
      maxWidth: 160,
    })
    expect(ops.some((op) => op.op === 'text' && op.color === '#ffffff' && op.size === 7)).toBe(true)
    expect(ops.some((op) => op.op === 'path' && op.closed && op.fill === '#ffffff')).toBe(true)
  })

  describe('underlined label with an arrow', () => {
    const one = (anchor: Point, luminanceAt?: (x: number, y: number) => number | null) =>
      labelOps([{ title: 'TFL18 I121', anchor }], {
        style: 'underlined-arrow',
        area,
        maxWidth: 160,
        ceilingAt: () => 120,
        ...(luminanceAt ? { luminanceAt } : {}),
      })
    const strokes = (ops: DrawOp[]) => paths(ops).filter((op) => !op.closed && op.stroke)

    it('runs the underline past the text and starts the leader at its right end', () => {
      const { ops, boxes } = one([200, 220])
      const text = ops.find((op) => op.op === 'text' && op.text === 'TFL18 I121') as Extract<DrawOp, { op: 'text' }>
      expect(text.style).toBe('bold')
      const textW = textWidth('TFL18 I121', ARROW_LABEL.title.size, 'bold')
      // Over no picture the underline and the leader are one dark stroke: underline, turn, down.
      const [line] = strokes(ops)
      const [start, turn, end] = line.parts[0]
      expect(start[0]).toBeCloseTo(text.x)
      expect(turn[1]).toBeCloseTo(start[1])
      expect(turn[0] - start[0]).toBeGreaterThanOrEqual(textW)
      expect(turn[0] - start[0]).toBeCloseTo(textW + ARROW_LABEL.overhang)
      // Room above the anchor: the turn sits over it and the leader runs straight down.
      expect(turn[0]).toBeCloseTo(200)
      expect(end[0]).toBeCloseTo(200)
      expect(end[1]).toBeGreaterThan(turn[1])
      expect(boxes[0].y + boxes[0].h).toBeLessThanOrEqual(120)
    })

    it('ends the leader in an arrowhead at the anchor', () => {
      const { ops } = one([200, 220])
      const head = paths(ops).find((op) => op.closed && op.fill)!
      const tip = head.parts[0][1]
      expect(Math.hypot(tip[0] - 200, tip[1] - 220)).toBeLessThan(1.5)
      expect(head.fill).toBe(INK_COLOR.dark)
    })

    it('turns the leader white over dark ground and back to dark, the head taking the last colour', () => {
      // Light sky to y 150, dark forest to 190, a pale block below.
      const ground = (_x: number, y: number) => (y < 150 ? 0.85 : y < 190 ? 0.12 : 0.8)
      const { ops } = one([200, 220], ground)
      const leader = strokes(ops).filter((op) => op.parts[0].some(([, y]) => y > 125))
      expect(leader.map((op) => op.stroke!.color)).toEqual([INK_COLOR.dark, INK_COLOR.light, INK_COLOR.dark])
      expect(leader[1].parts[0][0][1]).toBeCloseTo(150, -1)
      expect(leader[2].parts[0][0][1]).toBeCloseTo(190, -1)
      expect(paths(ops).find((op) => op.closed && op.fill)!.fill).toBe(INK_COLOR.dark)
      // Ending over the forest, the head is white.
      const forest = one([200, 220], (_x, y) => (y < 150 ? 0.85 : 0.12))
      expect(paths(forest.ops).find((op) => op.closed && op.fill)!.fill).toBe(INK_COLOR.light)
    })

    it('writes white text and underline over a dark background, with a halo where it is busy', () => {
      const { ops } = one([200, 220], (x) => (Math.floor(x / 3) % 2 ? 0.05 : 0.3))
      const text = ops.find((op) => op.op === 'text' && op.text === 'TFL18 I121') as Extract<DrawOp, { op: 'text' }>
      expect(text.color).toBe(INK_COLOR.light)
      expect(text.halo?.color).toBe(ARROW_LABEL.halo.light)
      const calm = one([200, 220], () => 0.9)
      const plain = calm.ops.find((op) => op.op === 'text') as Extract<DrawOp, { op: 'text' }>
      expect(plain.color).toBe(INK_COLOR.dark)
      expect(plain.halo).toBeUndefined()
    })
  })

  describe('contrast runs', () => {
    it('splits a leader over light, dark and light ground into dark, white and dark runs', () => {
      const line: Point[] = [
        [0, 0],
        [0, 90],
      ]
      const runs = contrastRuns(line, (_x, y) => (y < 30 ? 0.9 : y < 60 ? 0.1 : 0.9))
      expect(runs.map((run) => run.ink)).toEqual(['dark', 'light', 'dark'])
      expect(runs[0].parts[0]).toEqual([0, 0])
      expect(runs.at(-1)!.parts.at(-1)).toEqual([0, 90])
      for (let i = 1; i < runs.length; i++) expect(runs[i].parts[0]).toEqual(runs[i - 1].parts.at(-1))
      expect(inkStates([0.9, 0.9, 0.9, 0.1, 0.1, 0.1, 0.9, 0.9, 0.9])).toEqual([
        'dark',
        'dark',
        'dark',
        'light',
        'light',
        'light',
        'dark',
        'dark',
        'dark',
      ])
    })

    it('holds its colour through a one-sample flicker and inside the band', () => {
      expect(inkStates([0.9, 0.9, 0.1, 0.9, 0.9])).toEqual(['dark', 'dark', 'dark', 'dark', 'dark'])
      // Between the band's edges nothing changes, whichever side it started.
      const mid = (CONTRAST.toLight + CONTRAST.toDark) / 2
      expect(new Set(inkStates([0.9, mid, mid, mid, mid]))).toEqual(new Set(['dark']))
      expect(new Set(inkStates([0.1, mid, mid, mid, mid]))).toEqual(new Set(['light']))
      expect(
        contrastRuns(
          [
            [0, 0],
            [0, 40],
          ],
          (_x, y) => (Math.abs(y - 20) < 1 ? 0.05 : 0.9),
        ),
      ).toHaveLength(1)
    })
  })

  it('numbers markers and returns their key for the legend', () => {
    const { ops, key } = labelOps(clustered.slice(0, 3), { style: 'numbered', area, maxWidth: 160 })
    expect(key.map((entry) => entry.n)).toEqual([1, 2, 3])
    expect(key[0].text).toBe('Block A - cutblock - Possible Glimpses')
    expect(ops.filter((op) => op.op === 'circle')).toHaveLength(3)
  })
})
