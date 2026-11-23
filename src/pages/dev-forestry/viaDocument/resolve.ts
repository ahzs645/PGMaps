/**
 * Fills a VIA document format from one assessment. The facts are what PGMaps already holds for a set block: per
 * station, the class pass's areas (`FigureCounts`), the run's sightline figure, the block callouts' statuses, the
 * viewing distance and lens, the landform and its inventory unit, and, where the reviewer has given them, the
 * judgements the run never makes. One set of facts fills every format: the format decides the arithmetic, the scale,
 * the tables and the wording, and its recipes say which images to take.
 *
 * Nothing here invents a judgement: a sentence or cell that needs one the reviewer has not given is left out and
 * listed in `toComplete`. No DOM or network access.
 */
import {
  alteration,
  formatAlteration,
  type Alteration,
  type AlterationAreas,
} from '@/lib/forestry/viaFigure/alteration'

import type { CalloutStatus } from '../figureCallouts'
import {
  findDocumentFormat,
  T4,
  T5,
  type KeyViewpointMode,
  type KeyViewpointRule,
  type RenderRecipe,
  type ViaDocumentFormat,
} from './formats'
import {
  CLASS_NAMES,
  distanceTerm,
  PERCENT_SCALES,
  readPercent,
  REFERRAL_CEILINGS,
  type DistanceScale,
  scaleTerm,
  underCeiling,
  type ClassCode,
} from './scales'
import {
  APPENDIX_1,
  COMPARISON_STRIP,
  DEFINITION_PARTS,
  DISTRICT_SUMMARY,
  fillSentence,
  FORM_2001,
  PERSPECTIVE_REPORT,
  plainVisibility,
  REFERRAL,
  unseenTerms,
  type Sentence,
  type SentenceTemplate,
  type SlotValues,
} from './wording'

/** A block as one station sees it (`figureCallouts.ts`). */
export interface BlockAtStation {
  id: string
  status: CalloutStatus
  /** Share of its samples seen, percent. */
  visiblePercent: number
  /**
   * Whether the block counts as proposed. False: a block of another sale, licensee or cutting permit, or a CP-ready
   * block, counted in the figure beside the proposal but assessed in its own VIA (22's "other planned" blocks).
   */
  proposed?: boolean
  /** The sale or permit another planned block belongs to, when its record gives it ("TA0333"). */
  plannedUnder?: string
  /**
   * The block's share of the proposed blocks' visible apparent size at this viewpoint (0-1), from the run: what
   * splits the viewpoint's percent alteration by block. Absent when the run does not give it.
   */
  share?: number
  /** Share of the block's ground hidden only by standing timber from this viewpoint, percent; absent on older runs. */
  screenedPercent?: number
  /**
   * A partial cut (handbook 3.4.4): not cleared ground, so it takes no `share` of the viewpoint's proposed figure;
   * its pixels are `areas.partialCut` and the run adds its Table 6 figure to X.
   */
  partialCut?: true
  /**
   * The block's own distance from this viewpoint, km: its nearest sample seen from the eye. Absent when the run does
   * not give it or nothing of the block is seen.
   */
  distanceKm?: number
  /**
   * How far the block's callout lies off the view's centre line, degrees (negative to the left), from where its
   * anchor falls in the framed picture. Absent on older figures.
   */
  offAxisDeg?: number
}

/** The judgements a reviewer gives per viewpoint; every one optional. */
export interface ViewpointReview {
  impact?: string
  visibility?: string
  ocular?: string
  forceLines?: string
  borrow?: string
  edges?: string
  islands?: string
  position?: string
  design?: string
  extent?: string
  importance?: string
  duration?: string
  /** Handbook 3.2.1's viewpoint type, 1 to 5, as the reviewer recorded it for this view. */
  viewpointType?: number
  rationale?: string
  /** Why the viewpoint was chosen ("high boat traffic", 22, 23 Table 3). */
  selectionReason?: string
  /** What viewing from it is like ("sustained focal and side views", 22, 23 Table 3). */
  viewingExperience?: string
}

/** The 2022 handbook's Appendix 1 figures, from `assessVia` when the reviewer has worked step 4. */
export interface ViewpointAppendix1 {
  a: number
  b: number
  c: number
  x: number
  y: number | null
  adjusted: number | null
  rating: string | null
}

export interface DocumentViewpoint {
  name: string
  /** Sequence number on the sheet ("Viewpoint #{n}"). */
  n?: string
  landform: string
  /** The landform's established objective. */
  objective: ClassCode | null
  /** The view's inventory unit; `date` is the record's last update (`UPDATE_DATE`), the layer's only date. */
  inventory?: { vsu?: string; vsc?: string; vac?: string; evc?: string; vqo?: string; date?: string } | null
  /** The class pass's areas, pixels; null when the view has no class pass. */
  areas: AlterationAreas | null
  /**
   * The other landforms the view sees, each with the areas of its own class pass of the same frames (a sub-landform,
   * or the whole landform beside an assessed sub-landform; 23 A6 calculates Landform 1, 1a and 1b from one viewpoint).
   * `blocks` names the blocks with ground in it. Tables 4 and 5 give each a row of its own. Absent: one landform.
   */
  otherLandforms?: ReadonlyArray<{
    landform: string
    objective: ClassCode | null
    areas: AlterationAreas
    blocks: readonly string[]
  }>
  /**
   * The blocks with ground in the view's own landform, by the names `blocks` uses: what each block is cited on (its
   * text, Tables 2, 4 and 5). A block in neither it nor an `otherLandforms` entry lies in no landform assessed from
   * here. Absent (views saved before it was recorded): every block in view is read on the view's landform.
   */
  landformBlocks?: readonly string[]
  /**
   * The same areas with the drawn timber in front (an engine's screened pass, or PGMaps' before/after measure,
   * `timberScreen.ts`), or why they were not measured. A second pixel figure printed beside `areas`' and the
   * sightline figure, never instead of either. Absent: not looked for (hand-built facts).
   */
  withTimber?: { areas: AlterationAreas; source: 'engine' | 'pgmaps' } | { absent: string }
  /** The run's sightline figure at the station, percent: the assessment's figure. */
  sightlinePercent: number | null
  /**
   * Printed in place of `sightlinePercent` when the run did not stand behind a figure at the save (`capturedSightline`):
   * "Withheld — …" or that readiness was not recorded. Absent: the figure stands, or there is none.
   */
  sightlineWithheld?: string
  /**
   * Why the pixel figure and the sightline figure can part, when the picture drew the blocks' ground from much
   * coarser elevation cells than the run walked (`terrainDetailNote`): printed beside the two, neither adjusted.
   */
  terrainNote?: string
  /**
   * What the existing openings' green-up rests on (`runGreenUpBasis`: "modelled", "supplied estimate for 7 of 19
   * openings, modelled for 12", "field-confirmed …"), printed beside the existing-openings figure. Absent: not given.
   */
  greenUp?: string
  /**
   * What the existing openings counted rest on (`runExistingBasis`): the inventory's complete read over the landform,
   * or the reviewer's assumption that the included features are all of it. Absent: not given.
   */
  existingBasis?: string
  distanceKm: number | null
  hfovDeg?: number | null
  lensMm?: number | null
  lngLat?: [number, number] | null
  /** The eye's elevation above sea level, metres, when the view was framed at a known pose. */
  elevationM?: number | null
  /** The view's centre line, degrees clockwise from north (the camera's azimuth). */
  bearingDeg?: number | null
  blocks: readonly BlockAtStation[]
  review?: ViewpointReview
  /**
   * Whether this view stands at the run's assessment station, the one view the step 4 judgements belong to. Absent
   * (hand-built facts): the view carrying a `review` is taken as it (`atAssessmentStation`, `facts.ts`).
   */
  atAssessment?: boolean
  /**
   * The reviewer's step 4 applies to this view: it stands at the run's station, or its group of views of interest has
   * a step 4 of its own (`ViaReview.stations`), rated on the view's own captured figure. Absent: as `atAssessment`.
   */
  judged?: boolean
  /** Step 4's terms by eye for this view (its group's), and the ocular class they give; absent when not judged. */
  ocular?: {
    visibleness?: string | null
    scale?: string | null
    shape?: string | null
    classId?: string | null
  }
  appendix1?: ViewpointAppendix1 | null
}

/** A key viewpoint the reviewer chose, by the viewpoint's name in these facts, with the reason they gave. */
export interface KeyViewpointPick {
  viewpoint: string
  reason?: string
}

/** The reviewer's own key viewpoints, which override the run's choice (`chooseKeyViewpoints`). */
export interface KeyViewpointPicks {
  /** By block, under the name the scene gives it. */
  blocks?: Readonly<Record<string, KeyViewpointPick>>
  /** Group mode: the viewpoint the blocks are assessed from together. */
  group?: KeyViewpointPick | null
}

export interface DocumentFacts {
  /** The project or cutting permit, as the document names it ("the proposed blocks" when unnamed). */
  project: string
  viewpoints: readonly DocumentViewpoint[]
  /** Whether the run's sightlines counted standing timber as screening; false: bare ground only. Absent: unknown. */
  screeningModelled?: boolean
  /** Key viewpoints the reviewer chose; absent, the run chooses them all. */
  keyViewpoints?: KeyViewpointPicks
  /**
   * Each sub-landform's parent landform as step 1 records it, by the name the viewpoints read; a name read the
   * references' way ("Landform 1a") gives its parent without a record (`landformParentFromName`).
   */
  landformParents?: Readonly<Record<string, string>>
}

/**
 * The landform a sub-landform's name places it in, read the references' way: "Landform 1b" and "Sub-landform 1a"
 * belong to Landform 1. A trailing note in brackets ("Landform 1b (consultant, traced)") is the outline's source.
 * Null for a name that is not a sub-landform's.
 */
export function landformParentFromName(name: string): string | null {
  const named = name.match(/^(?:sub-?\s*landform|landform)\s+(\d+)[a-z](?:\s*\(.*\))?$/i)
  return named ? `Landform ${named[1]}` : null
}

export interface ResolvedViewpoint {
  name: string
  alteration: Alteration | null
  /** The figure as the format prints it, with the class or term it reads as. */
  printed: { percent: string; term: string; classCode: ClassCode | null } | null
  /** The with-timber pixel figure on the format's rule, or why it was not measured; absent when not looked for. */
  withTimber?: { percent: string } | { absent: string }
  distance: { km: string; term: string } | null
  rows: Record<string, Array<Record<string, string>>>
  sentences: Sentence[]
}

export interface ResolvedDocument {
  format: ViaDocumentFormat
  recipes: readonly RenderRecipe[]
  viewpoints: ResolvedViewpoint[]
  /** Document-level sentences (objective paragraph, verdict, conclusion, strip footer). */
  summary: Sentence[]
  /** Sentences and cells waiting on a reviewer, with the slots they need and the template's label when it has one. */
  toComplete: Array<{ viewpoint: string | null; id: string; missing: string[]; about?: string; label?: string }>
  /**
   * Perspective reports: each block, or the blocks assessed together, discussed once from where it is assessed; the
   * same sentences as the viewpoints', in discussion order. Empty for other formats.
   */
  discussion: DiscussionSection[]
  /** How the key viewpoints were chosen, and where each block is assessed from (perspective reports). */
  keyViewpoints: { mode: KeyViewpointMode; choice: KeyViewpointChoice } | null
  /**
   * Blocks of another sale or permit seen or listed by any viewpoint, by name: counted in the figures, assessed in
   * their own VIA. `sentence` names them once (perspective reports), or is null when there are none.
   */
  otherPlanned: { blocks: string[]; sentence: Sentence | null }
}

const lower = (text: string | undefined) => (text ? text.toLowerCase() : undefined)
const km = (value: number | null) => (value === null ? null : value.toFixed(1))
/** A distance's term read on the figure as printed (1.998 km prints 2.0 km and reads as 2.0), never the raw value. */
const termAt = (scale: DistanceScale, value: number) => distanceTerm(scale, Number(value.toFixed(1)))

function sentenceFrom(template: SentenceTemplate, values: SlotValues): Sentence {
  return { ...fillSentence(template.id, template.template, values, template.source), label: template.role }
}

/** "Block A", "Blocks A and B", "Blocks A, B and C". */
/** A block's id as a sentence prints it after "Block": its name without a leading "Block" or "Blocks". */
export const blockId = (name: string) => name.replace(/^blocks?\s+/i, '').trim() || name

export function blockList(names: readonly string[]): string {
  const ids = names.map(blockId)
  if (!ids.length) return ''
  if (ids.length === 1) return `Block ${ids[0]}`
  return `Blocks ${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1]}`
}

const seen = (block: BlockAtStation) => block.status === 'visible' || block.status === 'possible glimpses'

// ------------------------------------------------------------------ blocks of another sale or permit

/** Words in a block's name that mark it as planned under another sale or permit, counted but assessed elsewhere. */
const OTHER_PLANNED_WORDS = /^(other planned|other sale|another sale|cp[- ]ready|separate via|assessed separately)$/i

/**
 * A block named as planned under another sale or permit ("EGG5 (TA0333, other planned)"): its own name and the sale
 * or permit the name gives. The fallback for scenes that mark such blocks only in their names; null otherwise.
 */
export function otherPlannedName(name: string): { id: string; plannedUnder: string | null } | null {
  const match = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(name)
  if (!match) return null
  const parts = match[2]
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  if (!parts.some((part) => OTHER_PLANNED_WORDS.test(part))) return null
  const rest = parts.filter((part) => !OTHER_PLANNED_WORDS.test(part))
  return { id: match[1].trim() || name, plannedUnder: rest.join(', ') || null }
}

/**
 * The blocks with ground in a landform as one viewpoint read it: its own landform's (`landformBlocks`) or another's it
 * sees (`otherLandforms`). Null when the view recorded no list for it: every block it sees is read on it, as before.
 */
export function blocksOnLandform(vp: DocumentViewpoint, landform: string): readonly string[] | null {
  if (landform === vp.landform) return vp.landformBlocks ?? null
  return vp.otherLandforms?.find((entry) => entry.landform === landform)?.blocks ?? null
}

/**
 * The landform a block is cited on at a viewpoint: the view's own when it holds the block (or recorded no list),
 * else another landform the view reads that holds it, a sub-landform before the whole; null when none does.
 */
export function landformOfBlock(
  vp: DocumentViewpoint,
  id: string,
  parentOf: (landform: string) => string | null = () => null,
): { landform: string; other: NonNullable<DocumentViewpoint['otherLandforms']>[number] | null } | null {
  if (!vp.landformBlocks || vp.landformBlocks.includes(id)) return { landform: vp.landform, other: null }
  const holding = (vp.otherLandforms ?? []).filter((entry) => entry.blocks.includes(id))
  const other = holding.find((entry) => parentOf(entry.landform)) ?? holding[0]
  return other ? { landform: other.landform, other } : null
}

/** A block marked other planned by its flag or, failing that, its name; its id is then its own name. */
export function normalizeBlock(block: BlockAtStation): BlockAtStation {
  const named = otherPlannedName(block.id)
  if (!named) return block
  return {
    ...block,
    id: named.id,
    proposed: false,
    ...(block.plannedUnder || !named.plannedUnder ? {} : { plannedUnder: named.plannedUnder }),
  }
}

export const isOtherPlanned = (block: BlockAtStation) => block.proposed === false

// ------------------------------------------------------------------ key viewpoints

export interface KeyViewpointChoice {
  /** Each proposed block some viewpoint sees, by the index of the viewpoint it is assessed from. */
  byBlock: Map<string, number>
  /** Group mode: the viewpoint the blocks are assessed from together and the blocks it sees (two or more). */
  group: { index: number; blocks: string[] } | null
  /** What they were chosen by (`visibility` when absent). */
  rule?: KeyViewpointRule
  /** The choices the reviewer made, with the reason given ('' for none): blocks by id, and the group's. */
  reviewer?: { blocks: Map<string, string>; group: string | null }
  /** Reviewer choices not taken: the viewpoint named does not see the block (or, for a group, two of them). */
  declined?: Array<{ block: string | null; viewpoint: string }>
}

const SIGNIFICANCE_WORDS: Array<[RegExp, number]> = [
  [/moderate\s+to\s+high/i, 4],
  [/low\s+to\s+moderate/i, 2],
  [/high/i, 5],
  [/moderate/i, 3],
  [/low/i, 1],
]
/** A viewpoint's significance on Table 3's 1-5 scale, from the reviewer's entry ("High (5)", "4", "Moderate"). */
export function significanceScore(text: string | null | undefined): number | null {
  if (!text) return null
  const digit = text.match(/\b([1-5])\b/)
  if (digit) return Number(digit[1])
  return SIGNIFICANCE_WORDS.find(([pattern]) => pattern.test(text))?.[1] ?? null
}

/**
 * The viewpoints the proposed blocks are assessed from, from the run: the references choose the most direct view,
 * the one that sees most of a block, and the run measures that as the share of the block's ground in view.
 *
 * - `per-block` (22): each block's key viewpoint sees the largest share of its ground; a tie goes to a viewpoint
 *   whose landform shows the alteration, then to the earlier.
 * - `group` (23): one viewpoint for the blocks together: the one that sees the most of them, then (on a tie) one
 *   whose landform shows the alteration, then the largest summed share. A block it does not see takes its own.
 *
 * Blocks of another sale or permit never have a key viewpoint: they are assessed in their own VIA.
 *
 * A key viewpoint the reviewer chose (`picks`) overrides the run's, when that viewpoint sees the block (for a group,
 * two or more of the blocks); a block the reviewer gives its own viewpoint leaves the group. A choice that cannot be
 * taken is listed in `declined` and the run's stands.
 */
export function chooseKeyViewpoints(
  viewpoints: readonly DocumentViewpoint[],
  mode: KeyViewpointMode = 'per-block',
  /** Whether a viewpoint's landform shows any alteration. */
  altered: (index: number) => boolean = () => true,
  rule: KeyViewpointRule = 'visibility',
  /** The percent alteration of a viewpoint's landform, for the `impact` rule. */
  percentAt: (index: number) => number | null = () => null,
  picks: KeyViewpointPicks | null = null,
): KeyViewpointChoice {
  const run = chooseFromRun(viewpoints, mode, altered, rule, percentAt)
  const blockPicks = Object.entries(picks?.blocks ?? {})
  const groupPick = mode === 'group' ? (picks?.group ?? null) : null
  if (!blockPicks.length && !groupPick) return run
  const own = (index: number) =>
    viewpoints[index].blocks.filter((block) => seen(block) && !isOtherPlanned(block)).map((block) => block.id)
  const indexOf = (name: string) => viewpoints.findIndex((vp) => vp.name === name)
  const single = mode === 'group' ? chooseFromRun(viewpoints, 'per-block', altered, rule, percentAt).byBlock : null
  const byBlock = new Map(run.byBlock)
  let group = run.group ? { index: run.group.index, blocks: [...run.group.blocks] } : null
  const reviewer = { blocks: new Map<string, string>(), group: null as string | null }
  const declined: NonNullable<KeyViewpointChoice['declined']> = []
  if (groupPick) {
    const index = indexOf(groupPick.viewpoint)
    const members = index < 0 ? [] : own(index)
    if (members.length >= 2) {
      // Blocks of the run's group this viewpoint does not see go back to their own key viewpoints.
      for (const id of group?.blocks ?? []) if (!members.includes(id)) byBlock.set(id, single?.get(id) ?? -1)
      for (const id of members) byBlock.set(id, index)
      group = { index, blocks: members }
      reviewer.group = groupPick.reason?.trim() ?? ''
    } else declined.push({ block: null, viewpoint: groupPick.viewpoint })
  }
  for (const [name, pick] of blockPicks) {
    const index = indexOf(pick.viewpoint)
    const id =
      index < 0 ? undefined : own(index).find((entry) => blockId(entry) === blockId(otherPlannedName(name)?.id ?? name))
    if (id === undefined) {
      declined.push({ block: name, viewpoint: pick.viewpoint })
      continue
    }
    byBlock.set(id, index)
    reviewer.blocks.set(id, pick.reason?.trim() ?? '')
    if (group && group.index !== index) group.blocks = group.blocks.filter((entry) => entry !== id)
  }
  if (group && group.blocks.length < 2) {
    // A group left with one block is that block at its own key viewpoint, unless the reviewer put it there.
    for (const id of group.blocks) if (!reviewer.blocks.has(id)) byBlock.set(id, single?.get(id) ?? group.index)
    group = null
    reviewer.group = null
  }
  for (const [id, index] of byBlock) if (index < 0) byBlock.delete(id)
  return { byBlock, group, rule, reviewer, ...(declined.length ? { declined } : {}) }
}

function chooseFromRun(
  viewpoints: readonly DocumentViewpoint[],
  mode: KeyViewpointMode,
  altered: (index: number) => boolean,
  rule: KeyViewpointRule,
  percentAt: (index: number) => number | null,
): KeyViewpointChoice {
  const own = (vp: DocumentViewpoint) => vp.blocks.filter((block) => seen(block) && !isOtherPlanned(block))
  // Compared in order, larger first; the first difference decides. Visibility: the share, then an altered landform.
  // Impact: the significance, then the percent alteration, then the share.
  // A group's visibility key puts the altered landform before the summed share, as the references do.
  const key = (index: number, share: number, group = false) =>
    rule === 'impact'
      ? [significanceScore(viewpoints[index].review?.importance) ?? 0, percentAt(index) ?? 0, share]
      : group
        ? [altered(index) ? 1 : 0, share]
        : [share, altered(index) ? 1 : 0]
  const before = (a: number[], b: number[]) => {
    for (let k = 0; k < a.length; k++) if (Math.abs(a[k] - b[k]) > 1e-9) return a[k] > b[k]
    return false
  }
  const byBlock = new Map<string, number>()
  const best = new Map<string, { index: number; key: number[] }>()
  viewpoints.forEach((vp, index) => {
    for (const block of own(vp)) {
      const current = best.get(block.id)
      const mine = key(index, block.visiblePercent)
      if (!current || before(mine, current.key)) best.set(block.id, { index, key: mine })
    }
  })
  for (const [id, entry] of best) byBlock.set(id, entry.index)
  if (mode !== 'group') return { byBlock, group: null, rule }
  // The group's viewpoint sees the most of the blocks; among those, the rule decides on the summed share.
  let group: { index: number; key: number[] } | null = null
  viewpoints.forEach((vp, index) => {
    const blocks = own(vp)
    if (!blocks.length) return
    const sum = blocks.reduce((s, b) => s + b.visiblePercent, 0)
    const entry = { index, key: [blocks.length, ...key(index, sum, true)] }
    if (!group || before(entry.key, group.key)) group = entry
  })
  const chosen = group as { index: number } | null
  if (!chosen) return { byBlock, group: null, rule }
  const members = own(viewpoints[chosen.index]).map((block) => block.id)
  if (members.length < 2) return { byBlock, group: null, rule }
  for (const id of members) byBlock.set(id, chosen.index)
  return { byBlock, group: { index: chosen.index, blocks: members }, rule }
}

/** Each block's key viewpoint, by index, one per block (`chooseKeyViewpoints` in `per-block` mode). */
export function keyViewpoints(
  viewpoints: readonly DocumentViewpoint[],
  altered: (index: number) => boolean = () => true,
): Map<string, number> {
  return chooseKeyViewpoints(viewpoints, 'per-block', altered).byBlock
}

// ------------------------------------------------------------------ the discussion

/** A paragraph of the discussion; `label` leads it ("Visibility", 23) when it has a sentence to lead. */
export interface DiscussionParagraph {
  label?: string
  sentences: Sentence[]
}

/** One block, or the blocks assessed together, discussed once from where they are assessed. */
export interface DiscussionSection {
  heading: string
  /** The viewpoint it is written from; null for blocks no viewpoint sees. */
  viewpoint: string | null
  landform: string | null
  /** The blocks it discusses, by name. */
  blocks: string[]
  paragraphs: DiscussionParagraph[]
}

const NUMBER_WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
const allOf = (n: number) => (n === 2 ? 'both' : `all ${NUMBER_WORDS[n] ?? n}`)
/** "a", "a and b", "a, b and c". */
export const andList = (items: readonly string[]) =>
  items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
const plural = (n: number) => ({
  isAre: n === 1 ? 'is' : 'are',
  itsTheir: n === 1 ? 'its' : 'their',
  itThem: n === 1 ? 'it' : 'them',
  ItThey: n === 1 ? 'It' : 'They',
})

interface PerspectiveInput {
  format: ViaDocumentFormat
  viewpoints: readonly DocumentViewpoint[]
  results: readonly (Alteration | null)[]
  choice: KeyViewpointChoice
  /** A sub-landform's parent landform, or null (`DocumentFacts.landformParents`, else the name). */
  parentOf?: (landform: string) => string | null
}

interface PerspectiveOut {
  sections: DiscussionSection[]
  /** Sentences by the viewpoint they are written from (for the to-complete list). */
  byViewpoint: Sentence[][]
  /** Table 5's rows by viewpoint index: the blocks assessed there, in discussion order, then the landform's row. */
  rows: Array<Array<Record<string, string>>>
  extraToComplete: Array<{ viewpoint: string | null; id: string; missing: string[]; about?: string }>
}

/** The landform a block is cited on at a viewpoint, with its figure and the blocks with ground in it (null: all). */
interface CitedLandform {
  landform: string
  objective: ClassCode | null
  result: Alteration | null
  areas: AlterationAreas | null
  blocks: readonly string[] | null
}

/** Table 5's landform cell for a block no landform read from its viewpoint holds. */
const OUTSIDE_LANDFORMS = 'Outside the landforms outlined'

function perspectiveDiscussion({
  format,
  viewpoints,
  results,
  choice,
  parentOf = () => null,
}: PerspectiveInput): PerspectiveOut {
  const sections: DiscussionSection[] = []
  const byViewpoint: Sentence[][] = viewpoints.map(() => [])
  const extraToComplete: PerspectiveOut['extraToComplete'] = []
  const fill = (template: SentenceTemplate, values: SlotValues, about: string) => ({
    ...sentenceFrom(template, values),
    about,
  })
  const sizeTermAt = (i: number) =>
    results[i] ? lower(scaleTerm(format.percentScale, results[i]!.printedValue)) : undefined
  const distanceRatingAt = (i: number) =>
    viewpoints[i].distanceKm === null ? undefined : lower(termAt(format.distanceScale, viewpoints[i].distanceKm!))
  const zeroAt = (i: number) => results[i] !== null && results[i]!.printedValue === 0
  const seenAt = (i: number) => viewpoints[i].blocks.filter(seen)
  // A block's own distance from the viewpoint: the run's, else the nearest block in view's when it is the only one.
  const ownDistanceAt = (i: number, block: BlockAtStation): number | null =>
    block.distanceKm ??
    (seen(block) && seenAt(i).every((other) => other.id === block.id) ? viewpoints[i].distanceKm : null)
  // A block's own figure at a viewpoint: the proposed part of the viewpoint's figure, split by the block's share of
  // the proposed blocks' visible apparent size in the run. Null when the run gives no share.
  const blockPercentAt = (i: number, block: BlockAtStation) => {
    const result = results[i],
      areas = viewpoints[i].areas
    if (block.share === undefined || !result || !areas || result.denominator <= 0) return null
    const value = (100 * areas.proposed * block.share) / result.denominator
    return { value, printed: formatAlteration(value, format.rule) }
  }
  // The landform a block is cited on at a viewpoint (`landformOfBlock`), with its figure and the blocks with ground in
  // it (null: the view recorded no list, so every block in view). Null when no landform read from there holds it.
  const citedOn = (i: number, id: string): CitedLandform | null => {
    const vp = viewpoints[i]
    const home = landformOfBlock(vp, id, parentOf)
    if (!home) return null
    if (!home.other)
      return {
        landform: vp.landform,
        objective: vp.objective,
        result: results[i],
        areas: vp.areas,
        blocks: vp.landformBlocks ?? null,
      }
    return {
      landform: home.other.landform,
      objective: home.other.objective ?? vp.objective,
      result: alteration(format.rule, home.other.areas),
      areas: home.other.areas,
      blocks: home.other.blocks,
    }
  }
  const zeroOn = (on: CitedLandform) => on.result !== null && on.result.printedValue === 0
  const sizeTermOn = (on: CitedLandform) =>
    on.result ? lower(scaleTerm(format.percentScale, on.result.printedValue)) : undefined
  // The blocks in view with ground in the landform a block is cited on.
  const seenOn = (i: number, on: CitedLandform) => seenAt(i).filter((b) => !on.blocks || on.blocks.includes(b.id))
  // A block's own figure on the landform it is cited on: that landform's proposed part, split by the block's share of
  // the visible apparent size of the blocks in view with ground in it. Null when the run gives no share.
  const blockPercentOn = (i: number, block: BlockAtStation, on: CitedLandform) => {
    const { result, areas } = on
    if (block.share === undefined || !result || !areas || result.denominator <= 0) return null
    const total = on.blocks ? seenOn(i, on).reduce((sum, b) => sum + (b.share ?? 0), 0) : 1
    if (!(total > 0)) return null
    const value = (100 * areas.proposed * block.share) / total / result.denominator
    return { value, printed: formatAlteration(value, format.rule) }
  }
  // Where a block outside its key viewpoint's landform is measured instead: the viewpoint that sees most of it among
  // those whose landform holding it shows the alteration.
  const measuredAt = (ids: readonly string[], except: number) => {
    let found: { index: number; share: number; on: CitedLandform } | null = null
    viewpoints.forEach((vp, index) => {
      if (index === except) return
      const on = ids.length ? citedOn(index, ids[0]) : null
      if (!on || !on.result || zeroOn(on)) return
      const share = vp.blocks
        .filter((b) => ids.includes(b.id) && seen(b) && (!on.blocks || on.blocks.includes(b.id)))
        .reduce((s, b) => s + b.visiblePercent, 0)
      if (share > 0 && (!found || share > found.share)) found = { index, share, on }
    })
    return found as { index: number; share: number; on: CitedLandform } | null
  }
  // `on`: the landform it is cited on, whose figure is 0; null when no landform read from here holds it.
  const outside = (
    i: number,
    ids: readonly string[],
    about: string,
    first: string | null = null,
    on: CitedLandform | null | undefined = undefined,
  ): Sentence[] => {
    const vp = viewpoints[i]
    const landform = on ? on.landform : vp.landform
    const out = [
      on === null
        ? fill(
            PERSPECTIVE_REPORT.scaleOutsideAll,
            {
              landforms: andList([vp.landform, ...(vp.otherLandforms ?? []).map((entry) => entry.landform)]),
              subject: ids.length === 1 ? 'block' : 'blocks',
              itThem: plural(ids.length).itThem,
            },
            about,
          )
        : first
          ? fill(PERSPECTIVE_REPORT.scaleOutsideSame, { first, landform }, about)
          : fill(
              PERSPECTIVE_REPORT.scaleOutside,
              {
                landform,
                subject: ids.length === 1 ? 'block' : 'blocks',
                percent: (on ? on.result : results[i])?.printed,
                itThem: plural(ids.length).itThem,
              },
              about,
            ),
    ]
    const other = measuredAt(ids, i)
    if (other)
      out.push(
        fill(
          PERSPECTIVE_REPORT.scaleMeasuredAt,
          {
            viewpoint: viewpoints[other.index].name,
            landform: other.on.landform,
            percent: other.on.result?.printed,
            sizeTerm: sizeTermOn(other.on),
          },
          about,
        ),
      )
    extraToComplete.push({
      viewpoint: vp.name,
      id: 'landform-outline',
      missing: ['the landform holding the block, outlined from this viewpoint'],
      about,
    })
    return out
  }

  const blockRow = (i: number, block: BlockAtStation) => {
    const vp = viewpoints[i]
    const r = vp.review
    const isSeen = seen(block)
    // Cited on the landform it lies in; one no landform read from here holds has no figure of its own.
    const on = citedOn(i, block.id)
    const ownShare = !isSeen
      ? block.status === 'not visible'
        ? '0.00'
        : ''
      : !on || zeroOn(on)
        ? ''
        : seenOn(i, on).length === 1
          ? (on.result?.printed ?? '')
          : (blockPercentOn(i, block, on)?.printed ?? '')
    // The block's own distance; with one block in view the nearest block's is its own. Otherwise the nearest block
    // in view only bounds it, so no rating is read from it.
    const own = ownDistanceAt(i, block)
    const distance =
      own !== null
        ? `${termAt(format.distanceScale, own)} ${km(own)} km`
        : isSeen && vp.distanceKm !== null
          ? `at least ${km(vp.distanceKm)} km`
          : ''
    return {
      [T5.viewpoint]: vp.name,
      [T5.block]: `Block ${block.id}`,
      [T5.landform]: on ? on.landform : OUTSIDE_LANDFORMS,
      [T5.impact]: isSeen ? (r?.impact ?? '') : block.status === 'not visible' ? 'Not visible' : '',
      [T5.percent]: ownShare,
      [T5.forceLines]: isSeen ? (r?.forceLines ?? '') : 'N/A',
      [T5.borrow]: isSeen ? (r?.borrow ?? '') : 'N/A',
      [T5.edges]: r?.edges ?? '',
      [T5.islands]: r?.islands ?? '',
      [T5.distance]: distance,
      [T5.position]: isSeen ? (r?.position ?? '') : 'N/A',
      [T5.design]: r?.design ?? '',
      [T5.met]: r?.extent ?? '',
    }
  }
  const rows: PerspectiveOut['rows'] = viewpoints.map(() => [])

  // Why the group's viewpoint, by impact (23): its significance, then its alteration against the viewpoints that see
  // as many of the blocks (and, when significance is given, are as significant).
  const impactReason = (i: number, ids: string[], about: string): Sentence[] => {
    const owned = (vp: DocumentViewpoint) => vp.blocks.filter((b) => seen(b) && !isOtherPlanned(b)).length
    const significance = (j: number) => significanceScore(viewpoints[j].review?.importance)
    const anyGiven = viewpoints.some((_, j) => significance(j) !== null)
    const peers = viewpoints
      .map((vp, j) => ({ j, vp }))
      .filter(({ j, vp }) => j !== i && owned(vp) === ids.length && (!anyGiven || significance(j) === significance(i)))
      .filter(({ j }) => results[j])
      .sort((a, b) => (results[b.j]!.printedValue ?? 0) - (results[a.j]!.printedValue ?? 0))
    const given = viewpoints[i].review?.importance
    const scope = `the viewpoints that see ${ids.length === 2 ? 'both' : 'them all'}${
      anyGiven && given ? ` and are of ${given} significance` : ''
    }`
    return [
      fill(PERSPECTIVE_REPORT.keyGroupImpact, { seenCount: allOf(ids.length), scope }, about),
      ...(peers.length
        ? [
            fill(
              PERSPECTIVE_REPORT.keyImpactRunnerUp,
              { runnerUp: peers[0].vp.name, runnerPercent: results[peers[0].j]!.printed },
              about,
            ),
          ]
        : []),
      ...(anyGiven ? [] : [fill(PERSPECTIVE_REPORT.keyImpactNoSignificance, {}, about)]),
    ]
  }

  // A key viewpoint the reviewer chose, with their reason when they gave one.
  const reviewerReason = (bare: SentenceTemplate, withReason: SentenceTemplate, given: string, about: string) => {
    const reason = given.trim().replace(/[.\s]+$/, '')
    // The reason follows a colon: its first letter drops to lower case unless it starts a name or an acronym.
    const flowing =
      /^[A-Z][a-z]/.test(reason) && !/^[A-Z][a-z]+\s+[A-Z]/.test(reason)
        ? reason.charAt(0).toLowerCase() + reason.slice(1)
        : reason
    return reason ? fill(withReason, { reason: flowing }, about) : fill(bare, {}, about)
  }

  // Each block's own size term (23's "AN15 and AN3A small; AN03 small to medium"), when the run splits the figure.
  const scaleByBlock = (i: number, blocks: readonly BlockAtStation[], about: string): Sentence[] => {
    const split = blocks.map((block) => ({ block, figure: blockPercentAt(i, block) }))
    if (split.length < 2 || split.some((entry) => !entry.figure)) return []
    const list = andList(
      split.map(
        ({ block, figure }) =>
          `${block.id} ${lower(scaleTerm(format.percentScale, Number(figure!.printed)))} (${figure!.printed}%)`,
      ),
    )
    return [fill(PERSPECTIVE_REPORT.scaleByBlock, { list }, about)]
  }

  // The group's viewing distance: the range of the seen blocks' own distances when the run gives each (23's "between
  // 6.3 and 7.0 km"), else the nearest block in view's.
  const groupDistance = (i: number, blocks: readonly BlockAtStation[], about: string): Sentence => {
    const vp = viewpoints[i]
    const own = blocks.filter(seen).map((b) => b.distanceKm)
    if (own.length > 1 && own.every((d): d is number => d !== undefined)) {
      const near = Math.min(...own),
        far = Math.max(...own)
      if (km(near) !== km(far)) {
        const nearTerm = lower(termAt(format.distanceScale, near))!,
          farTerm = lower(termAt(format.distanceScale, far))!
        const rating = nearTerm === farTerm ? nearTerm : `${nearTerm} to ${farTerm}`
        return fill(
          PERSPECTIVE_REPORT.distanceRange,
          {
            near: km(near),
            far: km(far),
            viewpoint: vp.name,
            distanceRating: `${/^[aeiou]/.test(rating) ? 'an' : 'a'} ${rating}`,
          },
          about,
        )
      }
    }
    return fill(
      PERSPECTIVE_REPORT.distanceShared,
      { km: km(vp.distanceKm), viewpoint: vp.name, distanceRating: distanceRatingAt(i) },
      about,
    )
  }

  // The group, at its viewpoint (23).
  const groupSection = (i: number, ids: string[]) => {
    const vp = viewpoints[i]
    const about = blockList(ids)
    const r = vp.review
    const blocks = ids.map((id) => vp.blocks.find((b) => b.id === id)!)
    const glimpsed = blocks.filter((b) => b.status === 'possible glimpses').map((b) => b.id)
    const leftOut = [...choice.byBlock].filter(([id, index]) => index !== i && !ids.includes(id)).map(([id]) => id)
    const opening = [
      fill(
        parentOf(vp.landform) ? PERSPECTIVE_REPORT.groupLocationSub : PERSPECTIVE_REPORT.groupLocation,
        { blockList: about, landform: vp.landform, viewpoint: vp.name, parent: parentOf(vp.landform) },
        about,
      ),
      ...(choice.reviewer?.group != null
        ? [
            reviewerReason(
              PERSPECTIVE_REPORT.keyGroupReviewer,
              PERSPECTIVE_REPORT.keyGroupReviewerReason,
              choice.reviewer.group,
              about,
            ),
          ]
        : choice.rule === 'impact'
          ? impactReason(i, ids, about)
          : [
              fill(
                PERSPECTIVE_REPORT.keyGroup,
                {
                  seenCount: allOf(ids.length),
                  shares: andList(blocks.map((b) => `${Math.round(b.visiblePercent)}%`)),
                },
                about,
              ),
            ]),
      ...(glimpsed.length
        ? [fillSentence('group-glimpses', `Of these, ${blockList(glimpsed)} may be seen only in glimpses.`, {}, 'run')]
        : []),
      ...(leftOut.length
        ? [fill(PERSPECTIVE_REPORT.groupLeftOut, { blockList: blockList(leftOut), ...plural(leftOut.length) }, about)]
        : []),
    ]
    const visibility = [
      fill(PERSPECTIVE_REPORT.groupVisibility, { impact: lower(r?.impact), visibility: lower(r?.visibility) }, about),
    ]
    const scale = zeroAt(i)
      ? outside(i, ids, about)
      : [
          fill(PERSPECTIVE_REPORT.scaleGroup, { sizeTerm: sizeTermAt(i), percent: results[i]?.printed }, about),
          ...scaleByBlock(i, blocks, about),
        ]
    const design = [
      fill(PERSPECTIVE_REPORT.forceLines, { forceLines: lower(r?.forceLines) }, about),
      fill(PERSPECTIVE_REPORT.borrow, { subject: 'blocks', borrowsBorrow: 'borrow', borrow: lower(r?.borrow) }, about),
      fill(PERSPECTIVE_REPORT.edges, { edges: lower(r?.edges) }, about),
      groupDistance(i, blocks, about),
      fill(PERSPECTIVE_REPORT.groupPosition, { position: lower(r?.position) }, about),
      fill(PERSPECTIVE_REPORT.design, { viewpoint: vp.name, design: lower(r?.design) }, about),
    ]
    const closing = [
      fill(
        PERSPECTIVE_REPORT.closing,
        { vqo: vp.objective, extent: lower(r?.extent), blockList: about, landform: vp.landform },
        about,
      ),
    ]
    sections.push({
      heading: `${about} – ${vp.landform}`,
      viewpoint: vp.name,
      landform: vp.landform,
      blocks: ids,
      paragraphs: [
        { sentences: opening },
        { label: 'Visibility', sentences: visibility },
        { label: 'Size and scale', sentences: scale },
        { label: 'Visual design', sentences: design },
        { sentences: closing },
      ],
    })
    byViewpoint[i].push(...opening, ...visibility, ...scale, ...design, ...closing)
    for (const block of blocks) rows[i].push(blockRow(i, block))
  }

  // One block at its key viewpoint (22).
  const blockSection = (i: number, block: BlockAtStation, firstHere: string | null) => {
    const vp = viewpoints[i]
    const about = `Block ${block.id}`
    const r = vp.review
    // The landform it lies in, as the view read it: the view's own, another it reads, or none.
    const on = citedOn(i, block.id)
    const landform = on?.landform ?? vp.landform
    const common = { block: block.id, landform, viewpoint: vp.name, parent: parentOf(landform) }
    const others = viewpoints
      .map((other, index) => ({ index, block: other.blocks.find((b) => b.id === block.id && seen(b)) }))
      .filter((entry) => entry.index !== i && entry.block)
      .sort((a, b) => b.block!.visiblePercent - a.block!.visiblePercent)
    const picked = choice.reviewer?.blocks.get(block.id)
    const reason =
      picked !== undefined
        ? reviewerReason(PERSPECTIVE_REPORT.keyReviewer, PERSPECTIVE_REPORT.keyReviewerReason, picked, about)
        : others.length
          ? fill(
              PERSPECTIVE_REPORT.keyViewpoint,
              {
                share: Math.round(block.visiblePercent),
                compare:
                  Math.round(others[0].block!.visiblePercent) >= Math.round(block.visiblePercent)
                    ? 'as much as any other viewpoint assessed'
                    : others.length === 1
                      ? 'more than the one other viewpoint that sees it'
                      : `more than any of the other ${NUMBER_WORDS[others.length] ?? others.length} viewpoints that see it`,
                runnerUp: viewpoints[others[0].index].name,
                runnerShare: Math.round(others[0].block!.visiblePercent),
              },
              about,
            )
          : fill(PERSPECTIVE_REPORT.keyOnly, { viewpoint: vp.name, share: Math.round(block.visiblePercent) }, about)
    const inView = on ? seenOn(i, on).filter((b) => b.id !== block.id) : []
    const scale =
      !on || zeroOn(on)
        ? outside(i, [block.id], about, firstHere, on)
        : firstHere
          ? [fill(PERSPECTIVE_REPORT.scaleSame, { first: firstHere }, about)]
          : inView.length
            ? [
                fill(
                  PERSPECTIVE_REPORT.scaleShared,
                  {
                    sizeTerm: sizeTermOn(on),
                    percent: on.result?.printed,
                    others: andList(
                      [
                        blockList(inView.filter((b) => !isOtherPlanned(b)).map((b) => b.id)),
                        inView.some(isOtherPlanned)
                          ? `the other planned ${blockList(inView.filter(isOtherPlanned).map((b) => b.id)).replace(/^B/, 'b')}`
                          : '',
                      ].filter(Boolean),
                    ),
                    where: inView.length === 1 ? 'where it lies on the landform' : 'where they lie on the landform',
                  },
                  about,
                ),
              ]
            : [fill(PERSPECTIVE_REPORT.scale, { sizeTerm: sizeTermOn(on), percent: on.result?.printed }, about)]
    // The block's own distance when the run gives it (or it is the only block in view); else only what is known, the
    // nearest block in view, which bounds it and gives no rating.
    const ownKm = ownDistanceAt(i, block)
    const distance =
      ownKm !== null
        ? [
            fill(
              PERSPECTIVE_REPORT.distance,
              {
                distanceRating: lower(termAt(format.distanceScale, ownKm)),
                km: km(ownKm),
                viewpoint: vp.name,
              },
              about,
            ),
          ]
        : firstHere || vp.distanceKm === null
          ? []
          : [
              fill(
                PERSPECTIVE_REPORT.distanceAtLeast,
                { block: block.id, km: km(vp.distanceKm), viewpoint: vp.name },
                about,
              ),
            ]
    const terms = unseenTerms(block.status)
    const body = [
      fill(
        !on
          ? block.status === 'possible glimpses'
            ? PERSPECTIVE_REPORT.glimpsesOutside
            : PERSPECTIVE_REPORT.locationOutside
          : block.status === 'possible glimpses'
            ? PERSPECTIVE_REPORT.glimpses
            : parentOf(landform)
              ? PERSPECTIVE_REPORT.locationSub
              : PERSPECTIVE_REPORT.location,
        common,
        about,
      ),
      reason,
      fill(
        PERSPECTIVE_REPORT.visibility,
        { impact: terms?.impact ?? lower(r?.impact), visibility: terms?.visibility ?? lower(r?.visibility) },
        about,
      ),
      ...scale,
      fill(PERSPECTIVE_REPORT.forceLines, { forceLines: lower(r?.forceLines) }, about),
      fill(PERSPECTIVE_REPORT.borrow, { subject: 'block', borrowsBorrow: 'borrows', borrow: lower(r?.borrow) }, about),
      fill(PERSPECTIVE_REPORT.edges, { edges: lower(r?.edges) }, about),
      ...distance,
      fill(PERSPECTIVE_REPORT.position, { position: lower(r?.position) }, about),
      fill(PERSPECTIVE_REPORT.design, { viewpoint: vp.name, design: lower(r?.design) }, about),
    ]
    const closing = [
      on
        ? fill(
            PERSPECTIVE_REPORT.closing,
            { vqo: on.objective, extent: lower(r?.extent), blockList: about, landform },
            about,
          )
        : fill(
            PERSPECTIVE_REPORT.closingOutside,
            { vqo: vp.objective, extent: lower(r?.extent), blockList: about },
            about,
          ),
    ]
    sections.push({
      heading: on ? `${about} – ${landform}` : about,
      viewpoint: vp.name,
      landform: on ? landform : null,
      blocks: [block.id],
      paragraphs: [{ sentences: body }, { sentences: closing }],
    })
    byViewpoint[i].push(...body, ...closing)
    rows[i].push(blockRow(i, block))
  }

  viewpoints.forEach((vp, i) => {
    if (choice.group?.index === i) groupSection(i, choice.group.blocks)
    // "Read on the same figure as Block …" only for blocks cited on the same landform.
    const firstOn = new Map<string | null, string>()
    for (const block of vp.blocks) {
      if (isOtherPlanned(block) || !seen(block) || choice.byBlock.get(block.id) !== i) continue
      if (choice.group?.blocks.includes(block.id)) continue
      const key = citedOn(i, block.id)?.landform ?? null
      blockSection(i, block, firstOn.get(key) ?? null)
      if (!firstOn.has(key)) firstOn.set(key, block.id)
    }
  })

  // Proposed blocks no viewpoint sees: said so once, together, where they are first listed.
  const unseen = new Map<string, number>()
  viewpoints.forEach((vp, index) => {
    for (const block of vp.blocks)
      if (
        !isOtherPlanned(block) &&
        block.status === 'not visible' &&
        !choice.byBlock.has(block.id) &&
        !unseen.has(block.id)
      )
        unseen.set(block.id, index)
  })
  for (const [id, index] of unseen) {
    const block = viewpoints[index].blocks.find((b) => b.id === id)!
    rows[index].push(blockRow(index, block))
  }
  const hiddenIds = [...unseen.keys()]
  if (hiddenIds.length) {
    const about = blockList(hiddenIds)
    const sentence = fill(PERSPECTIVE_REPORT.notVisible, { blockList: about, ...plural(hiddenIds.length) }, about)
    sections.push({
      heading: about,
      viewpoint: null,
      landform: null,
      blocks: hiddenIds,
      paragraphs: [{ sentences: [sentence] }],
    })
    byViewpoint[unseen.get(hiddenIds[0])!].push(sentence)
  }

  // The landform's own row follows the blocks assessed from a viewpoint; a viewpoint that is no block's key has none.
  viewpoints.forEach((vp, i) => {
    if (!rows[i].length) return
    const result = results[i]
    const r = vp.review
    const allHidden = vp.blocks.length > 0 && vp.blocks.every((b) => b.status === 'not visible')
    const sizeTerm = result ? scaleTerm(format.percentScale, result.printedValue) : ''
    const own = {
      [T5.viewpoint]: vp.name,
      [T5.block]: 'Overall landform',
      [T5.landform]: vp.objective ?? '',
      [T5.impact]: r?.visibility ?? (allHidden ? 'Not easily distinguishable' : ''),
      [T5.percent]: result ? `${result.printed} (${sizeTerm})` : '',
      [T5.forceLines]: r?.forceLines ?? (allHidden ? 'N/A' : ''),
      [T5.borrow]: r?.borrow ?? (allHidden ? 'N/A' : ''),
      [T5.edges]: r?.edges ?? '',
      [T5.islands]: r?.islands ?? '',
      [T5.distance]: vp.distanceKm === null ? '' : termAt(format.distanceScale, vp.distanceKm),
      [T5.position]: r?.position ?? (allHidden ? 'N/A' : ''),
      [T5.design]: r?.design ?? '',
      [T5.met]: r?.extent ?? '',
    }
    // Other landforms holding proposed ground in the view take a row each (23 Table 5: Sub-landform 1a, then
    // Overall Landform 1), sub-landforms first. The reviewer's ratings are the assessed landform's only.
    const others = (vp.otherLandforms ?? []).filter((entry) => entry.areas.proposed > 0)
    if (!others.length) {
      rows[i].push(own)
      return
    }
    const entries = [
      { landform: vp.landform, row: own },
      ...others.map((entry) => {
        const figure = alteration(format.rule, entry.areas)
        return {
          landform: entry.landform,
          row: {
            [T5.viewpoint]: vp.name,
            [T5.landform]: entry.objective ?? '',
            [T5.percent]: figure ? `${figure.printed} (${scaleTerm(format.percentScale, figure.printedValue)})` : '',
            [T5.distance]: own[T5.distance],
          } as Record<string, string>,
        }
      }),
    ].sort(
      (a, b) =>
        Number(!parentOf(a.landform)) - Number(!parentOf(b.landform)) ||
        landformOrder(a.landform).localeCompare(landformOrder(b.landform), undefined, { numeric: true }),
    )
    for (const entry of entries)
      rows[i].push({
        ...entry.row,
        [T5.block]: `${parentOf(entry.landform) ? '' : 'Overall '}${plainLandform(entry.landform)}`,
      })
  })
  return { sections, byViewpoint, rows, extraToComplete }
}

/** A landform's name without the outline's source in brackets ("Landform 1a (traced)" is Landform 1a). */
const plainLandform = (name: string) => name.replace(/\s*\([^)]*\)\s*$/, '').trim() || name
/** What orders a viewpoint's landforms: the number its name gives it ("Landform 1b" is 1b), else its name. */
const landformOrder = (name: string) => name.match(/\bLandform\s+(\d+[a-z]?)\b/i)?.[1] ?? plainLandform(name)

/**
 * Table 4's rows for one viewpoint: its landform's (`initialRow`), then, ordered by number with it, each other
 * landform the view sees with alteration in it, and each sub-landform seen without any (23 Table 4: 1c, N/A). Another
 * landform that is merely in view is not assessed from it. The reviewer's terms are the assessed landform's only.
 */
function initialRows(
  format: ViaDocumentFormat,
  vp: DocumentViewpoint,
  result: Alteration | null,
  parentOf: (landform: string) => string | null,
) {
  const own = initialRow(format, vp, result)
  const others = (vp.otherLandforms ?? []).filter(
    (entry) => entry.areas.nonVeg + entry.areas.proposed > 0 || parentOf(entry.landform),
  )
  if (!others.length) return [own]
  const seenHere = vp.blocks.filter(seen)
  return [
    { landform: vp.landform, row: own },
    ...others.map((entry) => {
      const figure = alteration(format.rule, entry.areas)
      const altered = entry.areas.nonVeg + entry.areas.proposed > 0
      const blocks = seenHere.filter((block) => entry.blocks.includes(block.id))
      return {
        landform: entry.landform,
        row: {
          [T4.viewpoint]: vp.name,
          [T4.landform]: entry.landform,
          [T4.vqo]: entry.objective ?? '',
          [T4.blocks]: blocks.length
            ? blocks.map((b) => `${b.id}${isOtherPlanned(b) ? '*' : ''}`).join(', ')
            : altered
              ? 'Existing openings only'
              : 'None',
          [T4.visibility]: altered ? '' : 'N/A',
          [T4.percent]: figure?.printed ?? '',
          [T4.size]: figure ? scaleTerm(format.percentScale, figure.printedValue) : '',
          [T4.design]: altered ? '' : 'N/A',
          [T4.met]: altered ? '' : 'N/A',
        } as Record<string, string>,
      }
    }),
  ]
    .sort((a, b) => landformOrder(a.landform).localeCompare(landformOrder(b.landform), undefined, { numeric: true }))
    .map((entry) => entry.row)
}

/** Table 4's row for one viewpoint: every block seen, other planned ones marked *. */
function initialRow(format: ViaDocumentFormat, vp: DocumentViewpoint, result: Alteration | null) {
  // The blocks seen with ground in its landform; every block seen when the view recorded no list.
  const visibleBlocks = vp.blocks.filter((b) => seen(b) && (!vp.landformBlocks || vp.landformBlocks.includes(b.id)))
  const allHidden = vp.blocks.length > 0 && vp.blocks.every((b) => b.status === 'not visible')
  const visibility = vp.review?.visibility
  return {
    [T4.viewpoint]: vp.name,
    [T4.landform]: vp.landform,
    [T4.vqo]: vp.objective ?? '',
    [T4.blocks]: visibleBlocks.length
      ? visibleBlocks.map((b) => `${b.id}${isOtherPlanned(b) ? '*' : ''}`).join(', ')
      : allHidden
        ? 'None visible'
        : vp.landformBlocks
          ? 'None'
          : '',
    [T4.visibility]: visibility ?? (allHidden ? 'Not easily distinguishable' : ''),
    [T4.percent]: result?.printed ?? '',
    [T4.size]: result ? scaleTerm(format.percentScale, result.printedValue) : '',
    [T4.design]: allHidden ? 'Natural / No visible alteration' : (vp.review?.design ?? ''),
    [T4.met]: vp.review?.extent ?? '',
  }
}

function form2001(format: ViaDocumentFormat, vp: DocumentViewpoint, result: Alteration | null) {
  const band = result ? readPercent(format.percentScale, result.printedValue) : null
  const className = band?.code ? CLASS_NAMES[band.code] : undefined
  const zone = vp.distanceKm === null ? undefined : termAt(format.distanceScale, vp.distanceKm)
  const objective = vp.objective
  const range = band?.code ? format.percentScale.printed.split(';').find((part) => part.includes(band.code!)) : ''
  const standing =
    objective && band?.code
      ? CLASS_ORDER.indexOf(band.code) <= CLASS_ORDER.indexOf(objective)
        ? 'within'
        : 'over'
      : undefined
  const sentences = [
    sentenceFrom(FORM_2001.calcLine, { percent: result?.printed, className }),
    sentenceFrom(FORM_2001.zone, { km: km(vp.distanceKm), zone }),
    sentenceFrom(FORM_2001.ocular, { viewpoint: vp.name, ocular: lower(vp.review?.ocular) }),
    sentenceFrom(FORM_2001.numeric, {
      percent: result?.printed,
      basis: format.rule.basis,
      className,
      range: range?.trim(),
    }),
    sentenceFrom(FORM_2001.objective, { objectiveName: objective ? CLASS_NAMES[objective] : undefined, standing }),
  ]
  const row: Record<string, string> = {
    Viewpoint: vp.name,
    Importance: vp.review?.importance ?? '',
    Coordinates: vp.lngLat ? `${vp.lngLat[1].toFixed(5)}, ${vp.lngLat[0].toFixed(5)}` : '',
    Distance: vp.distanceKm === null ? '' : `${km(vp.distanceKm)} Km (${zone})`,
    Duration: vp.review?.duration ?? '',
    Lens: vp.lensMm ? `${Math.round(vp.lensMm)} mm` : '',
    Direction: '',
  }
  return { sentences, rows: { viewpoints: [row] } }
}

const CLASS_ORDER: readonly ClassCode[] = ['P', 'R', 'PR', 'M', 'MM']

function appendix1(format: ViaDocumentFormat, vp: DocumentViewpoint, result: Alteration | null) {
  const a1 = vp.appendix1
  // A figure past the scale's last class reads as the scale's own term for it ("excessive"), never as no class.
  const classOf = (value: number | null | undefined) =>
    value === null || value === undefined
      ? undefined
      : (readPercent(format.percentScale, value)?.code ?? format.percentScale.beyond)
  const x = a1?.x ?? result?.printedValue
  // Without the run's breakdown, a and c are the picture's own parts; b (roads outside openings) is no class of the
  // picture, so the sentence waits on it rather than printing a zero nobody measured.
  const partOf = (id: 'proposed' | 'nonVeg') =>
    result ? (result.parts.find((entry) => entry.part === id)?.printed ?? '0.0') : undefined
  const sentences = [
    sentenceFrom(APPENDIX_1.x, {
      a: a1?.a.toFixed(1) ?? partOf('proposed'),
      b: a1 ? a1.b.toFixed(1) : undefined,
      c: a1 ? a1.c.toFixed(1) : partOf('nonVeg'),
      x: x?.toFixed(1),
      initialClass: classOf(x),
    }),
    sentenceFrom(APPENDIX_1.y, {
      y: a1?.y === null || a1?.y === undefined ? undefined : a1.y > 0 ? `+${a1.y}` : String(a1.y),
      adjusted: a1?.adjusted?.toFixed(1),
      adjustedClass: classOf(a1?.adjusted),
    }),
    sentenceFrom(APPENDIX_1.rating, {
      vqo: vp.objective,
      rating: lower(a1?.rating ?? vp.review?.extent),
      viewpoint: vp.name,
    }),
    sentenceFrom(APPENDIX_1.rationale, { rationale: vp.review?.rationale }),
  ]
  const row: Record<string, string> = {
    'Distance to Development': vp.distanceKm === null ? '' : `${km(vp.distanceKm)} km`,
    'VLI No.': vp.inventory?.vsu ?? '',
    VSC: vp.inventory?.vsc ?? '',
    VAC: vp.inventory?.vac ?? '',
    EVQO: vp.inventory?.vqo ?? vp.objective ?? '',
    Latitude: vp.lngLat ? vp.lngLat[1].toFixed(3) : '',
    Longitude: vp.lngLat ? vp.lngLat[0].toFixed(3) : '',
    'View Duration': vp.review?.duration ?? '',
  }
  return { sentences, rows: { attributes: [row] } }
}

function calculationOnPhoto(vp: DocumentViewpoint, result: Alteration | null) {
  const a = vp.areas
  if (!a) return { areas: [] }
  return {
    areas: [
      {
        VLU: `${a.landform} px`,
        'Proposed Alteration': `${a.proposed} px`,
        'Non Veg State': `${a.nonVeg} px`,
        Rock: `${a.rock ?? 0} px`,
        'Net VLU': `${a.landform - (a.rock ?? 0)} px`,
        Alteration: `${a.proposed + a.nonVeg} px`,
        '%': result?.printed ?? '',
      },
    ],
  }
}

/** The blocks of another sale or permit any viewpoint lists, and the sentence that names them once. */
function otherPlannedOf(viewpoints: readonly DocumentViewpoint[], perspective: boolean) {
  const found = new Map<string, string | undefined>()
  for (const vp of viewpoints)
    for (const block of vp.blocks)
      if (isOtherPlanned(block) && !found.has(block.id)) found.set(block.id, block.plannedUnder)
  const blocks = [...found.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  if (!blocks.length || !perspective) return { blocks, sentence: null }
  const under = [...new Set([...found.values()].filter((value): value is string => !!value))]
  const words = plural(blocks.length)
  return {
    blocks,
    sentence: sentenceFrom(PERSPECTIVE_REPORT.otherPlanned, {
      blockList: blockList(blocks),
      underPhrase: under.length
        ? `another sale or cutting permit (${andList(under)})`
        : 'another sale or cutting permit',
      ...words,
    }),
  }
}

/**
 * The run's figure at each key viewpoint on the landform holding the blocks it is key for (`landformOfBlock`: a block
 * on a sub-landform the view also reads is quoted on that one, never on the view's own), then where they stand on the
 * range. A viewpoint whose blocks lie on two landforms gives a figure for each.
 */
function keyFigures(
  format: ViaDocumentFormat,
  facts: readonly DocumentViewpoint[],
  viewpoints: readonly ResolvedViewpoint[],
  choice: KeyViewpointChoice,
  objective: ClassCode | null,
): Sentence[] {
  const indices = [...new Set(choice.byBlock.values())].filter((i) => i >= 0).sort((a, b) => a - b)
  /** `on`: a landform other than the view's own, named short of its source note ("Landform 5b"). */
  type KeyFigure = { index: number; place: string; on: string | null; result: Alteration; objective: ClassCode | null }
  const entries: KeyFigure[] = []
  for (const i of indices) {
    const vp = facts[i]
    const ids = [...choice.byBlock].filter(([, at]) => at === i).map(([id]) => id)
    const read = new Set<string>()
    for (const id of ids.length ? ids : [null]) {
      const other = id === null ? null : (landformOfBlock(vp, id)?.other ?? null)
      const landform = other ? other.landform : vp.landform
      if (read.has(landform)) continue
      read.add(landform)
      const result = other ? alteration(format.rule, other.areas) : viewpoints[i].alteration
      if (!result || !(result.printedValue > 0)) continue
      entries.push({
        index: i,
        place: vp.name,
        on: other ? other.landform.replace(/\s*\([^)]*\)\s*$/, '') : null,
        result,
        objective: other?.objective ?? vp.objective ?? null,
      })
    }
  }
  if (!entries.length) return []
  const value = (entry: KeyFigure) => entry.result.printedValue
  const figure = (entry: KeyFigure) =>
    `${entry.result.printed}% (${lower(scaleTerm(format.percentScale, value(entry)))})${entry.on ? ` on ${entry.on}` : ''} at ${entry.place}`
  const nameOf = (entry: KeyFigure) => (entry.on ? `${entry.place} on ${entry.on}` : entry.place)
  const out = [
    sentenceFrom(PERSPECTIVE_REPORT.conclusionFigures, {
      keyPhrase: indices.length === 1 ? 'the key viewpoint' : 'the key viewpoints',
      figures: andList(entries.map(figure)),
    }),
  ]
  // Each figure is read against its own landform's objective (one report can hold R and PR landforms).
  const rangeOf = (code: ClassCode) =>
    PERCENT_SCALES.handbookTable2.printed
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${code} `))
  const judged = entries.filter((entry) => entry.objective ?? objective)
  if (!judged.length) return out
  const objectiveAt = (entry: KeyFigure) => (entry.objective ?? objective)!
  const over = judged.filter((entry) => {
    const code = readPercent(PERCENT_SCALES.handbookTable2, value(entry))?.code
    return !code || CLASS_ORDER.indexOf(code) > CLASS_ORDER.indexOf(objectiveAt(entry))
  })
  const objectives = [...new Set(judged.map(objectiveAt))]
  const rangePhrase = (code: ClassCode) => `the ${CLASS_NAMES[code]} range (${rangeOf(code)})`
  // A figure under its objective's range is within what the objective allows, never "within PR 1.6-7%" at 1.56%.
  const below = judged.filter((entry) => {
    const code = readPercent(PERCENT_SCALES.handbookTable2, value(entry))?.code
    return !!code && CLASS_ORDER.indexOf(code) < CLASS_ORDER.indexOf(objectiveAt(entry))
  })
  const allowed = (code: ClassCode) => `within what ${CLASS_NAMES[code]} allows`
  if (!over.length)
    out.push(
      fillSentence(
        'conclusion-standing',
        objectives.length === 1
          ? !below.length
            ? `${judged.length === 1 ? 'The figure is' : 'Each figure is'} within ${rangePhrase(objectives[0])}.`
            : below.length === judged.length
              ? `${judged.length === 1 ? 'The figure is' : 'Each figure is'} below ${rangePhrase(objectives[0])}, ${allowed(objectives[0])}.`
              : `Each figure is ${allowed(objectives[0])} (${rangeOf(objectives[0])}); ${
                  below.length === 1
                    ? `the figure at ${nameOf(below[0])} is`
                    : `the figures at ${andList(below.map(nameOf))} are`
                } below its range.`
          : `Each figure is within what its landform’s objective allows: ${andList(objectives.map(rangePhrase))}.`,
        {},
        'run',
      ),
    )
  else {
    const byObjective = [...new Set(over.map(objectiveAt))].map((code) => {
      const names = over.filter((entry) => objectiveAt(entry) === code).map(nameOf)
      return names.length === 1
        ? `the figure at ${names[0]} is over ${rangePhrase(code)}`
        : `the figures at ${andList(names)} are over ${rangePhrase(code)}`
    })
    out.push(fillSentence('conclusion-standing', `${andList(byObjective)}.`, {}, 'run'))
  }
  return out
}

/** Fills `formatOrId` from `facts`. */
export function resolveViaDocument(formatOrId: ViaDocumentFormat | string, facts: DocumentFacts): ResolvedDocument {
  const format = typeof formatOrId === 'string' ? findDocumentFormat(formatOrId) : formatOrId
  if (!format) throw new Error(`Unknown VIA document format: ${String(formatOrId)}`)
  // A block marked other planned only by its name is read as one (`normalizeBlock`).
  facts = { ...facts, viewpoints: facts.viewpoints.map((vp) => ({ ...vp, blocks: vp.blocks.map(normalizeBlock) })) }
  const figures = facts.viewpoints.map((vp) => (vp.areas ? alteration(format.rule, vp.areas) : null))
  const perspective = format.wording === 'perspective-report'
  const mode: KeyViewpointMode = format.keyViewpoint ?? 'per-block'
  const choice = perspective
    ? chooseKeyViewpoints(
        facts.viewpoints,
        mode,
        (index) => (figures[index]?.printedValue ?? 0) > 0,
        format.keyViewpointRule ?? 'visibility',
        (index) => figures[index]?.printedValue ?? null,
        facts.keyViewpoints ?? null,
      )
    : null
  const parentOf = (landform: string) => facts.landformParents?.[landform] ?? landformParentFromName(landform)
  const written = choice
    ? perspectiveDiscussion({
        format,
        viewpoints: facts.viewpoints,
        results: figures,
        choice,
        parentOf,
      })
    : null
  const viewpoints: ResolvedViewpoint[] = facts.viewpoints.map((vp, index) => {
    const result = figures[index]
    const band = result ? readPercent(format.percentScale, result.printedValue) : null
    const printed = result
      ? { percent: result.printed, term: band?.term ?? format.percentScale.beyond, classCode: band?.code ?? null }
      : null
    const distance =
      vp.distanceKm === null ? null : { km: km(vp.distanceKm)!, term: termAt(format.distanceScale, vp.distanceKm) }
    let sentences: Sentence[] = []
    let rows: ResolvedViewpoint['rows'] = {}
    const n = vp.n ?? String(index + 1)
    switch (format.wording) {
      case 'perspective-report':
        sentences = written!.byViewpoint[index]
        rows = {
          'initial-assessment': initialRows(format, vp, result, parentOf),
          'detailed-assessment': written!.rows[index],
        }
        break
      case 'form-2001':
        ;({ sentences, rows } = form2001(format, vp, result))
        break
      case 'appendix-1':
        ;({ sentences, rows } = appendix1(format, vp, result))
        break
      case 'referral':
        sentences = [
          sentenceFrom(REFERRAL.caption, { n, viewpoint: vp.name }),
          sentenceFrom(REFERRAL.plain, {
            project: facts.project,
            plainVisibility: plainVisibility(vp.blocks),
            viewpoint: vp.name,
          }),
        ]
        break
      case 'comparison-strip':
        sentences = [sentenceFrom(COMPARISON_STRIP.caption, { km: km(vp.distanceKm) })]
        rows = {
          summary: [
            {
              Viewpoint: vp.name,
              Distance: distance ? `${distance.km} km` : '',
              Landform: vp.landform,
              '% Alteration': result?.printed ?? '',
            },
          ],
        }
        break
      case 'district-summary': {
        const existing = result?.parts.find((p) => p.part === 'nonVeg')?.printed
        const proposed = result?.parts.find((p) => p.part === 'proposed')?.printed
        const within =
          vp.objective && band?.code
            ? CLASS_ORDER.indexOf(band.code) <= CLASS_ORDER.indexOf(vp.objective)
              ? 'Yes'
              : 'No'
            : undefined
        sentences = [
          sentenceFrom(DISTRICT_SUMMARY.total, {
            existing,
            proposed,
            total: result?.printed,
            basis: format.rule.basis,
          }),
          sentenceFrom(DISTRICT_SUMMARY.guidelines, {
            objective: vp.objective,
            printedRanges: format.percentScale.printed,
            withinGuidelines: within,
          }),
        ]
        rows = {
          summary: [
            {
              Viewpoint: vp.name,
              VLU: vp.inventory?.vsu ?? '',
              VSR: vp.inventory?.vsc ?? '',
              VAC: vp.inventory?.vac ?? '',
              EVC: vp.inventory?.evc ?? '',
              VQO: vp.objective ? CLASS_NAMES[vp.objective] : '',
              'Existing %': existing ?? '',
              'Proposed %': proposed ?? '',
              'Total %': result?.printed ?? '',
              'Within guidelines': within ?? '',
              'Meets definition': vp.review?.extent ?? '',
            },
          ],
        }
        break
      }
      case 'calculation-on-photo':
        rows = calculationOnPhoto(vp, result)
        break
    }
    const timber = vp.withTimber
    const timberResult = timber && 'areas' in timber ? alteration(format.rule, timber.areas) : null
    const withTimber = timberResult
      ? { percent: timberResult.printed }
      : timber && 'absent' in timber
        ? { absent: timber.absent }
        : undefined
    return {
      name: vp.name,
      alteration: result,
      printed,
      ...(withTimber ? { withTimber } : {}),
      distance,
      rows,
      sentences,
    }
  })

  const summary: Sentence[] = []
  const objective = facts.viewpoints.find((vp) => vp.objective)?.objective ?? null
  const definition = objective && objective in DEFINITION_PARTS ? DEFINITION_PARTS[objective as 'R' | 'PR' | 'M'] : null
  if (format.wording === 'referral') {
    summary.push(
      sentenceFrom(REFERRAL.objective, {
        project: facts.project,
        objectiveName: objective ? CLASS_NAMES[objective].toLowerCase() : undefined,
        defVisibility: definition?.visibility,
        defScale: definition?.scale,
        defDesign: definition?.design,
        ceiling: objective ? REFERRAL_CEILINGS[objective] : undefined,
      }),
    )
    // The verdict reads the worst station against the referral's single ceiling; over it, it is the reviewer's.
    const worst = viewpoints
      .filter((vp) => vp.alteration)
      .sort((a, b) => b.alteration!.printedValue - a.alteration!.printedValue)[0]
    const under = worst && objective ? underCeiling(objective, worst.alteration!.printedValue) : null
    const ceiling = objective ? REFERRAL_CEILINGS[objective] : undefined
    const wellUnder = under && ceiling !== undefined ? worst!.alteration!.printedValue <= 0.8 * ceiling : false
    const openings = facts.viewpoints.flatMap((vp) => vp.blocks.filter((b) => b.proposed !== false)).length
    summary.push(
      sentenceFrom(REFERRAL.verdict, {
        extentLower: under ? (wellUnder ? 'well met' : 'met') : undefined,
        openingPhrase: openings === 1 ? 'this opening' : 'these openings',
        percent: worst?.alteration?.printed,
        viewpoint: worst?.name,
      }),
    )
  } else if (perspective) {
    const extent = facts.viewpoints.map((vp) => vp.review?.extent).find(Boolean)
    const ids = [
      ...new Set(facts.viewpoints.flatMap((vp) => vp.blocks.filter((b) => !isOtherPlanned(b)).map((b) => b.id))),
    ]
    summary.push(
      sentenceFrom(PERSPECTIVE_REPORT.conclusion, {
        vqo: objective,
        extent: lower(extent),
        blockList: blockList(ids),
        defVisibility: definition?.visibility,
        defScale: definition?.scale,
        defDesign: definition?.design,
      }),
    )
    summary.push(...keyFigures(format, facts.viewpoints, viewpoints, choice!, objective))
  } else if (format.wording === 'comparison-strip') {
    const hfov = facts.viewpoints.find((vp) => vp.hfovDeg)?.hfovDeg
    summary.push(sentenceFrom(COMPARISON_STRIP.footer, { hfov: hfov ? Math.round(hfov) : undefined }))
  }

  const toComplete = [
    ...viewpoints.flatMap((vp) =>
      vp.sentences
        .filter((s) => s.text === null)
        .map((s) => ({
          viewpoint: vp.name,
          id: s.id,
          missing: s.missing,
          ...(s.about ? { about: s.about } : {}),
          ...(s.label ? { label: s.label } : {}),
        })),
    ),
    ...summary
      .filter((s) => s.text === null)
      .map((s) => ({ viewpoint: null, id: s.id, missing: s.missing, ...(s.label ? { label: s.label } : {}) })),
    ...(written?.extraToComplete ?? []),
    ...(choice?.declined ?? []).map((entry) => ({
      viewpoint: entry.viewpoint,
      id: 'key-viewpoint-declined',
      missing: [
        entry.block
          ? `a key viewpoint that sees Block ${blockId(entry.block)}`
          : 'a group viewpoint that sees two or more of the blocks',
      ],
      ...(entry.block ? { about: `Block ${blockId(entry.block)}` } : {}),
    })),
  ]
  return {
    format,
    recipes: format.recipes,
    viewpoints,
    summary,
    toComplete,
    discussion: written?.sections ?? [],
    keyViewpoints: choice ? { mode, choice } : null,
    otherPlanned: otherPlannedOf(facts.viewpoints, perspective),
  }
}

/**
 * `doc` with each view of the package it does not hold (`viewsLeftOut`: not captured, or saved without the class pass
 * its figure is measured on) named under *Reviewer to complete*: the document is written without its figure, never
 * refused for it, and never with a figure made up. Why each was left out is the closing *Views left out* section's
 * (`viewsLeftOutMarkdown`). `doc` itself is not changed.
 */
export function withViewsToComplete(doc: ResolvedDocument, leftOut: ReadonlyArray<{ name: string }>): ResolvedDocument {
  if (!leftOut.length) return doc
  return {
    ...doc,
    toComplete: [
      ...doc.toComplete,
      ...leftOut.map((view) => ({
        viewpoint: view.name,
        id: 'figure',
        missing: ['a capture with its class pass'],
        label: 'Analysis figure',
      })),
    ],
  }
}
