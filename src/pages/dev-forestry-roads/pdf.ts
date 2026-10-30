import type { Map as MapLibreMap } from 'maplibre-gl'
import { downloadBlob } from '@/lib/download'

const text = (value: string) =>
  value.replace(/−/g, '-').replace(/[–—]/g, ' - ').replace(/→/g, ' to ').replace(/Σ/g, 'Sum ')

const MAP_IMAGE_STAGE_TIMEOUT_MS = 10000

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Map PDF preparation cancelled.', 'AbortError')
}

/** Bound asynchronous export stages and consume late completion/rejection after cancellation. */
function withinExportBudget<T>(start: () => Promise<T>, signal: AbortSignal | undefined, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (success: boolean, value: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', aborted)
      if (success) resolve(value as T)
      else reject(value)
    }
    const aborted = () => finish(false, new DOMException('Map PDF preparation cancelled.', 'AbortError'))
    const timer = setTimeout(() => finish(false, Error(message)), MAP_IMAGE_STAGE_TIMEOUT_MS)
    if (signal?.aborted) {
      aborted()
      return
    }
    signal?.addEventListener('abort', aborted, { once: true })
    try {
      start().then(
        (value) => finish(true, value),
        (error: unknown) => finish(false, error),
      )
    } catch (error) {
      finish(false, error)
    }
  })
}

/** Read WebGL once, inside render, before its drawing buffer is discarded. */
async function mapImage(map: MapLibreMap, signal?: AbortSignal) {
  let capture = () => {}
  let removed = () => {}
  const image = await withinExportBudget(
    () =>
      new Promise<string>((resolve, reject) => {
        capture = () => {
          try {
            resolve(map.getCanvas().toDataURL('image/png'))
          } catch (error) {
            reject(error)
          }
        }
        removed = () => reject(Error('The map closed before its image could be prepared.'))
        map.once('render', capture)
        map.once('remove', removed)
        map.triggerRepaint()
      }),
    signal,
    'The map did not finish rendering. Try the export again.',
  ).finally(() => {
    map.off('render', capture)
    map.off('remove', removed)
  })
  throwIfAborted(signal)
  const container = map.getContainer()
  const original = map.getCanvas()
  const bounds = container.getBoundingClientRect()
  const width = Math.ceil(bounds.width),
    height = Math.ceil(bounds.height)
  const canvas = document.createElement('canvas')
  canvas.width = width * 2
  canvas.height = height * 2
  // Composition is immediately encoded. A CPU-backed canvas avoids another GPU readback.
  if (!canvas.getContext('2d', { willReadFrequently: true })) throw Error('This browser cannot create a map image.')
  const existingFrames = new Set(document.querySelectorAll<HTMLIFrameElement>('iframe.html2canvas-container'))
  const ownedFrames = new Set<HTMLIFrameElement>()
  let active = true
  try {
    await withinExportBudget(
      async () => {
        const { default: html2canvas } = await import('html2canvas')
        if (!active) throw new DOMException('Map PDF preparation cancelled.', 'AbortError')
        throwIfAborted(signal)
        const composition = html2canvas(container, {
          canvas,
          width,
          height,
          backgroundColor: '#ffffff',
          useCORS: true,
          scale: 2,
          logging: false,
          imageTimeout: MAP_IMAGE_STAGE_TIMEOUT_MS,
          ignoreElements: (element) => {
            // DocumentCloner reads canvases before onclone. Skip the live map now;
            // the captured image is inserted below without changing overlay z-order.
            if (element === original) return true
            if (element.tagName === 'CANVAS' && !container.contains(element)) return true
            if (element.hasAttribute('data-map-export-ignore') || element.tagName === 'BUTTON') return true
            if (
              element.getAttribute('data-testid') === 'road-terrain-legend' &&
              !element.querySelector('[aria-expanded="true"]')
            )
              return true
            return !!element.querySelector(':scope > button[aria-label="Zoom in"]')
          },
          onclone: async (clonedDocument, clonedMap) => {
            if (!active) throw new DOMException('Map PDF preparation cancelled.', 'AbortError')
            throwIfAborted(signal)
            const frame = clonedDocument.defaultView?.frameElement
            if (frame) ownedFrames.add(frame as HTMLIFrameElement)
            const host = clonedMap.querySelector('.maplibregl-canvas-container')
            if (!host) throw Error('The map image could not be placed in the export.')
            const replacement = clonedDocument.createElement('img')
            replacement.className = original.className
            replacement.src = image
            replacement.style.cssText = original.style.cssText
            replacement.style.width = `${original.clientWidth}px`
            replacement.style.height = `${original.clientHeight}px`
            // MapLibre places its canvas first; markers follow and remain above it.
            host.prepend(replacement)
            await replacement.decode()
            if (!active) throw new DOMException('Map PDF preparation cancelled.', 'AbortError')
            throwIfAborted(signal)
          },
        })
        // html2canvas attaches its iframe synchronously before awaiting fonts/images.
        // Track it here as well so a timeout before onclone cannot leave a hidden clone.
        for (const frame of document.querySelectorAll<HTMLIFrameElement>('iframe.html2canvas-container'))
          if (!existingFrames.has(frame)) ownedFrames.add(frame)
        await composition
      },
      signal,
      'The map image could not be prepared in time. Try the export again.',
    )
    throwIfAborted(signal)
    return { image: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height }
  } finally {
    active = false
    for (const frame of ownedFrames) frame.remove()
    canvas.width = 0
    canvas.height = 0
  }
}

export async function exportMapPdf(
  map: MapLibreMap,
  name: string,
  terrain: string,
  datum: string,
  filename: string,
  signal?: AbortSignal,
) {
  throwIfAborted(signal)
  if (map.getCanvas().clientWidth < 1 || map.getCanvas().clientHeight < 1)
    throw Error('Show the plan panel before exporting its map.')
  const [{ jsPDF }, capture] = await Promise.all([import('jspdf'), mapImage(map, signal)])
  throwIfAborted(signal)
  const pdf = new jsPDF({
    orientation: capture.width >= capture.height ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  })
  const width = pdf.internal.pageSize.getWidth(),
    height = pdf.internal.pageSize.getHeight()
  pdf.setFontSize(16)
  const title: string[] = pdf.splitTextToSize(text(name), width - 24)
  pdf.text(title, 12, 18)
  pdf.setFontSize(8)
  const metadata: string[] = pdf.splitTextToSize(text(`${terrain} | ${datum}`), width - 24)
  const metadataY = 18 + title.length * 7
  pdf.text(metadata, 12, metadataY)
  const imageY = metadataY + metadata.length * 4 + 5
  const scale = Math.min((width - 24) / capture.width, (height - imageY - 22) / capture.height)
  const w = capture.width * scale,
    h = capture.height * scale
  pdf.addImage(capture.image, 'PNG', (width - w) / 2, imageY, w, h)
  const attribution = [
    ...new Set(
      Object.values(map.getStyle().sources).flatMap((source) =>
        'attribution' in source && source.attribution
          ? [new DOMParser().parseFromString(source.attribution, 'text/html').body.textContent?.trim() ?? '']
          : [],
      ),
    ),
  ].join(' | ')
  if (attribution) {
    pdf.setFontSize(6)
    pdf.text(attribution, 12, height - 14, { maxWidth: width - 24 })
  }
  pdf.setFontSize(7)
  pdf.text('Current plan view | Preliminary planning - not for construction', 12, height - 8)
  throwIfAborted(signal)
  downloadBlob(pdf.output('blob'), filename)
}

async function svgImage(element: Element) {
  const svg = element.cloneNode(true) as Element
  const dimensions = (svg.getAttribute('viewBox') ?? '0 0 960 270').split(/\s+/).map(Number)
  const width = dimensions[2],
    height = dimensions[3]
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  svg.setAttribute('width', String(width * 2))
  svg.setAttribute('height', String(height * 2))
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }))
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = width * 2
    canvas.height = height * 2
    // This offscreen canvas is read back immediately. Keep it CPU-backed so
    // report rasterization does not wait on the live map's WebGL render queue.
    const context = canvas.getContext('2d', { willReadFrequently: true })!
    context.fillStyle = 'white'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0)
    return { image: canvas.toDataURL('image/png'), ratio: height / width }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** The existing report is the content contract; write its text/tables as paginated PDF text. */
export async function exportReportPdf(html: string, filename: string) {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
  const document = new DOMParser().parseFromString(html, 'text/html')
  const margin = 14,
    width = 182,
    bottom = 280
  let y = margin
  const page = () => {
    pdf.addPage()
    y = margin
  }
  const ensure = (height: number) => {
    if (y + height > bottom) page()
  }
  const paragraph = (value: string, size = 9, bold = false) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal')
    pdf.setFontSize(size)
    pdf.setTextColor(35)
    const lines: string[] = pdf.splitTextToSize(text(value.trim()), width)
    const lineHeight = size * 0.43
    for (const line of lines) {
      ensure(lineHeight)
      pdf.text(line, margin, y + lineHeight)
      y += lineHeight
    }
    y += 3
  }
  const table = (element: Element) => {
    const rows = [...element.querySelectorAll('tr')].map((row) =>
      [...row.querySelectorAll('th,td')].map((cell) => text(cell.textContent ?? '')),
    )
    if (!rows.length) return
    const columns = Math.max(...rows.map((row) => row.length))
    const widths = Array.from({ length: columns }, (_, i) =>
      columns >= 6 ? (i === columns - 1 ? width * 0.3 : (width * 0.7) / (columns - 1)) : width / columns,
    )
    const draw = (row: string[], heading: boolean, offset = 0, limit = Infinity) => {
      pdf.setFont('helvetica', heading ? 'bold' : 'normal')
      pdf.setFontSize(7)
      const cells: string[][] = row.map((cell, i) =>
        pdf.splitTextToSize(cell, widths[i] - 3).slice(offset, offset + limit),
      )
      const lines = Math.max(...cells.map((cell) => cell.length), 1)
      const height = lines * 3.1 + 3
      let x = margin
      if (heading) {
        pdf.setFillColor(238, 242, 245)
        pdf.rect(margin, y, width, height, 'F')
      }
      for (let i = 0; i < columns; i++) {
        pdf.text(cells[i] ?? [''], x + 1.5, y + 3.5)
        x += widths[i]
      }
      pdf.setDrawColor(210)
      pdf.line(margin, y + height, margin + width, y + height)
      y += height
    }
    const heading = rows[0]
    ensure(18)
    draw(heading, true)
    for (const row of rows.slice(1)) {
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(7)
      const lines = Math.max(...row.map((cell, i) => pdf.splitTextToSize(cell, widths[i] - 3).length), 1)
      const height = lines * 3.1 + 3
      if (y + height > bottom && height < bottom - margin - 20) {
        page()
        draw(heading, true)
      }
      for (let offset = 0; offset < lines; ) {
        let available = Math.floor((bottom - y - 3) / 3.1)
        if (available < 1) {
          page()
          draw(heading, true)
          available = Math.floor((bottom - y - 3) / 3.1)
        }
        const count = Math.min(available, lines - offset)
        draw(row, false, offset, count)
        offset += count
        if (offset < lines) {
          page()
          draw(heading, true)
        }
      }
    }
    y += 5
  }
  const render = async (element: Element): Promise<void> => {
    const tag = element.tagName.toLowerCase()
    const inlineText = () =>
      [...element.childNodes]
        .map((node) => node.textContent?.trim())
        .filter(Boolean)
        .join(' ')
    if (/^h[123]$/.test(tag)) {
      ensure(22)
      paragraph(element.textContent ?? '', tag === 'h1' ? 18 : 12, true)
    } else if (tag === 'p' || tag === 'li') paragraph((tag === 'li' ? '- ' : '') + inlineText())
    else if (tag === 'dl') {
      let label = ''
      for (const item of element.children) {
        if (item.tagName.toLowerCase() === 'dt') label = item.textContent ?? ''
        else if (item.tagName.toLowerCase() === 'dd') paragraph(`${label}: ${item.textContent ?? ''}`)
      }
    } else if (tag === 'table') table(element)
    else if (tag === 'svg') {
      const image = await svgImage(element),
        height = width * image.ratio
      ensure(height + 4)
      pdf.addImage(image.image, 'PNG', margin, y, width, height)
      y += height + 4
    } else if (element.classList.contains('sections')) {
      const sections = [...element.querySelectorAll('svg')]
      for (let i = 0; i < sections.length; i += 2) {
        const images = await Promise.all(sections.slice(i, i + 2).map(svgImage))
        const w = (width - 6) / 2,
          height = Math.max(...images.map((image) => w * image.ratio))
        ensure(height + 5)
        images.forEach((image, j) => pdf.addImage(image.image, 'PNG', margin + j * (w + 6), y, w, w * image.ratio))
        y += height + 5
      }
    } else if (
      element.textContent?.trim() &&
      ![...element.children].some((child) => /^(div|section|figure|p|h[1-6]|table|svg|ul|ol|dl)$/i.test(child.tagName))
    )
      paragraph(inlineText())
    else for (const child of element.children) await render(child)
  }
  for (const child of document.body.children) await render(child)
  const count = pdf.getNumberOfPages()
  for (let n = 1; n <= count; n++) {
    pdf.setPage(n)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7)
    pdf.setTextColor(100)
    pdf.text(`Preliminary planning | ${n} / ${count}`, margin, 290)
  }
  downloadBlob(pdf.output('blob'), filename)
}
