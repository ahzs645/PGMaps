import { describe, expect, it } from 'vitest'
import { FIT_CRS, GEOREFERENCE_SCHEMA, PIXEL_CONVENTION, serializeProject, type GeoreferenceProject } from './model'
import {
  draftKey,
  LEGACY_DRAFT_KEY,
  listLocalDrafts,
  migrateLegacyDraft,
  readLocalDraft,
  saveLocalDraft,
} from './drafts'

function storage() {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    key: (index: number) => [...values.keys()][index] || null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
  }
}

function project(id = 'map-a', hash = 'a'): GeoreferenceProject {
  return {
    schema: GEOREFERENCE_SCHEMA,
    pixelConvention: PIXEL_CONVENTION,
    fitCrs: FIT_CRS,
    source: {
      id,
      url: null,
      sha256: hash.repeat(64),
      width: 800,
      height: 600,
      frame: { kind: 'original-image', description: 'Exact original image pixel grid.' },
    },
    transform: 'affine',
    points: [{ id: 'first-control', pixel: [50, 60], coordinate: [-125, 54], enabled: true, role: 'control' }],
    notes: 'Work to preserve.',
  }
}

describe('source-scoped georeferencing draft recovery', () => {
  it('keeps edits for different maps and different native frames of the same map', () => {
    const local = storage()
    const first = project()
    const otherMap = project('map-b', 'b')
    const otherRevision = project('map-a', 'c')
    for (const p of [first, otherMap, otherRevision]) saveLocalDraft(local, p, null)
    const { drafts } = listLocalDrafts(local)
    expect(drafts).toHaveLength(3)
    expect(readLocalDraft(local, draftKey(first.source))?.project).toEqual(first)
    const changedGrid = { ...first.source, width: 400 }
    expect(draftKey(changedGrid)).not.toBe(draftKey(first.source))
  })

  it('migrates a legacy draft without losing its native pixel coordinates', () => {
    const local = storage(),
      saved = project()
    local.setItem(LEGACY_DRAFT_KEY, serializeProject(saved))
    migrateLegacyDraft(local)
    expect(local.getItem(LEGACY_DRAFT_KEY)).toBeNull()
    expect(readLocalDraft(local, draftKey(saved.source))?.project).toEqual(saved)
  })

  it('preserves a differing legacy draft alongside an already saved newer source draft', () => {
    const local = storage(),
      old = project(),
      newer = { ...old, notes: 'More recent edits.' }
    saveLocalDraft(local, newer, null)
    local.setItem(LEGACY_DRAFT_KEY, serializeProject(old))
    migrateLegacyDraft(local)
    expect(listLocalDrafts(local).drafts).toHaveLength(2)
    expect(readLocalDraft(local, draftKey(old.source))?.project.notes).toBe(newer.notes)
    expect(readLocalDraft(local, LEGACY_DRAFT_KEY)?.project.notes).toBe(old.notes)
  })

  it('requires resuming the stored revision before replacing it, including a newer edit from another tab', () => {
    const local = storage(),
      p = project()
    const first = saveLocalDraft(local, p, null)
    expect(() => saveLocalDraft(local, { ...p, points: [] }, null)).toThrow(/already exists/)
    const second = saveLocalDraft(local, { ...p, notes: 'Another tab edited this.' }, first.revision)
    expect(() => saveLocalDraft(local, { ...p, notes: 'Stale tab.' }, first.revision)).toThrow(/another tab/)
    expect(readLocalDraft(local, first.key)?.revision).toBe(second.revision)
  })

  it('keeps valid maps discoverable when another draft is corrupt and does not overwrite corrupt data', () => {
    const local = storage(),
      p = project()
    saveLocalDraft(local, p, null)
    const damaged = project('damaged', 'd')
    local.setItem(draftKey(damaged.source), '{broken')
    local.setItem('unrelated-local-setting', 'not-a-draft')
    const result = listLocalDrafts(local)
    expect(result.drafts).toHaveLength(1)
    expect(result.invalidCount).toBe(1)
    expect(() => saveLocalDraft(local, damaged, null)).toThrow(/already exists/)
  })

  it('leaves the legacy record and other maps intact if migration runs out of storage', () => {
    const local = storage(),
      legacy = serializeProject(project())
    local.setItem(LEGACY_DRAFT_KEY, legacy)
    const limited = {
      ...local,
      setItem: () => {
        throw new Error('Quota exceeded')
      },
    }
    expect(() => migrateLegacyDraft(limited)).toThrow(/Quota/)
    expect(local.getItem(LEGACY_DRAFT_KEY)).toBe(legacy)
  })
})
