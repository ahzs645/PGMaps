import { jsPDF } from 'jspdf'
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { ScoredBoundaryRegion, ScoreMetricDefinition, ScoreMethodSettings } from '../types'
import { formatAggregationMethod, formatNormalizationMethod } from '../components/scoreBuilderPanelUtils'

export interface PdfReportOptions {
  map: MapLibreMap | null
  title: string
  description: string
  equationPreview: string
  methodSettings: ScoreMethodSettings
  scoredRegions: ScoredBoundaryRegion[]
  metrics: ScoreMetricDefinition[]
  scoreSpread: { min: number; max: number; average: number }
}

const PAGE_MARGIN = 14
const TOP_REGION_ROWS = 30

/** Captures the map canvas inside a render frame (the GL buffer reads back blank otherwise). */
function captureMapImage(map: MapLibreMap): Promise<{ dataUrl: string; width: number; height: number } | null> {
  return new Promise((resolve) => {
    map.once('render', () => {
      try {
        const canvas = map.getCanvas()
        resolve({ dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height })
      } catch {
        resolve(null)
      }
    })
    map.triggerRepaint()
  })
}

export async function exportPdfReport({
  map,
  title,
  description,
  equationPreview,
  methodSettings,
  scoredRegions,
  metrics,
  scoreSpread,
}: PdfReportOptions): Promise<void> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const contentWidth = pageWidth - PAGE_MARGIN * 2
  let cursorY = PAGE_MARGIN

  // Header
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text(title, PAGE_MARGIN, cursorY + 4)
  cursorY += 9
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(110)
  doc.text(`PGMaps Index Lab report · ${new Date().toISOString().slice(0, 10)}`, PAGE_MARGIN, cursorY)
  cursorY += 6
  doc.setTextColor(40)
  const descriptionLines = doc.splitTextToSize(description, contentWidth)
  doc.text(descriptionLines, PAGE_MARGIN, cursorY)
  cursorY += descriptionLines.length * 4 + 3

  // Methodology block
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Methodology', PAGE_MARGIN, cursorY)
  cursorY += 5
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  const activeMetrics = metrics.length
  const methodLines = doc.splitTextToSize(
    [
      `Normalization: ${formatNormalizationMethod(methodSettings.normalization)}`,
      `Aggregation: ${formatAggregationMethod(methodSettings.aggregation)}`,
      `Missing data policy: ${methodSettings.missingData}`,
      `Active metrics: ${activeMetrics}`,
      `Score spread: ${scoreSpread.min.toFixed(1)} – ${scoreSpread.max.toFixed(1)} (average ${scoreSpread.average.toFixed(1)})`,
    ].join('\n'),
    contentWidth,
  )
  doc.text(methodLines, PAGE_MARGIN, cursorY)
  cursorY += methodLines.length * 4 + 3

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Equation', PAGE_MARGIN, cursorY)
  cursorY += 5
  doc.setFont('courier', 'normal')
  doc.setFontSize(8)
  const equationLines = doc.splitTextToSize(equationPreview, contentWidth)
  doc.text(equationLines, PAGE_MARGIN, cursorY)
  cursorY += equationLines.length * 3.6 + 4

  // Map snapshot
  if (map) {
    const image = await captureMapImage(map)
    if (image) {
      const imageHeight = Math.min(120, (image.height / image.width) * contentWidth)
      const pageHeight = doc.internal.pageSize.getHeight()
      if (cursorY + imageHeight > pageHeight - PAGE_MARGIN) {
        doc.addPage()
        cursorY = PAGE_MARGIN
      }
      doc.addImage(image.dataUrl, 'PNG', PAGE_MARGIN, cursorY, contentWidth, imageHeight)
      cursorY += imageHeight + 6
    }
  }

  // Rankings table
  doc.addPage()
  cursorY = PAGE_MARGIN
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text(`Top ${Math.min(TOP_REGION_ROWS, scoredRegions.length)} regions`, PAGE_MARGIN, cursorY)
  cursorY += 7

  const columns: Array<{ label: string; width: number; value: (region: ScoredBoundaryRegion) => string }> = [
    { label: 'Rank', width: 14, value: (region) => `#${region.rank}` },
    { label: 'Region', width: 74, value: (region) => region.region.name },
    { label: 'Code', width: 26, value: (region) => region.region.code },
    { label: 'Score', width: 18, value: (region) => region.score.toFixed(1) },
    {
      label: 'Score interval',
      width: 30,
      value: (region) => `${region.scoreInterval[0].toFixed(1)}–${region.scoreInterval[1].toFixed(1)}`,
    },
    { label: 'Confidence', width: 20, value: (region) => region.rankConfidence },
  ]

  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  let columnX = PAGE_MARGIN
  columns.forEach((column) => {
    doc.text(column.label, columnX, cursorY)
    columnX += column.width
  })
  cursorY += 2
  doc.setDrawColor(180)
  doc.line(PAGE_MARGIN, cursorY, pageWidth - PAGE_MARGIN, cursorY)
  cursorY += 4

  doc.setFont('helvetica', 'normal')
  const pageHeight = doc.internal.pageSize.getHeight()
  for (const region of scoredRegions.slice(0, TOP_REGION_ROWS)) {
    if (cursorY > pageHeight - PAGE_MARGIN) {
      doc.addPage()
      cursorY = PAGE_MARGIN
    }
    columnX = PAGE_MARGIN
    columns.forEach((column) => {
      const text = doc.splitTextToSize(column.value(region), column.width - 3)[0] ?? ''
      doc.text(text, columnX, cursorY)
      columnX += column.width
    })
    cursorY += 5
  }

  cursorY += 4
  if (cursorY > pageHeight - PAGE_MARGIN - 10) {
    doc.addPage()
    cursorY = PAGE_MARGIN
  }
  doc.setFontSize(7.5)
  doc.setTextColor(110)
  const footerLines = doc.splitTextToSize(
    'Generated by the PGMaps Index Lab. Scores are exploratory composites of public datasets; review the methodology and data caveats before policy use.',
    contentWidth,
  )
  doc.text(footerLines, PAGE_MARGIN, cursorY)

  doc.save('score-builder-report.pdf')
}
