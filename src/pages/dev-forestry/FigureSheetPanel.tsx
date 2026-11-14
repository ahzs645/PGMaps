import { useMemo } from 'react'

import { CheckboxField, StyledSelect } from '@/components/ui/form-field'
import { InlineAlert } from '@/components/ui/map-panels'
import {
  analysedFigure,
  composeFigure,
  cropRasterRows,
  figureLabelStyle,
  rgbaLuminance,
  type ClassRaster,
  type ComposedFigure,
  type FigureInput,
  type Overlay,
} from '@/lib/forestry/viaFigure/composeFigure'
import { findPreset, VIA_STYLE_PRESETS, type ViaStylePreset } from '@/lib/forestry/viaFigure/presets'
import type { CameraInfo } from '@/lib/forestry/viaFigure/cameraInfo'
import { LABEL_STYLES, type LabelStyleId } from '@/lib/mapSheet/callouts'
import type { RasterImage } from '@/lib/mapSheet/drawOps'
import { encodeSheetImages } from '@/lib/mapSheet/png'
import { sheetSvg } from '@/lib/mapSheet/renderSvg'
import { svgDataUrl } from '@/lib/mapSheet/symbolSvg'

import type { NoteImage } from './blockNote'
import { illustrationLine, missingLine, type FigureIllustration } from './engineCapture'
import type { BlockCallout } from './figureCallouts'
import { cropImageRows } from './mapCapture'

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
  /** The run's perspective alteration at that station, percent, and its Table 2 class. */
  sightlinePercent: number | null
  sightlineClass: string | null
  lens: string
  /** Nearest visible block, km, and the view's horizontal field of view, degrees. */
  distanceKm: number | null
  hfovDeg: number
  facts: Array<{ label: string; value: string }>
  rating: FigureInput['rating']
  /** Which rule chose the inventory unit (`inventoryBadge.ts`). */
  ratingNote?: string
  area: string
  viewpoint: string
  /** A landform split fell back: some class may be counted inside the landform that is not. */
  splitFailed: boolean
  /** Sub-landform dividers and lines of force (candidates), projected and cut to the landform. */
  lines?: Overlay[]
  /** The VQO zone pass of the same frames, when EVQO polygons were loaded. */
  zones?: ClassRaster
  /**
   * The landform's rows (`landformCropRows`): applied at export by styles that crop to the
   * landform, so one saved view serves a strip and a full frame with the title in its sky.
   */
  crop?: { y: number; height: number }
  /** What the camera information block prints. */
  camera?: CameraInfo
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
}

/** How an export names features and whether it prints the camera block; the style's own when absent. */
export type FigureOptions = { labelStyle?: LabelStyleId | null; cameraInfo?: boolean | null }

/** A callout moved into a crop's rows, or null when it falls outside them. */
function shiftCallout<T extends { anchor: [number, number] }>(
  callout: T,
  crop: { y: number; height: number },
): T | null {
  const y = callout.anchor[1] - crop.y
  return y >= 0 && y < crop.height ? { ...callout, anchor: [callout.anchor[0], y] } : null
}

export type FigureView = { id: string; name: string; image: (NoteImage & { figure?: SavedFigure }) | undefined }

/** The default style when the road view has none chosen. */
export const DEFAULT_FIGURE_STYLE = 'analysis-sheet-magenta'
/** PNG pixels per point: 2 is 144 pixels an inch. */
const PNG_PIXELS_PER_POINT = 2

/** Decodes a saved JPEG to straight RGBA, for styles that re-tone the frame. Browser only. */
async function decodedImage(image: NoteImage): Promise<RasterImage> {
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
  // only, and keep drawing the JPEG itself so the sheet stays small.
  const greyscale = preset.tone === 'greyscale'
  const decoded =
    greyscale || figureLabelStyle({ preset, labelStyle: options.labelStyle ?? undefined }) === 'underlined-arrow'
      ? await decodedImage(image)
      : null
  return {
    ...(options.labelStyle ? { labelStyle: options.labelStyle } : {}),
    ...(options.cameraInfo != null ? { cameraInfo: options.cameraInfo } : {}),
    ...(decoded?.kind === 'rgba' && !greyscale ? { luminance: rgbaLuminance(decoded) } : {}),
    zones: figure?.zones ? (crop ? cropRasterRows(figure.zones, crop) : figure.zones) : null,
    camera: figure?.camera ?? null,
    preset,
    image:
      greyscale && decoded
        ? decoded
        : { kind: 'url', url: image.dataUrl, format: 'JPEG', width: image.width, height: image.height },
    classes: figure?.classes ? (crop ? cropRasterRows(figure.classes, crop) : figure.classes) : null,
    screenedClasses: figure?.screened ? (crop ? cropRasterRows(figure.screened, crop) : figure.screened) : null,
    callouts,
    lines,
    sightlinePercent: figure?.sightlinePercent ?? null,
    sightlineClass: figure?.sightlineClass ?? null,
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
      n: '1',
    },
    facts: figure?.facts ?? [],
    rating: figure?.rating ?? null,
    ratingNote: figure?.ratingNote ?? null,
    generatedAt: new Date(),
  }
}

async function figurePng(figure: ComposedFigure): Promise<Blob> {
  const { sheetPngBlob } = await import('@/lib/mapSheet/sheetPng')
  const ops = await encodeSheetImages(figure.ops)
  return sheetPngBlob(sheetSvg(ops, figure.width, figure.height), figure.width, figure.height, PNG_PIXELS_PER_POINT)
}

async function figurePdf(figure: ComposedFigure): Promise<Blob> {
  const [jspdf, { createSheetPdf, drawSheetPdf }] = await Promise.all([
    import('jspdf'),
    import('@/lib/mapSheet/renderPdf'),
  ])
  const ops = await encodeSheetImages(figure.ops)
  const pdf = createSheetPdf(jspdf, figure.width, figure.height)
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
  options: FigureOptions = {},
): Promise<NoteImage> {
  const preset = findPreset(styleId) ?? findPreset(DEFAULT_FIGURE_STYLE)!
  const figure = analysedFigure(await figureInput(image, image.figure, preset, options))
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
}
export const NO_FIGURE_CHOICE: FigureChoice = { viewId: null, styleId: null, labelStyle: null, cameraInfo: null }

/** A choice with its defaults filled in: the last saved view, the road view's style, the style's labels. */
export type ResolvedFigure = {
  view: FigureView | null
  preset: ViaStylePreset
  labelStyle: LabelStyleId
  cameraInfo: boolean
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
  }
}

const composeResolved = async ({ view, preset, labelStyle, cameraInfo }: ResolvedFigure) => {
  if (!view?.image) throw new Error('Save a viewpoint in the road view first.')
  return composeFigure(await figureInput(view.image, view.image.figure, preset, { labelStyle, cameraInfo }))
}

/** The analysis sheet as a file, composed exactly as its preview is. */
export async function analysisSheetFile(
  resolved: ResolvedFigure,
  format: 'pdf' | 'png',
): Promise<{ blob: Blob; fileName: string }> {
  const figure = await composeResolved(resolved)
  const blob = format === 'pdf' ? await figurePdf(figure) : await figurePng(figure)
  return { blob, fileName: `via-analysis-${safeName(resolved.view?.name ?? 'view')}-${resolved.preset.id}.${format}` }
}

/** The analysis sheet as an SVG image for the preview, with the composer's notes. */
export async function analysisSheetPreview(resolved: ResolvedFigure): Promise<{ src: string; notes: string[] }> {
  const figure = await composeResolved(resolved)
  const ops = await encodeSheetImages(figure.ops)
  return { src: svgDataUrl(sheetSvg(ops, figure.width, figure.height)), notes: figure.notes }
}

/**
 * The analysis sheet's options in Save & export: which saved view, the figure style, the label
 * style and the camera block. The class pass taken at *Save viewpoint* gives the outlines (the
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
  const { view, preset, labelStyle, cameraInfo } = resolved
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
      <div className="flex items-end pb-1">
        <CheckboxField
          label="Camera info on image"
          checked={cameraInfo}
          onCheckedChange={(on) => onChange({ cameraInfo: on })}
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
        assessment&apos;s. Both are printed side by side.
      </p>
    </div>
  )
}
