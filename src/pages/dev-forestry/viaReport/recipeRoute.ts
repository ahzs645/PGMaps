/**
 * The VIA report's Word document through document-kit's recipe engine (`document-kit/recipe`, `docs/recipe.md`).
 *
 * The recipes are JSON in the kit's format (`recipeJson/`): a base recipe (`via-report.json`) states the theme, each
 * page kind as a section (its set-up, running header and "Page n of N"), and the furniture every report shares as JSON
 * components (the title block or the cover's head, the contents, the closing to-complete box and last line); each
 * shipped report `extends` it, adding its parts in order, and its details (`sources`, `format`, `figureStyle`, …) are
 * its `meta`, its paper, cover, contents and part options its `options`. `recipeJson/recipes.generated.json` is what
 * the page reads (`recipes.ts`), generated from those files by the kit's own compile and pinned by
 * `recipeJson.test.ts`.
 *
 * Every report part (`registry.ts`) is usable by the engine: a part defined as a JSON component (`kitBlocks.ts`) is
 * one, and every other part is a code component made by ONE adapter over the registry (`viaCodeComponents`). A route
 * run (`recipeReportDocument`) compiles the recipe, derives the `ReportRecipe` from the compiled recipe alone
 * (`reportRecipeOf`), assembles the report from it as the page does (`assembleReportParts`: each part run once over
 * the `ReportContext`, the reviewer's hand edits applied after it filled its blocks, its to-complete kept), renders
 * the compiled recipe (JSON components rendered by the engine; each code part handing the engine its assembled blocks
 * with what it left to complete), and lays the rendered report out by the PDF's page rules through `word.ts`'s
 * `layoutReport`, framed by the furniture the engine rendered. Placement stays the application's, as the kit's model
 * says it must (`docs/model.md`: a component cannot open a section; wide tables, sheets and figure pages are placed by
 * the app): which page kind a block takes depends on the blocks around it (`bodyParts`, `completeAt`).
 *
 * The direct route (`reportDocument`) is kept as the test oracle: `recipeRoute.test.ts` pins the two documents, and
 * their Word bytes, equal for every recipe over several made-up assessments. The kit is passed in (`RecipeKit`), so
 * this module loads only with the Word outputs (`viaReportWord.ts`). No DOM or network access.
 */
import type { Block, Document, Section } from 'document-kit'
import type {
  CodeComponent,
  CodeComponents,
  CompiledPart,
  CompiledRecipe,
  Component,
  JsonObject,
  Library,
  Recipe,
  RecipeChange,
} from 'document-kit/recipe'

import type { ReportLogo } from './html'
import { readPart } from './kitBlocks'
import { reportFacts } from './reportFacts'
import type { AssembledReport, ReportBlock } from './model'
import type { ReportContext } from './parts'
import {
  assembleReportParts,
  partContext,
  withViewsLeftOut,
  type AssembledEdits,
  type AssembledPart,
  type ReportRecipe,
} from './recipes'
import { editPartBlocks, type ReportEdits } from './edits'
import { findReportPart, REPORT_PARTS } from './registry'
import {
  layoutReport,
  PAGE_KINDS,
  reportPictures,
  wordFacts,
  type WordFurniture,
  type WordKit,
  type WordReportOptions,
} from './word'

import index from './recipeJson/index.json'

/** What this module takes from document-kit: the recipe engine, and the Word module's picture reader. */
export interface RecipeKit extends Pick<WordKit, 'imageInfo'> {
  recipe: {
    compileRecipe: typeof import('document-kit/recipe').compileRecipe
    renderRecipe: typeof import('document-kit/recipe').renderRecipe
    sharedLibrary: typeof import('document-kit/recipe').sharedLibrary
    defineCodeComponents: typeof import('document-kit/recipe').defineCodeComponents
  }
}

/** The base recipe every VIA report extends. */
export const VIA_BASE_RECIPE = 'via-report'
/** The shipped recipes, in the order the page lists them. */
export const SHIPPED_RECIPE_IDS: readonly string[] = index.recipes

// Every JSON file beside the recipes that is not a recipe (the index, the generated file, the comparison) is left out.
const RECIPE_FILES = import.meta.glob<Recipe>(
  [
    './recipeJson/*.json',
    '!./recipeJson/index.json',
    '!./recipeJson/wording.json',
    '!./recipeJson/*.generated.json',
    '!./recipeJson/*.compiled.json',
    '!./recipeJson/comparison-result.json',
  ],
  { eager: true, import: 'default' },
)
const COMPONENT_FILES = import.meta.glob<Component>('./recipeJson/components/*.json', {
  eager: true,
  import: 'default',
})

/** The recipes and the app's own JSON components, as written. */
export const VIA_RECIPES: readonly Recipe[] = Object.values(RECIPE_FILES)
export const VIA_COMPONENTS: readonly Component[] = Object.values(COMPONENT_FILES)

/** The furniture parts of the base recipe, by the part ids `via-report.json` gives them. */
const FURNITURE = { title: 'title', cover: 'cover-page', contents: 'contents', closing: 'closing' } as const

/** The custom block kind that stands, in the engine's output, for one block of a code part. */
export const REPORT_BLOCK_KIND = 'via.report-block'

/** The kit's shared components and the app's, and the recipes. */
export function viaLibrary(kit: RecipeKit): Library {
  return kit.recipe.sharedLibrary({ components: [...VIA_COMPONENTS], recipes: [...VIA_RECIPES] })
}

/** What each code part hands the engine at render: its blocks' places in the assembled report and what it left. */
export type PartHandles = (partId: string) => Block[]

/**
 * Every report part not defined in JSON as a code component, by one adapter over the registry: its id, title and
 * sources (`meta`) are the part's. Without `handles` (a compile) it builds nothing; at render it hands the engine the
 * part's assembled blocks as `REPORT_BLOCK_KIND` blocks, the part's own to-complete as their `pending`.
 */
export function viaCodeComponents(kit: RecipeKit, handles?: PartHandles): CodeComponents {
  return kit.recipe.defineCodeComponents(
    REPORT_PARTS.filter((part) => !VIA_COMPONENTS.some((component) => component.id === part.id)).map(
      (part): CodeComponent => ({
        id: part.id,
        title: part.title,
        version: '1',
        meta: { reportPart: true, sources: [...part.sources] },
        build: () => (handles ? handles(part.id) : []),
      }),
    ),
  )
}

const compiledCache = new Map<string, CompiledRecipe>()

/** A shipped recipe (by id) or an own one (its kit recipe), compiled; shipped ones once per session. */
export function compileViaRecipe(kit: RecipeKit, recipe: string | Recipe): CompiledRecipe {
  const key = typeof recipe === 'string' ? recipe : null
  const cached = key ? compiledCache.get(key) : undefined
  if (cached) return cached
  const compiled = kit.recipe.compileRecipe(recipe, viaLibrary(kit), { code: viaCodeComponents(kit) })
  if (key) compiledCache.set(key, compiled)
  return compiled
}

const isReportPart = (part: CompiledPart) => part.code !== undefined || part.part.componentMeta?.reportPart === true
const LAYOUT_KEYS = ['paper', 'cover', 'contents'] as const
const META_KEYS = [
  'title',
  'sources',
  'format',
  'purpose',
  'figureStyle',
  'obliquePitch',
  'overviewSheetStyle',
] as const

/**
 * The `ReportRecipe` a compiled recipe states: its report parts in order (the furniture left out), its details from
 * `meta`, its paper, cover and contents from `options` and its other options as the parts' options. Refused when a
 * report part is conditional, repeated by a loop or given parameters: a `ReportRecipe` cannot say so.
 */
export function reportRecipeOf(compiled: CompiledRecipe): ReportRecipe {
  const meta = (compiled.recipe.meta ?? {}) as Record<string, unknown>
  const parts: string[] = []
  compiled.sections.forEach((section, s) =>
    section.parts.filter(isReportPart).forEach((part) => {
      const where = `${compiled.recipe.id}: part ${part.part.id}`
      if (s !== 0) throw new Error(`${where} is not in the report's first section`)
      if (part.if !== undefined || part.for !== undefined || part.variant !== undefined || part.pageBreakBefore)
        throw new Error(`${where} has a condition, loop, variant or page break a report part cannot take`)
      if (Object.keys(part.params).length) throw new Error(`${where} is given parameters`)
      if (!findReportPart(part.part.component)) throw new Error(`${where} names no report part`)
      parts.push(part.part.component)
    }),
  )
  const options = Object.fromEntries(Object.entries(compiled.options).filter(([, value]) => value !== null))
  const layout = Object.fromEntries(LAYOUT_KEYS.map((key) => [key, options[key]]))
  const rest = Object.fromEntries(
    Object.entries(options).filter(([key]) => !(LAYOUT_KEYS as readonly string[]).includes(key)),
  )
  const details = Object.fromEntries(META_KEYS.filter((key) => meta[key] !== undefined).map((key) => [key, meta[key]]))
  return {
    id: compiled.recipe.id,
    name: compiled.recipe.name,
    ...details,
    parts,
    layout,
    ...(Object.keys(rest).length ? { options: rest } : {}),
    ...(meta.own !== undefined ? { own: meta.own } : {}),
  } as unknown as ReportRecipe
}

/** Every shipped recipe as the page reads it (`recipeJson/recipes.generated.json`), from the JSON by the kit's compile. */
export const shippedReportRecipes = (kit: RecipeKit): ReportRecipe[] =>
  SHIPPED_RECIPE_IDS.map((id) => reportRecipeOf(compileViaRecipe(kit, id)))

/** The report parts defined in JSON (components marked `meta.reportPart`): id, title and sources, as the page lists them. */
export const jsonPartEntries = (): Array<{ id: string; title: string; sources: string[] }> =>
  VIA_COMPONENTS.filter((component) => component.meta?.reportPart === true)
    .map((component) => ({
      id: component.id,
      title: component.title,
      sources: [...((component.meta?.sources as string[] | undefined) ?? [])],
    }))
    .sort((a, b) => a.id.localeCompare(b.id))

/**
 * Each JSON report part compiled on its own (`recipeJson/parts.compiled.json`), so the page renders a part with the
 * engine and never compiles: a one-part recipe per part.
 */
export function compiledJsonParts(kit: RecipeKit): Record<string, CompiledRecipe> {
  const library = viaLibrary(kit)
  return Object.fromEntries(
    jsonPartEntries().map((entry) => [
      entry.id,
      kit.recipe.compileRecipe(
        { kind: 'recipe', id: `part.${entry.id}`, name: entry.title, sections: [{ parts: [{ use: entry.id }] }] },
        library,
      ),
    ]),
  )
}

/** Changes that turn the report parts `from` into `to`, in the base recipe's first section (`changes`). */
export function partChanges(from: readonly string[], to: readonly string[]): RecipeChange[] {
  const changes: RecipeChange[] = []
  const current = [...from]
  for (const id of from)
    if (!to.includes(id)) {
      changes.push({ remove: id })
      current.splice(current.indexOf(id), 1)
    }
  const seen = new Map<string, number>()
  to.forEach((component, i) => {
    // A part printed twice is a second instance with its own id; the report reads its component.
    const n = (seen.get(component) ?? 0) + 1
    seen.set(component, n)
    const id = n > 1 ? `${component}.${n}` : component
    if (current[i] === id) return
    const anchor = i === 0 ? { before: current[0] ?? FURNITURE.closing } : { after: current[i - 1] as string }
    const at = current.indexOf(id)
    if (at >= 0) {
      changes.push({ move: id, ...anchor } as RecipeChange)
      current.splice(at, 1)
    } else changes.push({ add: { use: component, ...(id !== component ? { id } : {}) }, ...anchor } as RecipeChange)
    current.splice(i, 0, id)
  })
  return changes
}

/**
 * An own recipe (`userRecipes.ts`) as a kit recipe: it `extends` the shipped recipe it was copied from (else the
 * base), its parts reached by changes, its details in `meta`, its options laid over the shipped ones (an option the
 * shipped recipe sets and this one does not is `null`: not set). Made each time from the stored own recipe, which
 * stays in its own format (`userRecipes.ts`).
 */
export function ownRecipeJson(kit: RecipeKit, recipe: ReportRecipe): Recipe {
  const basedOn = recipe.own?.basedOn ?? null
  const shipped = basedOn && SHIPPED_RECIPE_IDS.includes(basedOn) ? basedOn : null
  const base = shipped ? reportRecipeOf(compileViaRecipe(kit, shipped)) : null
  const inherited: Record<string, unknown> = base ? { ...base.layout, ...base.options } : {}
  const own: Record<string, unknown> = { ...recipe.layout, ...recipe.options }
  const options: JsonObject = {}
  for (const key of new Set([...Object.keys(inherited), ...Object.keys(own)]))
    if (own[key] !== undefined) options[key] = own[key] as JsonObject[string]
    else if (!(LAYOUT_KEYS as readonly string[]).includes(key)) options[key] = null
  const meta: JsonObject = { own: { basedOn } }
  for (const key of META_KEYS) if (recipe[key] !== undefined) meta[key] = recipe[key] as JsonObject[string]
  return {
    kind: 'recipe',
    id: recipe.id,
    name: recipe.name,
    extends: shipped ?? VIA_BASE_RECIPE,
    own: { basedOn },
    meta,
    options,
    changes: partChanges(base?.parts ?? [], recipe.parts),
  }
}

/** The kit recipe a report recipe is built from: a shipped one by id, an own one made from it. */
export const kitRecipeOf = (kit: RecipeKit, recipe: ReportRecipe): string | Recipe =>
  recipe.own || !SHIPPED_RECIPE_IDS.includes(recipe.id) ? ownRecipeJson(kit, recipe) : recipe.id

export interface RecipeRouteInput {
  recipe: ReportRecipe
  ctx: ReportContext
  /** The reviewer's hand edits (`viaReview.reportEdits`). */
  edits?: ReportEdits
  /** The package's views the report does not print, with why (`withViewsLeftOut`). */
  leftOut?: ReadonlyArray<{ name: string; reason: string }>
  logo: ReportLogo | null
  options?: WordReportOptions
}

export interface RecipeRouteResult {
  document: Document
  /** The report as laid out: the same `AssembledReport` the PDF, HTML and Markdown draw. */
  report: AssembledReport
  parts: AssembledPart[]
  edits: AssembledEdits
  /** The page frames and furniture the engine rendered from the recipe's JSON. */
  furniture: WordFurniture
  /** The recipe as the engine compiled it, and what its render said of each part. */
  compiled: CompiledRecipe
  rendered: ReturnType<RecipeKit['recipe']['renderRecipe']>
}

/** The report's Word document through the recipe engine. */
export async function recipeReportDocument(kit: RecipeKit, input: RecipeRouteInput): Promise<RecipeRouteResult> {
  const compiled = compileViaRecipe(kit, kitRecipeOf(kit, input.recipe))
  const recipe = reportRecipeOf(compiled)
  const edits = input.edits ?? {}
  const assembled = assembleReportParts(recipe, input.ctx, edits)
  const report = withViewsLeftOut(assembled.report, input.leftOut ?? [])
  const pics = await reportPictures(kit)

  // Each code part's blocks by their place in the assembled report, its own to-complete on the first of them.
  const byPart = new Map<string, Block[][]>()
  let item = 0
  for (const part of assembled.parts) {
    const from = part.first ? report.blocks.indexOf(part.first) : -1
    const pending = report.toComplete.slice(item, item + part.toComplete).map(({ what }) => ({ what }))
    item += part.toComplete
    const blocks: Block[] = Array.from({ length: from < 0 ? 0 : part.blocks }, (_, i) => ({
      type: 'custom',
      kind: REPORT_BLOCK_KIND,
      data: { at: from + i },
    }))
    if (pending.length)
      blocks[0] = blocks.length
        ? { ...blocks[0], pending }
        : { type: 'custom', kind: REPORT_BLOCK_KIND, data: { at: null }, pending }
    byPart.set(part.id, [...(byPart.get(part.id) ?? []), blocks])
  }
  // A part printed twice hands over each printing in turn.
  const handles: PartHandles = (id) => byPart.get(id)?.shift() ?? []

  // The furniture's values beside the facts the JSON parts read, from the very context the parts were built with.
  const data = { ...wordFacts(report, input.logo, pics), facts: reportFacts(partContext(recipe, input.ctx)) }
  const rendered = kit.recipe.renderRecipe(compiled, data, {
    code: viaCodeComponents(kit, handles),
  })
  const sections = rendered.document.sections
  const kindAt = new Map(compiled.sections.map((section, i) => [section.id, i]))
  const sectionOf = (kind: string): Section => {
    const at = kindAt.get(kind)
    if (at === undefined) throw new Error(`The recipe ${compiled.recipe.id} has no "${kind}" page section`)
    return sections[at]
  }
  const partBlocks = (id: string): Block[] => {
    const part = rendered.parts.find((entry) => entry.id === id)
    return part ? sections[part.section].body.slice(part.start, part.end) : []
  }

  // The report's blocks in the order the engine rendered its parts: a code part's from the assembled report, a JSON
  // part's read back from what the engine rendered, with the reviewer's edits applied as the page applies them.
  const blocks: ReportBlock[] = [report.blocks[0]]
  for (const part of rendered.parts) {
    const compiledPart = compiled.sections[part.section].parts.find((entry) => entry.part.id === part.id)
    if (!compiledPart || !isReportPart(compiledPart)) continue
    const own = partBlocks(part.id)
    if (compiledPart.code !== undefined) {
      for (const block of own)
        if (block.type === 'custom' && block.kind === REPORT_BLOCK_KIND) {
          const at = (block.data as { at: number | null }).at
          if (at !== null) blocks.push(report.blocks[at])
        }
    } else {
      const reportPart = findReportPart(compiledPart.part.component)!
      blocks.push(...editPartBlocks(reportPart, readPart(own, reportPart.id).blocks, edits).blocks)
    }
  }
  // What the page adds after the parts (the views left out) follows them.
  blocks.push(...report.blocks.slice(assembled.report.blocks.length))
  const laid: AssembledReport = { ...report, blocks }

  const furniture: WordFurniture = {
    section: (kind) => {
      const { page, header, footer } = sectionOf(kind)
      return { page, header, footer }
    },
    title: partBlocks(FURNITURE.title),
    cover: partBlocks(FURNITURE.cover),
    contents: partBlocks(FURNITURE.contents),
    closing: partBlocks(FURNITURE.closing),
  }
  for (const kind of PAGE_KINDS) sectionOf(kind)

  const document: Document = {
    ...(rendered.document.metadata || input.options?.created
      ? {
          metadata: {
            ...rendered.document.metadata,
            ...(input.options?.created ? { created: input.options.created } : {}),
          },
        }
      : {}),
    ...(rendered.document.theme ? { theme: rendered.document.theme } : {}),
    sections: layoutReport(laid, pics, furniture),
  }
  return { document, report: laid, parts: assembled.parts, edits: assembled.edits, furniture, compiled, rendered }
}

/** The Word file's bytes through the recipe engine, a blank value printed as a rule (as `reportDocx`). */
export async function recipeReportDocx(
  kit: RecipeKit & Pick<WordKit, 'writeDocx'>,
  input: RecipeRouteInput,
): Promise<Uint8Array> {
  const { document } = await recipeReportDocument(kit, input)
  return kit.writeDocx(document, { nullCells: 'rule', creator: 'PGMaps' })
}
