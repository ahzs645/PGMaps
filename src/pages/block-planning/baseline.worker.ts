import { readBaseline, type BaselineSource } from './baselineImport'
import { readOrderUnit } from './orderUnits'
import type { Shape } from './plan'

type Ask =
  | {
      kind: 'baseline'
      unit: Shape
      sources: BaselineSource[]
      earliestYear: number
      readOn: string
      marginMetres: number
    }
  | { kind: 'unit'; district: string; ndu: string; readOn: string }

/** DataBC reads and clipping off the page's thread, reporting progress as they go. */
self.onmessage = async ({ data }: MessageEvent<Ask>) => {
  const fetchFn = (url: string, init?: { signal?: AbortSignal }) => fetch(url, init)
  try {
    if (data.kind === 'unit') {
      self.postMessage({ progress: `Reading the order’s units for ${data.district} · ${data.ndu}…` })
      self.postMessage({ unit: await readOrderUnit({ ...data, fetch: fetchFn }) })
      return
    }
    const result = await readBaseline({
      ...data,
      fetch: fetchFn,
      onProgress: (message) => self.postMessage({ progress: message }),
    })
    self.postMessage({ result })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'DataBC could not be read.' })
  }
}
