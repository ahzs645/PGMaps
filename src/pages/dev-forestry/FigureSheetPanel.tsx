import { useEffect, useMemo, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { CheckboxField, StyledSelect } from '@/components/ui/form-field'
import { InlineAlert } from '@/components/ui/map-panels'
import { downloadBlob } from '@/lib/download'
import {
  analysedFigure,
  composeFigure,
  type ClassRaster,
  type ComposedFigure,
  type FigureInput,
} from '@/lib/forestry/viaFigure/composeFigure'
import { findPreset, VIA_STYLE_PRESETS, type ViaStylePreset } from '@/lib/forestry/viaFigure/presets'
import type { RasterImage } from '@/lib/mapSheet/drawOps'
import { encodeSheetImages } from '@/lib/mapSheet/png'
import { sheetSvg } from '@/lib/mapSheet/renderSvg'
import { svgDataUrl } from '@/lib/mapSheet/symbolSvg'

import type { NoteImage } from './blockNote'
import type { BlockCallout } from './figureCallouts'

/** What a saved view's VIA figure is composed from, kept with its screenshot for the session. */
export type SavedFigure = {
  /** The class pass of the saved camera, the screenshot's size. */
  classes: ClassRaster
  callouts: BlockCallout[]
  stationIndex: number
  /** The run's perspective alteration at that station, percent, and its Table 2 class. */
  sightlinePercent: number | null
  sightlineClass: string | null
  lens: string
  facts: Array<{ label: string; value: string }>
  rating: FigureInput['rating']
  area: string
  viewpoint: string
  /** A landform split fell back: some class may be counted inside the landform that is not. */
  splitFailed: boolean
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
  image: NoteImage,
  figure: SavedFigure | undefined,
  preset: ViaStylePreset,
): Promise<FigureInput> {
  return {
    preset,
    image:
      preset.tone === 'greyscale'
        ? await decodedImage(image)
        : { kind: 'url', url: image.dataUrl, format: 'JPEG', width: image.width, height: image.height },
    classes: figure?.classes ?? null,
    callouts: figure?.callouts ?? [],
    sightlinePercent: figure?.sightlinePercent ?? null,
    sightlineClass: figure?.sightlineClass ?? null,
    lens: figure?.lens ?? image.caption,
    titles: {
      area: figure?.area ?? 'Landform',
      viewpoint: figure?.viewpoint ?? image.caption.replace(/\.$/, ''),
      n: '1',
    },
    facts: figure?.facts ?? [],
    rating: figure?.rating ?? null,
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
): Promise<NoteImage> {
  const preset = findPreset(styleId) ?? findPreset(DEFAULT_FIGURE_STYLE)!
  const figure = analysedFigure(await figureInput(image, image.figure, preset))
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

/**
 * Step 5: a saved view composed as a VIA analysis sheet in one of the figure styles. The class
 * pass taken at *Save viewpoint* gives the outlines (the visible edge of each class) and the pixel
 * counts; the run's sightline figure is printed beside the pixel one and stays the assessment's.
 */
export function FigureSheetPanel({
  views,
  styleId,
  noteFigures,
  onNoteFiguresChange,
}: {
  views: readonly FigureView[]
  /** The road view's figure style, the starting choice here. */
  styleId: string | null
  /** Whether the block note uses each view's figure instead of its screenshot. */
  noteFigures: boolean
  onNoteFiguresChange: (on: boolean) => void
}) {
  const ready = views.filter((view) => view.image)
  const [viewId, setViewId] = useState<string | null>(null)
  const [chosenStyle, setChosenStyle] = useState<string | null>(null)
  const style = chosenStyle ?? styleId ?? DEFAULT_FIGURE_STYLE
  const preset = findPreset(style) ?? findPreset(DEFAULT_FIGURE_STYLE)!
  const view = ready.find((entry) => entry.id === viewId) ?? ready.at(-1)
  const [busy, setBusy] = useState<'pdf' | 'png' | 'preview' | null>(null)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<{ key: string; src: string; notes: string[] } | null>(null)
  const key = view ? `${view.id}:${preset.id}:${view.image?.figure ? 'f' : 'n'}` : ''
  const shown = preview?.key === key ? preview : null
  useEffect(() => setError(''), [key])

  const compose = async () => composeFigure(await figureInput(view!.image!, view!.image!.figure, preset))
  const run = async (kind: 'pdf' | 'png' | 'preview') => {
    if (!view?.image) return
    setBusy(kind)
    setError('')
    try {
      const figure = await compose()
      if (kind === 'preview') {
        const ops = await encodeSheetImages(figure.ops)
        setPreview({ key, src: svgDataUrl(sheetSvg(ops, figure.width, figure.height)), notes: figure.notes })
      } else {
        const blob = kind === 'pdf' ? await figurePdf(figure) : await figurePng(figure)
        downloadBlob(blob, `via-analysis-${safeName(view.name)}-${preset.id}.${kind}`)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The analysis sheet could not be made.')
    } finally {
      setBusy(null)
    }
  }
  const styleOptions = useMemo(() => VIA_STYLE_PRESETS.filter((entry) => entry.family !== 'G'), [])

  if (!ready.length)
    return (
      <p className="text-2xs text-muted-foreground">
        Save a viewpoint in the road view (step 2) first: its screenshot and class pass are what the sheet is drawn
        from.
      </p>
    )
  return (
    <div className="space-y-2 text-xs" data-testid="figure-sheet-panel">
      <label className="block">
        <span className="mb-1 block text-2xs font-medium text-muted-foreground">Saved view</span>
        <StyledSelect
          aria-label="Saved view for the analysis sheet"
          className="w-full"
          value={view?.id ?? ''}
          onChange={(event) => setViewId(event.target.value)}
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
          onChange={(event) => setChosenStyle(event.target.value)}
        >
          {styleOptions.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </StyledSelect>
      </label>
      {view && !view.image?.figure && (
        <InlineAlert>
          This view was saved without a class pass, so the sheet has no traced outlines or pixel figure. Save the view
          again to add them.
        </InlineAlert>
      )}
      {view?.image?.figure?.splitFailed && (
        <InlineAlert>
          A shape could not be split at the landform edge; its pixels count as inside the landform.
        </InlineAlert>
      )}
      <div className="grid grid-cols-3 gap-1.5">
        <Button type="button" variant="outline" size="sm" disabled={!!busy} onClick={() => void run('preview')}>
          {busy === 'preview' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Preview
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={!!busy} onClick={() => void run('pdf')}>
          {busy === 'pdf' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          PDF
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={!!busy} onClick={() => void run('png')}>
          {busy === 'png' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          PNG
        </Button>
      </div>
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      {shown && (
        <figure className="space-y-1">
          <img src={shown.src} alt={`Analysis sheet of ${view?.name}`} className="w-full rounded-md border bg-white" />
          {shown.notes.map((note) => (
            <figcaption key={note} className="text-3xs text-muted-foreground">
              {note}
            </figcaption>
          ))}
        </figure>
      )}
      <CheckboxField
        label="Use these figures in the block note"
        checked={noteFigures}
        onCheckedChange={onNoteFiguresChange}
      />
      <p className="text-3xs text-muted-foreground">
        Pixel figures count what this picture shows; the sightline figure is the run&apos;s and stays the
        assessment&apos;s. Both are printed side by side.
      </p>
    </div>
  )
}
