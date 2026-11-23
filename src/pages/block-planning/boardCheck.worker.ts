import { boardCheck } from './boardCheck'
import type { Plan } from './plan'

/** The Board check runs the patch calculation twice over the whole baseline: off the page's thread. */
self.onmessage = ({ data }: MessageEvent<{ plan: Plan }>) => {
  try {
    self.postMessage({ result: boardCheck(data.plan) })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'The check could not be run.' })
  }
}
