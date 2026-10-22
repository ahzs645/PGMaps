import type { Map as MapLibreMap } from 'maplibre-gl'
import { captureMapImage } from '@/lib/mapImageCapture'
import {
  checkedMapImageOptions,
  fitImageRect,
  imageScaleBar,
  mapImageLegends,
  type MapImageLegend,
  type MapImageOptions,
} from './mapImage'
import type { Workspace } from './workspace'

type ReadyLegend = MapImageLegend & { image?: ImageBitmap; error?: string }
export type ComposedMapImage = {
  blob: Blob
  width: number
  height: number
  sourceWidth: number
  sourceHeight: number
  warnings: string[]
}

function wrapText(context: CanvasRenderingContext2D, text: string, width: number): string[] {
  if (!text) return []
  const lines: string[] = []
  let line = ''
  for (const word of text.replace(/\s+/g, ' ').trim().split(' ')) {
    if (context.measureText(line ? `${line} ${word}` : word).width <= width) {
      line = line ? `${line} ${word}` : word
      continue
    }
    if (line) lines.push(line)
    line = ''
    for (const character of word) {
      if (line && context.measureText(line + character).width > width) {
        lines.push(line)
        line = ''
      }
      line += character
    }
  }
  if (line) lines.push(line)
  return lines
}

async function legendImage(url: string, signal: AbortSignal): Promise<ImageBitmap> {
  const response = await fetch(url, { signal, credentials: 'omit', mode: 'cors' })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? ''
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mime))
    throw new Error('No raster legend returned')
  const limit = 2 * 1024 * 1024
  if (Number(response.headers.get('content-length')) > limit) throw new Error('Legend exceeds 2 MiB')
  if (!response.body) throw new Error('No legend image body')
  const reader = response.body.getReader()
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > limit) throw new Error('Legend exceeds 2 MiB')
      chunks.push(new Uint8Array(value))
    }
  } catch (reason) {
    await reader.cancel().catch(() => undefined)
    throw reason
  } finally {
    reader.releaseLock()
  }
  const image = await createImageBitmap(new Blob(chunks, { type: mime }))
  if (image.width > 8192 || image.height > 8192 || image.width * image.height > 16_777_216) {
    image.close()
    throw new Error('Legend dimensions exceed the image limit')
  }
  return image
}

async function prepareLegends(legends: MapImageLegend[], signal: AbortSignal): Promise<ReadyLegend[]> {
  const result: ReadyLegend[] = legends.map((item) => ({ ...item }))
  let next = 0
  // Four bounded image requests at a time; each failed legend remains labelled in the output.
  await Promise.all(
    Array.from({ length: Math.min(4, result.length) }, async () => {
      while (next < result.length && !signal.aborted) {
        const item = result[next++]
        if (!item.imageUrl) continue
        const controller = new AbortController()
        const abort = () => controller.abort()
        signal.addEventListener('abort', abort, { once: true })
        const timeout = setTimeout(abort, 8000)
        try {
          item.image = await legendImage(item.imageUrl, controller.signal)
        } catch (reason) {
          item.error = reason instanceof Error ? reason.message : 'Legend unavailable'
        } finally {
          clearTimeout(timeout)
          signal.removeEventListener('abort', abort)
        }
      }
    }),
  )
  if (signal.aborted) {
    result.forEach((item) => item.image?.close())
    throw new DOMException('Map image preparation cancelled.', 'AbortError')
  }
  return result
}

function drawSymbol(
  context: CanvasRenderingContext2D,
  legend: MapImageLegend,
  row: MapImageLegend['rows'][number],
  x: number,
  y: number,
  unit: number,
) {
  context.save()
  context.strokeStyle = row.symbol?.strokeColor ?? row.color
  context.fillStyle = row.symbol?.fillColor ?? row.color
  const strokeWidth = row.symbol?.strokeWidth ?? legend.lineWidth
  legend.symbols.forEach((symbol, index) => {
    context.lineWidth = Math.min(4, Math.max(0.5, strokeWidth)) * unit
    const left = x + index * 17 * unit
    if (symbol === 'polygon') {
      context.globalAlpha = row.symbol?.fillOpacity ?? legend.fillOpacity
      context.fillRect(left, y + 2 * unit, 13 * unit, 10 * unit)
      context.globalAlpha = row.symbol?.strokeOpacity ?? legend.lineOpacity
      if (strokeWidth > 0) context.strokeRect(left, y + 2 * unit, 13 * unit, 10 * unit)
    } else if (symbol === 'line') {
      context.globalAlpha = row.symbol?.strokeOpacity ?? legend.lineOpacity
      context.beginPath()
      context.moveTo(left, y + 12 * unit)
      context.lineTo(left + 13 * unit, y + 2 * unit)
      if (strokeWidth > 0) context.stroke()
    } else {
      context.globalAlpha = row.symbol?.pointOpacity ?? 1
      context.beginPath()
      context.arc(
        left + 7 * unit,
        y + 7 * unit,
        (row.symbol ? Math.min(6, row.symbol.pointRadius) : 5) * unit,
        0,
        Math.PI * 2,
      )
      context.fill()
      if (row.symbol && row.symbol.pointStrokeWidth > 0) {
        context.globalAlpha = row.symbol.strokeOpacity
        context.lineWidth = Math.min(4, row.symbol.pointStrokeWidth) * unit
        context.stroke()
      }
    }
  })
  context.restore()
}

/** Compose a copy of the rendered map; never resize the map, change its camera or alter its layers. */
export async function composeMapImage(
  map: MapLibreMap,
  workspace: Workspace,
  input: MapImageOptions,
  signal: AbortSignal,
): Promise<ComposedMapImage> {
  const options = checkedMapImageOptions(input)
  const entries = options.legend ? mapImageLegends(workspace) : []
  const unit = Math.max(1, Math.min(2, options.width / 800, options.height / 600))
  if (entries.length * 32 * unit * options.legendScale > options.height - 60 * unit)
    throw new Error(
      'The visible layer legend will not fit. Increase image height, reduce legend scale, or turn off the legend.',
    )
  const captured = await captureMapImage(map, signal)
  const legends = await prepareLegends(entries, signal)
  const warnings = legends
    .filter((item) => item.error)
    .map((item) => `${item.title}: service legend unavailable (${item.error}).`)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = options.width
    canvas.height = options.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('This browser cannot compose a map image.')
    const margin = 14 * unit
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, options.width, options.height)
    context.textBaseline = 'top'
    context.font = `600 ${20 * unit}px system-ui, sans-serif`
    const titleLines = wrapText(context, options.title, options.width - margin * 2)
    const header = titleLines.length ? titleLines.length * 25 * unit + margin * 2 : 0
    context.font = `${10 * unit}px system-ui, sans-serif`
    const attribution = options.attribution
      ? [options.attributionText, captured.attribution].filter(Boolean).join(' · ')
      : ''
    const creditLines = wrapText(context, attribution, options.width - margin * 2)
    const footer = creditLines.length ? creditLines.length * 13 * unit + margin : 0
    const body = {
      x: margin,
      y: header || margin,
      width: options.width - margin * 2,
      height: options.height - (header || margin) - footer - margin,
    }
    const legendWidth = legends.length ? Math.min(210 * unit * options.legendScale, body.width * 0.4) : 0
    const gap = legends.length ? 12 * unit : 0
    const mapArea = { ...body, width: body.width - legendWidth - gap }
    if (mapArea.width < 80 || mapArea.height < 100)
      throw new Error(
        'Title, credits and legend leave too little room for the map. Increase image size or shorten the text.',
      )
    const mapRect = fitImageRect(captured.cssWidth, captured.cssHeight, mapArea)
    context.fillStyle = '#f1f5f9'
    context.fillRect(mapArea.x, mapArea.y, mapArea.width, mapArea.height)
    context.drawImage(captured.canvas, mapRect.x, mapRect.y, mapRect.width, mapRect.height)
    context.strokeStyle = '#cbd5e1'
    context.lineWidth = 1
    context.strokeRect(mapRect.x, mapRect.y, mapRect.width, mapRect.height)
    if (mapRect.width > captured.canvas.width || mapRect.height > captured.canvas.height)
      warnings.push(
        'The map image is enlarged from the current screen resolution; a larger output does not add geographic detail.',
      )
    if (captured.pitch > 0 && options.scaleBar)
      warnings.push(
        captured.pitch > 60
          ? 'Scale bar omitted above 60° map pitch.'
          : 'At this map pitch, the scale bar describes distances at the map centre.',
      )
    if (options.scaleBar) {
      const bar = imageScaleBar(
        captured.metersPerCssPixel,
        captured.cssWidth,
        mapRect.width,
        captured.pitch,
        Math.min((options.scaleDistanceKm === null ? 140 : 300) * unit, mapRect.width - 28 * unit),
        options.scaleDistanceKm,
      )
      if (bar) {
        const x = mapRect.x + 10 * unit
        const y = mapRect.y + mapRect.height - 12 * unit
        context.fillStyle = '#ffffffed'
        context.fillRect(x - 4 * unit, y - 22 * unit, Math.max(bar.pixels + 8 * unit, 80 * unit), 29 * unit)
        context.strokeStyle = '#0f172a'
        context.lineWidth = 2 * unit
        context.beginPath()
        context.moveTo(x, y - 6 * unit)
        context.lineTo(x, y)
        context.lineTo(x + bar.pixels, y)
        context.lineTo(x + bar.pixels, y - 6 * unit)
        context.stroke()
        context.fillStyle = '#0f172a'
        context.font = `${10 * unit}px system-ui, sans-serif`
        context.fillText(`${bar.label}${captured.pitch > 0 ? ' · centre' : ''}`, x, y - 20 * unit)
      }
    }
    if (options.northArrow) {
      const x = mapRect.x + mapRect.width - 34 * unit
      const y = mapRect.y + 35 * unit
      context.save()
      context.translate(x, y)
      context.fillStyle = '#ffffffed'
      context.beginPath()
      context.arc(0, 0, 27 * unit, 0, Math.PI * 2)
      context.fill()
      context.rotate(captured.northAngle)
      context.fillStyle = '#0f172a'
      context.strokeStyle = '#0f172a'
      context.lineWidth = unit
      context.beginPath()
      context.moveTo(0, -15 * unit)
      context.lineTo(6 * unit, 12 * unit)
      context.lineTo(0, 8 * unit)
      context.lineTo(-6 * unit, 12 * unit)
      context.closePath()
      context.fill()
      if (options.northArrowStyle === 'compass') {
        context.beginPath()
        context.moveTo(-15 * unit, 0)
        context.lineTo(15 * unit, 0)
        context.moveTo(0, 8 * unit)
        context.lineTo(0, 17 * unit)
        context.stroke()
      }
      context.restore()
      context.textAlign = 'center'
      context.fillStyle = '#0f172a'
      context.font = `700 ${11 * unit}px system-ui, sans-serif`
      context.fillText(
        'N',
        x + Math.sin(captured.northAngle) * 22 * unit,
        y - Math.cos(captured.northAngle) * 22 * unit - 5 * unit,
      )
      context.textAlign = 'left'
    }
    context.fillStyle = '#0f172a'
    context.font = `600 ${20 * unit}px system-ui, sans-serif`
    titleLines.forEach((line, index) => context.fillText(line, margin, margin + index * 25 * unit))
    context.fillStyle = '#334155'
    context.font = `${10 * unit}px system-ui, sans-serif`
    creditLines.forEach((line, index) => context.fillText(line, margin, options.height - footer + index * 13 * unit))

    const legendUnit = unit * options.legendScale
    const legendX = body.x + body.width - legendWidth
    let cursor = body.y
    const textLines = (text: string, width: number, bold = false) => {
      context.font = `${bold ? '600 ' : ''}${12 * legendUnit}px system-ui, sans-serif`
      return wrapText(context, text, width)
    }
    const drawText = (lines: string[], x: number) => {
      if (cursor + lines.length * 16 * legendUnit > body.y + body.height)
        throw new Error(
          'The full legend does not fit. Increase image height, reduce legend scale, or turn off the legend.',
        )
      context.fillStyle = '#0f172a'
      lines.forEach((line, index) => context.fillText(line, x, cursor + index * 16 * legendUnit))
      cursor += lines.length * 16 * legendUnit
    }
    for (const entry of legends) {
      drawText(textLines(entry.title, legendWidth, true), legendX)
      cursor += 4 * legendUnit
      if (entry.gradient) {
        const stops = entry.gradient.stops
        const first = stops[0].value,
          last = stops[stops.length - 1].value
        drawText(
          textLines(entry.gradient.property + ' · ' + entry.gradient.channel + ' gradient', legendWidth),
          legendX,
        )
        if (cursor + 20 * legendUnit > body.y + body.height)
          throw new Error('The gradient legend does not fit. Increase image height or reduce legend scale.')
        const gradient = context.createLinearGradient(legendX, 0, legendX + legendWidth, 0)
        for (const stop of stops) gradient.addColorStop((stop.value - first) / (last - first), stop.color)
        context.fillStyle = gradient
        context.fillRect(legendX, cursor + 3 * legendUnit, legendWidth, 10 * legendUnit)
        cursor += 20 * legendUnit
        drawText(textLines('Stops: ' + stops.map((stop) => String(stop.value)).join(' · '), legendWidth), legendX)
        cursor += 4 * legendUnit
      }
      for (const row of entry.rows) {
        const symbolWidth = entry.symbols.length * 17 * legendUnit + 5 * legendUnit
        const lines = textLines(row.label || ' ', Math.max(12, legendWidth - symbolWidth))
        const y = cursor
        drawText(lines.length ? lines : [''], legendX + symbolWidth)
        drawSymbol(context, entry, row, legendX, y, legendUnit)
      }
      if (entry.image) {
        const imageScale = Math.min(legendUnit, legendWidth / entry.image.width)
        const height = entry.image.height * imageScale
        if (cursor + height > body.y + body.height)
          throw new Error(
            'A service legend does not fit. Increase image height, reduce legend scale, or turn off the legend.',
          )
        context.drawImage(entry.image, legendX, cursor, entry.image.width * imageScale, height)
        cursor += height
      } else if (entry.imageUrl) {
        drawText(textLines('Service legend unavailable', legendWidth), legendX)
      }
      cursor += 12 * legendUnit
    }
    if (signal.aborted) throw new DOMException('Map image preparation cancelled.', 'AbortError')
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('The browser could not encode the PNG image.'))),
        'image/png',
      ),
    )
    return {
      blob,
      width: options.width,
      height: options.height,
      sourceWidth: captured.canvas.width,
      sourceHeight: captured.canvas.height,
      warnings,
    }
  } catch (reason) {
    if (reason instanceof DOMException && reason.name === 'SecurityError')
      throw new Error('A map or legend provider blocks PNG export. Hide that layer and retry.')
    throw reason
  } finally {
    legends.forEach((item) => item.image?.close())
  }
}
