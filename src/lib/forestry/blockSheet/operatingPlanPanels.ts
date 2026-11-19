/** White operating-plan furniture. Uses project geometry and PGMaps symbols, never a source PDF. */
import type { DrawOp } from '@/lib/mapSheet/drawOps'
import { rectRing } from '@/lib/mapSheet/drawOps'
import { fontSize, type Rect, type ResolvedSheet } from '@/lib/mapSheet/layout'
import { frameProjection } from '@/lib/mapSheet/scale'
import { fitLabel, fitText } from '@/lib/mapSheet/textMetrics'
import { emptyFieldText } from '@/lib/mapSheet/emptyFields'
import type { ComposeInput } from './composeSheet'
import { SHEET_CHROME } from './styles'

function centred(ops: DrawOp[], sheet: ResolvedSheet, box: Rect, text: string, referencePt: number, bold = true) {
  const pad = 6 * sheet.k
  const label = fitLabel(text, fontSize(sheet, referencePt), box.w - pad * 2, box.h - pad, {
    style: bold ? 'bold' : 'normal',
  })
  const pitch = label.size * 1.2
  label.lines.forEach((line, i) =>
    ops.push({
      op: 'text',
      x: box.x + box.w / 2,
      y: box.y + box.h / 2 + (i - (label.lines.length - 1) / 2) * pitch,
      text: line,
      size: label.size,
      style: bold ? 'bold' : 'normal',
      color: SHEET_CHROME.barText,
      align: 'center',
      baseline: 'middle',
    }),
  )
}

export function operatingPlanTitle(ops: DrawOp[], sheet: ResolvedSheet, input: ComposeInput) {
  const box = sheet.title
  ops.push({
    op: 'rect',
    ...box,
    fill: SHEET_CHROME.operatingPlanFill,
    stroke: { color: SHEET_CHROME.line, width: sheet.k },
  })
  const slice = (start: number, height: number): Rect => ({ ...box, y: box.y + box.h * start, h: box.h * height })
  centred(
    ops,
    sheet,
    slice(0, 0.25),
    input.fields.forestDistrict?.trim() || emptyFieldText(input.emptyFields, 'Forest district not recorded'),
    11,
  )
  centred(ops, sheet, slice(0.25, 0.3), input.frame.preset.title, 15)
  centred(ops, sheet, slice(0.55, 0.25), input.fields.blockId?.trim() || input.layers.block?.name || 'Road access', 12)
  const permits = [
    input.fields.forestLicence?.trim() ? `F.L. ${input.fields.forestLicence.trim()}` : '',
    input.fields.cuttingPermit?.trim() ? `CP ${input.fields.cuttingPermit.trim()}` : '',
  ]
    .filter(Boolean)
    .join(' / ')
  if (permits) centred(ops, sheet, slice(0.8, 0.2), permits, 7, false)
}

/** Only the user's branding. A missing logo leaves space for the organisation's name. */
export function operatingPlanBrand(ops: DrawOp[], sheet: ResolvedSheet, box: Rect, input: ComposeInput) {
  const pad = 6 * sheet.k
  ops.push({
    op: 'rect',
    ...box,
    fill: SHEET_CHROME.operatingPlanFill,
    stroke: { color: SHEET_CHROME.line, width: sheet.k },
  })
  if (input.logo) {
    const ratio = Math.min((box.w - pad * 2) / input.logo.width, (box.h * 0.65) / input.logo.height)
    const w = input.logo.width * ratio,
      h = input.logo.height * ratio
    ops.push({ op: 'image', x: box.x + (box.w - w) / 2, y: box.y + pad, w, h, image: input.logo })
  }
  centred(
    ops,
    sheet,
    { ...box, y: box.y + (input.logo ? box.h * 0.72 : 0), h: box.h * (input.logo ? 0.26 : 0.75) },
    input.issue.organisation || 'PGMaps',
    input.logo ? 8 : 20,
  )
  if (!input.logo)
    centred(ops, sheet, { ...box, y: box.y + box.h * 0.7, h: box.h * 0.25 }, 'Forestry planning map', 7, false)
}

/** A vector overview of loaded roads and blocks, with the actual main-map extent in red. */
export function operatingPlanLocator(ops: DrawOp[], sheet: ResolvedSheet, body: Rect, input: ComposeInput) {
  const { k } = sheet
  const pad = 6 * k
  const captionHeight = fontSize(sheet, 5.5) * 2.5
  const box = { x: body.x + pad, y: body.y + pad, w: body.w - pad * 2, h: body.h - pad * 2 - captionHeight }
  const main = input.frame.projection
  // Show 3.5 times the main frame's width: the inset is a locator, not another data query.
  const overview = frameProjection(box, main.center, main.scale * (main.frame.w / box.w) * 3.5)
  const project = (line: number[][]) => line.map(([lng, lat]) => overview.project(lng, lat))
  const stroke = { color: SHEET_CHROME.locatorLine, width: 0.6 * k }
  ops.push({ op: 'clip', parts: [rectRing(box.x, box.y, box.w, box.h)] })
  for (const block of [input.layers.block, ...(input.layers.otherBlocks ?? [])]) {
    if (!block) continue
    const polygons = block.geometry.type === 'Polygon' ? [block.geometry.coordinates] : block.geometry.coordinates
    ops.push({ op: 'path', parts: polygons.flatMap((polygon) => polygon.map(project)), closed: true, stroke })
  }
  for (const road of input.layers.existingRoads ?? [])
    ops.push({ op: 'path', parts: [project(road.line)], closed: false, stroke })
  for (const road of input.layers.roads ?? [])
    ops.push({ op: 'path', parts: [project(road.line)], closed: false, stroke: { ...stroke, color: road.color } })
  const [west, south, east, north] = main.bounds
  ops.push({
    op: 'path',
    parts: [
      project([
        [west, north],
        [east, north],
        [east, south],
        [west, south],
        [west, north],
      ]),
    ],
    closed: true,
    stroke: { color: SHEET_CHROME.locatorExtent, width: k },
  })
  ops.push({ op: 'restore' })
  ops.push({ op: 'rect', ...box, stroke })
  const size = fontSize(sheet, 5.5)
  ops.push({
    op: 'text',
    x: body.x + body.w / 2,
    y: body.y + body.h - pad,
    text: fitText('Loaded roads and blocks; red box = main map', size, body.w - pad * 2),
    size,
    color: SHEET_CHROME.barText,
    align: 'center',
  })
}
