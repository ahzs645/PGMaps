/**
 * Your own VIA report recipes: an ordered list of the shared parts (`registry.ts`) with a document format, a figure
 * style, a layout and the recipe options, made by copying a built-in recipe and changing it. An own recipe is data
 * only: it names parts by id and never carries a copy of one, so every report keeps one version of each section
 * (AGENTS.md, VIA reports). This module checks, copies and writes them; the browser keeps them (`userRecipeStore.ts`),
 * and a recipe file (`RECIPE_FILE_KIND`) shares one. Everything read is checked by hand and refused with a reason
 * naming what is wrong, never repaired by guessing. No DOM or network access.
 */
import { VIA_STYLE_PRESETS } from '@/lib/forestry/viaFigure/presets'

import { OVERVIEW_SHEET_STYLES, type OverviewSheetStyle } from '../reportMaps'
import { VIA_DOCUMENT_FORMATS } from '../viaDocument/formats'
import type { ReportContext } from './parts'
import type { ReportRecipe } from './recipes'
import { REPORT_PARTS } from './registry'

/** What a shared recipe file says it is. */
export const RECIPE_FILE_KIND = 'pgmaps-via-recipe'
export const RECIPE_FILE_VERSION = 1
/** Own recipes' ids start with this, so one never takes a built-in recipe's id. */
export const OWN_RECIPE_PREFIX = 'own-'
/** The most parts an own recipe takes: every part twice over is more than any reference prints. */
export const MAX_RECIPE_PARTS = 80
/** The oblique renders' map pitch an own recipe may ask for, degrees (`horizonSafePitch` keeps the drawn one safe). */
export const OBLIQUE_PITCH_RANGE = { min: 30, max: 80 } as const
/** Panorama figure pages: how many times as wide as tall (26 prints 2.4). */
export const PANORAMA_RANGE = { min: 1.5, max: 4 } as const
const MAX_TEXT = 200

type RecipeOptions = NonNullable<ReportContext['recipeOptions']>

/** Each recipe option as the editor offers it and the recipe's description names it. */
export type RecipeOptionField =
  | { key: keyof RecipeOptions; label: string; kind: 'flag'; whenAbsent: boolean }
  | {
      key: keyof RecipeOptions
      label: string
      kind: 'choice'
      choices: ReadonlyArray<{ value: string; label: string }>
      whenAbsent: string
    }
  | { key: keyof RecipeOptions; label: string; kind: 'number'; min: number; max: number; step: number }

export const RECIPE_OPTION_FIELDS: readonly RecipeOptionField[] = [
  {
    key: 'partialCutGuide',
    label: 'Partial-cut guide',
    kind: 'choice',
    choices: [
      { value: 'table', label: 'As the handbook’s table' },
      { value: 'poster', label: 'Lettered as the poster prints it (01)' },
    ],
    whenAbsent: 'table',
  },
  {
    key: 'viewingAngleClass',
    label: 'Rate each view’s angle class: focal, oblique or peripheral (01)',
    kind: 'flag',
    whenAbsent: false,
  },
  {
    key: 'inventoryByBlock',
    label: 'List each block’s hectares in each inventory unit (05)',
    kind: 'flag',
    whenAbsent: false,
  },
  {
    key: 'numberedPairs',
    label: 'Number photograph / simulation pairs, with a caption sentence (21)',
    kind: 'flag',
    whenAbsent: false,
  },
  {
    key: 'plainViewSheets',
    label: 'Print a plain Perspective Viewpoint sheet before each analysis sheet (22)',
    kind: 'flag',
    whenAbsent: true,
  },
  {
    key: 'figurePanorama',
    label: 'Figure pages show panoramas, times as wide as tall (26)',
    kind: 'number',
    ...PANORAMA_RANGE,
    step: 0.1,
  },
]

export const PAPER_SIZES: ReadonlyArray<{ value: 'letter' | 'legal'; label: string }> = [
  { value: 'letter', label: 'Letter' },
  { value: 'legal', label: 'Legal' },
]

/** An own recipe read back from the browser or a file, or why it could not be. */
export type OwnRecipeRead = { recipe: ReportRecipe; error?: undefined } | { recipe?: undefined; error: string }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown, max = MAX_TEXT) =>
  typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null

/** A fresh own recipe id; `taken` holds every id already in use. */
export function ownRecipeId(name: string, taken: ReadonlySet<string>, random: () => number = Math.random): string {
  const slug =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 40)
      .replace(/^-+|-+$/g, '') || 'recipe'
  for (;;) {
    const id = `${OWN_RECIPE_PREFIX}${slug}-${Math.floor(random() * 36 ** 4)
      .toString(36)
      .padStart(4, '0')}`
    if (!taken.has(id)) return id
  }
}

/** The reference documents an own recipe's parts come from, in number order. */
export function partSources(parts: readonly string[]): string[] {
  const out = new Set<string>()
  for (const id of parts)
    for (const source of REPORT_PARTS.find((part) => part.id === id)?.sources ?? []) out.add(source)
  return [...out].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
}

/**
 * A copy of `recipe` to change as your own: every choice kept, named "… (your copy)". Its sources follow its parts
 * from here on, and it remembers what it was copied from.
 */
export function copyRecipe(
  recipe: ReportRecipe,
  taken: ReadonlySet<string>,
  random: () => number = Math.random,
): ReportRecipe {
  const name = `${recipe.name.replace(/ \(your copy\)$/, '')} (your copy)`.slice(0, MAX_TEXT)
  return {
    ...recipe,
    id: ownRecipeId(name, taken, random),
    name,
    parts: [...recipe.parts],
    sources: partSources(recipe.parts),
    ...(recipe.leftOut ? { leftOut: recipe.leftOut.map((entry) => ({ ...entry })) } : {}),
    ...(recipe.layout ? { layout: { ...recipe.layout } } : {}),
    ...(recipe.options ? { options: { ...recipe.options } } : {}),
    own: { basedOn: recipe.own ? recipe.own.basedOn : recipe.id },
  }
}

/** `recipe` with `change` applied, its sources following its parts. */
export function editRecipe(recipe: ReportRecipe, change: Partial<Omit<ReportRecipe, 'id' | 'own'>>): ReportRecipe {
  const next = { ...recipe, ...change }
  return { ...next, sources: partSources(next.parts) }
}

function readOptions(value: unknown, problems: string[]): RecipeOptions | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) {
    problems.push('its options are not a list of settings')
    return undefined
  }
  const out: Record<string, unknown> = {}
  for (const [key, given] of Object.entries(value)) {
    const field = RECIPE_OPTION_FIELDS.find((entry) => entry.key === key)
    if (!field) {
      problems.push(`it sets an option PGMaps does not have, "${key}"`)
      continue
    }
    if (field.kind === 'flag') {
      if (typeof given === 'boolean') out[key] = given
      else problems.push(`its option "${field.label}" is not on or off`)
    } else if (field.kind === 'choice') {
      if (typeof given === 'string' && field.choices.some((choice) => choice.value === given)) out[key] = given
      else problems.push(`its option "${field.label}" is not one of ${field.choices.map((c) => c.value).join(', ')}`)
    } else if (typeof given === 'number' && Number.isFinite(given) && given >= field.min && given <= field.max)
      out[key] = given
    else problems.push(`its option "${field.label}" is not a number from ${field.min} to ${field.max}`)
  }
  return out as RecipeOptions
}

/**
 * The parts switched off in an own recipe's contents, each at its place in the whole list (`ReportRecipe.leftOut`):
 * every one a part PGMaps has, every place a whole number inside the list and no two at the same place. `parts` is the
 * recipe's printed parts as read, or null when they did not read (the places are then not checked against them).
 */
function readLeftOut(
  value: unknown,
  parts: unknown[] | null,
  problems: string[],
): Array<{ part: string; at: number }> | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    problems.push('its parts switched off are not a list')
    return undefined
  }
  const total = (parts?.length ?? 0) + value.length
  if (total > MAX_RECIPE_PARTS) {
    problems.push(`it has more than ${MAX_RECIPE_PARTS} parts, counting those switched off`)
    return undefined
  }
  const out: Array<{ part: string; at: number }> = []
  const places = new Set<number>()
  for (const entry of value) {
    const part = isRecord(entry) ? entry.part : undefined
    const at = isRecord(entry) ? entry.at : undefined
    if (typeof part !== 'string' || !REPORT_PARTS.some((known) => known.id === part)) {
      problems.push(`it switches off a part PGMaps does not have: "${String(part)}"`)
      continue
    }
    if (typeof at !== 'number' || !Number.isInteger(at) || at < 0 || (parts && at >= total)) {
      problems.push(`its switched-off part "${part}" has no place in the list`)
      continue
    }
    if (places.has(at)) {
      problems.push(`two of its switched-off parts share place ${at}`)
      continue
    }
    places.add(at)
    out.push({ part, at })
  }
  return out.sort((a, b) => a.at - b.at)
}

/**
 * Checks an own recipe as stored or shared: every part, the format, the figure style and the overview sheet style
 * must be ones this PGMaps has, and every field its own type. Refused with every problem named, never repaired.
 */
export function readOwnRecipe(value: unknown): OwnRecipeRead {
  if (!isRecord(value)) return { error: 'It is not a recipe.' }
  const problems: string[] = []
  const id = typeof value.id === 'string' && /^own-[a-z0-9-]{1,60}$/.test(value.id) ? value.id : null
  if (!id) problems.push('its id is not an own recipe’s')
  const name = text(value.name)
  if (!name) problems.push('it has no name')
  const title = text(value.title)
  if (!title) problems.push('it has no report title')
  const purpose = typeof value.purpose === 'string' ? value.purpose.slice(0, 1000) : ''
  const format = typeof value.format === 'string' ? value.format : ''
  if (!VIA_DOCUMENT_FORMATS.some((entry) => entry.id === format))
    problems.push(`its document format "${format || 'none'}" is not one PGMaps has`)
  const parts = Array.isArray(value.parts) ? value.parts : null
  if (!parts || !parts.length) problems.push('it has no parts')
  else if (parts.length > MAX_RECIPE_PARTS) problems.push(`it has more than ${MAX_RECIPE_PARTS} parts`)
  else {
    const unknown = parts.filter((part) => typeof part !== 'string' || !REPORT_PARTS.some((entry) => entry.id === part))
    if (unknown.length)
      problems.push(
        `it names part${unknown.length > 1 ? 's' : ''} PGMaps does not have: ${unknown.map((part) => `"${String(part)}"`).join(', ')}`,
      )
  }
  const leftOut = readLeftOut(value.leftOut, parts, problems)
  const figureStyle = value.figureStyle
  if (figureStyle !== undefined && !VIA_STYLE_PRESETS.some((preset) => preset.id === figureStyle))
    problems.push(`its figure style "${String(figureStyle)}" is not one PGMaps has`)
  const overviewSheetStyle = value.overviewSheetStyle
  if (overviewSheetStyle !== undefined && !OVERVIEW_SHEET_STYLES.some((style) => style.id === overviewSheetStyle))
    problems.push(`its overview sheet style "${String(overviewSheetStyle)}" is not one PGMaps has`)
  const obliquePitch = value.obliquePitch
  if (
    obliquePitch !== undefined &&
    !(
      typeof obliquePitch === 'number' &&
      obliquePitch >= OBLIQUE_PITCH_RANGE.min &&
      obliquePitch <= OBLIQUE_PITCH_RANGE.max
    )
  )
    problems.push(
      `its oblique pitch is not a number of degrees from ${OBLIQUE_PITCH_RANGE.min} to ${OBLIQUE_PITCH_RANGE.max}`,
    )
  let layout: ReportRecipe['layout']
  if (value.layout !== undefined) {
    const given = value.layout
    if (!isRecord(given)) problems.push('its layout is not a list of settings')
    else {
      layout = {}
      if (given.paper !== undefined) {
        if (PAPER_SIZES.some((paper) => paper.value === given.paper)) layout.paper = given.paper as 'letter' | 'legal'
        else problems.push(`its paper "${String(given.paper)}" is not letter or legal`)
      }
      for (const key of ['cover', 'contents'] as const)
        if (given[key] !== undefined) {
          if (typeof given[key] === 'boolean') layout[key] = given[key]
          else problems.push(`its layout's ${key} is not on or off`)
        }
    }
  }
  const options = readOptions(value.options, problems)
  const basedOn = isRecord(value.own) && typeof value.own.basedOn === 'string' ? value.own.basedOn : null
  if (problems.length) return { error: `${name ? `“${name}”: ` : ''}${problems.join('; ')}.` }
  const recipeParts = parts as string[]
  return {
    recipe: {
      id: id!,
      name: name!,
      title: title!,
      purpose,
      format,
      parts: recipeParts,
      sources: partSources(recipeParts),
      ...(leftOut?.length ? { leftOut } : {}),
      ...(typeof figureStyle === 'string' ? { figureStyle } : {}),
      ...(layout ? { layout } : {}),
      ...(options && Object.keys(options).length ? { options } : {}),
      ...(typeof overviewSheetStyle === 'string'
        ? { overviewSheetStyle: overviewSheetStyle as OverviewSheetStyle }
        : {}),
      ...(typeof obliquePitch === 'number' ? { obliquePitch } : {}),
      own: { basedOn },
    },
  }
}

/** The recipe as stored and shared: the fields `readOwnRecipe` reads, nothing derived. */
export function storedRecipe(recipe: ReportRecipe): Record<string, unknown> {
  return {
    id: recipe.id,
    name: recipe.name,
    title: recipe.title,
    purpose: recipe.purpose,
    format: recipe.format,
    parts: [...recipe.parts],
    ...(recipe.leftOut?.length ? { leftOut: recipe.leftOut.map(({ part, at }) => ({ part, at })) } : {}),
    ...(recipe.figureStyle ? { figureStyle: recipe.figureStyle } : {}),
    ...(recipe.layout ? { layout: recipe.layout } : {}),
    ...(recipe.options && Object.keys(recipe.options).length ? { options: recipe.options } : {}),
    ...(recipe.overviewSheetStyle ? { overviewSheetStyle: recipe.overviewSheetStyle } : {}),
    ...(recipe.obliquePitch !== undefined ? { obliquePitch: recipe.obliquePitch } : {}),
    own: { basedOn: recipe.own?.basedOn ?? null },
  }
}

/** A file sharing one own recipe, to import in another browser. */
export function recipeFileText(recipe: ReportRecipe, exportedAt: Date): string {
  return `${JSON.stringify(
    {
      kind: RECIPE_FILE_KIND,
      version: RECIPE_FILE_VERSION,
      exportedAt: exportedAt.toISOString(),
      recipe: storedRecipe(recipe),
    },
    null,
    2,
  )}\n`
}

/** The file's name: the recipe's name, made safe. */
export const recipeFileName = (recipe: ReportRecipe) =>
  `${
    recipe.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'recipe'
  }.via-recipe.json`

/**
 * Reads a shared recipe file. The imported recipe takes a fresh id when its own is already in use (`taken`), so an
 * import never overwrites a recipe; its name gains "(imported)" when that name is taken too.
 */
export function readRecipeFile(
  textValue: string,
  taken: { ids: ReadonlySet<string>; names: ReadonlySet<string> },
  random: () => number = Math.random,
): OwnRecipeRead {
  let parsed: unknown
  try {
    parsed = JSON.parse(textValue)
  } catch {
    return { error: 'The file is not JSON.' }
  }
  if (!isRecord(parsed) || parsed.kind !== RECIPE_FILE_KIND)
    return { error: 'The file is not a PGMaps VIA recipe (its "kind" is not pgmaps-via-recipe).' }
  if (parsed.version !== RECIPE_FILE_VERSION)
    return { error: `The file is version ${String(parsed.version)} of the recipe format; this PGMaps reads version 1.` }
  const read = readOwnRecipe(parsed.recipe)
  if (!read.recipe) return read
  let recipe = read.recipe
  if (taken.names.has(recipe.name)) recipe = { ...recipe, name: `${recipe.name} (imported)`.slice(0, MAX_TEXT) }
  if (taken.ids.has(recipe.id)) recipe = { ...recipe, id: ownRecipeId(recipe.name, taken.ids, random) }
  return { recipe }
}
