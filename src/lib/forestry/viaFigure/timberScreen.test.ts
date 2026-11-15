import { describe, expect, it } from 'vitest'
import type { DrawOp } from '@/lib/mapSheet/drawOps'
import {
  analysedFigure,
  analysisSheet,
  CLASS_PALETTE,
  countClasses,
  decodeClassRaster,
  FIGURE_CLASS,
  TABLOID_PAGE,
  tabloidFigure,
  timberLine,
  translateOps,
  type ClassRaster,
  type FigureClass,
  type FigureInput,
} from './composeFigure'
import { presetById } from './presets'
import { TIMBER_ABSENT, TIMBER_CHANGE_DISTANCE, timberCounts, timberScreenedClasses } from './timberScreen'

const W = 100,
  H = 60

/** Sky above row 20, terrain below; a 60 × 30 landform with a 10 × 10 block, a 5 × 6 opening, and a block outside. */
function classes(): ClassRaster {
  const rgba = new Uint8ClampedArray(W * H * 4)
  const paint = (x0: number, y0: number, x1: number, y1: number, name: Exclude<FigureClass, 'sky'>) => {
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const o = (y * W + x) * 4
        ;[rgba[o], rgba[o + 1], rgba[o + 2]] = CLASS_PALETTE[name]
        rgba[o + 3] = 255
      }
  }
  paint(0, 20, W, H, 'terrain')
  paint(20, 25, 80, 55, 'landform') // 1800
  paint(30, 30, 40, 40, 'proposedIn') // 100
  paint(50, 30, 55, 36, 'existingIn') // 30
  paint(5, 30, 10, 35, 'proposedOut') // 25
  return decodeClassRaster(rgba, W, H)
}

/** A forest-green picture, with `cut` (x0, y0, x1, y1) painted as tan cut ground. */
function picture(cut: [number, number, number, number] | null = null, noise = 0) {
  const data = new Uint8ClampedArray(W * H * 4)
  for (let k = 0; k < W * H; k++) {
    const x = k % W,
      y = Math.floor(k / W)
    const inCut = cut && x >= cut[0] && x < cut[2] && y >= cut[1] && y < cut[3]
    const jitter = noise ? ((x * 7 + y * 13) % 3) - 1 : 0
    data.set(inCut ? [196, 170, 130, 255] : [40 + jitter * noise, 70, 45, 255], k * 4)
  }
  return { data, width: W, height: H }
}

describe('the with-timber pixel measure (before/after difference)', () => {
  it('reads a block the timber hides entirely as the ground in front: 0 proposed, landform unchanged', () => {
    const ground = classes()
    const measure = timberScreenedClasses(ground, picture(), picture())
    expect(measure.kind).toBe('measured')
    if (measure.kind !== 'measured') return
    expect(measure).toMatchObject({ proposedPx: 100, seenPx: 0 })
    const counts = countClasses(measure.classes)
    // The landform's pixels are the ground pass's: only the proposed count falls.
    expect(counts.landform).toBe(countClasses(ground).landform)
    expect(counts.proposed).toBe(0)
    expect(counts.nonVeg).toBe(30)
    expect(measure.classes.codes[32 * W + 35]).toBe(FIGURE_CLASS.landform)
    expect(measure.classes.codes[32 * W + 7]).toBe(FIGURE_CLASS.terrain)
    // The ground pass itself is never changed.
    expect(ground.codes[32 * W + 35]).toBe(FIGURE_CLASS.proposedIn)
  })

  it('counts the block pixels whose colour changes as seen past the timber', () => {
    // The block's left half is cut and seen in the after picture; its right half stays behind standing timber.
    const measure = timberScreenedClasses(classes(), picture(), picture([30, 30, 35, 40]))
    expect(measure).toMatchObject({ kind: 'measured', proposedPx: 100, seenPx: 50 })
    expect(timberCounts(measure)?.proposed).toBe(50)
    expect(timberCounts(measure)?.grossPercent).toBeCloseTo((100 * 80) / 1800, 6)
  })

  it('ignores change outside the blocks and differences under the threshold', () => {
    // A cut drawn over the opening and the terrain (not a proposed class) changes nothing; JPEG-like noise neither.
    const measure = timberScreenedClasses(classes(), picture(null, 6), picture([45, 25, 60, 40], 0))
    expect(measure).toMatchObject({ kind: 'measured', seenPx: 0 })
    expect(TIMBER_CHANGE_DISTANCE).toBeGreaterThan(6 * Math.sqrt(3))
  })

  it('is absent, never zero, when the pictures and the class pass are not one size', () => {
    const before = { ...picture(), width: W - 1 }
    expect(timberScreenedClasses(classes(), before, picture())).toEqual({ kind: 'absent', reason: TIMBER_ABSENT.size })
    expect(timberCounts({ kind: 'absent', reason: TIMBER_ABSENT.noBefore })).toBeNull()
  })
})

const texts = (ops: DrawOp[]) => ops.flatMap((op) => (op.op === 'text' ? [op.text] : []))

const figureInput = (presetId: string, timber: FigureInput['timber']): FigureInput => ({
  preset: presetById(presetId),
  image: { kind: 'rgba', data: picture().data, width: W, height: H },
  classes: classes(),
  ...(timber !== undefined ? { timber } : {}),
  callouts: [{ title: 'Block 1', body: 'Visible', anchor: [35, 35] }],
  sightlinePercent: 6.4,
  sightlineClass: 'Partial Retention',
  lens: '50 mm equivalent, 39.6° horizontal, facing 245°',
  titles: { area: 'Sample Creek', viewpoint: 'Viewpoint 1', n: '1' },
  facts: [],
  rating: null,
  generatedAt: new Date('2026-11-11T12:00:00Z'),
})

describe('the sheets print the with-timber figure beside the others', () => {
  const seen = timberScreenedClasses(classes(), picture(), picture([30, 30, 35, 40]))
  const measured = seen.kind === 'measured' ? { classes: seen.classes } : null

  it('prints it as a second pixel figure, keeping the pixel and sightline figures', () => {
    for (const compose of [analysisSheet, analysedFigure]) {
      // The sheet's calculation cell wraps its lines: read them as one text.
      const lines = texts(compose(figureInput('analysis-sheet-magenta', measured)).ops).join(' ')
      expect(lines).toMatch(/Sightline measure \(PGMaps run, the assessment figure\): 6\.40%/)
      expect(lines).toMatch(/Pixel measure, this image: 7\.22%/)
      // (50 + 30) / 1800; the opening keeps the ground pass's count and the line says so.
      expect(lines).toMatch(/Pixel measure, with drawn timber: 4\.44% \(existing openings as on the\s+ground\)/)
    }
  })

  it('says why when it was not measured, and never prints 0', () => {
    const lines = texts(
      analysedFigure(figureInput('analysis-sheet-magenta', { absent: TIMBER_ABSENT.noBefore })).ops,
    ).join('\n')
    expect(lines).toContain('Pixel measure, with drawn timber: not measured (no before-harvest render of this view)')
    expect(timberLine({ ...figureInput('analysis-sheet-magenta', undefined) })).toBeNull()
  })
})

describe('a calculation figure on an 11 × 17 page', () => {
  it('composes an analysed figure as large as the page holds, centred, never stretched', () => {
    const input = figureInput('analysed-photo-private-land', null)
    const page = tabloidFigure(input)
    expect(page).toMatchObject(TABLOID_PAGE)
    // The picture is far larger than at a letter page's width, and keeps its aspect.
    expect(page.frame.w).toBeGreaterThan(analysedFigure(input).frame.w * 1.5)
    expect(page.frame.w / page.frame.h).toBeCloseTo(W / H, 2)
    expect(page.frame.x).toBeGreaterThanOrEqual(0)
    expect(page.frame.x + page.frame.w).toBeLessThanOrEqual(TABLOID_PAGE.width)
  })

  it('keeps an analysis sheet as composed', () => {
    const input = figureInput('analysis-sheet-magenta', null)
    expect(tabloidFigure(input).ops).toEqual(analysisSheet(input).ops)
  })

  it('moves every kind of op', () => {
    const ops: DrawOp[] = [
      { op: 'rect', x: 1, y: 2, w: 3, h: 4 },
      { op: 'path', parts: [[[0, 0]]], closed: false },
      { op: 'clip', parts: [[[1, 1]]] },
      { op: 'restore' },
    ]
    expect(translateOps(ops, 10, 20)).toEqual([
      { op: 'rect', x: 11, y: 22, w: 3, h: 4 },
      { op: 'path', parts: [[[10, 20]]], closed: false },
      { op: 'clip', parts: [[[11, 21]]] },
      { op: 'restore' },
    ])
  })
})
