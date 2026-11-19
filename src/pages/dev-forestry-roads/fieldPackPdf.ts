/**
 * The field pack's geospatial PDF (guide `docs/forestry-road-design/field-review.md`). Browser only.
 *
 * The plan map is turned north-up and flat, framed on the issue, captured with its markers and put
 * back as it was (`withNorthUpPlan`, `planCapture.ts`, which a framed Map PDF shares). The issued centreline and the checks are drawn over the
 * capture from the issue's own geometry, never from the road as it now stands. The image's
 * corners are read from the map at capture, and `addMapViewports` registers the page in Web
 * Mercator, the CRS the image was drawn in, so Avenza, GDAL and PGMaps' reader place it exactly.
 */
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { ExportBrand, UploadedLogo } from '@/branding/model'
import { configurePdfBrand, drawPdfPrintedLogo, setPdfBrandFont } from '@/branding/pdf'
import { addMapViewports, WEB_MERCATOR_WKT } from '@/lib/geoPdf/writeViewport'
import { emptyFieldText, type EmptyFields } from '@/lib/mapSheet/emptyFields'
import { FIELD_CHECK_KINDS, issuedPositionAt, type FieldIssue } from './fieldReview'
import { PLANNING_CAVEAT } from './projectIssue'
import { withNorthUpPlan } from './planCapture'

/** Space round the issue's extent on the sheet, in screen pixels. */
const FRAME_PADDING_PX = 48
const MM_TO_PT = 72 / 25.4
const pdfText = (value: string) =>
  value
    .replace(/−/g, '-')
    .replace(/[–—]/g, ' - ')
    .replace(/→/g, ' to ')
    .replace(/·/g, '|')
    .replace(/©/g, '(c)')
    .replace(/[^\x20-\x7e]/g, '?')

/** Draws the issued centreline and checks over the capture, placed by the map as framed. */
async function overlayIssue(map: MapLibreMap, image: string, width: number, height: number, issue: FieldIssue) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw Error('This browser cannot draw the field pack.')
  const picture = new Image()
  picture.src = image
  await picture.decode()
  ctx.drawImage(picture, 0, 0)
  const scale = width / map.getContainer().clientWidth
  const at = (c: [number, number]) => {
    const p = map.project(c)
    return [p.x * scale, p.y * scale] as const
  }
  const line = (points: readonly [number, number][], colour: string, px: number) => {
    ctx.beginPath()
    points.forEach((c, i) => (i ? ctx.lineTo(...at(c)) : ctx.moveTo(...at(c))))
    ctx.strokeStyle = colour
    ctx.lineWidth = px * scale
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.stroke()
  }
  line(issue.centreline, '#ffffff', 6)
  line(issue.centreline, '#d82f1f', 3)
  ctx.font = `600 ${11 * scale}px Helvetica, Arial, sans-serif`
  ctx.textBaseline = 'middle'
  for (const check of issue.checks) {
    if (check.endChainage !== undefined) {
      const stretch = [
        issuedPositionAt(issue, check.chainage),
        ...issue.centreline.filter(
          (_, i) => issue.chainages[i] > check.chainage && issue.chainages[i] < check.endChainage!,
        ),
        issuedPositionAt(issue, check.endChainage),
      ]
      line(stretch, '#ffc800', 9)
      line(stretch, '#d82f1f', 3)
    }
    const [x, y] = at(check.coordinate)
    ctx.beginPath()
    ctx.arc(x, y, 6 * scale, 0, Math.PI * 2)
    ctx.fillStyle = '#ffc800'
    ctx.fill()
    ctx.lineWidth = 2 * scale
    ctx.strokeStyle = '#1f2937'
    ctx.stroke()
    const label = check.label
    const w = ctx.measureText(label).width + 8 * scale
    ctx.fillStyle = 'rgba(255,255,255,0.92)'
    ctx.fillRect(x + 9 * scale, y - 8 * scale, w, 16 * scale)
    ctx.strokeRect(x + 9 * scale, y - 8 * scale, w, 16 * scale)
    ctx.fillStyle = '#111827'
    ctx.fillText(label, x + 13 * scale, y)
  }
  try {
    return canvas.toDataURL('image/png')
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

/** Frames the map on the issue, captures it and puts the camera back (`withNorthUpPlan`). */
async function captureIssue(map: MapLibreMap, issue: FieldIssue, signal?: AbortSignal) {
  const xs = issue.centreline.map((c) => c[0]),
    ys = issue.centreline.map((c) => c[1])
  return withNorthUpPlan(
    map,
    {
      bounds: [
        [Math.min(...xs), Math.min(...ys)],
        [Math.max(...xs), Math.max(...ys)],
      ],
      paddingPx: FRAME_PADDING_PX,
    },
    {
      signal,
      globeMessage: 'Switch the plan to the flat map before issuing a field pack.',
      cancelledMessage: 'Field pack PDF cancelled.',
    },
    async (capture) => {
      const image = await overlayIssue(map, capture.image, capture.width, capture.height, issue)
      return { image, width: capture.width, height: capture.height, corners: capture.corners }
    },
  )
}

export interface FieldPackPdfOptions {
  attribution: string
  signal?: AbortSignal
  branding?: ExportBrand
  logo?: UploadedLogo | null
  /** What an empty revision prints (`RoadReportSettings.emptyFields`); absent is blank. */
  emptyFields?: EmptyFields
}

/** Page 1: the georegistered map. Page 2: the checks the crew answers. */
export async function fieldPackPdf(map: MapLibreMap, issue: FieldIssue, options: FieldPackPdfOptions): Promise<Blob> {
  if (map.getCanvas().clientWidth < 1 || map.getCanvas().clientHeight < 1)
    throw Error('Show the plan panel before building the field pack.')
  const capture = await captureIssue(map, issue, options.signal)
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({
    orientation: capture.width >= capture.height ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  })
  const width = pdf.internal.pageSize.getWidth(),
    height = pdf.internal.pageSize.getHeight()
  const fonts = configurePdfBrand(pdf, options.branding)
  const revision = issue.revision || emptyFieldText(options.emptyFields, 'not recorded')
  // Left empty, the field keeps its label: "Rev", not a stand-in.
  const rev = revision ? `Rev ${revision}` : 'Rev'
  const logoDrawn = await drawPdfPrintedLogo(pdf, options.branding, options.logo, width - 58, 8, 46, 20)
  setPdfBrandFont(pdf, fonts, true)
  pdf.setFontSize(14)
  pdf.text(pdfText(`${issue.label} | ${issue.roadName} | Field review`), 12, 16, {
    maxWidth: width - (logoDrawn ? 84 : 24),
  })
  setPdfBrandFont(pdf, fonts)
  pdf.setFontSize(8)
  pdf.text(
    pdfText(
      `${rev} | Issued ${issue.issuedOn} | ${issue.terrain.name} | ${issue.terrain.verticalReference} | ${PLANNING_CAVEAT}`,
    ),
    12,
    22,
    { maxWidth: width - (logoDrawn ? 84 : 24) },
  )
  const top = logoDrawn ? 32 : 27
  const scale = Math.min((width - 24) / capture.width, (height - top - 20) / capture.height)
  const w = capture.width * scale,
    h = capture.height * scale,
    x = (width - w) / 2
  pdf.addImage(capture.image, 'PNG', x, top, w, h)
  pdf.setDrawColor(60)
  pdf.rect(x, top, w, h)
  pdf.setFontSize(6)
  if (options.attribution) pdf.text(pdfText(options.attribution), 12, height - 13, { maxWidth: width - 24 })
  pdf.setFontSize(7)
  pdf.text(
    pdfText(
      `North up | Web Mercator | Record observations on your own layer with the check label (${issue.checks[0]?.label ?? 'C-01'}) in the name.`,
    ),
    12,
    height - 8,
  )
  // Page 2: the checks.
  pdf.addPage('a4', 'portrait')
  const pageWidth = pdf.internal.pageSize.getWidth()
  setPdfBrandFont(pdf, fonts, true)
  pdf.setFontSize(12)
  pdf.text(pdfText(`${issue.label} checks | ${issue.roadName} | ${rev}`), 14, 16)
  let y = 24
  setPdfBrandFont(pdf, fonts)
  pdf.setFontSize(8)
  for (const check of issue.checks) {
    const lines: string[] = pdf.splitTextToSize(pdfText(check.question), pageWidth - 80)
    if (y + lines.length * 3.6 + 10 > 285) {
      pdf.addPage('a4', 'portrait')
      y = 16
    }
    setPdfBrandFont(pdf, fonts, true)
    pdf.text(pdfText(`${check.label}  ${FIELD_CHECK_KINDS[check.kind].label}`), 14, y)
    setPdfBrandFont(pdf, fonts)
    pdf.text(pdfText(check.station), 44, y)
    pdf.text(lines, 72, y)
    y += Math.max(1, lines.length) * 3.6 + 2
    pdf.setDrawColor(200)
    pdf.line(14, y, pageWidth - 14, y)
    y += 4
  }
  if (!issue.checks.length) pdf.text('No checks were listed for this issue.', 14, y)
  const pageHeightPt = height * MM_TO_PT
  const bytes = await addMapViewports(pdf.output('arraybuffer'), [
    {
      page: 0,
      bbox: [x * MM_TO_PT, pageHeightPt - (top + h) * MM_TO_PT, (x + w) * MM_TO_PT, pageHeightPt - top * MM_TO_PT],
      corners: capture.corners,
      wkt: WEB_MERCATOR_WKT,
      name: `${issue.label} ${issue.roadName}`,
    },
  ])
  return new Blob([bytes as BlobPart], { type: 'application/pdf' })
}
