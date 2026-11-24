import { parseSavedMappings, rememberMapping, type ImportMapping, type SavedMapping } from './importMapping'

/**
 * Import mappings saved in this browser (guide `exports-and-project-files.md`, **Mapping a layer's
 * fields**). Never in a project file: a mapping describes the person's files, not the project.
 */
const STORAGE_KEY = 'pgmaps-road-import-mappings'

export function readSavedMappings(): SavedMapping[] {
  try {
    const text = localStorage.getItem(STORAGE_KEY)
    return text ? parseSavedMappings(JSON.parse(text)) : []
  } catch {
    return []
  }
}

/** Records the mappings an import used; storage that refuses (private mode, full) only loses the memory. */
export function rememberImportMappings(
  entries: readonly { key: string; fileName: string; mapping: ImportMapping; guess: ImportMapping }[],
) {
  if (!entries.length) return
  const now = new Date().toISOString()
  const saved = entries.reduce((list, entry) => rememberMapping(list, entry, now), readSavedMappings())
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved))
  } catch {
    // Nothing to tell the person: the import itself succeeded.
  }
}

/** Forgets the mapping saved for `key`, so the next file of that shape starts from the guess. */
export function forgetSavedMapping(key: string) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(readSavedMappings().filter((item) => item.key !== key)))
  } catch {
    // As above.
  }
}
