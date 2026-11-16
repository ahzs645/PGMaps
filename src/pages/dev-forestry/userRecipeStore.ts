/**
 * Your own VIA report recipes, kept in this browser (`localStorage`) for every assessment on this machine, as the
 * printed logo is: never in a scene or a project file. A recipe file shares one with another browser
 * (`viaReport/userRecipes.ts`). Every stored recipe is checked again on read; one this PGMaps can no longer build (a part
 * since removed) is listed with why, never built or dropped silently.
 */
import { useSyncExternalStore } from 'react'

import type { ReportRecipe } from './viaReport/recipes'
import { readOwnRecipe, storedRecipe } from './viaReport/userRecipes'

const STORAGE_KEY = 'pgmaps:via-own-recipes:v1'

export type OwnRecipes = {
  recipes: readonly ReportRecipe[]
  /** Stored recipes that no longer read, each with why, so the reviewer can delete them. */
  unreadable: ReadonlyArray<{ index: number; error: string }>
  /** Storage refused the last write (private window, quota): what was changed lasts only while the page is open. */
  writeError: string | null
}

const listeners = new Set<() => void>()
let raw: unknown[] = []
let snapshot: OwnRecipes = { recipes: [], unreadable: [], writeError: null }
let loaded = false

function rebuild(writeError: string | null) {
  const recipes: ReportRecipe[] = []
  const unreadable: Array<{ index: number; error: string }> = []
  raw.forEach((entry, index) => {
    const read = readOwnRecipe(entry)
    if (read.recipe) recipes.push(read.recipe)
    else unreadable.push({ index, error: read.error })
  })
  snapshot = { recipes, unreadable, writeError }
  listeners.forEach((listener) => listener())
}

function load() {
  if (loaded) return
  loaded = true
  try {
    const text = window.localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = text ? JSON.parse(text) : []
    raw = Array.isArray(parsed) ? parsed : []
  } catch {
    raw = []
  }
  rebuild(null)
}

function save(next: unknown[]) {
  raw = next
  let writeError: string | null = null
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch (error) {
    writeError = `This browser did not keep your recipes (${error instanceof Error ? error.message : 'storage refused'}): they last while the page is open. Share each one as a file to keep it.`
  }
  rebuild(writeError)
}

function subscribe(listener: () => void) {
  load()
  listeners.add(listener)
  // Another tab changed them: read them again.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return
    loaded = false
    load()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

const getSnapshot = () => {
  load()
  return snapshot
}

/** Adds `recipe`, or replaces the stored one with its id. */
export function putOwnRecipe(recipe: ReportRecipe) {
  load()
  const value = storedRecipe(recipe)
  const at = raw.findIndex((entry) => (entry as { id?: unknown } | null)?.id === recipe.id)
  save(at < 0 ? [...raw, value] : raw.map((entry, index) => (index === at ? value : entry)))
}

/** Deletes the recipe with `id`, or the unreadable entry at `index`. */
export function deleteOwnRecipe(target: { id: string } | { index: number }) {
  load()
  save(
    raw.filter((entry, index) =>
      'id' in target ? (entry as { id?: unknown } | null)?.id !== target.id : index !== target.index,
    ),
  )
}

/** Your own recipes, as stored in this browser, kept current across tabs. */
export function useOwnRecipes(): OwnRecipes {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
