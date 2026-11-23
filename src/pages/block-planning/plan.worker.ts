import { analyzePlan } from './planAnalysis'
import { footprintName, type Plan } from './plan'

/** Runs every schedule's patch calculation off the page's thread. */
self.onmessage = ({ data }: MessageEvent<{ plan: Plan; shown: { schedule: string; year: number } }>) => {
  try {
    self.postMessage({ result: analyzePlan(data.plan, data.shown) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The patch calculation failed.'
    // The engine names footprints by their internal ids; give the planner the names they chose.
    self.postMessage({ error: message.replace(/\b[db]:[\w-]+/g, (id) => `“${footprintName(data.plan, id)}”`) })
  }
}
