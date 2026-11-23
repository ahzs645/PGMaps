import { analyze } from './analysis'
self.onmessage = ({ data }: MessageEvent<Parameters<typeof analyze>>) => {
  try {
    self.postMessage({ result: analyze(...data) })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Patch analysis failed.' })
  }
}
