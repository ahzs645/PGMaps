/**
 * The one-page field brief a pre-layout VIA goes to the layout crew as.
 *
 * Practitioners run the VIA before block layout and hand it to the crew, who
 * then place strategic wildlife tree patches and leave trees where the block
 * is seen, run the boundary along natural features, confirm the neighbouring
 * openings have greened up, and check that each viewpoint is real and
 * reachable — which saves a second trip. The brief carries what they need for
 * that: the block, its landform and objective, the viewpoints with where to
 * stand and which way to face, up to three of the saved views' screenshots,
 * the measured figure (or "not yet run"), what to look for, and the checklist
 * with tick boxes. Answers recorded back in the app (`fieldChecklist.ts`) are
 * printed in the boxes.
 *
 * No DOM: `buildFieldBrief` assembles the content from the scene, the run and
 * the review, and `fieldBriefPdf` draws it with the jsPDF module passed in, so
 * the tests write a real file in Node. Text goes through `pdfText`, because
 * jsPDF's standard fonts are WinAnsi.
 */
import { pdfText as foldText } from '@/lib/mapSheet/renderPdf'

import type { NoteImage } from './blockNote'
import { roadPath, roadPlacement } from './driveMath'
import {
  FIELD_CHECK_LABELS,
  layoutStageLabel,
  layoutStageOf,
  localIsoDate,
  stampText,
  type FieldCheckEntry,
  type FieldChecklist,
  type LayoutStage,
} from './fieldChecklist'
import { formatHa, formatKm, formatPct } from './measureFormat'
import type { SavedDriveView } from './previewState'
import type { AnalysisResult, TargetPolygon, Viewpoint } from './types'
import { table2Range, type ViaAssessment, type ViaReview } from './via'
import {
  bearingDegrees,
  haversineMeters,
  lineLengthMeters,
  polygonAreaMeters,
  polygonInteriorPoint,
} from './visibility'
import { visualQualityClass } from './vqo'

/** `pdfText`, with the double spaces its dash folding leaves ("A — west" → "A - west") closed up. */
const pdfText = (value: string) => foldText(value).replace(/ {2,}/g, ' ')

/** What one brief holds, so it stays on one page. */
export const FIELD_BRIEF_LIMITS = { viewpoints: 6, images: 3, openings: 8 } as const

export type BriefViewpoint = {
  /** The checklist's key: `station:<viewpoint id>` for the road, `view:<saved view id>` for a saved view. */
  key: string
  name: string
  /** "Assessment station · 1.25 km along Hwy 16", "Saved view", … */
  where: string
  location: { lng: number; lat: number } | null
  /** Compass bearing to face, when known. */
  facing: number | null
}

export type BriefOpening = {
  id: string
  name: string
  harvestYear: number | null
  /** Centre to centre, from the block. */
  distanceMeters: number | null
}

export type FieldBrief = {
  blockName: string
  stage: LayoutStage
  header: Array<{ label: string; value: string }>
  viewpoints: Array<BriefViewpoint & { check: FieldCheckEntry | null }>
  /** Saved views past the brief's limit, by count. */
  moreViewpoints: number
  images: NoteImage[]
  prompts: string[]
  openings: Array<BriefOpening & { check: FieldCheckEntry | null }>
  moreOpenings: number
  boundary: { note: string; stamp: string }
  checkedBy: string
  /** The latest date any answer was recorded, `YYYY-MM-DD`; empty before any. */
  checkedOn: string
  notes: string[]
  generatedAt: Date
}

export type BriefSavedView = Pick<SavedDriveView, 'id' | 'name' | 'positionMeters' | 'lookAtTargetId'> & {
  lookBearing?: number | null
  /** Saved on the road the scene has now; views saved where the reviewer stood elsewhere have no position here. */
  onThisRoad: boolean
}

const round1 = (value: number) => Math.round(value * 10) / 10

/** "53.91234, -122.10456": decimal degrees to five places, about a metre. */
export function formatLatLng(point: { lng: number; lat: number }): string {
  return `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
/** "245° (SW)" */
export function formatBearing(bearing: number): string {
  const degrees = ((Math.round(bearing) % 360) + 360) % 360
  return `${degrees}° (${COMPASS[Math.round(degrees / 45) % 8]})`
}

/**
 * The viewpoints the crew is asked to find: the road's assessment station (or
 * the viewpoint itself before a run), then each saved view on this road in the
 * order saved, then views saved elsewhere. The keys are what the checklist
 * stores answers under.
 */
export function briefViewpoints(input: {
  viewpoint: Viewpoint
  block: TargetPolygon | null
  targets: ReadonlyArray<TargetPolygon>
  /** A current run; null when there is none or it is stale. */
  result: AnalysisResult | null
  savedViews: ReadonlyArray<BriefSavedView>
}): BriefViewpoint[] {
  const { viewpoint, block, result } = input
  const coordinates = viewpoint.coordinates
  const roadName = viewpoint.name || 'the road'
  const centreOf = (target: TargetPolygon | null | undefined) => (target ? polygonInteriorPoint(target.geometry) : null)
  const blockCentre = centreOf(block)
  const faceBlock = (from: { lng: number; lat: number } | null) =>
    from && blockCentre ? bearingDegrees(from, blockCentre) : null
  const out: BriefViewpoint[] = []
  if (coordinates.length) {
    const station = result?.stations[result.assessmentStationIndex] ?? null
    const corridor = viewpoint.mode === 'corridor' && coordinates.length > 1
    const location = station
      ? { lng: station.lng, lat: station.lat }
      : { lng: coordinates[0][0], lat: coordinates[0][1] }
    out.push({
      key: `station:${viewpoint.id}`,
      name: roadName,
      where: station
        ? corridor
          ? `Assessment station · ${formatKm(station.distanceAlongMeters)} along the road`
          : 'Assessment station'
        : corridor
          ? `Start of ${formatKm(lineLengthMeters(coordinates))} of road (not run yet)`
          : 'Spot viewpoint',
      location,
      facing: faceBlock(location),
    })
  }
  const path = coordinates.length > 1 ? roadPath(coordinates) : null
  const ordered = [...input.savedViews.filter((v) => v.onThisRoad), ...input.savedViews.filter((v) => !v.onThisRoad)]
  for (const view of ordered) {
    const placed = view.onThisRoad && path ? roadPlacement(path, view.positionMeters) : null
    const location = placed ? { lng: placed.lng, lat: placed.lat } : null
    const target = view.lookAtTargetId ? input.targets.find((t) => t.id === view.lookAtTargetId) : null
    const targetCentre = centreOf(target)
    out.push({
      key: `view:${view.id}`,
      name: view.name,
      where: placed
        ? `Saved view · ${formatKm(view.positionMeters)} along ${roadName}`
        : 'Saved view at another viewpoint',
      location,
      facing:
        typeof view.lookBearing === 'number'
          ? view.lookBearing
          : location && targetCentre
            ? bearingDegrees(location, targetCentre)
            : faceBlock(location),
    })
  }
  return out
}

/** Existing openings nearest the block first, for the green-up check. */
export function briefOpenings(block: TargetPolygon | null, targets: ReadonlyArray<TargetPolygon>): BriefOpening[] {
  const centre = block ? polygonInteriorPoint(block.geometry) : null
  return targets
    .filter((target) => target.role === 'harvested')
    .map((target) => {
      const own = polygonInteriorPoint(target.geometry)
      return {
        id: target.id,
        name: target.name,
        harvestYear: target.harvestYear,
        distanceMeters: centre && own ? haversineMeters(centre, own) : null,
      }
    })
    .sort((a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity))
}

/** What the crew looks for on the ground, worded for this block's objective. */
export function briefPrompts(input: {
  objectiveCode: string | null
  /** The visible proposal sits under 1 km from the assessment station. */
  foreground: boolean
  /** Share of the block's ground in view from the road, when run. */
  blockVisiblePercent: number | null
}): string[] {
  const strict = input.objectiveCode === 'P' || input.objectiveCode === 'R' || input.objectiveCode === 'PR'
  const prompts = [
    'Strategic wildlife tree patches: place them where they break up the opening as seen from the viewpoints, on the face and edges turned to the road, not on the back slope where no one sees them.',
    'Leave trees: keep dispersed leave trees in the part of the block most in view, to soften the opening and its edges.',
    'Natural boundary shapes: follow landform lines (draws, benches, rock, timber-type and age changes); avoid straight lines and boundaries square to the slope.',
    'Skyline notches: keep timber on the ridge line where the block reaches it; do not cut a notch into the skyline seen from a viewpoint.',
    'Edge feathering: feather the boundary into the standing timber (irregular edge, thinning density) where it is in view.',
  ]
  if (strict)
    prompts.push(
      `The ${input.objectiveCode} objective allows little visible alteration: every metre of boundary in view matters.`,
    )
  if (input.foreground)
    prompts.push(
      'Foreground view: the proposal is under 1 km from the assessment station, where the handbook criteria are not calibrated. Note what is seen close up.',
    )
  if (input.blockVisiblePercent !== null)
    prompts.push(
      `The run sees ${formatPct(input.blockVisiblePercent, 0)} of the block's ground from the road (terrain and drawn timber, not roadside brush); check how much is really open to view.`,
    )
  return prompts
}

/** The measured figure as the brief states it, or why there is none. */
export function measuredText(input: { assessment: ViaAssessment | null; hasResult: boolean; stale: boolean }): string {
  const { assessment } = input
  if (input.stale) return 'Not current: the scene changed since the run'
  if (!input.hasResult) return 'Not yet run'
  if (!assessment) return 'No landform: percent alteration not measured'
  if (assessment.initialPercent === null)
    return assessment.numericalProvisional ? 'Withheld: the run is provisional' : 'Not measured'
  const reads = assessment.initialClass ? `, reads ${assessment.initialClass.code}` : ''
  const adjusted = assessment.adjusted ? ` · adjusted ${formatPct(assessment.adjusted.percent)}` : ''
  return `X = ${formatPct(assessment.initialPercent)} in perspective view${reads}${adjusted}`
}

export function buildFieldBrief(input: {
  block: TargetPolygon
  targets: ReadonlyArray<TargetPolygon>
  viewpoint: Viewpoint
  landform: TargetPolygon | null
  /** A current run; null when there is none or it is stale. */
  result: AnalysisResult | null
  stale: boolean
  assessment: ViaAssessment | null
  review: ViaReview | null | undefined
  savedViews: ReadonlyArray<BriefSavedView>
  /** Screenshots taken at *Save viewpoint*, by saved view id. */
  images: Readonly<Record<string, NoteImage>>
  notes?: string[]
  generatedAt: Date
}): FieldBrief {
  const { block, landform, result, assessment } = input
  const stage = layoutStageOf(input.review)
  const checklist: FieldChecklist | undefined = input.review?.fieldChecklist
  const objectiveId = landform?.objectiveId ?? block.objectiveId
  const objective = visualQualityClass(objectiveId)
  const range = table2Range(objectiveId)
  const planning = block.planning
  const blockTarget = result?.targets.find((target) => target.targetId === block.id) ?? null
  const header = [
    { label: 'Block', value: planning?.blockId ?? block.name },
    ...(planning?.licenceId ? [{ label: 'Licence', value: planning.licenceId }] : []),
    ...(planning?.permitId ? [{ label: 'Cutting permit', value: planning.permitId }] : []),
    { label: 'Area', value: formatHa(polygonAreaMeters(block.geometry)) },
    {
      label: 'VIA stage',
      value:
        stage === 'pre-layout'
          ? 'Pre-layout: proposed boundary, before field layout'
          : 'Post-layout: boundary as laid out in the field',
    },
    {
      label: 'Landform',
      value: landform ? `${landform.name} · ${formatHa(polygonAreaMeters(landform.geometry), 0)}` : 'None adopted',
    },
    {
      label: 'Objective',
      value: `${objective.label} (${objective.code}) · Table 2 range ${range.label}${landform ? '' : ' (the block’s own)'}`,
    },
    { label: 'Measured', value: measuredText({ assessment, hasResult: !!result, stale: input.stale }) },
    ...(assessment?.rating ? [{ label: 'VIA rating', value: assessment.rating.label }] : []),
  ]

  const allViewpoints = briefViewpoints({
    viewpoint: input.viewpoint,
    block,
    targets: input.targets,
    result,
    savedViews: input.savedViews,
  })
  const viewpoints = allViewpoints.slice(0, FIELD_BRIEF_LIMITS.viewpoints)
  // The screenshots, in the order the viewpoints are listed: the crew matches each to its row.
  const images = viewpoints
    .flatMap((point, index) => {
      const image = point.key.startsWith('view:') ? input.images[point.key.slice(5)] : undefined
      return image ? [{ ...image, caption: `${index + 1}. ${image.caption || point.name}` }] : []
    })
    .slice(0, FIELD_BRIEF_LIMITS.images)
  const allOpenings = briefOpenings(block, input.targets)
  const openings = allOpenings.slice(0, FIELD_BRIEF_LIMITS.openings)
  return {
    blockName: block.name,
    stage,
    header,
    viewpoints: viewpoints.map((point) => ({ ...point, check: checklist?.viewpoints[point.key] ?? null })),
    moreViewpoints: allViewpoints.length - viewpoints.length,
    images,
    prompts: briefPrompts({
      objectiveCode: objective.code,
      foreground: !!assessment?.foreground,
      blockVisiblePercent: blockTarget ? round1(blockTarget.visiblePercent) : null,
    }),
    openings: openings.map((opening) => ({ ...opening, check: checklist?.greenUp[opening.id] ?? null })),
    moreOpenings: allOpenings.length - openings.length,
    boundary: { note: checklist?.boundary.note.trim() ?? '', stamp: stampText(checklist?.boundary) },
    checkedBy: checklist?.checkedBy.trim() ?? '',
    checkedOn: checklist
      ? ([...Object.values(checklist.viewpoints), ...Object.values(checklist.greenUp), checklist.boundary]
          .map((entry) => entry.on)
          .filter(Boolean)
          .sort()
          .at(-1) ?? '')
      : '',
    notes: input.notes ?? [],
    generatedAt: input.generatedAt,
  }
}

/** "CHU_26_1-field-brief-2026-11-11.pdf" */
export function fieldBriefFileName(brief: FieldBrief): string {
  const safe = brief.blockName.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'block'
  return `${safe}-field-brief-${localIsoDate(brief.generatedAt)}.pdf`
}

/** Every string the PDF prints, for a test that nothing folds to "?". */
export function fieldBriefStrings(brief: FieldBrief): string[] {
  return [
    brief.blockName,
    ...brief.header.flatMap((row) => [row.label, row.value]),
    ...brief.viewpoints.flatMap((point) => [point.name, point.where, point.check?.note ?? '']),
    ...brief.images.map((image) => image.caption),
    ...brief.prompts,
    ...brief.openings.flatMap((opening) => [opening.name, opening.check?.note ?? '']),
    brief.boundary.note,
    brief.checkedBy,
    ...brief.notes,
    ...STATIC_TEXT,
  ]
}

// ---------------------------------------------------------------------------
// PDF

type PdfModule = typeof import('jspdf')
type Pdf = InstanceType<PdfModule['jsPDF']>

/** Letter portrait, millimetres. */
const PAGE = { width: 215.9, height: 279.4, margin: 12 }
const INK: [number, number, number] = [17, 24, 39]
const MUTED: [number, number, number] = [107, 114, 128]

const STATIC_TEXT = [
  'Field brief',
  'Viewpoints to ground-truth',
  'Real and reachable?',
  'What to look for',
  'Crew checklist',
  'Green-up of adjacent openings',
  'Where the boundary can follow natural features',
  'Checked by',
  'Date',
]

/** A tick box, ticked when `ticked`. Returns the x after it and its label. */
function tickBox(pdf: Pdf, x: number, y: number, label: string, ticked: boolean): number {
  const size = 3.2
  pdf.setDrawColor(55, 65, 81)
  pdf.setLineWidth(0.25)
  pdf.rect(x, y - size + 0.4, size, size)
  if (ticked) {
    pdf.setLineWidth(0.45)
    pdf.line(x + 0.6, y - size / 2 + 0.3, x + size / 2 - 0.2, y - 0.2)
    pdf.line(x + size / 2 - 0.2, y - 0.2, x + size - 0.4, y - size + 0.9)
  }
  pdf.setFont('helvetica', ticked ? 'bold' : 'normal')
  pdf.text(pdfText(label), x + size + 1.2, y)
  return x + size + 1.2 + pdf.getTextWidth(pdfText(label)) + 3
}

export function fieldBriefPdf(brief: FieldBrief, { jsPDF }: PdfModule): ArrayBuffer {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })
  const { width, height, margin } = PAGE
  const inner = width - 2 * margin
  const bottom = height - margin - 8
  let y = margin

  const setText = (size: number, style: 'normal' | 'bold' | 'italic' = 'normal', color = INK) => {
    pdf.setFont('helvetica', style)
    pdf.setFontSize(size)
    pdf.setTextColor(...color)
  }
  const footer = () => {
    setText(6.5, 'normal', MUTED)
    const lines = pdf.splitTextToSize(
      pdfText(
        [
          ...brief.notes,
          `Generated ${localIsoDate(brief.generatedAt)} by PGMaps visual quality. Record answers in step 2 of the visual quality page.`,
        ].join('  -  '),
      ),
      inner,
    )
    pdf.text(lines, margin, height - margin + 2 - (lines.length - 1) * 2.6)
    setText(9)
  }
  /** Room for `needed` mm, or a new page. */
  const ensure = (needed: number) => {
    if (y + needed <= bottom) return
    pdf.addPage()
    footer()
    y = margin
  }
  const heading = (label: string) => {
    ensure(10)
    y += 2
    setText(10.5, 'bold')
    pdf.text(pdfText(label), margin, y + 3.5)
    pdf.setDrawColor(209, 213, 219)
    pdf.setLineWidth(0.2)
    pdf.line(margin, y + 5, width - margin, y + 5)
    y += 8
  }

  footer()
  // Title
  setText(15, 'bold')
  pdf.text(pdfText(`${brief.blockName} · Field brief`), margin, y + 5)
  setText(9, 'normal', MUTED)
  pdf.text(
    pdfText(`${layoutStageLabel(brief.stage)} VIA · for the layout crew · ${localIsoDate(brief.generatedAt)}`),
    margin,
    y + 10,
  )
  y += 15

  // Header: label / value rows in two columns.
  const columnWidth = (inner - 6) / 2
  const labelWidth = 24
  const rows = brief.header
  const half = Math.ceil(rows.length / 2)
  let columnBottom = y
  for (const [column, part] of [rows.slice(0, half), rows.slice(half)].entries()) {
    let rowY = y
    const x = margin + column * (columnWidth + 6)
    for (const row of part) {
      setText(8, 'bold')
      pdf.text(pdfText(row.label), x, rowY + 3)
      setText(8)
      const value = pdf.splitTextToSize(pdfText(row.value), columnWidth - labelWidth)
      pdf.text(value, x + labelWidth, rowY + 3)
      rowY += Math.max(1, value.length) * 3.5 + 1
    }
    columnBottom = Math.max(columnBottom, rowY)
  }
  y = columnBottom + 1

  // (a) Viewpoints, each with its tick boxes.
  heading('Viewpoints to ground-truth')
  const labels = FIELD_CHECK_LABELS.viewpoints
  setText(7, 'bold', MUTED)
  pdf.text('#', margin, y + 2)
  pdf.text('Viewpoint', margin + 5, y + 2)
  pdf.text('Stand at (lat, long) · face', margin + 72, y + 2)
  pdf.text(pdfText('Real and reachable?'), margin + 132, y + 2)
  y += 4
  brief.viewpoints.forEach((point, index) => {
    const nameLines = pdf.splitTextToSize(pdfText(point.name), 64)
    const whereLines = pdf.splitTextToSize(pdfText(point.where), 64)
    const note = point.check?.note.trim()
    const stamp = stampText(point.check)
    const noteLines =
      note || stamp
        ? pdf.splitTextToSize(pdfText([note, stamp && `(${stamp})`].filter(Boolean).join(' ')), inner - 5)
        : []
    const rowHeight = (nameLines.length + whereLines.length) * 3.3 + noteLines.length * 3.2 + 2.5
    ensure(rowHeight)
    setText(8.5, 'bold')
    pdf.text(String(index + 1), margin, y + 3)
    pdf.text(nameLines, margin + 5, y + 3)
    setText(7.5, 'normal', MUTED)
    pdf.text(whereLines, margin + 5, y + 3 + nameLines.length * 3.3)
    setText(8.5)
    pdf.text(
      pdfText(
        point.location
          ? `${formatLatLng(point.location)}${point.facing !== null ? ` · face ${formatBearing(point.facing)}` : ''}`
          : 'Location: see the saved view',
      ),
      margin + 72,
      y + 3,
    )
    setText(8)
    const next = tickBox(pdf, margin + 132, y + 3, labels.yes, point.check?.answer === 'yes')
    tickBox(pdf, next, y + 3, labels.no, point.check?.answer === 'no')
    if (noteLines.length) {
      setText(7.5, 'italic')
      pdf.text(noteLines, margin + 5, y + 3 + (nameLines.length + whereLines.length) * 3.3)
    }
    y += rowHeight
    pdf.setDrawColor(229, 231, 235)
    pdf.setLineWidth(0.15)
    pdf.line(margin, y - 0.8, width - margin, y - 0.8)
  })
  if (!brief.viewpoints.length) {
    setText(8.5, 'italic', MUTED)
    pdf.text('No viewpoint yet: draw or import the road in step 1.', margin, y + 3)
    y += 5
  }
  if (brief.moreViewpoints > 0) {
    setText(7.5, 'italic', MUTED)
    pdf.text(
      `${brief.moreViewpoints} more saved view${brief.moreViewpoints === 1 ? '' : 's'} not listed.`,
      margin,
      y + 3,
    )
    y += 5
  }

  // The saved views' screenshots, side by side, numbered as their rows.
  if (brief.images.length) {
    const gap = 4
    const slot = (inner - gap * (FIELD_BRIEF_LIMITS.images - 1)) / FIELD_BRIEF_LIMITS.images
    const maxHeight = 42
    const sizes = brief.images.map((image) => {
      const scale = Math.min(slot / image.width, maxHeight / image.height)
      return { width: image.width * scale, height: image.height * scale }
    })
    const tallest = Math.max(...sizes.map((size) => size.height))
    ensure(tallest + 12)
    y += 2
    let captionBottom = y + tallest
    brief.images.forEach((image, index) => {
      const x = margin + index * (slot + gap)
      pdf.addImage(image.dataUrl, 'JPEG', x, y, sizes[index].width, sizes[index].height)
      setText(7, 'italic', MUTED)
      const caption = pdf.splitTextToSize(pdfText(image.caption), slot).slice(0, 2)
      pdf.text(caption, x, y + sizes[index].height + 3.2)
      captionBottom = Math.max(captionBottom, y + sizes[index].height + 3.2 + caption.length * 2.8)
    })
    y = captionBottom + 1
  }

  // What to look for.
  heading('What to look for')
  setText(8.5)
  for (const prompt of brief.prompts) {
    const lines = pdf.splitTextToSize(pdfText(prompt), inner - 5)
    ensure(lines.length * 3.6 + 1)
    pdf.text('-', margin + 1, y + 3)
    pdf.text(lines, margin + 5, y + 3)
    y += lines.length * 3.6 + 1
  }

  // (b) and (c), with who and when.
  heading('Crew checklist')
  setText(9, 'bold')
  ensure(6)
  pdf.text(pdfText('Green-up of adjacent openings'), margin, y + 3)
  y += 5
  const greenUp = FIELD_CHECK_LABELS.greenUp
  if (!brief.openings.length) {
    setText(8, 'italic', MUTED)
    pdf.text('No existing openings in the scene: look up the BC inventory in step 1 to list them.', margin, y + 3)
    y += 5
  }
  for (const opening of brief.openings) {
    const note = opening.check?.note.trim()
    const stamp = stampText(opening.check)
    const noteLines =
      note || stamp
        ? pdf.splitTextToSize(pdfText([note, stamp && `(${stamp})`].filter(Boolean).join(' ')), inner - 5)
        : []
    ensure(5 + noteLines.length * 3.2)
    setText(8.5)
    const detail = [
      opening.harvestYear ? `harvested ${opening.harvestYear}` : null,
      opening.distanceMeters !== null ? `${formatKm(opening.distanceMeters, 1)} from the block` : null,
    ]
      .filter(Boolean)
      .join(' · ')
    pdf.text(pdf.splitTextToSize(pdfText(opening.name), 70)[0], margin + 5, y + 3)
    setText(7.5, 'normal', MUTED)
    pdf.text(pdfText(detail), margin + 77, y + 3)
    setText(8)
    const next = tickBox(pdf, margin + 132, y + 3, greenUp.yes, opening.check?.answer === 'yes')
    tickBox(pdf, next, y + 3, 'Not yet', opening.check?.answer === 'no')
    y += 4.5
    if (noteLines.length) {
      setText(7.5, 'italic')
      pdf.text(noteLines, margin + 5, y + 2)
      y += noteLines.length * 3.2
    }
  }
  if (brief.moreOpenings > 0) {
    setText(7.5, 'italic', MUTED)
    pdf.text(
      `${brief.moreOpenings} more opening${brief.moreOpenings === 1 ? '' : 's'} farther away not listed.`,
      margin + 5,
      y + 3,
    )
    y += 5
  }

  y += 2
  ensure(22)
  setText(9, 'bold')
  pdf.text(pdfText('Where the boundary can follow natural features'), margin, y + 3)
  y += 5
  if (brief.boundary.note) {
    setText(8.5)
    const lines = pdf.splitTextToSize(pdfText(brief.boundary.note), inner - 5)
    for (const line of lines) {
      ensure(4)
      pdf.text(line, margin + 5, y + 3)
      y += 3.6
    }
    if (brief.boundary.stamp) {
      setText(7.5, 'italic', MUTED)
      pdf.text(pdfText(`(${brief.boundary.stamp})`), margin + 5, y + 3)
      y += 4
    }
  } else {
    // Ruled lines to write on.
    pdf.setDrawColor(156, 163, 175)
    pdf.setLineWidth(0.15)
    for (let line = 0; line < 3; line++) {
      pdf.line(margin + 5, y + 6, width - margin, y + 6)
      y += 6
    }
    y += 1
  }

  y += 3
  ensure(8)
  setText(8.5, 'bold')
  pdf.text(pdfText('Checked by'), margin, y + 3)
  pdf.text(pdfText('Date'), margin + 110, y + 3)
  setText(8.5)
  pdf.setDrawColor(156, 163, 175)
  pdf.setLineWidth(0.15)
  if (brief.checkedBy) pdf.text(pdfText(brief.checkedBy), margin + 20, y + 2.5)
  pdf.line(margin + 19, y + 3.6, margin + 100, y + 3.6)
  if (brief.checkedOn) pdf.text(brief.checkedOn, margin + 120, y + 2.5)
  pdf.line(margin + 119, y + 3.6, width - margin, y + 3.6)
  return pdf.output('arraybuffer')
}
