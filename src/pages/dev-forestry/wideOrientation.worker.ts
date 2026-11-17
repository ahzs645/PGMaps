/// <reference lib="webworker" />
/** Runs `searchOrientation` off the page's thread: a full search takes seconds and would freeze the map. */
import { searchOrientation, type WideSearchInput } from './wideOrientation'

type Request = Omit<WideSearchInput, 'onProgress' | 'cancelled'>

self.onmessage = ({ data }: MessageEvent<Request>) => {
  try {
    const result = searchOrientation({
      ...data,
      onProgress: (done) => self.postMessage({ type: 'progress', done }),
    })
    self.postMessage({ type: 'done', result })
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
