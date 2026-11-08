import { parseProject, serializeProject, type GeoreferenceProject, type GeoreferenceSource } from './model'

export const LEGACY_DRAFT_KEY = 'pgmaps-georeference-draft-v1'
const DRAFT_PREFIX = 'pgmaps-georeference-draft-v2:'
const DRAFT_SCHEMA = 'pgmaps-georeference-local-draft-v2'
type DraftStorage = Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>

export type LocalDraft = {
  key: string
  project: GeoreferenceProject
  savedAt: string | null
  /** The exact stored revision, used to avoid replacing a draft changed in another tab. */
  revision: string
}

/** A map ID alone cannot distinguish an original scan from a later rectified pixel grid. */
export function draftKey(source: GeoreferenceSource): string {
  return (
    DRAFT_PREFIX +
    encodeURIComponent(
      JSON.stringify([
        source.id,
        source.sha256 || source.url,
        source.width,
        source.height,
        source.frame.kind,
        source.frame.crs || '',
      ]),
    )
  )
}

function parseDraft(key: string, raw: string): LocalDraft {
  if (key === LEGACY_DRAFT_KEY) return { key, project: parseProject(raw), savedAt: null, revision: raw }
  const value = JSON.parse(raw) as Record<string, unknown>
  if (value.schema !== DRAFT_SCHEMA || typeof value.savedAt !== 'string' || !Number.isFinite(Date.parse(value.savedAt)))
    throw Error('The saved local draft is not valid.')
  const project = parseProject(value.project)
  if (draftKey(project.source) !== key) throw Error('The saved local draft does not match its source identity.')
  return { key, project, savedAt: value.savedAt, revision: raw }
}

export function readLocalDraft(storage: DraftStorage, key: string): LocalDraft | null {
  const raw = storage.getItem(key)
  return raw === null ? null : parseDraft(key, raw)
}

/** Missing or corrupt entries never hide other maps' recoverable work. */
export function listLocalDrafts(storage: DraftStorage): { drafts: LocalDraft[]; invalidCount: number } {
  const drafts: LocalDraft[] = []
  let invalidCount = 0
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (!key || (key !== LEGACY_DRAFT_KEY && !key.startsWith(DRAFT_PREFIX))) continue
    try {
      const saved = readLocalDraft(storage, key)
      if (saved) drafts.push(saved)
    } catch {
      invalidCount++
    }
  }
  drafts.sort(
    (a, b) =>
      (b.savedAt || '').localeCompare(a.savedAt || '') || a.project.source.id.localeCompare(b.project.source.id),
  )
  return { drafts, invalidCount }
}

export function saveLocalDraft(
  storage: DraftStorage,
  project: GeoreferenceProject,
  expectedRevision: string | null,
  now = new Date(),
): LocalDraft {
  const canonical = parseProject(project)
  const key = draftKey(canonical.source)
  const current = storage.getItem(key)
  if (current !== expectedRevision)
    throw Error(
      'A saved local draft already exists or changed in another tab. Resume that draft, or download these edits before switching maps.',
    )
  const raw = JSON.stringify({ schema: DRAFT_SCHEMA, savedAt: now.toISOString(), project: canonical })
  storage.setItem(key, raw)
  return { key, project: canonical, savedAt: now.toISOString(), revision: raw }
}

/** Keep a differing legacy draft when a source-scoped draft already exists. */
export function migrateLegacyDraft(storage: DraftStorage): void {
  const legacy = readLocalDraft(storage, LEGACY_DRAFT_KEY)
  if (!legacy) return
  const key = draftKey(legacy.project.source)
  const current = storage.getItem(key)
  if (current === null) saveLocalDraft(storage, legacy.project, null)
  else if (serializeProject(parseDraft(key, current).project) !== serializeProject(legacy.project)) return
  if (storage.getItem(LEGACY_DRAFT_KEY) === legacy.revision) storage.removeItem(LEGACY_DRAFT_KEY)
}
