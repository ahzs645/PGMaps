import { PDF_LIMITS, type PdfImport } from './types'

export function importGeoPdf(
  file: File,
  path: string,
  limits: { maxFeatures: number; maxVertices: number },
  signal?: AbortSignal,
): Promise<PdfImport> {
  signal?.throwIfAborted()
  if (file.size > PDF_LIMITS.bytes) throw Error(`${file.name} is over 64 MB. Import a smaller PDF sheet.`)
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./geoPdf.worker.ts', import.meta.url), { type: 'module' })
    const close = () => {
      signal?.removeEventListener('abort', abort)
      worker.terminate()
    }
    const abort = () => {
      close()
      reject(signal?.reason ?? new DOMException('Import cancelled.', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    worker.onerror = () => {
      close()
      reject(Error('The PDF reader could not run. Retry in a browser supporting module workers and OffscreenCanvas.'))
    }
    worker.onmessage = ({ data }: MessageEvent<{ type?: string; result?: PdfImport; error?: string }>) => {
      // PDF.js can emit its own worker-ready protocol message before our result.
      if (data.type !== 'geopdf-result') return
      close()
      if (data.result) resolve(data.result)
      else reject(Error(data.error ?? 'Could not read this PDF.'))
    }
    worker.postMessage({ file, path, ...limits })
  })
}
