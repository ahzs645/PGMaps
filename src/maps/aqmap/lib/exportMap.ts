import type maplibregl from 'maplibre-gl'

export type ExportFormat = 'png' | 'pngOverlay' | 'jpeg' | 'pdf'

interface ExportOptions {
  map: maplibregl.Map
  container: HTMLElement | null
  baseName?: string
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, base64] = dataUrl.split(',')
  const mimeMatch = meta.match(/data:(.*);base64/)
  const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream'
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new Blob([bytes], { type: mime })
}

async function waitForMapIdle(map: maplibregl.Map): Promise<void> {
  if (map.loaded() && !map.isMoving()) return
  await new Promise<void>((resolve) => {
    const handler = () => {
      map.off('idle', handler)
      resolve()
    }
    map.on('idle', handler)
    setTimeout(() => {
      map.off('idle', handler)
      resolve()
    }, 4000)
  })
}

async function captureMapCanvas(map: maplibregl.Map, mime: 'image/png' | 'image/jpeg'): Promise<string> {
  await waitForMapIdle(map)
  map.triggerRepaint()
  await new Promise((resolve) => requestAnimationFrame(resolve))
  const canvas = map.getCanvas()
  return canvas.toDataURL(mime, 0.92)
}

async function captureWithOverlays(container: HTMLElement, map: maplibregl.Map): Promise<string> {
  await waitForMapIdle(map)
  const html2canvasModule = await import('html2canvas')
  const html2canvas = html2canvasModule.default ?? html2canvasModule

  const canvas = await html2canvas(container, {
    useCORS: true,
    backgroundColor: null,
    logging: false,
    ignoreElements: (element) => element.tagName === 'CANVAS' && !(element as HTMLCanvasElement).classList.contains('maplibregl-canvas'),
  })
  return canvas.toDataURL('image/png')
}

function timestampedFilename(base: string, extension: string): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
  return `${base}_${stamp}.${extension}`
}

export async function exportAqmap(format: ExportFormat, options: ExportOptions): Promise<void> {
  const { map, container } = options
  const baseName = options.baseName ?? 'aqmap'

  if (format === 'png') {
    const dataUrl = await captureMapCanvas(map, 'image/png')
    downloadBlob(dataUrlToBlob(dataUrl), timestampedFilename(baseName, 'png'))
    return
  }

  if (format === 'jpeg') {
    const dataUrl = await captureMapCanvas(map, 'image/jpeg')
    downloadBlob(dataUrlToBlob(dataUrl), timestampedFilename(baseName, 'jpg'))
    return
  }

  if (format === 'pngOverlay') {
    if (!container) {
      const fallback = await captureMapCanvas(map, 'image/png')
      downloadBlob(dataUrlToBlob(fallback), timestampedFilename(baseName, 'png'))
      return
    }
    const dataUrl = await captureWithOverlays(container, map)
    downloadBlob(dataUrlToBlob(dataUrl), timestampedFilename(`${baseName}_overlay`, 'png'))
    return
  }

  if (format === 'pdf') {
    const dataUrl = container
      ? await captureWithOverlays(container, map)
      : await captureMapCanvas(map, 'image/png')

    const jsPdfModule = await import('jspdf')
    const JsPdfCtor = jsPdfModule.jsPDF ?? jsPdfModule.default
    const image = new Image()
    image.src = dataUrl
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Failed to load export image'))
    })

    const widthPx = image.naturalWidth
    const heightPx = image.naturalHeight
    const orientation = widthPx >= heightPx ? 'landscape' : 'portrait'
    const pdf = new JsPdfCtor({
      orientation,
      unit: 'pt',
      format: [widthPx, heightPx],
      compress: true,
    })
    pdf.addImage(dataUrl, 'PNG', 0, 0, widthPx, heightPx, undefined, 'FAST')
    pdf.save(timestampedFilename(baseName, 'pdf'))
    return
  }
}
