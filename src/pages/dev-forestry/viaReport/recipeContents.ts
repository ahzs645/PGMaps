/**
 * A VIA report recipe as its contents list (`DocumentContents`; Save & export's *What goes in* and the own recipe's
 * editor): its parts in print order, each on or off, a part switched off kept at its place (`ReportRecipe.leftOut`)
 * so it comes back there; the edits that list makes; and the person's own copy a shipped recipe becomes on its first
 * change. The presets of that list are the recipes themselves. Names come from `partLabel`, never an id. No DOM or
 * network access.
 */
import type { ContentsPart, ContentsPreset } from '@/lib/documentContents/contents'

import { partCatalogue, partLabel } from './recipeMakeup'
import { findReportRecipe, type ReportRecipe } from './recipes'
import { copyRecipe, editRecipe, MAX_RECIPE_PARTS, ownRecipeId } from './userRecipes'

/** One row of a recipe's contents: a part, and whether it prints. */
export type RecipeEntry = { part: string; on: boolean }

/** What the contents list reads of a recipe. */
export type RecipeContentsSource = Pick<ReportRecipe, 'parts' | 'leftOut' | 'layout'>

/** What a printing part gave once the report was assembled (`AssembledPart`), by its place among the printing parts. */
export type PartFacts = { printed: boolean; toComplete: number }

/** The ids and names already in use, which a new own recipe must not take. */
export type TakenRecipes = { ids: ReadonlySet<string>; names: ReadonlySet<string> }

/** The part that makes the cover page when the recipe's layout has one (the PDF's cover takes every block before the first heading). */
export const COVER_PART = 'cover'

/** The recipe's whole list in print order: its printed parts with those switched off merged in at their places. */
export function recipeEntries(recipe: Pick<ReportRecipe, 'parts' | 'leftOut'>): RecipeEntry[] {
  const entries: RecipeEntry[] = recipe.parts.map((part) => ({ part, on: true }))
  // In order of place: each lands after everything that stands before it in the whole list.
  for (const entry of [...(recipe.leftOut ?? [])].sort((a, b) => a.at - b.at))
    entries.splice(Math.min(entry.at, entries.length), 0, { part: entry.part, on: false })
  return entries
}

/** The recipe's `parts` and `leftOut` for a whole list: what prints, and what is switched off at its place. */
export function entriesChange(entries: readonly RecipeEntry[]): Pick<ReportRecipe, 'parts' | 'leftOut'> {
  const leftOut = entries.flatMap((entry, at) => (entry.on ? [] : [{ part: entry.part, at }]))
  return {
    parts: entries.filter((entry) => entry.on).map((entry) => entry.part),
    leftOut: leftOut.length ? leftOut : undefined,
  }
}

/**
 * Each row's key: its part's id and which time the list holds it ("notes-2001#1", "overview-map#2"). A part may be
 * in a recipe twice, so the id alone is not enough; a moved row keeps its key, so focus follows it.
 */
export function entryKeys(entries: readonly RecipeEntry[]): string[] {
  const seen = new Map<string, number>()
  return entries.map((entry) => {
    const n = (seen.get(entry.part) ?? 0) + 1
    seen.set(entry.part, n)
    return `${entry.part}#${n}`
  })
}

/** The shipped recipe an own recipe was copied from, or the shipped recipe itself; null when there is none. */
export function baseRecipeOf(recipe: Pick<ReportRecipe, 'id' | 'own'>): ReportRecipe | null {
  return recipe.own ? findReportRecipe(recipe.own.basedOn) : findReportRecipe(recipe.id)
}

const sourcesHelp = (id: string) => {
  const sources = partCatalogue().find((part) => part.id === id)?.sources ?? []
  return sources.length
    ? `From reference document${sources.length > 1 ? 's' : ''} ${sources.join(', ')}.`
    : 'A part of PGMaps’ own.'
}

/**
 * The recipe as contents rows, in print order, keyed by `entryKeys`, and each printing row's place among the printing
 * parts (`places`: the draft marks a part `part-<place>`). A row says what is known of it once the report has been
 * assembled (`facts`, and `pages` when the draft's pages are known), and nothing before. The cover is pinned first
 * while the layout has a cover. The last part still printing cannot be switched off, since a recipe prints at least
 * one. Only a part the recipe it was copied from does not hold (one the person added) is removed; the others are
 * switched off and keep their place. `base` is that recipe's parts; null when there is none, and then any part but
 * the last may be removed.
 */
export function recipeContents(
  recipe: RecipeContentsSource,
  options: {
    base?: readonly string[] | null
    facts?: ReadonlyArray<PartFacts> | null
    pages?: readonly number[] | null
  } = {},
): { parts: ContentsPart[]; places: Record<string, number> } {
  const entries = recipeEntries(recipe)
  const keys = entryKeys(entries)
  const printing = entries.filter((entry) => entry.on).length
  const cover = { paper: 'letter', cover: false, contents: false, ...recipe.layout }.cover
  const base = options.base ?? null
  const places: Record<string, number> = {}
  let place = 0
  const parts = entries.map((entry, index): ContentsPart => {
    const key = keys[index]
    const occurrence = Number(key.slice(key.lastIndexOf('#') + 1))
    const at = entry.on ? place++ : null
    if (at !== null) places[key] = at
    const facts = at !== null ? options.facts?.[at] : undefined
    const page = at !== null ? options.pages?.[at] : undefined
    const detail = [
      page ? `p. ${page}` : null,
      facts && !facts.printed ? 'prints nothing for this assessment' : null,
      facts?.toComplete ? `${facts.toComplete} to complete` : null,
    ].filter(Boolean)
    const added = base ? occurrence > base.filter((id) => id === entry.part).length : true
    return {
      key,
      label: partLabel(entry.part),
      state: entry.on ? 'on' : 'off',
      ...(entry.on && printing === 1 ? { locked: 'The only part printing: a report prints at least one' } : {}),
      ...(index === 0 && cover && entry.part === COVER_PART ? { pinned: true } : {}),
      ...(detail.length ? { detail: detail.join(' · ') } : {}),
      help: sourcesHelp(entry.part),
      ...(added && entries.length > 1 && !(entry.on && printing === 1) ? { removable: true } : {}),
    }
  })
  return { parts, places }
}

/** A change the contents list makes to a recipe's parts. */
export type ContentsEdit =
  | { kind: 'state'; key: string; on: boolean }
  | { kind: 'move'; order: readonly string[] }
  | { kind: 'add'; part: string }
  | { kind: 'remove'; key: string }

/**
 * The whole list after `edit`, or null when it changes nothing or is refused: an unknown key or part, an order that is
 * not the list's own keys, the last printing part switched off or removed, past `MAX_RECIPE_PARTS`, or the pinned
 * cover moved off the top.
 */
export function editedEntries(recipe: RecipeContentsSource, edit: ContentsEdit): RecipeEntry[] | null {
  const entries = recipeEntries(recipe)
  const keys = entryKeys(entries)
  const at = 'key' in edit ? keys.indexOf(edit.key) : -1
  const printing = entries.filter((entry) => entry.on).length
  switch (edit.kind) {
    case 'state': {
      if (at < 0 || entries[at].on === edit.on) return null
      if (!edit.on && printing === 1) return null
      return entries.map((entry, index) => (index === at ? { ...entry, on: edit.on } : entry))
    }
    case 'move': {
      if (edit.order.length !== keys.length || new Set(edit.order).size !== keys.length) return null
      const next = edit.order.map((key) => entries[keys.indexOf(key)])
      if (next.some((entry) => !entry) || edit.order.every((key, index) => key === keys[index])) return null
      const pinned = recipeContents(recipe).parts.find((part) => part.pinned)
      if (pinned && edit.order[0] !== pinned.key) return null
      return next
    }
    case 'add': {
      if (!partCatalogue().some((part) => part.id === edit.part) || entries.length >= MAX_RECIPE_PARTS) return null
      return [...entries, { part: edit.part, on: true }]
    }
    case 'remove': {
      if (at < 0 || entries.length === 1 || (entries[at].on && printing === 1)) return null
      return entries.filter((_, index) => index !== at)
    }
  }
}

/** `name`, or "name 2", "name 3"… when it is taken. */
function freeName(name: string, names: ReadonlySet<string>): string {
  if (!names.has(name)) return name
  for (let n = 2; ; n++) if (!names.has(`${name} ${n}`)) return `${name} ${n}`
}

/** The person's own copy of `recipe` under a name not in use: "… (your copy)", or the name typed for it. */
export function ownCopy(
  recipe: ReportRecipe,
  taken: TakenRecipes,
  name?: string,
  random: () => number = Math.random,
): ReportRecipe {
  const copy = copyRecipe(recipe, taken.ids, random)
  const chosen = freeName((name ?? copy.name).trim().slice(0, 200) || copy.name, taken.names)
  return chosen === copy.name ? copy : { ...copy, name: chosen, id: ownRecipeId(chosen, taken.ids, random) }
}

/**
 * `edit` made to `recipe`: an own recipe is changed in place; a shipped one becomes the person's own copy first, in
 * the same step, with no question asked (`copied`). Null when the edit changes nothing.
 */
export function editRecipeContents(
  recipe: ReportRecipe,
  edit: ContentsEdit,
  taken: TakenRecipes,
  random: () => number = Math.random,
): { recipe: ReportRecipe; copied: boolean } | null {
  const entries = editedEntries(recipe, edit)
  if (!entries) return null
  const own = recipe.own ? recipe : ownCopy(recipe, taken, undefined, random)
  return { recipe: editRecipe(own, entriesChange(entries)), copied: !recipe.own }
}

const sortedOptions = (options: ReportRecipe['options']) =>
  Object.fromEntries(Object.entries(options ?? {}).sort(([a], [b]) => a.localeCompare(b)))

/** What a recipe is made of, for comparing one with the recipe it was copied from: everything but its name and id. */
const makeup = (recipe: ReportRecipe) =>
  JSON.stringify({
    title: recipe.title,
    format: recipe.format,
    parts: recipe.parts,
    leftOut: recipe.leftOut ?? [],
    figureStyle: recipe.figureStyle ?? null,
    layout: { paper: 'letter', cover: false, contents: false, ...recipe.layout },
    options: sortedOptions(recipe.options),
    overviewSheetStyle: recipe.overviewSheetStyle ?? null,
    obliquePitch: recipe.obliquePitch ?? null,
  })

/** Whether an own recipe differs from the shipped recipe it was copied from; false for a shipped one or one with none. */
export function recipeModified(recipe: ReportRecipe): boolean {
  if (!recipe.own) return false
  const base = baseRecipeOf(recipe)
  return !!base && makeup(recipe) !== makeup(base)
}

/** The recipes as the contents list's presets: the shipped ones, then the person's own (`saved`). */
export function recipePresets(recipes: readonly ReportRecipe[]): ContentsPreset[] {
  return [
    ...recipes.filter((recipe) => !recipe.own).map((recipe) => ({ id: recipe.id, label: recipe.name })),
    ...recipes.filter((recipe) => recipe.own).map((recipe) => ({ id: recipe.id, label: recipe.name, saved: true })),
  ]
}

/** The shared parts to add, grouped by the reference documents they come from, as the editor's Add list offers them. */
export function addablePartOptions(): Array<{ id: string; label: string; group: string }> {
  return partCatalogue()
    .map((part) => ({
      id: part.id,
      label: partLabel(part.id),
      group: part.sources.length ? `From ${part.sources.join(', ')}` : 'PGMaps’ own',
    }))
    .sort((a, b) => a.group.localeCompare(b.group, undefined, { numeric: true }) || a.label.localeCompare(b.label))
}
