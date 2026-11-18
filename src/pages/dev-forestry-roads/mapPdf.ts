/**
 * The Map PDF (guide docs/forestry-road-design/exports-and-project-files.md, **Map PDF options**).
 * Browser only.
 *
 * - **As shown** (the default): the plan as it is on screen with its markers, fitted onto the page
 *   as it always was. It is registered in Web Mercator only when the plan is north-up, flat and
 *   without 3D terrain (`asShownRegistrable`); a turned or tilted view is not a Mercator picture.
 * - **Framed** (a road, every road, a block, or the view at a typed scale): the plan is turned
 *   north-up and flat, moved so the frame's ground fills it, drawn, captured and put back
 *   (`withNorthUpPlan`, `planCapture.ts`, the field pack's path), and the page's map box is the
 *   centred crop of that capture at exactly the stated scale. The page prints the scale and a scale
 *   bar and is registered with `addMapViewports`, so Avenza and QGIS place it.
 */
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { jsPDF as JsPdf } from 'jspdf'
import type { ExportBrand, UploadedLogo } from '@/branding/model'
import { configurePdfBrand, drawPdfPrintedLogo, setPdfBrandFont } from '@/branding/pdf'
import { addMapViewports, WEB_MERCATOR_WKT, type MapViewport } from '@/lib/geoPdf/writeViewport'
import { formatScale, scaleBar } from '@/lib/mapSheet/scale'
import {
  asShownRegistrable,
  captureCamera,
  captureDpi,
  capturePixelRatio,
  framedMapBox,
  framedScale,
  framedScaleLine,
  mapPdfPageFormat,
  MM_PER_PT,
  zoomReached,
  type MapPdfPlan,
} from './mapPdfFrame'
import { cropCapture, withNorthUpPlan, type Corners } from './planCapture'
import { mapImage, pdfPlainText as text } from './pdf'

export interface MapPdfRequest {
  plan: MapPdfPlan
  /** The project's name, the page's title. */
  name: string
  terrain: string
  /** The datum, issue stamp and caveat line under the title. */
  datum: string
  signal?: AbortSignal
  branding?: ExportBrand
  /** The user's own logo (`printedLogo`), printed in place of the brand's. */
  logo?: UploadedLogo | null
}

export interface MapPdfResult {
  blob: Blob
  /** Whether the page is registered, and what it prints, for the notice. */
  georeferenced: boolean
  /** Why the plan as shown was printed without registration. */
  unregisteredReason?: string
  scale?: number
  /** Dots per inch the map's own drawing prints at on a framed page. */
  dpi?: number
}

function cancelledIf(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Map PDF preparation cancelled.', 'AbortError')
}

/** Every source's credit, as the footer prints it. */
function attributionOf(map: MapLibreMap) {
  return [
    ...new Set(
      Object.values(map.getStyle().sources).flatMap((source) =>
        'attribution' in source && source.attribution
          ? [new DOMParser().parseFromString(source.attribution, 'text/html').body.textContent?.trim() ?? '']
          : [],
      ),
    ),
  ].join(' | ')
}

/** The title, the terrain and datum line and the logo; returns where the map may start, mm. */
async function drawHeader(pdf: JsPdf, request: MapPdfRequest, width: number) {
  const { branding, logo } = request
  const fonts = configurePdfBrand(pdf, branding)
  const logoDrawn = await drawPdfPrintedLogo(pdf, branding, logo, width - 58, 8, 46, 20)
  if (branding) setPdfBrandFont(pdf, fonts, true)
  pdf.setFontSize(16)
  const title: string[] = pdf.splitTextToSize(text(request.name), width - (logoDrawn ? 84 : 24))
  pdf.text(title, 12, 18)
  pdf.setFontSize(8)
  if (branding) setPdfBrandFont(pdf, fonts)
  const metadata: string[] = pdf.splitTextToSize(
    text(`${request.terrain} | ${request.datum}`),
    width - (logoDrawn ? 84 : 24),
  )
  const metadataY = 18 + title.length * 7
  pdf.text(metadata, 12, metadataY)
  return Math.max(metadataY + metadata.length * 4 + 5, logoDrawn ? 34 : 0)
}

/**
 * Where a framed page's map starts under this title, terrain line and logo, mm: the header drawn on
 * a scratch page, so the preview's sketch fits the same map box, and states the same scale, as the PDF.
 */
export async function mapPdfHeaderTop(
  request: Pick<MapPdfRequest, 'name' | 'terrain' | 'datum' | 'branding' | 'logo'>,
  plan: Extract<MapPdfPlan, { mode: 'framed' }>,
): Promise<number> {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ orientation: plan.orientation, unit: 'mm', format: mapPdfPageFormat(plan.paper) })
  return drawHeader(pdf, { ...request, plan }, pdf.internal.pageSize.getWidth())
}

/** The attribution and the footer line, as the Map PDF always printed them. */
function drawFoot(pdf: JsPdf, attribution: string, footer: string, width: number, height: number) {
  if (attribution) {
    pdf.setFontSize(6)
    pdf.text(attribution, 12, height - 14, { maxWidth: width - 24 })
  }
  pdf.setFontSize(7)
  pdf.text(footer, 12, height - 8)
}

/** The image's rectangle on the page in PDF points, origin bottom-left, for `addMapViewports`. */
const viewportBox = (
  box: { x: number; y: number; w: number; h: number },
  pageHeightMm: number,
): MapViewport['bbox'] => [
  box.x / MM_PER_PT,
  (pageHeightMm - box.y - box.h) / MM_PER_PT,
  (box.x + box.w) / MM_PER_PT,
  (pageHeightMm - box.y) / MM_PER_PT,
]

async function registered(
  pdf: JsPdf,
  box: { x: number; y: number; w: number; h: number },
  height: number,
  corners: Corners,
  name: string,
) {
  const bytes = await addMapViewports(pdf.output('arraybuffer'), [
    { page: 0, bbox: viewportBox(box, height), corners, wkt: WEB_MERCATOR_WKT, name },
  ])
  return new Blob([bytes as BlobPart], { type: 'application/pdf' })
}

/** An alternating scale bar ending at `right`, with its labels under it (`scaleBar`, the sheets' own). */
function drawScaleBar(pdf: JsPdf, scale: number, right: number, top: number, maxWidthMm: number) {
  const bar = scaleBar(scale, maxWidthMm / MM_PER_PT)
  const segment = bar.segmentPt * MM_PER_PT
  const left = right - bar.widthPt * MM_PER_PT
  const km = bar.segmentM >= 1000
  const stops = [0, segment / 2, ...Array.from({ length: bar.rightSegments + 1 }, (_, i) => segment * (i + 1))]
  pdf.setLineWidth(0.15)
  pdf.setDrawColor(40)
  for (let i = 0; i + 1 < stops.length; i++) {
    const grey = i % 2 ? 255 : 40
    pdf.setFillColor(grey, grey, grey)
    pdf.rect(left + stops[i], top, stops[i + 1] - stops[i], 1.4, 'FD')
  }
  pdf.setFontSize(6)
  pdf.setTextColor(40)
  bar.labels.forEach((label, i) => {
    const value = km ? `${label.value / 1000}` : `${label.value}`
    const last = i === bar.labels.length - 1
    pdf.text(last ? `${value} ${km ? 'km' : 'm'}` : value, left + label.offsetPt * MM_PER_PT, top + 4, {
      align: last ? 'left' : 'center',
    })
  })
  pdf.setTextColor(0)
  return left
}

/** Builds the Map PDF for a plan made by `mapPdfPlan`. */
export async function mapPdf(map: MapLibreMap, request: MapPdfRequest): Promise<MapPdfResult> {
  const { plan, signal, branding } = request
  cancelledIf(signal)
  if (map.getCanvas().clientWidth < 1 || map.getCanvas().clientHeight < 1)
    throw Error('Show the plan panel before exporting its map.')
  const brandName = branding?.brand.profile.name ?? 'DDC Access'

  if (plan.mode === 'as-shown') {
    const projection = (map as unknown as { getProjection?: () => { type?: string } | undefined }).getProjection?.()
    const view = {
      bearing: map.getBearing(),
      pitch: map.getPitch(),
      terrain: !!map.getTerrain(),
      projection: projection?.type,
    }
    const [{ jsPDF }, capture] = await Promise.all([import('jspdf'), mapImage(map, signal)])
    cancelledIf(signal)
    // Read at the capture, before anything can move the plan: the image is the whole plan.
    const shown = { w: capture.width / 2, h: capture.height / 2 }
    const corner = (x: number, y: number) => {
      const p = map.unproject([x, y])
      return [p.lng, p.lat] as [number, number]
    }
    const corners: Corners = [corner(0, 0), corner(shown.w, 0), corner(shown.w, shown.h), corner(0, shown.h)]
    const georeferenced = asShownRegistrable(view)
    const pdf = new jsPDF({
      orientation:
        plan.orientation === 'auto' ? (capture.width >= capture.height ? 'landscape' : 'portrait') : plan.orientation,
      unit: 'mm',
      format: mapPdfPageFormat(plan.paper),
      compress: true,
    })
    const width = pdf.internal.pageSize.getWidth(),
      height = pdf.internal.pageSize.getHeight()
    const imageY = await drawHeader(pdf, request, width)
    const scale = Math.min((width - 24) / capture.width, (height - imageY - 22) / capture.height)
    const w = capture.width * scale,
      h = capture.height * scale
    const box = { x: (width - w) / 2, y: imageY, w, h }
    pdf.addImage(capture.image, 'PNG', box.x, box.y, w, h)
    drawFoot(
      pdf,
      attributionOf(map),
      `${brandName} | Current plan view${georeferenced ? ' | Georeferenced, Web Mercator' : ''} | Preliminary planning - not for construction`,
      width,
      height,
    )
    cancelledIf(signal)
    if (!georeferenced)
      return {
        blob: pdf.output('blob'),
        georeferenced,
        unregisteredReason: view.terrain
          ? 'the plan shows 3D terrain'
          : view.projection && view.projection !== 'mercator'
            ? 'the plan is on the globe'
            : 'the plan is turned or tilted',
      }
    return { blob: await registered(pdf, box, height, corners, request.name), georeferenced }
  }

  const { jsPDF } = await import('jspdf')
  cancelledIf(signal)
  const pdf = new jsPDF({
    orientation: plan.orientation,
    unit: 'mm',
    format: mapPdfPageFormat(plan.paper),
    compress: true,
  })
  const width = pdf.internal.pageSize.getWidth(),
    height = pdf.internal.pageSize.getHeight()
  const top = await drawHeader(pdf, request, width)
  const box = framedMapBox({ width, height }, top)
  if (box.h < 20 || box.w < 20)
    throw Error('The title leaves no room for the map on this paper. Choose a larger paper.')
  const scale = framedScale(plan, box)
  const container = map.getContainer()
  const camera = captureCamera(plan.center, scale, box, {
    width: container.clientWidth,
    height: container.clientHeight,
  })
  const framed = await withNorthUpPlan(
    map,
    { center: camera.center, zoom: camera.zoom },
    {
      signal,
      pixelRatio: capturePixelRatio(camera.cssPerMm, map.getPixelRatio()),
      globeMessage: 'Switch the plan to the flat map before printing a framed Map PDF.',
      cancelledMessage: 'Map PDF preparation cancelled.',
    },
    async (capture) => {
      if (!zoomReached(map.getZoom(), camera.zoom))
        throw Error(
          `The plan cannot zoom to show ${formatScale(scale)} on this paper. Choose a coarser scale or a smaller paper.`,
        )
      const cropped = await cropCapture(map, capture, camera.crop)
      return { ...cropped, dpi: captureDpi(camera.cssPerMm, capture.pixelRatio), attribution: attributionOf(map) }
    },
  )
  cancelledIf(signal)
  pdf.addImage(framed.image, 'PNG', box.x, box.y, box.w, box.h)
  pdf.setDrawColor(60)
  pdf.rect(box.x, box.y, box.w, box.h)
  const barLeft = drawScaleBar(pdf, scale, width - 12, height - 27, Math.min(80, box.w / 2))
  pdf.setFontSize(7)
  pdf.text(text(framedScaleLine(scale, plan.center[1], plan.paper)), 12, height - 25.6, {
    maxWidth: Math.max(40, barLeft - 18),
  })
  drawFoot(
    pdf,
    framed.attribution,
    text(`${brandName} | ${plan.label} | Preliminary planning - not for construction`),
    width,
    height,
  )
  cancelledIf(signal)
  return {
    blob: await registered(pdf, box, height, framed.corners, `${request.name} ${plan.label}`),
    georeferenced: true,
    scale,
    dpi: framed.dpi,
  }
}

/** The notice after a Map PDF is written. */
export function mapPdfNotice(plan: MapPdfPlan, result: MapPdfResult): string {
  if (plan.mode === 'as-shown')
    return result.georeferenced
      ? 'Map PDF downloaded: the plan as shown, georeferenced in Web Mercator (EPSG:3857), so Avenza and QGIS place it.'
      : `Map PDF downloaded: the plan as shown. Not georeferenced, because ${result.unregisteredReason ?? 'the view is not north-up and flat'}; turn it north-up and flat, or frame it in Options, to register it.`
  return `Map PDF downloaded: ${plan.label} at ${formatScale(result.scale ?? 0)}, north-up and georeferenced in Web Mercator (EPSG:3857), so Avenza and QGIS place it. The map prints at about ${Math.round(result.dpi ?? 0)} dpi.`
}
