/// <reference lib="webworker" />
/**
 * The own-photo tools' heavy work off the page's thread (`photoWork.ts`): terrain is loaded here from the page's own
 * tile cache, kept between jobs, and every result comes back as typed arrays, transferred.
 */
import { loadElevationGrid } from '@/lib/forestry/terrain/demLoader'
import { createPhotoWorkHost, type PhotoWorkRequest, type PhotoWorkResponse } from './photoWork'

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<PhotoWorkRequest>) => void) | null
  postMessage: (message: PhotoWorkResponse, transfer?: Transferable[]) => void
}

const handle = createPhotoWorkHost({
  // Not tied to one job's signal: a mosaic another job is waiting on, or the next nudge will want, is worth finishing.
  loadTerrain: async (range, onProgress) => (await loadElevationGrid({ range, concurrency: 4, onProgress })).grid,
  post: (message, transfer) => scope.postMessage(message, transfer ?? []),
})

scope.onmessage = ({ data }) => handle(data)
