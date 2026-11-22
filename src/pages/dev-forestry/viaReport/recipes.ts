/**
 * VIA reports as recipes: an ordered list of shared parts (`parts.ts`) and the document format whose arithmetic,
 * scale and wording the parts read (`viaDocument/formats.ts`). Most reports share most parts: the 2001 forms (01, 03,
 * 05) differ in the figures they carry and the numerical worksheet; the consultant reports (22, 23) share every part
 * and differ only in their arithmetic; the handbook's Appendix 1 (06, 07) is one part; the Board's comparison (21)
 * and the environmental assessment memo (26) are the two that assess without a VQO rating of their own.
 *
 * The recipes are JSON in document-kit's recipe format (`recipeJson/*.json`; `recipeRoute.ts` says how): that is
 * where a recipe is added or changed. The page reads them as `REPORT_RECIPES` from `recipeJson/recipes.generated.json`,
 * which the kit's own compile writes from the JSON (`npm run via-recipes:build`) and `recipeJson.test.ts` pins, so the
 * kit never loads with the page. Structure only, never branding. No DOM or network access.
 */
import type { OverviewSheetStyle } from '../reportMaps'
import { findDocumentFormat } from '../viaDocument/formats'
import { toCompleteLine } from '../viaDocument/wording'
import { inViewpointOrder, proposedBlocks, type ReportContext } from './parts'
import { findReportPart } from './registry'
import { editKeysOf, editPartBlocks, orphanEdits, type EditKeys, type EditTarget, type ReportEdits } from './edits'
import type { AssembledReport, ReportBlock, ReportItemToComplete, ReportLayout } from './model'
import { heading } from './model'
import generated from './recipeJson/recipes.generated.json'

export interface ReportRecipe {
  id: string
  name: string
  title: string
  /** Reference documents whose structure it follows. */
  sources: readonly string[]
  /** The VIA document format whose rule, scale and wording it reads. */
  format: string
  parts: readonly string[]
  purpose: string
  /** The figure style its pictures are drawn in, when not its format's (`presets.ts` id). */
  figureStyle?: string
  /** Paper, cover and contents; letter with neither when absent. */
  layout?: Partial<ReportLayout>
  /** How its parts draw what they can draw more than one way. */
  options?: ReportContext['recipeOptions']
  /** Its overview sheet's style when the reviewer has not chosen one (landscape topographic when absent). */
  overviewSheetStyle?: OverviewSheetStyle
  /**
   * Map pitch of its oblique renders of the blocks, degrees (`DEFAULT_OBLIQUE_PITCH` when absent): 60 looks down on
   * the blocks as 01's model confirmation does; about 75 stands near eye level on the viewpoint's side, as 02's
   * obliques do. Drawn through `horizonSafePitch` with roll 0.
   */
  obliquePitch?: number
  /**
   * A recipe someone made from the shared parts (`userRecipes.ts`), kept in their browser: the recipe it was copied
   * from, if any. Absent on the built-in recipes. Its report says it is an own recipe, never "in the structure of" a
   * reference document it no longer follows.
   */
  own?: { basedOn: string | null }
  /**
   * An own recipe's parts switched off in its contents (`recipeContents.ts`), each at its place in the whole list
   * (`parts` and these merged by place), so one switched on again comes back where it was. Nothing reads them but the
   * contents list: `parts` alone is what prints. Absent on the built-in recipes and when nothing is switched off.
   */
  leftOut?: ReadonlyArray<{ part: string; at: number }>
}

/** Map pitch of the report's oblique renders when a recipe gives none, degrees: about 60° down on the blocks. */
export const DEFAULT_OBLIQUE_PITCH = 60

/** The shipped recipes, compiled from `recipeJson/` (`recipes.generated.json`), in the order the page lists them. */
export const REPORT_RECIPES: readonly ReportRecipe[] = generated.recipes as unknown as readonly ReportRecipe[]

export const findReportRecipe = (id: string | null | undefined) =>
  REPORT_RECIPES.find((recipe) => recipe.id === id) ?? null

/** Document sentences whose missing judgement these parts already list for the reviewer, by sentence id. */
const LISTED_BY_PARTS: Readonly<Record<string, readonly string[]>> = {
  ocular: ['basic-definition', 'criteria-rating-2001'],
  // Appendix 1's forms list their own blank lines (b, the adjustments, the rating and the rationale) per viewpoint.
  x: ['appendix-1'],
  y: ['appendix-1'],
  rating: ['appendix-1'],
  rationale: ['appendix-1'],
}

/** What a report's values can be changed to by hand, and what was (`edits.ts`). */
export interface AssembledEdits {
  /** Every value a reviewer can edit, in reading order; an edited one carries its edit. */
  targets: EditTarget[]
  /** Each drawn value's key, for the draft's page. */
  keys: EditKeys
  /** Edits kept for this recipe's parts whose place no part printed. */
  orphans: string[]
}

/** One part as it printed in an assembled report: what it drew and what it left for the reviewer. */
export interface AssembledPart {
  id: string
  title: string
  sources: readonly string[]
  /** Its first block, as an object in `report.blocks`; null when it printed nothing for this assessment. */
  first: ReportBlock | null
  blocks: number
  toComplete: number
}

/** The report's subtitle: the licence and cutting permit, else the proposed blocks. No part is needed for it. */
export const reportSubtitle = (ctx: ReportContext): string =>
  ctx.office.cuttingPermit
    ? `${ctx.office.licence ? `${ctx.office.licence} ` : ''}CP ${ctx.office.cuttingPermit}`
    : proposedBlocks(ctx)
        .map((block) => block.name)
        .join(', ') || 'Proposed blocks'

/** The context every part of `recipe` is built with: the recipe's parts and options laid over `ctx`. */
export const partContext = (recipe: ReportRecipe, ctx: ReportContext): ReportContext => ({
  ...inViewpointOrder(ctx),
  recipeParts: recipe.parts,
  recipeOptions: { ...recipe.options, ...ctx.recipeOptions },
})

/** Assembles `recipe` from `ctx`: each part in order, with what each leaves for the reviewer. */
export function assembleReport(recipe: ReportRecipe, ctx: ReportContext): AssembledReport {
  return assembleReportParts(recipe, ctx).report
}

/**
 * As `assembleReport`, also saying which part printed what (`AssembledPart`), for the draft's part list and its marks
 * in the page. The report is the same object `assembleReport` returns.
 */
export function assembleReportParts(
  recipe: ReportRecipe,
  ctx: ReportContext,
  edits: ReportEdits = {},
): { report: AssembledReport; parts: AssembledPart[]; edits: AssembledEdits } {
  // Viewpoints print in the order of the numbers their names carry, whatever order the views were saved in.
  ctx = inViewpointOrder(ctx)
  const partCtx = partContext(recipe, ctx)
  const blocks: ReportBlock[] = []
  const toComplete: ReportItemToComplete[] = []
  const parts: AssembledPart[] = []
  const targets: EditTarget[] = []
  const keyMaps: Array<Map<object, Map<string, string>>> = []
  for (const id of recipe.parts) {
    const part = findReportPart(id)
    if (!part) throw new Error(`Unknown report part: ${id}`)
    const out = part.build(partCtx)
    // The reviewer's hand edits of this part's values (`edits.ts`); a blank filled by hand is no longer to complete.
    const edited = editPartBlocks(part, out.blocks, edits)
    const left = (out.toComplete ?? []).filter((what) => !edited.filled.includes(what))
    targets.push(...edited.targets)
    keyMaps.push(edited.keys)
    parts.push({
      id: part.id,
      title: part.title,
      sources: part.sources,
      first: edited.blocks[0] ?? null,
      blocks: edited.blocks.length,
      toComplete: left.length,
    })
    blocks.push(...edited.blocks)
    for (const what of left) toComplete.push({ part: part.title, what })
  }
  const applied = targets.filter((target) => target.edited !== undefined).length
  // The document's own unfilled sentences, once each, named by viewpoint and block; one a part of this recipe already
  // lists in its own words (the class by eye) is not listed twice.
  const listed = (id: string) => (LISTED_BY_PARTS[id] ?? []).some((part) => recipe.parts.includes(part))
  for (const item of ctx.document.toComplete.filter((entry) => !listed(entry.id)))
    toComplete.push({
      part: 'Wording',
      what: `${item.viewpoint ? `${item.viewpoint}: ` : ''}${item.about ? `${item.about}, ` : ''}${toCompleteLine(item)}`,
    })
  const project = reportSubtitle(ctx)
  const structure = recipe.own
    ? `PGMaps report from your own recipe, ${recipe.name}, built of shared parts${recipe.sources.length ? ` from reference document${recipe.sources.length > 1 ? 's' : ''} ${recipe.sources.join(', ')}` : ''}`
    : `PGMaps report in the structure of reference document${recipe.sources.length > 1 ? 's' : ''} ${recipe.sources.join(', ')}`
  const report: AssembledReport = {
    id: recipe.id,
    title: recipe.title,
    subtitle: project,
    sources: recipe.sources,
    blocks: [heading(recipe.title, 1), ...blocks],
    toComplete,
    layout: { paper: 'letter', cover: false, contents: false, ...recipe.layout },
    // The count stays on the page (a reviewer's change is printed as theirs); what the report is goes in its properties.
    footer: applied ? `${applied} value${applied === 1 ? '' : 's'} changed by hand by the reviewer.` : '',
    about: `${structure}, generated ${ctx.date.toISOString().slice(0, 10)}`,
  }
  return {
    report,
    parts,
    edits: { targets, keys: editKeysOf(keyMaps), orphans: orphanEdits(edits, recipe.parts, targets) },
  }
}

/**
 * The report with the views of its package it does not print named at its end, each with why (a view not captured,
 * or one whose analysis sheet could not be drawn), and listed to complete before signing. A report never drops a
 * view silently. Unchanged when every view prints.
 */
export function withViewsLeftOut(
  report: AssembledReport,
  leftOut: ReadonlyArray<{ name: string; reason: string }>,
): AssembledReport {
  if (!leftOut.length) return report
  return {
    ...report,
    blocks: [
      ...report.blocks,
      heading('Views left out of this report', 2),
      {
        kind: 'list',
        items: leftOut.map((view) => `${view.name}: ${view.reason.replace(/[.\s]*$/, '')}.`),
        source: 'run',
      },
    ],
    toComplete: [
      ...report.toComplete,
      ...leftOut.map((view) => ({
        part: 'Figures',
        what: `${view.name} is not in the report (${view.reason.replace(/[.\s]*$/, '')}): capture it again or leave it out of the package`,
      })),
    ],
  }
}

/**
 * A report written though some of its pictures could not be drawn: each group that failed (the maps from the plan,
 * the before pictures, the renders) is named on the to-complete list with why. Nothing is printed in its place: the
 * parts that would have drawn it print nothing for it.
 */
export function withPicturesNotDrawn(
  report: AssembledReport,
  notDrawn: ReadonlyArray<{ what: string; reason: string }>,
): AssembledReport {
  if (!notDrawn.length) return report
  return {
    ...report,
    toComplete: [
      ...report.toComplete,
      ...notDrawn.map((entry) => ({
        part: 'Figures',
        what: `${entry.what} could not be drawn (${entry.reason.replace(/[.\s]*$/, '')}): write the report again to draw them`,
      })),
    ],
  }
}

/** The document format a recipe reads, checked. */
export function recipeFormat(recipe: ReportRecipe) {
  const format = findDocumentFormat(recipe.format)
  if (!format) throw new Error(`Report ${recipe.id} names an unknown format: ${recipe.format}`)
  return format
}
