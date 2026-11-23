import Dexie, { type Table } from 'dexie'
import { z } from 'zod'
import { factSetSchema, parseFacts, parsePack, releaseKey, type Pack } from '../../../packages/legal-rules/src/contract'
import { emptyProject, periodYears, parseProject, type Project } from '../forest-patches/project'
import type { Zones } from './riparian'
import { defaults } from '../legal-workbench/registry'

export const caseSchema = z.object({
  selected: z.array(z.string()),
  date: z.string(),
  sets: z.record(z.string(), factSetSchema),
})
export type ReviewCase = z.infer<typeof caseSchema>
export interface Plan {
  format: 'pgmaps-block-plan/v1'
  project: Project
  view?: { selectedId: string; scenario: 'reference' | 'proposed' | 'alternative'; year: number }
  zones?: Zones
  reviews: Record<string, ReviewCase>
  packs: Pack[]
}
export function freshPlan(project = emptyProject()): Plan {
  return { format: 'pgmaps-block-plan/v1', project, reviews: {}, packs: [] }
}
export async function readPlan(raw: unknown): Promise<Plan> {
  const data = z.object({ format: z.string() }).parse(raw)
  const { prepareFootprints } = await import('../forest-patches/analysis')
  if (data.format === 'pgmaps-patches-v1') {
    const project = parseProject(raw)
    prepareFootprints(project)
    return freshPlan(project)
  }
  const parsed = z
    .object({
      format: z.literal('pgmaps-block-plan/v1'),
      project: z.unknown(),
      reviews: z.record(z.string(), caseSchema),
      view: z
        .object({
          selectedId: z.string(),
          scenario: z.enum(['reference', 'proposed', 'alternative']),
          year: z.number().int(),
        })
        .optional(),
      packs: z.array(z.unknown()),
      zones: z.object({ source: z.string(), layer: z.unknown() }).optional(),
    })
    .parse(raw)
  const project = parseProject(parsed.project)
  prepareFootprints(project)
  if (parsed.view && !periodYears(project.startYear).includes(parsed.view.year))
    throw Error('The saved map year is outside the project timeline.')
  const packs = parsed.packs.map(parsePack)
  const available = new Map([...defaults, ...packs].map((p) => [releaseKey(p), p]))
  for (const [key, review] of Object.entries(parsed.reviews)) {
    z.tuple([
      z.string().nullable(),
      z.enum(['reference', 'proposed', 'alternative']),
      z.number().int(),
      z.string(),
      z.string(),
    ]).parse(JSON.parse(key))
    for (const key of review.selected) if (!available.has(key)) throw Error('Missing release ' + key)
    for (const [key, set] of Object.entries(review.sets)) {
      const pack = available.get(key)
      if (!pack) throw Error('Missing release for saved evidence: ' + key)
      parseFacts(set, pack)
    }
  }
  const zones = parsed.zones && (await import('./riparian')).readZones(parsed.zones.layer, parsed.zones.source)
  return { format: parsed.format, project, reviews: parsed.reviews, view: parsed.view, packs, zones }
}

const db = new Dexie('pgmaps-block-planning') as Dexie & { plans: Table<Plan, string> }
db.version(1).stores({ plans: '' })
export const loadPlan = () => db.plans.get('current')
export const storePlan = (plan: Plan) => db.plans.put(plan, 'current')
