// SPDX-License-Identifier: Apache-2.0
import { CASTOR_IMPORT_LIMIT_BYTES } from './inputTables'
import { castorConfig, requireCastorProject } from './inputs'
import { CASTOR_MODEL_VERSION } from './types'
import type { CastorConfig, CastorProject, CastorResult } from './types'

export interface CastorRestoredSession {
  project: CastorProject
  config: CastorConfig
  result?: CastorResult
  resultOmitted?: boolean
}

export function serializeCastorSession(
  project: CastorProject,
  config: CastorConfig,
  result: CastorResult | null,
): string {
  requireCastorProject(project, config)
  return JSON.stringify(
    { schema: 'pgmaps-castor-session-v1', modelVersion: CASTOR_MODEL_VERSION, project, config, result },
    null,
    2,
  )
}

/** Saved outputs are retained in the file, but recalculated after import. */
export function parseCastorSession(text: string): CastorRestoredSession {
  if (text.length > CASTOR_IMPORT_LIMIT_BYTES) throw new Error('Session JSON exceeds the 64 MB import limit.')
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('The selected session is not valid JSON.')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('A session must be a JSON object.')
  const session = value as Record<string, unknown>
  if (session.schema === 'pgmaps-castor-project-v1') {
    const project = requireCastorProject(value)
    return { project, config: castorConfig(project) }
  }
  if (session.schema !== 'pgmaps-castor-session-v1')
    throw new Error('Expected a pgmaps-castor-session-v1 session or a Castor project.')
  if (!session.config || typeof session.config !== 'object' || Array.isArray(session.config))
    throw new Error('The saved session has no valid configuration.')
  const project = requireCastorProject(session.project, session.config as CastorConfig)
  if (typeof session.modelVersion === 'string' && session.modelVersion !== CASTOR_MODEL_VERSION) {
    project.provenance.notes.push(
      `Imported settings from model ${session.modelVersion}. The next run uses ${CASTOR_MODEL_VERSION}; saved results are retained only in the imported file and are not treated as current calculations.`,
    )
  }
  return {
    project,
    config: castorConfig(project, session.config as CastorConfig),
    resultOmitted: session.result != null,
  }
}

const DATABASE = 'pgmaps-forestry-castor-v1',
  STORE = 'drafts',
  KEY = 'current'
async function openDrafts(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined')
    throw new Error('Local draft storage is unavailable in this browser. Export a session JSON to retain your work.')
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(new Error('Could not open local draft storage. Export a session JSON to retain your work.'))
    request.onblocked = () =>
      reject(
        new Error(
          'Local draft storage is blocked by another page. Close the other workbench or export a session JSON.',
        ),
      )
  })
}

export async function saveCastorDraft(project: CastorProject, config: CastorConfig): Promise<void> {
  const db = await openDrafts()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite')
      transaction
        .objectStore(STORE)
        .put({ schema: 'pgmaps-castor-session-v1', modelVersion: CASTOR_MODEL_VERSION, project, config }, KEY)
      transaction.oncomplete = () => resolve()
      transaction.onerror = transaction.onabort = () =>
        reject(new Error('The browser could not save this draft. Export a session JSON before leaving the page.'))
    })
  } finally {
    db.close()
  }
}

export async function loadCastorDraft(): Promise<{ project: CastorProject; config: CastorConfig } | null> {
  const db = await openDrafts()
  try {
    const value = await new Promise<unknown>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readonly'),
        request = transaction.objectStore(STORE).get(KEY)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(new Error('The saved Castor draft could not be read.'))
    })
    if (value === undefined) return null
    const restored = parseCastorSession(JSON.stringify(value))
    return { project: restored.project, config: restored.config }
  } finally {
    db.close()
  }
}

export async function clearCastorDraft(): Promise<void> {
  const db = await openDrafts()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite')
      transaction.objectStore(STORE).delete(KEY)
      transaction.oncomplete = () => resolve()
      transaction.onerror = transaction.onabort = () =>
        reject(new Error('The saved Castor draft could not be removed.'))
    })
  } finally {
    db.close()
  }
}
