import { GState, jsPDF } from 'jspdf'
import { describe, expect, it } from 'vitest'
import type { DrawOp } from '@/lib/mapSheet/drawOps'
import { createSheetPdf, drawSheetPdf, pdfTextUnfolded } from '@/lib/mapSheet/renderPdf'
import { sheetSvg } from '@/lib/mapSheet/renderSvg'
import {
  analysedFigure,
  analysisSheet,
  CLASS_PALETTE,
  composeFigure,
  countClasses,
  decodeClassRaster,
  FIGURE_CLASS,
  fillTemplate,
  fitFrame,
  inLandform,
  NO_INVENTORY_UNIT,
  landformCropRows,
  cropRasterRows,
  landformCentroid,
  layoutCallouts,
  maskRings,
  presetPercent,
  ringArea,
  roleOverlays,
  skylineRow,
  tonedImage,
  visibleLineParts,
  type ClassRaster,
  type FigureClass,
  type FigureInput,
} from './composeFigure'
import { presetById, VIA_STYLE_PRESETS } from './presets'

const W = 100,
  H = 60

/** A view: sky above row 20, terrain below, a landform with a block, an opening, private land and rock in it. */
function syntheticRgba(blend = false) {
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
  paint(20, 25, 80, 55, 'landform') // 60 × 30 = 1800
  paint(30, 30, 40, 40, 'proposedIn') // 100
  paint(50, 30, 55, 36, 'existingIn') // 30
  paint(60, 45, 70, 50, 'privateIn') // 50
  paint(70, 40, 75, 44, 'rock') // 20
  paint(5, 30, 10, 35, 'proposedOut') // 25, outside the landform
  if (blend)
    // A blended column on the block's left edge: halfway between landform green and block red,
    // which lies nearer the rock colour than either; it must not become rock.
    for (let y = 30; y < 40; y++) {
      const o = (y * W + 29) * 4
      rgba[o] = 128
      rgba[o + 1] = 80
      rgba[o + 2] = 0
    }
  return rgba
}

const raster = (blend = false): ClassRaster => decodeClassRaster(syntheticRgba(blend), W, H)

const input = (presetId: string, classes: ClassRaster | null = raster()): FigureInput => ({
  preset: presetById(presetId),
  image: { kind: 'rgba', data: new Uint8ClampedArray(W * H * 4).fill(200), width: W, height: H },
  classes,
  callouts: [
    { title: 'Block 1', body: 'Visible', anchor: [35, 35] },
    { title: 'Block 2', body: 'Likely Not Visible', anchor: [62, 52] },
  ],
  sightlinePercent: 6.4,
  sightlineClass: 'Partial Retention',
  lens: '50 mm equivalent, 39.6° horizontal, facing 245°',
  titles: { area: 'Sample Creek', viewpoint: 'Viewpoint 1', n: '1' },
  facts: [
    { label: 'Viewpoint', value: 'Sample FSR km 4' },
    { label: 'Distance', value: '2.1 km' },
  ],
  rating: { vsu: '12', vsc: '2', vac: 'L', evc: 'R', vqo: 'PR' },
  generatedAt: new Date('2026-11-11T12:00:00Z'),
})

const texts = (ops: DrawOp[]) => ops.flatMap((op) => (op.op === 'text' ? [op.text] : []))

describe('the class pass', () => {
  it('decodes palette colours and counts the classes the sheets print', () => {
    const counts = countClasses(raster())
    expect(counts).toMatchObject({ landform: 1800, proposed: 100, nonVeg: 30, privateLand: 50, rock: 20 })
    expect(counts.grossPercent).toBeCloseTo((100 * 130) / 1800)
    expect(counts.netOfPrivatePercent).toBeCloseTo((100 * 130) / 1750)
    expect(counts.netOfRockPercent).toBeCloseTo((100 * 130) / 1780)
  })

  it('gives a blended edge pixel to its neighbours, never to a third class', () => {
    const plain = countClasses(raster())
    const blended = countClasses(raster(true))
    expect(blended.rock).toBe(plain.rock)
    expect(blended.landform).toBe(plain.landform)
    expect(blended.proposed + blended.landform).toBeGreaterThan(0)
  })

  it('reads transparent pixels as sky and finds the skyline', () => {
    const r = raster()
    expect(r.codes[0]).toBe(FIGURE_CLASS.sky)
    expect(skylineRow(r, 50)).toBe(20)
    expect(skylineRow(r, -5)).toBe(20)
    expect(() => decodeClassRaster(new Uint8Array(4), 2, 2)).toThrow()
  })

  it('traces each class to rings with the area of its pixels', () => {
    const r = raster()
    const block = maskRings(r, (c) => c === FIGURE_CLASS.proposedIn)
    expect(block).toHaveLength(1)
    expect(ringArea(block[0])).toBeCloseTo(100, -1)
    expect(maskRings(r, () => false)).toEqual([])
    // Specks under the minimum are dropped.
    expect(maskRings(r, (c) => c === FIGURE_CLASS.rock, 25)).toEqual([])
    const overlays = roleOverlays(presetById('analysed-photo-hatched-rock'), r)
    expect(overlays.map((o) => o.role)).toEqual(['landform', 'rockNonVeg', 'existingNonVeg', 'proposedBlock'])
    // The block role traces blocks in and out of the landform.
    expect(overlays.find((o) => o.role === 'proposedBlock')!.parts).toHaveLength(2)
    expect(landformCentroid(r)![0]).toBeCloseTo(50, 0)
  })
})

describe('lines on the figure', () => {
  it('keeps the runs of a projected line that fall on the landform', () => {
    const r = raster()
    const points: Array<[number, number] | null> = [
      [10, 40], // terrain, outside the landform
      [25, 40],
      [45, 40],
      null, // behind the camera
      [50, 45],
      [60, 45],
      [90, 45], // outside again
    ]
    const parts = visibleLineParts(points, r, inLandform)
    expect(parts).toEqual([
      [
        [25, 40],
        [45, 40],
      ],
      [
        [50, 45],
        [60, 45],
      ],
    ])
  })

  it('draws line overlays in their own symbol', () => {
    const figure = composeFigure({
      ...input('district-greyscale'),
      lines: [
        {
          role: 'forceConvex',
          parts: [
            [
              [25, 40],
              [45, 40],
            ],
          ],
        },
      ],
    })
    expect(figure.drawn).toContain('forceConvex')
  })
})

describe('cropping the strip to the landform', () => {
  /** A 100 × 200 strip: sky to row 150, the landform on rows 150–159, ground below. */
  const tall = () => {
    const codes = new Uint8Array(100 * 200)
    for (let y = 150; y < 200; y++)
      for (let x = 0; x < 100; x++) codes[y * 100 + x] = y < 160 ? FIGURE_CLASS.landform : FIGURE_CLASS.terrain
    return { width: 100, height: 200, codes }
  }

  it('keeps about a fifth sky above the landform and at most 12 % ground below, full width', () => {
    const crop = landformCropRows(tall())!
    // A 10-row band in a window of 10 / 0.68 rows.
    expect(crop.height).toBe(15)
    const sky = (150 - crop.y) / crop.height,
      ground = (crop.y + crop.height - 160) / crop.height
    expect(sky).toBeGreaterThanOrEqual(0.15)
    expect(sky).toBeLessThanOrEqual(0.25)
    expect(ground).toBeLessThanOrEqual(0.15)
    const cropped = cropRasterRows(tall(), crop)
    expect(cropped).toMatchObject({ width: 100, height: 15 })
    expect(countClasses(cropped).landform).toBe(countClasses(tall()).landform)
  })

  it('puts a cropped strip’s callouts in the sheet’s band above the strip, clear of the landform', () => {
    const strip = { ...input('analysis-sheet-magenta') }
    // A strip with no sky: every column's skyline is row 0.
    const codes = new Uint8Array(W * 10).fill(FIGURE_CLASS.landform)
    const sheet = analysisSheet({
      ...strip,
      image: { kind: 'rgba', data: new Uint8ClampedArray(W * 10 * 4).fill(200), width: W, height: 10 },
      classes: { width: W, height: 10, codes },
      callouts: [{ title: 'Block 1', body: 'Visible', anchor: [50, 5] }],
    })
    const titleOp = sheet.ops.find((op) => op.op === 'text' && op.text === 'Block 1') as { y: number }
    expect(titleOp.y).toBeLessThan(sheet.frame.y)
  })

  it('never reaches past the image, and leaves a landform that fills it alone', () => {
    const codes = new Uint8Array(10 * 10).fill(FIGURE_CLASS.landform)
    expect(landformCropRows({ width: 10, height: 10, codes })).toBeNull()
    expect(landformCropRows({ width: 10, height: 10, codes: new Uint8Array(100) })).toBeNull()
    // A landform at the very top: the window starts at row 0.
    const top = new Uint8Array(100 * 200)
    for (let y = 0; y < 10; y++) for (let x = 0; x < 100; x++) top[y * 100 + x] = FIGURE_CLASS.landform
    expect(landformCropRows({ width: 100, height: 200, codes: top })!.y).toBe(0)
  })
})

describe('figure composition', () => {
  it('fits the image without stretching it', () => {
    const frame = fitFrame({ width: 200, height: 100 }, { x: 0, y: 0, w: 100, h: 100 })
    expect(frame).toMatchObject({ x: 0, y: 25, w: 100, h: 50, scale: 0.5 })
  })

  it('fills templates and leaves unknown fields', () => {
    expect(fillTemplate('Landform {n} of {area} {x}', { n: 2, area: 'A' })).toBe('Landform 2 of A {x}')
  })

  it('reads net figures when a preset subtracts private land or rock', () => {
    const counts = countClasses(raster())
    expect(presetPercent(presetById('analysis-sheet-orange'), counts)).toBe(counts.netOfPrivatePercent)
    expect(presetPercent(presetById('analysed-photo-hatched-rock'), counts)).toBe(counts.netOfRockPercent)
    expect(presetPercent(presetById('analysis-sheet-magenta'), counts)).toBe(counts.grossPercent)
  })

  it('lays callouts out above the skyline without overlap', () => {
    const preset = presetById('analysis-sheet-magenta')
    const frame = fitFrame({ width: W, height: H }, { x: 0, y: 0, w: 1000, h: 600 })
    const { boxes, dropped } = layoutCallouts(input(preset.id).callouts, preset.callout!, frame, raster())
    expect(dropped).toBe(0)
    expect(boxes).toHaveLength(2)
    const [a, b] = boxes.map((entry) => entry.box)
    expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true)
    // Above the skyline (row 20 = 200 pt), less the gap.
    expect(a.y + a.h).toBeLessThanOrEqual(200)
  })

  it('composes the analysis sheet: title, both figures, legend of what was drawn, the logo slot', () => {
    const sheet = analysisSheet(input('analysis-sheet-orange'))
    expect(sheet).toMatchObject({ width: 1224, height: 792 })
    const all = texts(sheet.ops)
    expect(all).toContain('Visual Impact Assessment')
    expect(all).toContain('Sample Creek - Landform 1')
    expect(all).toContain('Area of Private Land (PL) = 50')
    expect(all.some((t) => t.startsWith('Sightline measure (PGMaps run, the assessment figure): 6.40%'))).toBe(true)
    expect(all.some((t) => t.startsWith('Pixel measure, this image: 7.43%'))).toBe(true)
    expect(all).toContain('Logo (your own)')
    expect(all).toContain('Private Land')
    expect(all).toContain('Block 1')
    // The orange preset's rating code under the landform label, and why that unit.
    expect(all).toContain('L  /  R')
    expect(sheet.drawn).toEqual(expect.arrayContaining(['landform', 'privateLand', 'proposedBlock', 'existingNonVeg']))
    for (const text of all) expect(pdfTextUnfolded(text), text).toEqual([])
    expect(() => analysisSheet(input('board-triptych'))).toThrow()
  })

  it('draws no empty inventory circle: one line when no unit is known', () => {
    const sheet = analysisSheet({ ...input('analysis-sheet-magenta'), rating: null })
    const all = texts(sheet.ops)
    expect(all.join(' ')).toContain(NO_INVENTORY_UNIT)
    expect(all).not.toContain('Visual Inventory Legend')
    expect(all.some((t) => t.startsWith('VSU - Visual Sensitivity Unit'))).toBe(false)
    expect(sheet.ops.some((op) => op.op === 'circle')).toBe(false)
    // With a unit, the circle, its values (unknown ones as "?") and the key.
    const known = texts(analysisSheet({ ...input('analysis-sheet-magenta'), rating: { vsu: '12', vqo: 'PR' } }).ops)
    expect(known).toEqual(expect.arrayContaining(['VSU 12', '?', '?  /  ?', 'PR', 'VSU - Visual Sensitivity Unit']))
  })

  it('prints which rule chose the inventory unit under the circle', () => {
    const sheet = analysisSheet({
      ...input('analysis-sheet-magenta'),
      ratingNote: "VSU 12: under the blocks' visible ground",
    })
    expect(texts(sheet.ops)).toContain("VSU 12: under the blocks' visible ground")
    expect(texts(sheet.ops)).toContain('VSU 12')
  })

  it('prints without a class pass, and says what is missing', () => {
    const sheet = composeFigure(input('analysis-sheet-magenta', null))
    expect(sheet.counts).toBeNull()
    expect(sheet.notes[0]).toMatch(/No class pass/)
    expect(texts(sheet.ops).some((t) => t.startsWith('Pixel measure, this image: n/a'))).toBe(true)
  })

  it('composes every preset, and draws every one to PDF and SVG', () => {
    for (const preset of VIA_STYLE_PRESETS) {
      const sheet = composeFigure(input(preset.id))
      expect(sheet.width, preset.id).toBeGreaterThan(0)
      expect(sheet.ops.length, preset.id).toBeGreaterThan(5)
      for (const text of texts(sheet.ops)) expect(pdfTextUnfolded(text), `${preset.id}: ${text}`).toEqual([])
      expect(sheetSvg(sheet.ops, sheet.width, sheet.height)).toContain('<svg')
    }
    const figure = analysedFigure(input('analysed-photo-hatched-rock'))
    const pdf = createSheetPdf({ jsPDF, GState }, figure.width, figure.height)
    drawSheetPdf(pdf, { jsPDF, GState }, figure.ops)
    expect(pdf.output('arraybuffer').byteLength).toBeGreaterThan(1000)
    expect(texts(figure.ops)).toContain('Rock= 20 px')
  })

  it('fills the viewing distance and field of view, and leaves out a line it cannot fill', () => {
    const filled = texts(composeFigure({ ...input('district-greyscale'), distanceKm: 3.26, hfovDeg: 38.4 }).ops)
    expect(filled).toContain(
      'scaled to viewing distance (3.3 km) for comparison with other viewpoints with 38 deg. field of view',
    )
    const unfilled = texts(composeFigure(input('district-greyscale')).ops)
    expect(unfilled.some((t) => t.includes('{'))).toBe(false)
  })

  it('tones the frame grey for greyscale styles only', () => {
    const image = { kind: 'rgba' as const, data: new Uint8ClampedArray([255, 0, 0, 255]), width: 1, height: 1 }
    const grey = tonedImage(image, 'greyscale')
    expect(grey.kind === 'rgba' && [...grey.data]).toEqual([76, 76, 76, 255])
    expect(tonedImage(image, 'colour')).toBe(image)
  })
})

describe('the gallery view', () => {
  it('composes every preset over the synthetic view with its classes counted', async () => {
    const { galleryFigureInput } = await import('./galleryFigure')
    for (const preset of VIA_STYLE_PRESETS) {
      const figure = composeFigure(galleryFigureInput(preset))
      expect(figure.counts!.landform, preset.id).toBeGreaterThan(1000)
      expect(figure.counts!.proposed, preset.id).toBeGreaterThan(100)
    }
  })
})
