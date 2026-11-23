import Dexie, { type Table } from 'dexie'
import { keepStoragePersistent } from '@/lib/offline/persistentStorage'
import { openPlanFile, type Opened } from './migrate'
import type { Plan } from './plan'

/**
 * The plan open in this browser (`pgmaps-block-planning`, `work` in the storage catalogue). One
 * row, `current`. A row written by an earlier version opens through `openPlanFile`, with its notes.
 */
const db = new Dexie('pgmaps-block-planning') as Dexie & { plans: Table<unknown, string> }
db.version(1).stores({ plans: '' })

export async function loadStoredPlan(): Promise<Opened | null> {
  const raw = await db.plans.get('current')
  return raw === undefined ? null : openPlanFile(raw)
}

export async function storePlan(plan: Plan) {
  keepStoragePersistent()
  await db.plans.put(plan, 'current')
}
