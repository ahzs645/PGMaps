import type { ForestryScene } from './scene'
import Dexie, { type Table } from 'dexie'
import { emptyTools, parseTools, type ToolsDocument } from './assessmentTools'

class ToolsDatabase extends Dexie {
  documents!: Table<{ id: string; document: ToolsDocument }, string>
  scenes!: Table<{ id: string; scene: ForestryScene }, string>
  constructor() {
    super('pgmaps.forestry-assessment-tools.v1')
    this.version(1).stores({ documents: 'id' })
    this.version(2).stores({ documents: 'id', scenes: 'id' })
  }
}
const db = new ToolsDatabase()
export async function loadTools() {
  const saved = await db.documents.get('workspace')
  return saved ? parseTools(saved.document) : emptyTools()
}
export async function saveTools(document: ToolsDocument) {
  await db.documents.put({ id: 'workspace', document })
}

export async function loadCurrentScene() {
  return (await db.scenes.get('current'))?.scene ?? null
}
export async function saveCurrentScene(scene: ForestryScene) {
  await db.scenes.put({ id: 'current', scene })
}
