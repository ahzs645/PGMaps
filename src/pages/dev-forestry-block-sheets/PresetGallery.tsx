import { useEffect, useRef, useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import {
  galleryFileName,
  gallerySheet,
  galleryVariants,
  type GalleryVariant,
} from '@/lib/forestry/blockSheet/gallerySheets'
import { SHEET_KINDS, SHEET_PRESETS } from '@/lib/forestry/blockSheet/sheets'
import { downloadBlob } from '@/lib/download'
import { PAPER_SIZES } from '@/lib/mapSheet/layout'
import { encodeSheetImages } from '@/lib/mapSheet/png'
import { sheetSvg } from '@/lib/mapSheet/renderSvg'
import { formatScale } from '@/lib/mapSheet/scale'
import { svgDataUrl } from '@/lib/mapSheet/symbolSvg'
import { enqueueRender, useSeen } from './renderQueue'

/** Terrain raster of a downloaded PDF, and of a PNG, dots per inch. */
const PDF_DPI = 150
const PNG_DPI = 100
/** PNG pixels per point: 2 is 144 pixels an inch. */
const PNG_PIXELS_PER_POINT = 2

async function sheetPdf(variant: GalleryVariant) {
  const [jspdf, { createSheetPdf, drawSheetPdf }] = await Promise.all([
    import('jspdf'),
    import('@/lib/mapSheet/renderPdf'),
  ])
  const sheet = gallerySheet(variant, PDF_DPI)
  const ops = await encodeSheetImages(sheet.ops)
  const pdf = createSheetPdf(jspdf, sheet.width, sheet.height)
  drawSheetPdf(pdf, jspdf, ops)
  return pdf.output('blob')
}

async function sheetPng(variant: GalleryVariant) {
  const { sheetPngBlob } = await import('@/lib/mapSheet/sheetPng')
  const sheet = gallerySheet(variant, PNG_DPI)
  const ops = await encodeSheetImages(sheet.ops)
  return sheetPngBlob(sheetSvg(ops, sheet.width, sheet.height), sheet.width, sheet.height, PNG_PIXELS_PER_POINT)
}

function PresetCard({ variant }: { variant: GalleryVariant }) {
  const ref = useRef<HTMLDivElement>(null)
  const seen = useSeen(ref)
  const [preview, setPreview] = useState<{ src: string; width: number; height: number } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<'pdf' | 'png' | null>(null)
  useEffect(() => {
    if (!seen) return
    let live = true
    enqueueRender(async () => {
      const sheet = gallerySheet(variant)
      const ops = await encodeSheetImages(sheet.ops)
      return { src: svgDataUrl(sheetSvg(ops, sheet.width, sheet.height)), width: sheet.width, height: sheet.height }
    }).then(
      (value) => live && setPreview(value),
      (cause: unknown) => live && setError(cause instanceof Error ? cause.message : 'The sheet could not be drawn.'),
    )
    return () => {
      live = false
    }
  }, [seen, variant])
  const download = async (kind: 'pdf' | 'png') => {
    setBusy(kind)
    setError('')
    try {
      const blob = await enqueueRender(() => (kind === 'pdf' ? sheetPdf(variant) : sheetPng(variant)))
      downloadBlob(blob, galleryFileName(variant, kind))
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'The download could not be made.')
    } finally {
      setBusy(null)
    }
  }
  const preset = SHEET_PRESETS[variant.kind]
  const landscape = preset.template.orientation === 'landscape'
  const name = `${formatScale(variant.scale)} · ${PAPER_SIZES[variant.paper].label}`
  return (
    <figure
      ref={ref}
      className="flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-2"
      data-testid="block-sheet-preset-card"
      data-kind={variant.kind}
      data-paper={variant.paper}
      data-scale={variant.scale}
    >
      <div
        className="flex items-center justify-center overflow-hidden rounded border bg-muted/40"
        style={{ aspectRatio: landscape ? '17 / 11' : '11 / 17' }}
      >
        {preview ? (
          <img
            src={preview.src}
            alt={`${preset.label} sheet at ${name}`}
            className="h-full w-full object-contain"
            data-testid="block-sheet-preview"
          />
        ) : (
          <span className="text-xs text-muted-foreground">{seen ? 'Drawing…' : 'Waiting to draw'}</span>
        )}
      </div>
      <figcaption className="flex flex-wrap items-center justify-between gap-1 text-xs">
        <span className="font-medium">{name}</span>
        <span className="flex gap-1">
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => download('pdf')}>
            <Download className="size-3.5" aria-hidden="true" />
            {busy === 'pdf' ? 'Making PDF…' : 'PDF'}
          </Button>
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => download('png')}>
            <Download className="size-3.5" aria-hidden="true" />
            {busy === 'png' ? 'Making PNG…' : 'PNG'}
          </Button>
        </span>
      </figcaption>
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
    </figure>
  )
}

/** Every preset at each offered scale on tabloid, then on letter, A3 and A4 at its default scale. */
export function PresetGallery() {
  return (
    <div className="space-y-8">
      <p className="max-w-3xl text-sm text-muted-foreground">
        Each sheet is drawn from a synthetic block, terrain and canopy through the same composer and renderer as the
        road tool's export. Previews sample the terrain at 40 dpi; the PDF at 150 dpi and the PNG at 100 dpi. The
        imagery sheet uses a synthetic green stand-in, so the gallery needs no network.
      </p>
      {SHEET_KINDS.map((kind) => (
        <section key={kind} aria-labelledby={`block-sheet-preset-${kind}`} className="space-y-3">
          <div>
            <h2 id={`block-sheet-preset-${kind}`} className="text-base font-semibold">
              {SHEET_PRESETS[kind].label}
            </h2>
            <p className="text-xs text-muted-foreground">{SHEET_PRESETS[kind].description}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {galleryVariants(kind).map((variant) => (
              <PresetCard key={`${variant.paper}-${variant.scale}`} variant={variant} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
