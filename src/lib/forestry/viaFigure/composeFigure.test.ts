import { GState, jsPDF } from 'jspdf'
import { describe, expect, it } from 'vitest'
import { INK_COLOR } from '@/lib/mapSheet/contrastRuns'
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
  existingOpeningCallouts,
  FIGURE_CLASS,
  figureLabelCallouts,
  figureLuminance,
  fillTemplate,
  fitFrame,
  inLandform,
  NO_INVENTORY_UNIT,
  paintBlockGround,
  paintsBlocks,
  landformCropRows,
  cropRasterRows,
  landformCentroid,
  layoutCallouts,
  maskRings,
  presetPercent,
  calcColumns,
  calcValues,
  classPaletteEntries,
  countsAlteration,
  partialCutLines,
  presetRule,
  rgbaLuminance,
  ringArea,
  roleOverlays,
  skylineRow,
  tonedImage,
  traceLandform,
  visibleLineParts,
  type ClassRaster,
  type FigureClass,
  type FigureCounts,
  type FigureInput,
  fittedLines,
  landformNumber,
} from './composeFigure'
import { ALTERATION_RULES, sceneSheetRule } from './alteration'
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

  it("prints the total its formula line names, from the style's rule", () => {
    // 22's box reads (NonVEG + Prop. Blk) / (LF - PL): the total is net of private land, the parts over the landform.
    const counts = {
      landform: 101153,
      privateLand: 55889,
      nonVeg: 0,
      proposed: 517,
      rock: 0,
      grossPercent: null,
      netOfPrivatePercent: null,
      netOfRockPercent: null,
    }
    const orange = presetById('analysis-sheet-orange')
    const values = calcValues(counts, '1', presetRule(orange))
    expect(values.totalPct).toBe('1.14')
    expect(values.proposedPct).toBe('0.51')
    expect(values.netPx).toBe(101153 - 55889)
    // The photo styles print one decimal and the class the page reads it as; no reading leaves the line out.
    const photo = presetById('analysed-photo-hatched-rock')
    const classed = calcValues({ ...counts, privateLand: 0, rock: 1153 }, '1', presetRule(photo), () => ({
      code: 'R',
      name: 'Retention',
    }))
    expect(classed).toMatchObject({ totalPct: '0.5', class: 'Retention', deductedPx: 1153 })
    expect(calcValues(counts, '1', presetRule(photo)).class).toBeUndefined()
  })

  it('prints the rule it is handed, naming what leaves the landform, and its own wording otherwise', () => {
    const counts = countClasses(raster())
    const magenta = input('analysis-sheet-magenta')
    const own = texts(analysisSheet(magenta).ops)
    expect(own).toContain(`Area of Landform 1 = ${counts.landform}`)
    expect(own.some((t) => t.startsWith('(NonVEG + Proposed Blocks) / VSU = '))).toBe(true)
    expect(own.some((t) => t.startsWith('Less ') || t.startsWith('Net Landform'))).toBe(false)
    // A scene that takes private land out: the sheet nets private land and rock, and its lines say so.
    const rule = sceneSheetRule(presetRule(magenta.preset), { privateLandOutOfDenominator: true })
    const net = countsAlteration(rule, counts)!
    const netted = texts(analysisSheet({ ...magenta, rule }).ops)
    expect(netted).toContain(`Less Rock and Private Land = ${counts.privateLand + counts.rock}`)
    expect(netted).toContain(`Net Landform 1 = ${net.denominator}`)
    expect(netted).toContain(`(NonVEG + Proposed Blocks) / Net VSU = ${net.printed}%*`)
    expect(netted.some((t) => t.startsWith(`Pixel measure, this image: ${net.percent.toFixed(2)}%`))).toBe(true)
    // A report's format rule on another style: that rule's figure, in the style's own words when they match.
    const photo = input('analysed-photo-rock-outline')
    const report = texts(composeFigure({ ...photo, rule: ALTERATION_RULES.netOfRockAndPrivateCm2 }).ops)
    expect(report).toEqual(texts(composeFigure(photo).ops))
    expect(report).toContain(`Rock and Private Land= ${counts.privateLand + counts.rock} px`)
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

  it('prints why the sightline figure is withheld, never a number, when the run did not stand behind it', () => {
    const withheld = texts(
      analysisSheet({
        ...input('analysis-sheet-orange'),
        sightlinePercent: null,
        sightlineClass: null,
        sightlineWithheld: 'Withheld \u2014 Existing disturbance coverage has not been confirmed.',
      }).ops,
    ).join('\n')
    expect(withheld).toMatch(/Sightline measure \(PGMaps run\): Withheld \u2014 Existing disturbance/)
    expect(withheld).not.toMatch(/the assessment figure/)
    // The pixel figure still prints beside it.
    expect(withheld).toMatch(/Pixel measure, this image: 7\.43%/)
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
    // PGMaps' own map drew it: no renderer line.
    expect(all.some((t) => t.startsWith('Picture and pixel measure:'))).toBe(false)
    // Another engine's capture says so beside the measures.
    const engine = texts(
      analysisSheet({
        ...input('analysis-sheet-orange'),
        illustration: [
          'Picture and pixel measure: Nanite Forest 467b44c, one capture',
          'Drawn without data: trees past 6.1 km not drawn',
        ],
      }).ops,
    )
    expect(engine.some((t) => t.startsWith('Picture and pixel measure: Nanite Forest'))).toBe(true)
    expect(engine.some((t) => t.startsWith('Drawn without data: trees past 6.1 km'))).toBe(true)
    // An engine's ground pass gives the outlines and the first figure; its trees-in-front pass a second one
    // (here the drawn trees hide every proposed pixel; the existing opening still counts).
    const base = input('analysis-sheet-orange')
    const hidden = base.classes!.codes.map((code) => (code === FIGURE_CLASS.proposedIn ? 10 : code))
    const withTrees = texts(analysisSheet({ ...base, screenedClasses: { ...base.classes!, codes: hidden } }).ops)
    expect(withTrees.some((t) => /^Pixel measure, this image, the ground under the trees: 7\.43%/.test(t))).toBe(true)
    expect(withTrees.some((t) => /^Pixel measure with the drawn trees in front: 1\.82%/.test(t))).toBe(true)
    // No logo given: the slot draws nothing, and the sheet says nothing of itself.
    expect(all.some((t) => /logo/i.test(t))).toBe(false)
    expect(all.some((t) => /PGMaps figure|generated 20|not a field-verified/.test(t))).toBe(false)
    expect(sheet.ops.some((op) => op.op === 'rect' && op.stroke?.dash)).toBe(false)
    expect(all).toContain('Private Land')
    expect(all).toContain('Block 1')
    // The orange preset's rating code under the landform label, and why that unit.
    expect(all).toContain('L  /  R')
    expect(sheet.drawn).toEqual(expect.arrayContaining(['landform', 'privateLand', 'proposedBlock', 'existingNonVeg']))
    for (const text of all) expect(pdfTextUnfolded(text), text).toEqual([])
    expect(() => analysisSheet(input('board-triptych'))).toThrow()
  })

  it('draws no empty inventory circle: one line when no unit is known', () => {
    const sheet = analysisSheet({ ...input('analysis-sheet-magenta'), rating: null, ratingNote: null })
    const all = texts(sheet.ops)
    expect(all.join(' ')).toContain(NO_INVENTORY_UNIT)
    // An inventory never read says so, rather than that no unit is there.
    const unread = 'Visual inventory not read: look it up in step 1 to fill the circle.'
    const notRead = analysisSheet({ ...input('analysis-sheet-magenta'), rating: null, ratingNote: unread })
    expect(texts(notRead.ops).join(' ')).toContain('Visual inventory not read')
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

describe('painting block ground', () => {
  /** A picture lit from the left: bright (200) on the left half, shaded (80) on the right. */
  const litImage = () => {
    const data = new Uint8ClampedArray(W * H * 4)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) data.set(x < 35 ? [200, 200, 200, 255] : [80, 80, 80, 255], (y * W + x) * 4)
    return { data, width: W, height: H }
  }
  const lum = (data: ArrayLike<number>, k: number) =>
    0.299 * data[k * 4] + 0.587 * data[k * 4 + 1] + 0.114 * data[k * 4 + 2]
  const paint = { proposed: '#9c817b', existing: '#777e70' }

  it('changes only the pixels of the blocks it paints', () => {
    const classes = raster()
    const image = litImage()
    const proposedOnly = paintBlockGround(image, classes, { proposed: paint.proposed })
    const both = paintBlockGround(image, classes, paint)
    let changed = 0
    for (let k = 0; k < W * H; k++) {
      const code = classes.codes[k]
      const proposed = code === FIGURE_CLASS.proposedIn || code === FIGURE_CLASS.proposedOut
      const existing = code === FIGURE_CLASS.existingIn || code === FIGURE_CLASS.existingOut
      const same = (out: Uint8ClampedArray) => [0, 1, 2, 3].every((c) => out[k * 4 + c] === image.data[k * 4 + c])
      if (!proposed) expect(same(proposedOnly), `pixel ${k}`).toBe(true)
      if (!proposed && !existing) expect(same(both), `pixel ${k}`).toBe(true)
      if (proposed && !same(proposedOnly)) changed++
      expect(both[k * 4 + 3]).toBe(255)
    }
    // Both blocks (the one in the landform and the one outside it) are painted.
    expect(changed).toBe(125)
    expect([...both.slice((32 * W + 52) * 4, (32 * W + 52) * 4 + 3)]).not.toEqual([80, 80, 80])
  })

  it('keeps the picture’s shading: lit ground stays lighter than shaded ground', () => {
    // One block across the light and the shade: rows 30–40, columns 30–40 straddle column 35.
    const classes = raster()
    const out = paintBlockGround(litImage(), classes, paint)
    const mean = (x0: number, x1: number) => {
      let s = 0,
        n = 0
      for (let y = 31; y < 39; y++)
        for (let x = x0; x < x1; x++) {
          s += lum(out, y * W + x)
          n++
        }
      return s / n
    }
    expect(mean(31, 34)).toBeGreaterThan(mean(36, 39) * 1.3)
    // And it is the paint's colour, not the grey picture: warm, red above blue.
    const k = (35 * W + 32) * 4
    expect(out[k]).toBeGreaterThan(out[k + 2] + 10)
  })

  it('paints the same view the same way every time, and a different seed differently', () => {
    const classes = raster()
    const a = paintBlockGround(litImage(), classes, paint)
    const b = paintBlockGround(litImage(), classes, paint)
    expect([...a]).toEqual([...b])
    expect([...paintBlockGround(litImage(), classes, paint, { seed: 7 })]).not.toEqual([...a])
  })

  it('textures the cut: neighbouring interior pixels of one flat area differ', () => {
    const flat = { data: new Uint8ClampedArray(W * H * 4).fill(150), width: W, height: H }
    const out = paintBlockGround(flat, raster(), paint)
    const values = new Set<number>()
    for (let y = 32; y < 38; y++) for (let x = 32; x < 38; x++) values.add(Math.round(lum(out, y * W + x)))
    expect(values.size).toBeGreaterThan(10)
  })

  it('blends the block’s boundary pixels half and half with the picture', () => {
    const flat = { data: new Uint8ClampedArray(W * H * 4).fill(150), width: W, height: H }
    const out = paintBlockGround(flat, raster(), paint)
    // Pixel (30, 35) is on the block's left edge; (32, 35) inside. The edge sits nearer the picture's 150.
    const edge = lum(out, 35 * W + 30),
      inside = lum(out, 35 * W + 33)
    expect(Math.abs(edge - 150)).toBeLessThan(Math.abs(inside - 150) + 1)
    expect(Math.abs(edge - 150)).toBeGreaterThan(0)
  })

  it('never paints over a tree the screened pass draws in front of the block', () => {
    const classes = raster()
    // A tree standing on ordinary ground in front of the block's left half: the screened pass reads terrain there.
    const screened: ClassRaster = { ...classes, codes: classes.codes.slice() }
    for (let y = 30; y < 40; y++) for (let x = 30; x < 35; x++) screened.codes[y * W + x] = FIGURE_CLASS.terrain
    const image = litImage()
    const out = paintBlockGround(image, classes, paint, { screened })
    for (let y = 30; y < 40; y++)
      for (let x = 30; x < 35; x++)
        expect([...out.slice((y * W + x) * 4, (y * W + x) * 4 + 4)]).toEqual([200, 200, 200, 255])
    expect(lum(out, 35 * W + 37)).not.toBe(80)
  })

  it('paints nothing when the picture and the class pass differ in size', () => {
    const image = { data: new Uint8ClampedArray(4 * 4 * 4).fill(90), width: 4, height: 4 }
    expect([...paintBlockGround(image, raster(), paint)]).toEqual([...image.data])
  })

  it('paints by the preset’s choice unless the reviewer chooses, and keeps the outline on top', () => {
    expect(paintsBlocks({ preset: presetById('analysis-sheet-magenta') })).toBe(true)
    expect(paintsBlocks({ preset: presetById('perspective-overlay') })).toBe(false)
    expect(paintsBlocks({ preset: presetById('analysis-sheet-magenta'), paintBlocks: false })).toBe(false)
    const base = { ...input('analysis-sheet-magenta'), image: { kind: 'rgba' as const, ...litImage() } }
    const imageOf = (figure: ReturnType<typeof composeFigure>) => {
      const op = figure.ops.find((entry) => entry.op === 'image')!
      return op.op === 'image' && op.image.kind === 'rgba' ? op.image.data : null
    }
    const painted = imageOf(composeFigure(base))!
    const plain = imageOf(composeFigure({ ...base, paintBlocks: false }))!
    expect([...plain]).toEqual([...base.image.data])
    expect([...painted]).not.toEqual([...plain])
    // The block's outline is drawn after the painted picture.
    const ops = composeFigure(base).ops
    const imageAt = ops.findIndex((op) => op.op === 'image')
    const outlineAt = ops.findIndex((op) => op.op === 'path' && 'stroke' in op && op.stroke?.color === '#4ce600')
    expect(outlineAt).toBeGreaterThan(imageAt)
  })

  it('paints private land one flat, shaded colour only when the style gives it one', () => {
    const classes = raster()
    const image = litImage()
    const isPrivate = (k: number) =>
      classes.codes[k] === FIGURE_CLASS.privateIn || classes.codes[k] === FIGURE_CLASS.privateOut
    const same = (out: Uint8ClampedArray, k: number) =>
      [0, 1, 2, 3].every((c) => out[k * 4 + c] === image.data[k * 4 + c])
    const without = paintBlockGround(image, classes, paint)
    const withPrivate = paintBlockGround(image, classes, { ...paint, privateLand: '#b702d5' })
    let painted = 0
    for (let k = 0; k < W * H; k++) {
      if (isPrivate(k)) {
        expect(same(without, k), `pixel ${k}`).toBe(true)
        if (!same(withPrivate, k)) painted++
      } else expect([...withPrivate.slice(k * 4, k * 4 + 4)]).toEqual([...without.slice(k * 4, k * 4 + 4)])
    }
    expect(painted).toBe(50)
    // Magenta, and flat: interior pixels on one side of the light are one colour (no cut texture).
    const at = (x: number, y: number) => [...withPrivate.slice((y * W + x) * 4, (y * W + x) * 4 + 3)]
    expect(at(64, 47)[2]).toBeGreaterThan(at(64, 47)[1] + 60)
    expect(at(64, 47)).toEqual(at(66, 47))
  })

  it('keeps private land’s symbol off a picture that paints it, and its legend row', () => {
    const base = { ...input('analysis-sheet-orange'), image: { kind: 'rgba' as const, ...litImage() } }
    const fills = (figure: ReturnType<typeof composeFigure>) =>
      figure.ops.filter((op) => (op.op === 'path' || op.op === 'rect') && op.fill === '#d004ef').length
    const painted = composeFigure(base)
    const plain = composeFigure({ ...base, paintBlocks: false })
    // Unpainted, the mask is drawn over the picture and again as the legend swatch; painted, only the swatch.
    expect(fills(plain)).toBeGreaterThan(fills(painted))
    expect(fills(painted)).toBeGreaterThan(0)
    expect(texts(painted.ops).join(' ')).toContain('Private Land')
  })

  it('says so when it cannot paint an encoded frame', () => {
    const figure = composeFigure({
      ...input('analysis-sheet-magenta'),
      image: { kind: 'url', url: 'data:image/jpeg;base64,', format: 'JPEG', width: W, height: H },
    })
    expect(figure.notes.join(' ')).toMatch(/could not be painted/)
  })
})

describe('the perspective overlay and the camera block', () => {
  const camera = {
    frames: 2,
    focalMm: 50,
    fovDeg: 79.2,
    observerHeightM: 1.6,
    above: 'ground' as const,
    lng: -122.6,
    lat: 53.9,
    elevationM: 700,
    azimuthDeg: 112,
    maxTreeHeightM: 24.5,
    renderedOn: new Date('2026-11-12T00:00:00Z'),
  }
  /** Left half of the terrain Retention, right half Partial Retention. */
  const zones = () => {
    const codes = new Uint8Array(W * H)
    for (let y = 20; y < H; y++) for (let x = 0; x < W; x++) codes[y * W + x] = x < 50 ? 2 : 3
    return { width: W, height: H, codes }
  }

  it('puts the title in the sky, the VQO legend, underlined labels and the camera block on the image', () => {
    const sheet = composeFigure({
      ...input('perspective-overlay'),
      zones: zones(),
      camera,
      titles: { area: 'Sample Creek', viewpoint: 'VP1', n: '1', blocks: 'Block 1, Block 2' },
    })
    const all = texts(sheet.ops)
    expect(all).toEqual(
      expect.arrayContaining([
        'Visual Impact Assessment',
        'Sample Creek',
        'Block 1, Block 2',
        'Perspective View',
        'Viewpoint 1',
        'Visual Quality Objective Legend',
        'Retention (R)',
        'Partial Retention (PR)',
        'Composite of 2 simulated 50 mm camera images: FOV 79.2 degrees',
        'Maximum tree height: 24.5 metres',
      ]),
    )
    // No objective that is not in view, and an unfilled title line is left out.
    expect(all).not.toContain('Preservation (P)')
    expect(all.some((t) => t.includes('{'))).toBe(false)
    expect(sheet.drawn).toEqual(expect.arrayContaining(['vqoRetention', 'vqoPartialRetention', 'proposedBlock']))
    // Underlined labels by default: the label text is bold, with no callout box behind it.
    expect(sheet.ops.some((op) => op.op === 'text' && op.text === 'Block 1' && op.style === 'bold')).toBe(true)
  })

  /** A pale sky over the top 20 rows and dark forest below, as the synthetic class pass draws. */
  const skyAndForest = () => {
    const data = new Uint8ClampedArray(W * H * 4)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const v = y < 20 ? 225 : 35
        data.set([v, v, v, 255], (y * W + x) * 4)
      }
    return { kind: 'rgba' as const, data, width: W, height: H }
  }

  it('draws arrow labels by default, their leaders dark over the sky and white over the forest', () => {
    const sheet = composeFigure({ ...input('perspective-overlay'), image: skyAndForest() })
    const strokes = sheet.ops.filter(
      (op): op is Extract<DrawOp, { op: 'path' }> => op.op === 'path' && !op.closed && !!op.stroke,
    )
    const colours = new Set(strokes.map((op) => op.stroke!.color))
    expect(colours).toContain(INK_COLOR.dark)
    expect(colours).toContain(INK_COLOR.light)
    // The name sits in the sky in dark type.
    const name = sheet.ops.find((op) => op.op === 'text' && op.text === 'Block 1') as Extract<DrawOp, { op: 'text' }>
    expect(name.color).toBe(INK_COLOR.dark)
  })

  it('reads the printed brightness: the frame with the preset’s fills over it', () => {
    const image = skyAndForest()
    expect(rgbaLuminance(image)(50, 5)).toBeCloseTo(225 / 255)
    expect(rgbaLuminance(image)(-1, 5)).toBeNull()
    const frame = fitFrame(image, { x: 0, y: 0, w: W, h: H })
    const sample = figureLuminance({ ...input('perspective-overlay'), image }, frame)!
    // Plain forest stays dark; the pale yellow-tan block fill over it reads light.
    expect(sample(90, 50)!).toBeLessThan(0.2)
    expect(sample(35, 35)!).toBeGreaterThan(0.6)
    // A JPEG frame without a decoded sampler cannot be read.
    const encoded = { kind: 'url' as const, url: 'data:,', format: 'JPEG' as const, width: W, height: H }
    expect(figureLuminance({ ...input('perspective-overlay'), image: encoded }, frame)).toBeNull()
    expect(
      figureLuminance({ ...input('perspective-overlay'), image: encoded, luminance: () => 0.5 }, frame)!(10, 10),
    ).toBeCloseTo(0.5)
  })

  it('says the pixel measure is of the ground, under any drawn timber', () => {
    const line = (maxTreeHeightM: number | null) =>
      texts(analysisSheet({ ...input('analysis-sheet-magenta'), camera: { ...camera, maxTreeHeightM } }).ops).find(
        (t) => t.startsWith('Pixel measure'),
      )
    expect(line(24.5)).toMatch(/^Pixel measure, this image, the ground under the trees: /)
    expect(line(null)).toMatch(/^Pixel measure, this image, bare earth: /)
  })

  it('prints the camera block on other styles only when asked', () => {
    const plain = texts(analysisSheet({ ...input('analysis-sheet-magenta'), camera }).ops)
    expect(plain.some((t) => t.startsWith('Composite of'))).toBe(false)
    const asked = texts(analysisSheet({ ...input('analysis-sheet-magenta'), camera, cameraInfo: true }).ops)
    expect(asked.some((t) => t.startsWith('Observer position (UTM zone 10)'))).toBe(true)
  })

  it('takes a label style other than the preset’s', () => {
    const numbered = analysisSheet({ ...input('analysis-sheet-magenta'), labelStyle: 'numbered' })
    expect(numbered.ops.filter((op) => op.op === 'circle').length).toBeGreaterThanOrEqual(2)
    expect(texts(numbered.ops).some((t) => t.startsWith('1  Block 1'))).toBe(true)
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

describe('fitted lines', () => {
  const box = { x: 0, top: 10, bottom: 60, width: 120 }
  const style = { size: 9, color: '#1d4ed8' }
  const lines = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ text: `Line ${i + 1}: a measure that wraps across the cell`, style }))
  const texts = (ops: ReturnType<typeof fittedLines>) =>
    ops.flatMap((op) => (op.op === 'text' ? [{ text: op.text, y: op.y, size: op.size }] : []))

  it('keeps every line at full size when they fit', () => {
    const drawn = texts(fittedLines(lines(2), box))
    expect(drawn.every((t) => t.size === 9)).toBe(true)
    expect(drawn.at(-1)!.y).toBeLessThanOrEqual(box.bottom)
  })

  it('shrinks, then ellipsizes, and never runs past the foot', () => {
    const shrunk = texts(fittedLines(lines(3), box))
    expect(shrunk[0].size).toBeLessThan(9)
    const crowded = texts(fittedLines(lines(12), box))
    expect(crowded.every((t) => t.y <= box.bottom)).toBe(true)
    expect(crowded.at(-1)!.text.endsWith('...')).toBe(true)
    expect(crowded[0].size).toBeCloseTo(9 * 0.7, 5)
  })
})

describe('arrows, no outlines', () => {
  it('finds each existing opening the class pass shows, largest first, with its arrow on the opening', () => {
    const classes = raster()
    // A second, smaller opening outside the landform, and a speck under the minimum share.
    const codes = classes.codes.slice()
    for (let y = 22; y < 25; y++) for (let x = 85; x < 89; x++) codes[y * W + x] = FIGURE_CLASS.existingOut
    codes[58 * W + 2] = FIGURE_CLASS.existingOut
    const found = existingOpeningCallouts({ ...classes, codes }, 'Existing opening', 0.001, 4)
    expect(found.map((c) => c.priority)).toEqual([30, 12])
    expect(found.every((c) => c.secondary && c.title === 'Existing opening')).toBe(true)
    for (const c of found) {
      const code = codes[Math.floor(c.anchor[1]) * W + Math.floor(c.anchor[0])]
      expect([FIGURE_CLASS.existingIn, FIGURE_CLASS.existingOut]).toContain(code)
    }
    expect(existingOpeningCallouts({ ...classes, codes }, 'x', 0.001, 1)).toHaveLength(1)
  })

  it('points out openings only for a style that asks, and never beside the page’s own secondary callouts', () => {
    const arrows = input('arrows-no-outlines')
    expect(figureLabelCallouts(arrows).filter((c) => c.secondary)).toHaveLength(1)
    expect(figureLabelCallouts(input('perspective-overlay'))).toHaveLength(2)
    const own = {
      ...arrows,
      callouts: [...arrows.callouts, { title: 'Old cut', anchor: [52, 33] as [number, number], secondary: true }],
    }
    expect(
      figureLabelCallouts(own)
        .filter((c) => c.secondary)
        .map((c) => c.title),
    ).toEqual(['Old cut'])
    expect(figureLabelCallouts({ ...arrows, classes: null })).toHaveLength(2)
  })

  it('draws no outline or legend, and labels the blocks and the opening with arrowheads', () => {
    const figure = composeFigure(input('arrows-no-outlines'))
    expect(figure.drawn).toEqual([])
    const all = texts(figure.ops)
    expect(all).toEqual(expect.arrayContaining(['Block 1', 'Existing opening', 'Viewpoint 1 - Simulated Harvest']))
    // No traced ring is stroked: every closed path is an arrowhead (three points) or the frame.
    const closed = figure.ops.filter((op): op is Extract<DrawOp, { op: 'path' }> => op.op === 'path' && op.closed)
    expect(closed.every((op) => op.parts.every((part) => part.length <= 4))).toBe(true)
    // Three arrowheads at least: two blocks and the opening.
    expect(closed.filter((op) => op.fill && op.parts[0].length === 3).length).toBeGreaterThanOrEqual(3)
  })
})

describe('a partial cut in the class pass (handbook 3.4.4)', () => {
  /** The synthetic view with a partial cut, 10 × 8 = 80 px, inside the landform beside the clearcut block. */
  function withPartialCut() {
    const rgba = syntheticRgba()
    for (let y = 46; y < 54; y++)
      for (let x = 30; x < 40; x++) {
        const o = (y * W + x) * 4
        ;[rgba[o], rgba[o + 1], rgba[o + 2]] = CLASS_PALETTE.partialIn
      }
    return decodeClassRaster(rgba, W, H, classPaletteEntries(true))
  }
  const cuts = [
    { name: 'FP1', visible: true, equivalentPercent: 0.8, volumeRemovedPercent: 10, residualHeightMeters: 27.5 },
    { name: 'FP2', visible: true, equivalentPercent: 0.8, volumeRemovedPercent: 10, residualHeightMeters: 27.5 },
  ]

  it('counts its pixels in the landform but never as proposed alteration', () => {
    const counts = countClasses(withPartialCut())
    expect(counts).toMatchObject({ landform: 1800, proposed: 100, nonVeg: 30, partialCut: 80 })
    // The figures are the clearcut ones: (100 + 30) / 1800, as with no partial cut in the view.
    expect(counts.grossPercent).toBeCloseTo((100 * 130) / 1800)
    for (const preset of VIA_STYLE_PRESETS.filter((p) => p.calc))
      expect(presetPercent(preset, counts)).toBe(presetPercent(preset, countClasses(raster())))
    const result = countsAlteration(presetRule(presetById('analysis-sheet-orange')), counts)
    expect(result?.numerator).toBe(130)
    expect(calcValues(counts).proposedPx).toBe(100)
  })

  it('outlines it as the block it is', () => {
    const rings = roleOverlays(presetById('analysis-sheet-orange'), withPartialCut()).find(
      (overlay) => overlay.role === 'proposedBlock',
    )!.parts
    const area = rings.reduce((sum, ring) => sum + Math.abs(ringArea(ring)), 0)
    // The two blocks inside the landform and the one outside: 100 + 80 + 25 px of outline area, about.
    expect(area).toBeGreaterThan(180)
  })

  it('says on the sheet what was left out, and the Table 6 figure the run adds to X instead', () => {
    const counts = countClasses(withPartialCut())
    const lines = partialCutLines({ partialCuts: cuts }, counts)
    expect(lines).toEqual([
      'Partial cut, not cleared ground (handbook 3.4.4): 80 px of the landform, left out of Proposed Blocks',
      'Table 6 clearcut equivalent, added to X in step 4, not to this figure: FP1, FP2 0.8% each (10% removed, 27.5 m left)',
    ])
    const printed = texts(analysisSheet({ ...input('analysis-sheet-orange', withPartialCut()), partialCuts: cuts }).ops)
    expect(printed.join(' ')).toContain('left out of Proposed')
    expect(printed.join(' ')).toContain('Table 6 clearcut equivalent')
    expect(
      partialCutLines(
        {
          partialCuts: [
            { ...cuts[0], equivalentPercent: null, volumeRemovedPercent: null, residualHeightMeters: null },
            { ...cuts[1], visible: false },
          ],
        },
        null,
      ),
    ).toEqual([
      'Partial cut, not cleared ground (handbook 3.4.4): none in the landform in this image',
      'Table 6 clearcut equivalent, added to X in step 4, not to this figure: FP1 volume removed and residual height not entered; FP2 0.8%, not seen by the run: adds 0 (10% removed, 27.5 m left)',
    ])
  })

  it('leaves a scene with no partial cut exactly as before', () => {
    // The decode palette is the nine colours it always was.
    expect(classPaletteEntries()).toEqual([
      { code: 1, rgb: [96, 96, 96] },
      { code: 2, rgb: [0, 160, 0] },
      { code: 3, rgb: [150, 70, 210] },
      { code: 4, rgb: [255, 0, 0] },
      { code: 5, rgb: [255, 230, 0] },
      { code: 6, rgb: [130, 0, 40] },
      { code: 7, rgb: [0, 0, 255] },
      { code: 8, rgb: [0, 210, 210] },
      { code: 9, rgb: [255, 140, 255] },
    ])
    expect(countClasses(raster())).not.toHaveProperty('partialCut')
    expect(partialCutLines({}, countClasses(raster()))).toEqual([])
    const plain = analysisSheet(input('analysis-sheet-orange'))
    const empty = analysisSheet({ ...input('analysis-sheet-orange'), partialCuts: [] })
    expect(JSON.stringify(empty.ops)).toBe(JSON.stringify(plain.ops))
  })

  it('keeps its colours far from every other class and from every blend of two of them', () => {
    const others = [
      ...Object.entries(CLASS_PALETTE)
        .filter(([name]) => !name.startsWith('partial'))
        .map(([, rgb]) => rgb),
      [255, 255, 255],
      [255, 128, 0],
      [0, 0, 0],
    ]
    const d = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
    for (const colour of [CLASS_PALETTE.partialIn, CLASS_PALETTE.partialOut])
      for (let i = 0; i < others.length; i++)
        for (let j = i; j < others.length; j++)
          for (let t = 0; t <= 1; t += 0.05) {
            const blend = others[i].map((v, k) => v + (others[j][k] - v) * t)
            expect(d(colour, blend)).toBeGreaterThan(60)
          }
    expect(d(CLASS_PALETTE.partialIn, CLASS_PALETTE.partialOut)).toBeGreaterThan(60)
  })
})

describe('a calculation per landform (23 A6: Landform 1 (Full), 1a and 1b from one viewpoint)', () => {
  const counts = (landform: number, nonVeg: number, proposed: number): FigureCounts => ({
    landform,
    privateLand: 0,
    nonVeg,
    proposed,
    rock: 0,
    grossPercent: (100 * (nonVeg + proposed)) / landform,
    netOfPrivatePercent: (100 * (nonVeg + proposed)) / landform,
    netOfRockPercent: (100 * (nonVeg + proposed)) / landform,
  })
  const others = [
    { name: 'Landform 1b (traced)', counts: counts(1000, 31, 0) },
    { name: 'Landform 1c (traced)', counts: counts(400, 0, 0) },
    { name: 'Landform 1 (traced)', counts: counts(1000, 12, 7) },
  ]
  const subLandform = (landforms = others): FigureInput => ({
    ...input('analysis-sheet-purple'),
    titles: { area: 'Landform 1a (traced)', viewpoint: 'Viewpoint 5', n: '1a' },
    landforms,
  })

  it('puts a column for each landform with alteration in order, the whole landform as Full, and names the rest', () => {
    const own = countClasses(raster())
    const { columns, unaltered } = calcColumns(subLandform(), own)
    expect(columns.map((column) => [column.n, column.primary])).toEqual([
      ['1 (Full)', false],
      ['1a', true],
      ['1b', false],
    ])
    expect(columns[1].counts).toBe(own)
    expect(unaltered).toEqual(['Landform 1c'])
    expect(landformNumber('Sub-landform 5b')).toBe('5b')
    expect(landformNumber('VSU 1284')).toBe('VSU 1284')
    expect(landformNumber('Landform 12a (consultant, traced)')).toBe('12a')
  })

  it('prints each column from its own counts through the style’s rule', () => {
    const printed = texts(analysisSheet(subLandform()).ops)
    expect(printed.filter((text) => text === 'Percent Alteration Calculation')).toHaveLength(3)
    const all = printed.join(' ')
    // Landform 1: (12 + 7) / 1000; 1a: the class pass's own (30 + 100) / 1800; 1b: 31 / 1000.
    expect(all).toContain('1.90%')
    expect(all).toContain('7.22%')
    expect(all).toContain('3.10%')
    expect(all).toContain('Landform 1 (Full)')
    expect(all).toContain('Also seen, no alteration in it: Landform 1c')
    expect(all).toContain('Sightline measure (PGMaps run, the assessment figure, Landform 1a)')
  })

  it('keeps one calculation when no other landform shows alteration, and the sheet unchanged with none', () => {
    const quiet = texts(analysisSheet(subLandform([others[1]])).ops)
    expect(quiet.join(' ')).toContain('Area of Landform 1a = 1800')
    expect(quiet.filter((text) => text === 'Percent Alteration Calculation')).toHaveLength(1)
    expect(quiet.join(' ')).toContain('Also seen, no alteration in it: Landform 1c')
    const plain = analysisSheet(input('analysis-sheet-orange'))
    const empty = analysisSheet({ ...input('analysis-sheet-orange'), landforms: [] })
    expect(JSON.stringify(empty.ops)).toBe(JSON.stringify(plain.ops))
  })
  describe('outlines of the other landforms, each from its own class pass', () => {
    /** The other pass: the same view split at a sub-landform, the landform's right half (x 50-80). */
    const subPass = (): ClassRaster => {
      const own = raster()
      const codes = own.codes.map((code, k) => {
        const x = k % W
        if (!inLandform(code) || x >= 50) return code
        return code === FIGURE_CLASS.proposedIn ? FIGURE_CLASS.proposedOut : FIGURE_CLASS.terrain
      })
      return { ...own, codes }
    }
    const traced = traceLandform(subPass())
    const withOutline = (presetId: string, labelAt = traced.labelAt): FigureInput => ({
      ...input(presetId),
      titles: { area: 'Landform 1 (traced)', viewpoint: 'Viewpoint 5', n: '1' },
      landforms: [{ name: 'Landform 1b (traced)', counts: countClasses(subPass()), outline: traced.outline, labelAt }],
    })
    const strokes = (ops: DrawOp[], color: string) =>
      ops.filter((op) => op.op === 'path' && op.stroke?.color === color).map((op) => (op.op === 'path' ? op : null)!)

    it('keeps the trace, not the pass: the visible outline, and a name place deep inside it', () => {
      expect(traced.outline).toHaveLength(1)
      // The landform's right half, 30 × 30 px, as rings round pixel centres.
      expect(ringArea(traced.outline[0])).toBeGreaterThan(800)
      expect(ringArea(traced.outline[0])).toBeLessThan(900)
      const [x, y] = traced.labelAt!
      expect(x).toBeGreaterThan(55)
      expect(x).toBeLessThan(75)
      expect(y).toBeGreaterThan(30)
      expect(y).toBeLessThan(50)
      // Searched in the rows the sheet keeps; none visible gives none.
      expect(traceLandform(subPass(), { y: 26, height: 4 }).labelAt![1]).toBeLessThan(30)
      expect(traceLandform({ ...raster(), codes: raster().codes.map(() => FIGURE_CLASS.terrain) })).toEqual({
        outline: [],
        labelAt: null,
      })
    })

    it('draws each in the style’s other-landform symbol, dashed in 23’s style, under the landform’s line', () => {
      const sheet = analysisSheet(withOutline('analysis-sheet-purple'))
      expect(sheet.drawn).toContain('otherLandform')
      const purple = strokes(sheet.ops, '#c500ff')
      const dashed = purple.filter((op) => op.stroke?.dash?.length)
      const solid = purple.filter((op) => !op.stroke?.dash?.length)
      expect(dashed.length).toBeGreaterThan(0)
      expect(solid.length).toBeGreaterThan(0)
      expect(sheet.ops.indexOf(dashed[0])).toBeLessThan(sheet.ops.indexOf(solid[0]))
      // Named on its ground in the landform label style; no legend row (23 lists only the landform).
      const printed = texts(sheet.ops)
      expect(printed).toContain('Landform 1b')
      expect(printed).not.toContain('Sub-landform')
      const name = sheet.ops.find((op) => op.op === 'text' && op.text === 'Landform 1b')
      expect(name).toMatchObject({ color: '#8400a8', halo: { color: '#ffffff' } })
      // 22's style outlines every landform alike, solid.
      const orange = analysisSheet(withOutline('analysis-sheet-orange'))
      expect(strokes(orange.ops, '#e69800').every((op) => !op.stroke?.dash?.length)).toBe(true)
      expect(strokes(orange.ops, '#e69800').length).toBeGreaterThan(
        strokes(analysisSheet(input('analysis-sheet-orange')).ops, '#e69800').length,
      )
    })

    it('prints no name it cannot place or that repeats the landform’s own, and draws nothing without a trace', () => {
      // A name with no place, or at the landform's own number, is left out; the outline still draws.
      const unnamed = analysisSheet(withOutline('analysis-sheet-purple', null))
      expect(texts(unnamed.ops)).not.toContain('Landform 1b')
      expect(unnamed.drawn).toContain('otherLandform')
      const same = analysisSheet({
        ...withOutline('analysis-sheet-purple'),
        landforms: [{ name: 'Landform 1 (whole)', counts: countClasses(subPass()), ...traced }],
      })
      expect(texts(same.ops).filter((text) => text === 'Landform 1')).toHaveLength(1)
      // The whole landform beside its sub-landforms is outlined, not named (23 A6 names 1a, 1b and 1c only).
      const whole = analysisSheet({
        ...withOutline('analysis-sheet-purple'),
        titles: { area: 'Landform 1a (traced)', viewpoint: 'Viewpoint 5', n: '1a' },
        landforms: [{ name: 'Landform 1 (traced)', counts: countClasses(subPass()), ...traced }],
      })
      expect(texts(whole.ops)).not.toContain('Landform 1')
      expect(whole.drawn).toContain('otherLandform')
      // Views saved before the trace, and styles with no such symbol, draw exactly as before.
      const before = withOutline('analysis-sheet-purple')
      const untraced = { ...before, landforms: before.landforms!.map(({ name, counts }) => ({ name, counts })) }
      expect(analysisSheet(untraced).drawn).not.toContain('otherLandform')
      const photo = input('analysed-photo-rock-outline')
      expect(JSON.stringify(composeFigure({ ...photo, landforms: withOutline(photo.preset.id).landforms }).ops)).toBe(
        JSON.stringify(composeFigure({ ...photo, landforms: untraced.landforms }).ops),
      )
    })
  })
})
