import { useMemo } from 'react'

import { CheckboxField, StyledSelect } from '@/components/ui/form-field'
import { InlineAlert } from '@/components/ui/map-panels'
import {
  analysedFigure,
  composeFigure,
  cropRasterRows,
  figureLabelStyle,
  figureSubject,
  paintsBlocks,
  presetRule,
  rgbaLuminance,
  tabloidFigure,
  type ClassRaster,
  type ComposedFigure,
  type FigureCounts,
  type FigureInput,
  type Overlay,
  type PartialCutNote,
} from '@/lib/forestry/viaFigure/composeFigure'
import { sceneSheetRule, type AlterationRule, type SceneDenominator } from '@/lib/forestry/viaFigure/alteration'
import {
  DEFAULT_FIGURE_STYLE,
  findPreset,
  VIA_STYLE_PRESETS,
  type ViaStylePreset,
} from '@/lib/forestry/viaFigure/presets'
import { TIMBER_ABSENT, timberScreenedClasses, type TimberMeasure } from '@/lib/forestry/viaFigure/timberScreen'
import type { CameraInfo } from '@/lib/forestry/viaFigure/cameraInfo'
import { LABEL_STYLES, type LabelStyleId } from '@/lib/mapSheet/callouts'
import type { DrawOp, Point, RasterImage } from '@/lib/mapSheet/drawOps'
import { encodeSheetImages } from '@/lib/mapSheet/png'
import { sheetSvg } from '@/lib/mapSheet/renderSvg'
import { svgDataUrl } from '@/lib/mapSheet/symbolSvg'

import type { NoteImage } from './blockNote'
import { illustrationLine, missingLine, type FigureIllustration } from './engineCapture'
import type { BlockCallout } from './figureCallouts'
import type { InventoryBadgeInput } from './inventoryBadge'
import { cropImageRows } from './mapCapture'
import { capturedSightline } from './runFigures'
import { table2Class } from './via'

/** A printed percent read against Table 2, for a calculation line's `{class}`, titled as the forms print it. */
const table2Reading = (percent: number) => {
  const found = table2Class(percent)
  if (found) return { code: found.code, name: found.label.replace(/\b\w/g, (c) => c.toUpperCase()) }
  // Table 2 stops at 30%: past it the line still prints, saying so, rather than dropping the total.
  return percent > 30 ? { code: '>MM', name: 'Over 30%, beyond Table 2' } : null
}

/** What a saved view's VIA figure is composed from, kept with its screenshot for the session. */
export type SavedFigure = {
  /** The class pass of the figure's camera, `frameImage`'s size (or the screenshot's, unframed). */
  classes: ClassRaster
  /**
   * The view framed for the sheet (`captureFramed`): the landform mid-frame through one or more
   * frames of the lens. Absent when the view could not be framed, and the screenshot is used.
   */
  frameImage?: NoteImage
  callouts: BlockCallout[]
  stationIndex: number
  /**
   * The run's perspective alteration at that station, percent, and its Table 2 class: kept only when the run's
   * figures were the assessment's when the view was saved (`captureSightline`). Read it through `capturedSightline`.
   */
  sightlinePercent: number | null
  sightlineClass: string | null
  /** Whether the save checked the run's readiness (`runFigures`). Absent on views saved before it. */
  sightlineReadiness?: 'ready' | 'withheld'
  /** Why the sightline figure was withheld when the view was saved: the run's first gap. */
  sightlineWithheld?: string
  lens: string
  /** Nearest visible block, km, and the view's horizontal field of view, degrees. */
  distanceKm: number | null
  hfovDeg: number
  facts: Array<{ label: string; value: string; items?: string[] }>
  /** The view's inventory unit (`inventoryBadge.ts`), with the record's update date the sheet does not print. */
  rating: (NonNullable<FigureInput['rating']> & { date?: string }) | null
  /** Which rule chose the inventory unit (`inventoryBadge.ts`). */
  ratingNote?: string
  /** What chose the unit, so a read made after the save fills it by the same rules (`withReadInventory`). */
  inventoryAt?: InventoryBadgeInput
  area: string
  viewpoint: string
  /** The road or viewpoint the view was saved on, as the scene names it ("Lakeshore"); the view's own name is `viewpoint`. */
  place?: string
  /** Blocks the station does not see: listed in the facts, never called out on the picture. */
  hidden?: BlockCallout[]
  /** The visual inventory had been read when the view was saved, so "no unit" is a finding rather than a gap. */
  inventoryRead?: boolean
  /** A landform split fell back: some class may be counted inside the landform that is not. */
  splitFailed: boolean
  /** Sub-landform dividers and lines of force (candidates), projected and cut to the landform. */
  lines?: Overlay[]
  /** The VQO zone pass of the same frames, when EVQO polygons were loaded. */
  zones?: ClassRaster
  /** The landform's rows in the frame (`landformCropRows`), also under a fixed frame: what report panoramas centre on. */
  landformRows?: { y: number; height: number }
  /**
   * The landform's rows (`landformCropRows`): applied at export by styles that crop to the
   * landform, so one saved view serves a strip and a full frame with the title in its sky.
   */
  crop?: { y: number; height: number }
  /** What the camera information block prints. */
  camera?: CameraInfo
  /**
   * The DEM cell the map drew the seen blocks' ground from and the run's, when the map's was at least
   * `TERRAIN_DETAIL_NOTE_RATIO` times coarser: the view line and the report's caption say so (`terrainDetailNote`).
   * Absent otherwise, and for another engine's picture.
   */
  terrainDetail?: { drawnCellMeters: number; runCellMeters: number }
  /**
   * Another engine drew the picture, and its class pass gave the outlines and the pixel figure (`engineCapture.ts`);
   * absent when PGMaps' own map did.
   */
  illustration?: FigureIllustration
  /**
   * The engine's screened pass (its trees drawn, each in its ground's class), `classes`' size; `classes` is then the
   * ground pass. Absent for PGMaps' own map.
   */
  screened?: ClassRaster
  /**
   * The scene's partial-cut blocks when the view was saved, by block id, with the Table 6 figure the run adds to X
   * (`partialCutEntries`). Their pixels are counted apart from Proposed (`FigureCounts.partialCut`). Absent: none.
   */
  partialCuts?: Array<PartialCutNote & { id: string }>
  /**
   * The other landforms the scene holds that the view sees (sub-landforms, or the whole landform beside the active
   * sub-landform), each counted on a class pass of the same frames split at it (`MAX_LANDFORM_PASSES`): the sheet's
   * further calculation columns and the report's further rows. `objective` is the landform's own (a VQO code),
   * `blocks` the block ids with ground in it. Absent: the scene holds one landform, the view was saved against
   * another landform than the open scene's, or another engine drew the picture. `outline` is its visible outline traced
   * from that pass (`traceLandform`) and `labelAt` where its name goes, image pixels of the uncropped frame: the sheet
   * outlines every landform it calculates (23 A6), and keeps the trace rather than the pass, a few hundred points
   * against a code per pixel. Absent on views saved before it: no outline is drawn.
   */
  landforms?: Array<{
    id: string
    name: string
    objective: string | null
    counts: FigureCounts
    blocks: string[]
    outline?: Point[][]
    labelAt?: Point | null
  }>
  /**
   * The block ids with ground in the figure's own landform (`blocksInLandform`), as `landforms` lists them for the
   * others: what the report cites each block on. Absent (views saved before it): every block is read on the landform.
   */
  landformBlocks?: string[]
}

/**
 * How an export names features, whether it prints the camera block and whether it paints the blocks' ground; the
 * style's own when absent.
 */
export type FigureOptions = {
  labelStyle?: LabelStyleId | null
  cameraInfo?: boolean | null
  paintBlocks?: boolean | null
  /** The logo for the title block (`printedLogoRaster`), or none. */
  logo?: RasterImage | null
  /** The arithmetic the calculation prints (a report's format rule), in place of the style's own `calc.rule`. */
  rule?: AlterationRule | null
  /**
   * The scene's denominators (`AnalysisSettings`): without `rule`, a figure nets out what the scene's run nets out
   * when the scene takes private land out (`sceneSheetRule`), and otherwise prints the style's own rule.
   */
  sceneDenominator?: SceneDenominator | null
  /**
   * PGMaps' with-timber measure of the view (`timberMeasureFor`); absent, the sheet says no before-harvest render was
   * taken. Ignored for an engine's figure, whose screened pass measures the same thing.
   */
  timber?: TimberMeasure | null
}

/** A callout moved into a crop's rows, or null when it falls outside them. */
function shiftCallout<T extends { anchor: [number, number] }>(
  callout: T,
  crop: { y: number; height: number },
): T | null {
  const y = callout.anchor[1] - crop.y
  return y >= 0 && y < crop.height ? { ...callout, anchor: [callout.anchor[0], y] } : null
}

export type FigureView = { id: string; name: string; image: (NoteImage & { figure?: SavedFigure }) | undefined }

/** The default style when the road view has none chosen; it lives with the presets. */
export { DEFAULT_FIGURE_STYLE }
/** PNG pixels per point: 2 is 144 pixels an inch. */
const PNG_PIXELS_PER_POINT = 2

/** Decodes a saved JPEG to straight RGBA, for styles that re-tone or paint the frame. Browser only. */
async function decodedImage(image: Pick<NoteImage, 'dataUrl' | 'width' | 'height'>): Promise<RasterImage> {
  const element = new Image()
  element.src = image.dataUrl
  await element.decode()
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('No 2D canvas to decode the view.')
  context.drawImage(element, 0, 0, image.width, image.height)
  return {
    kind: 'rgba',
    data: context.getImageData(0, 0, image.width, image.height).data,
    width: image.width,
    height: image.height,
  }
}

/**
 * A view's with-timber measure (`timberScreenedClasses`) from its before-harvest render, a render of the figure's own
 * framing (`captureFramed`) at the same size as its framed capture; absent with the reason otherwise. Browser only
 * (decodes the two JPEGs); the arithmetic is DOM-free.
 */
export async function timberMeasureFor(
  figure: SavedFigure,
  before: Pick<NoteImage, 'dataUrl' | 'width' | 'height'> | null,
): Promise<TimberMeasure> {
  const after = figure.frameImage
  if (!after) return { kind: 'absent', reason: TIMBER_ABSENT.noFrame }
  if (!before) return { kind: 'absent', reason: TIMBER_ABSENT.noBefore }
  if (before.width !== after.width || before.height !== after.height || figure.classes.width !== after.width)
    return { kind: 'absent', reason: TIMBER_ABSENT.size }
  const [b, a] = await Promise.all([decodedImage(before), decodedImage(after)])
  if (b.kind !== 'rgba' || a.kind !== 'rgba') return { kind: 'absent', reason: TIMBER_ABSENT.size }
  return timberScreenedClasses(figure.classes, b, a)
}

/** The composer's input for a saved view in `preset`. */
export async function figureInput(
  screenshot: NoteImage,
  figure: SavedFigure | undefined,
  preset: ViaStylePreset,
  options: FigureOptions = {},
): Promise<FigureInput> {
  // The framed view when the figure has one, with the screenshot's caption; cropped to the landform
  // (the same rows of the picture, the class and zone passes, the callouts and lines) unless the
  // style keeps its sky.
  let image = figure?.frameImage ? { ...figure.frameImage, caption: screenshot.caption } : screenshot
  const sightline = capturedSightline(figure)
  const crop = figure?.frameImage && figure.crop && preset.cropToLandform !== false ? figure.crop : null
  if (crop) image = { ...(await cropImageRows(image, crop)), caption: image.caption }
  const callouts = (figure?.callouts ?? []).flatMap((callout) => {
    const moved = crop ? shiftCallout(callout, crop) : callout
    return moved ? [moved] : []
  })
  const lines = (figure?.lines ?? []).flatMap((line) => {
    if (!crop) return [line]
    const parts = line.parts
      .map((part) =>
        part
          .filter(([, y]) => y >= crop.y && y < crop.y + crop.height)
          .map(([x, y]) => [x, y - crop.y] as [number, number]),
      )
      .filter((part) => part.length > 1)
    return parts.length ? [{ ...line, parts }] : []
  })
  // The arrow labels read the frame's brightness to colour their leaders: decode the frame for that
  // only, and keep drawing the JPEG itself so the sheet stays small. Painting the blocks and greyscale
  // styles draw the decoded frame (the sheet re-encodes it as JPEG: `jpegFrames`).
  const greyscale = preset.tone === 'greyscale'
  const paint = !!figure?.classes && paintsBlocks({ preset, paintBlocks: options.paintBlocks ?? undefined })
  const drawDecoded = greyscale || paint
  const decoded =
    drawDecoded || figureLabelStyle({ preset, labelStyle: options.labelStyle ?? undefined }) === 'underlined-arrow'
      ? await decodedImage(image)
      : null
  return {
    ...(options.labelStyle ? { labelStyle: options.labelStyle } : {}),
    ...(options.cameraInfo != null ? { cameraInfo: options.cameraInfo } : {}),
    ...(options.paintBlocks != null ? { paintBlocks: options.paintBlocks } : {}),
    ...(options.logo ? { logo: options.logo } : {}),
    ...(options.rule || options.sceneDenominator
      ? { rule: options.rule ?? sceneSheetRule(presetRule(preset), options.sceneDenominator) }
      : {}),
    ...(decoded?.kind === 'rgba' && !drawDecoded ? { luminance: rgbaLuminance(decoded) } : {}),
    zones: figure?.zones ? (crop ? cropRasterRows(figure.zones, crop) : figure.zones) : null,
    camera: figure?.camera ?? null,
    classify: table2Reading,
    preset,
    image:
      drawDecoded && decoded
        ? decoded
        : { kind: 'url', url: image.dataUrl, format: 'JPEG', width: image.width, height: image.height },
    classes: figure?.classes ? (crop ? cropRasterRows(figure.classes, crop) : figure.classes) : null,
    screenedClasses: figure?.screened ? (crop ? cropRasterRows(figure.screened, crop) : figure.screened) : null,
    // PGMaps' own picture: the with-timber figure, or why it was not measured; an engine's has its screened pass.
    ...(figure && !figure.illustration && !figure.screened
      ? {
          timber:
            options.timber?.kind === 'measured'
              ? { classes: crop ? cropRasterRows(options.timber.classes, crop) : options.timber.classes }
              : { absent: options.timber?.kind === 'absent' ? options.timber.reason : TIMBER_ABSENT.noBefore },
        }
      : {}),
    callouts,
    lines,
    // The assessment's figure only when the run was ready at the save; else why not (`capturedSightline`).
    sightlinePercent: sightline.percent,
    sightlineClass: sightline.percent === null ? null : (figure?.sightlineClass ?? null),
    ...(sightline.note ? { sightlineWithheld: sightline.note } : {}),
    ...(figure?.partialCuts?.length ? { partialCuts: figure.partialCuts } : {}),
    ...(figure?.landforms?.length
      ? {
          landforms: figure.landforms.map(({ name, counts, outline, labelAt }) => ({
            name,
            counts,
            // Moved into the crop's rows; the sheet clips what falls outside them, and a name off them is not printed.
            ...(outline
              ? { outline: crop ? outline.map((ring) => ring.map(([x, y]) => [x, y - crop.y] as Point)) : outline }
              : {}),
            ...(labelAt && (!crop || (labelAt[1] >= crop.y && labelAt[1] < crop.y + crop.height))
              ? { labelAt: crop ? ([labelAt[0], labelAt[1] - crop.y] as Point) : labelAt }
              : {}),
          })),
        }
      : {}),
    illustration: figure?.illustration
      ? [illustrationLine(figure.illustration), missingLine(figure.illustration)].filter(
          (line): line is string => line !== null,
        )
      : null,
    lens: figure ? `${figure.lens}${crop ? ', cropped to the landform' : ''}` : image.caption,
    distanceKm: figure?.distanceKm ?? null,
    hfovDeg: figure?.hfovDeg ?? null,
    titles: {
      area: figure?.area ?? 'Landform',
      viewpoint: figure?.viewpoint ?? image.caption.replace(/\.$/, ''),
      blocks: (figure?.callouts ?? [])
        .filter((callout) => !callout.secondary)
        .map((callout) => callout.title)
        .join(', '),
      // "Landform 8 (traced)" is landform 8 on the sheet, not landform 1.
      n: figure?.area.match(/\bLandform\s+(\d+[a-z]?)\b/i)?.[1] ?? '1',
    },
    facts: figure?.facts ?? [],
    rating: figure?.rating ?? null,
    ratingNote: figure?.ratingNote ?? null,
    generatedAt: new Date(),
  }
}

/** JPEG quality of a decoded (painted or toned) frame written back into the sheet. */
const FRAME_JPEG_QUALITY = 0.92

/**
 * The sheet's decoded frames (a painted or greyscale picture) encoded as JPEG, as the captured frame itself is, then
 * anything else raw as PNG: a painted 2000 px strip as PNG made the PDF several times larger. Browser only.
 */
async function jpegFrames(ops: readonly DrawOp[]): Promise<DrawOp[]> {
  const encoded = await Promise.all(
    ops.map(async (op) => {
      if (op.op !== 'image' || op.image.kind !== 'rgba') return op
      const { data, width, height } = op.image
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) return op
      context.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0)
      const url = canvas.toDataURL('image/jpeg', FRAME_JPEG_QUALITY)
      return { ...op, image: { kind: 'url', url, format: 'JPEG', width, height } as RasterImage }
    }),
  )
  return encodeSheetImages(encoded)
}

async function figurePng(figure: ComposedFigure): Promise<Blob> {
  const { sheetPngBlob } = await import('@/lib/mapSheet/sheetPng')
  const ops = await jpegFrames(figure.ops)
  return sheetPngBlob(sheetSvg(ops, figure.width, figure.height), figure.width, figure.height, PNG_PIXELS_PER_POINT)
}

/** `subject`: what the file says of itself (`figureSubject`), in its properties rather than on the sheet. */
async function figurePdf(figure: ComposedFigure, subject?: string): Promise<Blob> {
  const [jspdf, { createSheetPdf, drawSheetPdf }] = await Promise.all([
    import('jspdf'),
    import('@/lib/mapSheet/renderPdf'),
  ])
  const ops = await jpegFrames(figure.ops)
  const pdf = createSheetPdf(jspdf, figure.width, figure.height)
  if (subject) pdf.setProperties({ subject, creator: 'PGMaps' })
  drawSheetPdf(pdf, jspdf, ops)
  return pdf.output('blob')
}

/**
 * A saved view's analysed figure as a PNG note image, for the block note: the figure alone in
 * the style, legend inset and calculation under it, so the note keeps its own layout.
 */
export async function figureNoteImage(
  image: NoteImage & { figure?: SavedFigure },
  styleId: string,
  options: FigureOptions & {
    /** Compose on an 11 × 17 landscape page (`tabloidFigure`), as a report's calculation pages print it. */
    tabloid?: boolean
  } = {},
): Promise<NoteImage> {
  const preset = findPreset(styleId) ?? findPreset(DEFAULT_FIGURE_STYLE)!
  const input = await figureInput(image, image.figure, preset, options)
  // A report's calculation page is an 11 × 17 sheet; the block note keeps the figure alone at a letter page's width.
  const figure = options.tabloid ? tabloidFigure(input) : analysedFigure(input)
  const blob = await figurePng(figure)
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('The figure could not be read back.'))
    reader.readAsDataURL(blob)
  })
  return {
    caption: image.caption,
    dataUrl,
    width: Math.round(figure.width * PNG_PIXELS_PER_POINT),
    height: Math.round(figure.height * PNG_PIXELS_PER_POINT),
  }
}

const safeName = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'view'

/** The analysis sheet's choices in Save & export; null keeps the road view's (or the style's) own. */
export type FigureChoice = {
  viewId: string | null
  styleId: string | null
  labelStyle: LabelStyleId | null
  cameraInfo: boolean | null
  paintBlocks: boolean | null
}
export const NO_FIGURE_CHOICE: FigureChoice = {
  viewId: null,
  styleId: null,
  labelStyle: null,
  cameraInfo: null,
  paintBlocks: null,
}

/** A choice with its defaults filled in: the last saved view, the road view's style, the style's labels. */
export type ResolvedFigure = {
  view: FigureView | null
  preset: ViaStylePreset
  labelStyle: LabelStyleId
  cameraInfo: boolean
  paintBlocks: boolean
  /** The scene's denominators, which the sheet's calculation follows (`FigureOptions.sceneDenominator`). */
  sceneDenominator?: SceneDenominator | null
}

export function resolveFigureChoice(
  choice: FigureChoice,
  views: readonly FigureView[],
  roadView: { styleId: string | null; labelStyle: LabelStyleId | null },
): ResolvedFigure {
  const ready = views.filter((view) => view.image)
  const preset =
    findPreset(choice.styleId ?? roadView.styleId ?? DEFAULT_FIGURE_STYLE) ?? findPreset(DEFAULT_FIGURE_STYLE)!
  return {
    view: ready.find((entry) => entry.id === choice.viewId) ?? ready.at(-1) ?? null,
    preset,
    labelStyle: choice.labelStyle ?? roadView.labelStyle ?? figureLabelStyle({ preset }),
    cameraInfo: choice.cameraInfo ?? preset.cameraInfo ?? false,
    paintBlocks: choice.paintBlocks ?? paintsBlocks({ preset }),
  }
}

const composeResolved = async (
  { view, preset, labelStyle, cameraInfo, paintBlocks, sceneDenominator }: ResolvedFigure,
  logo: RasterImage | null = null,
  timber: TimberMeasure | null = null,
) => {
  if (!view?.image)
    throw new Error(
      'No view in the package has a screenshot to draw the sheet from: capture a view of interest in step 2, or save one in the road view.',
    )
  return composeFigure(
    await figureInput(view.image, view.image.figure, preset, {
      labelStyle,
      cameraInfo,
      paintBlocks,
      logo,
      timber,
      sceneDenominator,
    }),
  )
}

/** The analysis sheet as a file, composed exactly as its preview is. */
export async function analysisSheetFile(
  resolved: ResolvedFigure,
  format: 'pdf' | 'png',
  logo: RasterImage | null = null,
  /** The view's with-timber measure (`timberMeasureFor`), or why it has none. */
  timber: TimberMeasure | null = null,
): Promise<{ blob: Blob; fileName: string; copyPng: () => Promise<Blob> }> {
  const figure = await composeResolved(resolved, logo, timber)
  const blob =
    format === 'pdf' ? await figurePdf(figure, figureSubject(resolved.preset, new Date())) : await figurePng(figure)
  return {
    blob,
    fileName: `via-analysis-${safeName(resolved.view?.name ?? 'view')}-${resolved.preset.id}.${format}`,
    // The same composed sheet as the PNG format writes it, for the clipboard: nothing is captured or measured again.
    copyPng: format === 'png' ? async () => blob : () => figurePng(figure),
  }
}

/** The analysis sheet as an SVG image for the preview, with the composer's notes. */
export async function analysisSheetPreview(resolved: ResolvedFigure): Promise<{ src: string; notes: string[] }> {
  const figure = await composeResolved(resolved)
  const ops = await jpegFrames(figure.ops)
  return { src: svgDataUrl(sheetSvg(ops, figure.width, figure.height)), notes: figure.notes }
}

/**
 * The analysis sheet's options in Save & export: which saved view, the figure style, the label
 * style, the camera block and whether the blocks' visible ground is painted as harvested ground. The class pass taken at *Save viewpoint* gives the outlines (the
 * visible edge of each class) and the pixel counts; the run's sightline figure is printed beside
 * the pixel one and stays the assessment's.
 */
export function AnalysisSheetOptions({
  views,
  resolved,
  onChange,
}: {
  views: readonly FigureView[]
  resolved: ResolvedFigure
  onChange: (patch: Partial<FigureChoice>) => void
}) {
  const ready = views.filter((view) => view.image)
  const styleOptions = useMemo(() => VIA_STYLE_PRESETS.filter((entry) => entry.family !== 'G'), [])
  const { view, preset, labelStyle, cameraInfo, paintBlocks } = resolved
  return (
    <div className="grid gap-2 text-xs sm:grid-cols-2" data-testid="figure-sheet-panel">
      <label className="block">
        <span className="mb-1 block text-2xs font-medium text-muted-foreground">Saved view</span>
        <StyledSelect
          aria-label="Saved view for the analysis sheet"
          className="w-full"
          value={view?.id ?? ''}
          onChange={(event) => onChange({ viewId: event.target.value })}
        >
          {ready.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </StyledSelect>
      </label>
      <label className="block">
        <span className="mb-1 block text-2xs font-medium text-muted-foreground">Figure style</span>
        <StyledSelect
          aria-label="Analysis sheet figure style"
          className="w-full"
          value={preset.id}
          onChange={(event) => onChange({ styleId: event.target.value })}
        >
          {styleOptions.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </StyledSelect>
      </label>
      <label className="block">
        <span className="mb-1 block text-2xs font-medium text-muted-foreground">Label style</span>
        <StyledSelect
          aria-label="Analysis sheet label style"
          className="w-full"
          value={labelStyle}
          onChange={(event) => onChange({ labelStyle: event.target.value as LabelStyleId })}
        >
          {LABEL_STYLES.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </StyledSelect>
      </label>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-1 pb-1">
        <CheckboxField
          label="Camera info on image"
          checked={cameraInfo}
          onCheckedChange={(on) => onChange({ cameraInfo: on })}
        />
        <CheckboxField
          label="Paint blocks"
          checked={paintBlocks}
          onCheckedChange={(on) => onChange({ paintBlocks: on })}
        />
      </div>
      {view && !view.image?.figure && (
        <InlineAlert className="sm:col-span-2">
          This view was saved without a class pass, so the sheet has no traced outlines or pixel figure. Save the view
          again to add them.
        </InlineAlert>
      )}
      {view?.image?.figure?.splitFailed && (
        <InlineAlert className="sm:col-span-2">
          A shape could not be split at the landform edge; its pixels count as inside the landform.
        </InlineAlert>
      )}
      <p className="text-3xs text-muted-foreground sm:col-span-2">
        Pixel figures count what this picture shows; the sightline figure is the run&apos;s and stays the
        assessment&apos;s. Both are printed side by side. Paint blocks shows each block&apos;s visible ground as
        harvested ground, as the reference simulations render it; it changes the picture, never a count.
      </p>
    </div>
  )
}
