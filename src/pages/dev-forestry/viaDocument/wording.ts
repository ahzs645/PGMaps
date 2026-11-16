/**
 * The sentences VIA documents are written in, as templates over named slots, and the closed vocabularies they draw
 * from. The structure follows the reference documents (November 2026 survey, cited by number); the words are
 * PGMaps' own except where a vocabulary is the regulation's or the handbook's (FPPR s. 1.1, the 2022 handbook's
 * Table 7 ratings), which are public text. No licensee, consultant or place name appears in a template.
 *
 * Every sentence says where its slots come from. A `run` slot is a figure the assessment computed; a `reviewer` slot
 * is a judgement the page never makes (the visibility term, lines of force, edge treatment, the extent met). When a
 * slot has no value the sentence is not printed: it is returned with `text: null` and its missing slots, and the
 * document lists it as "reviewer to complete". No DOM or network access.
 */

export type SlotSource = 'run' | 'reviewer' | 'scene'

export interface Sentence {
  id: string
  /** The filled sentence, or null when a slot has no value. */
  text: string | null
  /** Where its slots came from: the run alone, or a reviewer's judgement among them. */
  source: SlotSource
  /** Slots without a value, by name. */
  missing: string[]
  /** The template, for "reviewer to complete" lists. */
  template: string
  /** What the sentence is about when a document repeats it (a block), for "reviewer to complete" lists. */
  about?: string
  /** The template's human label (`SentenceTemplate.role`), for "reviewer to complete" lists. */
  label?: string
}

export type SlotValues = Record<string, string | number | null | undefined>

/** Fills `{slot}`s. Missing or empty slots leave the sentence unprinted, never printed with braces. */
export function fillSentence(id: string, template: string, values: SlotValues, source: SlotSource): Sentence {
  const missing: string[] = []
  const text = template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = values[key]
    if (value === null || value === undefined || value === '') {
      missing.push(key)
      return ''
    }
    return String(value)
  })
  // A sentence that opens with a slot ("the project is ...") still starts with a capital, and a name that brings its
  // own article ("The Shores") does not take a second one ("the The Shores").
  // A doubled word where a slot repeats its frame ("from the Lake viewpoint viewpoint", "from from") reads once.
  const joined = text
    .replace(/\bthe (The [A-Z])/g, '$1')
    .replace(/\b(the|from|of|at|to|a) \1\b/g, '$1')
    .replace(/\b(viewpoint) viewpoint\b/gi, '$1')
    // A block named "Block 1" in a "Block {block}" frame reads "Block 1", and in a list "Blocks 1, 2 and 3".
    .replace(/\b(Blocks?) Block /g, '$1 ')
    .replace(/\bBlocks [^.;:()]*/g, (list) => list.replace(/(, | and )Block (?=\S)/g, '$1'))
  const sentence = joined.charAt(0).toUpperCase() + joined.slice(1)
  return { id, text: missing.length ? null : sentence, source, missing, template }
}

/**
 * Plain names for the slots a sentence can be missing, as a "reviewer to complete" list prints them; a slot not named
 * here is spelled out from its own name ("adjustedClass" reads "adjusted class").
 */
export const SLOT_NAMES: Readonly<Record<string, string>> = {
  a: 'line a, % altered by proposed openings',
  b: 'line b, % in access roads',
  c: 'line c, % of existing openings not greened up',
  x: 'initial percent alteration (X)',
  y: 'total adjustment (Y)',
  adjusted: 'adjusted percent alteration',
  adjustedClass: 'class of the adjusted figure',
  initialClass: 'class of the initial figure',
  rating: 'extent the objective is met',
  extent: 'extent the objective is met',
  extentLower: 'extent the objective is met',
  rationale: 'rationale',
  vqo: 'established objective',
  objective: 'established objective',
  objectiveName: 'established objective',
  ocular: 'class by eye',
  impact: 'level of impact',
  visibility: 'visibility term',
  forceLines: 'response to the lines of force',
  borrow: 'borrowing from natural character',
  borrowsBorrow: 'borrowing from natural character',
  edges: 'edge treatment',
  position: 'position on the landform',
  design: 'design character',
  percent: 'percent alteration',
  km: 'viewing distance',
  distanceRating: 'viewing distance rating',
  sizeTerm: 'size term',
  landform: 'landform',
  viewpoint: 'viewpoint',
  block: 'block',
  blockList: 'blocks',
  project: 'project name',
  withinGuidelines: 'within the guidelines',
  existing: 'existing alteration',
  proposed: 'proposed alteration',
  total: 'total alteration',
  plainVisibility: 'how visible the proposal is',
  defVisibility: 'objective’s visibility requirement',
  defScale: 'objective’s scale requirement',
  defDesign: 'objective’s design requirement',
  ceiling: 'objective’s ceiling',
  className: 'class',
  range: 'class range',
  hfov: 'field of view',
}

/** A slot's plain name for a "reviewer to complete" list. */
export const slotName = (slot: string) =>
  SLOT_NAMES[slot] ??
  // A need already written in words ("a key viewpoint that sees Block 3") prints as written.
  (/\s/.test(slot)
    ? slot
    : slot
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/[-_]/g, ' ')
        .toLowerCase())

/**
 * A sentence waiting on the reviewer, as a "reviewer to complete" list prints it: the template's label (else its id
 * spelled out) and the plain names of what it needs, never the template's internal codes.
 */
export function toCompleteLine(item: { id: string; missing: readonly string[]; label?: string }): string {
  const what = item.label ?? item.id.replace(/[-_]/g, ' ')
  const needs = [...new Set(item.missing.map(slotName))]
  return needs.length ? `${what}: needs ${andJoin(needs)}` : what
}
const andJoin = (items: readonly string[]) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`

// ------------------------------------------------------------------ vocabularies

/** FPPR s. 1.1 visibility terms, in order (22 adds "Extremely easy to see"). */
export const VISIBILITY_TERMS = [
  'Not easily distinguishable',
  'Difficult to see',
  'Easy to see',
  'Very easy to see',
] as const

/** Level of impact (the 2001 form's ocular terms; 22, 23 Table 5). */
export const IMPACT_TERMS = ['Not visible', 'Not visually evident', 'Subordinate', 'Dominant', 'Out of scale'] as const

/** Design sub-element ratings (22, 23 Table 5; the 2022 form's G / M / P). */
export const DESIGN_RATINGS = ['Good', 'Moderate', 'Poor'] as const

/** The extent a VQO is met: the 2022 handbook's Table 7 (06, 07) and the consultants' five-level scale (22, 23). */
export const EXTENT_TERMS = ['Well Met', 'Met', 'Inconclusive', 'Not Met', 'Clearly Not Met'] as const

/** What a block callout says, from the run's share of its ground seen (22, 23 callouts; `figureCallouts.ts`). */
export const CALLOUT_TERMS = [
  'Visible',
  'Possible Glimpses',
  'Likely Not Visible',
  'Unknown (missing terrain)',
] as const

/** FPPR s. 1.1's three requirements for each class, as a referral or a conclusion restates them. */
export const DEFINITION_PARTS: Record<'R' | 'PR' | 'M', { visibility: string; scale: string; design: string }> = {
  R: { visibility: 'difficult to see', scale: 'small in scale', design: 'natural in appearance' },
  PR: {
    visibility: 'easy to see',
    scale: 'small to medium in scale',
    design: 'natural and not rectilinear or geometric in shape',
  },
  M: {
    visibility: 'very easy to see',
    scale: 'large in scale',
    design: 'natural in appearance or, if angular, borrowing from the natural line and form of the landscape',
  },
}

// ------------------------------------------------------------------ sentence sets

export interface SentenceTemplate {
  id: string
  template: string
  source: SlotSource
  /** What the sentence is for, in the document. */
  role: string
}

const t = (id: string, role: string, source: SlotSource, template: string): SentenceTemplate => ({
  id,
  role,
  source,
  template,
})

/**
 * Consultant perspective reports (22, 23): the block discussion, the closing line and the conclusion. A block is
 * discussed once, from its key viewpoint (22), or the blocks together from one key viewpoint (23); the reasons a key
 * viewpoint is chosen are the references' (the most direct view, the largest share seen, the most visible), measured
 * here by the share of each block's ground the run sees.
 */
export const PERSPECTIVE_REPORT = {
  location: t(
    'location',
    'Block discussion: where the block is and that it is seen',
    'run',
    'Block {block} is located on {landform} and is visible from the {viewpoint} viewpoint.',
  ),
  keyViewpoint: t(
    'key-viewpoint',
    'Block discussion: why this viewpoint, when others see the block too',
    'run',
    'This viewpoint was chosen for the detailed assessment because it sees {share}% of the block’s ground, {compare} (next, {runnerUp} at {runnerShare}%), so the block is most visible and most directly in view from here.',
  ),
  keyOnly: t(
    'key-viewpoint',
    'Block discussion: why this viewpoint, when it is the only one that sees the block',
    'run',
    'The {viewpoint} viewpoint is the only one assessed that sees the block ({share}% of its ground in view), so the block is assessed from there.',
  ),
  keyReviewer: t(
    'key-viewpoint',
    'Block discussion: why this viewpoint, when the reviewer chose it',
    'reviewer',
    'The reviewer chose this viewpoint for the detailed assessment.',
  ),
  keyReviewerReason: t(
    'key-viewpoint',
    'Block discussion: why this viewpoint, when the reviewer chose it and said why',
    'reviewer',
    'The reviewer chose this viewpoint for the detailed assessment: {reason}.',
  ),
  keyGroupReviewer: t(
    'key-viewpoint',
    'Group discussion: why one viewpoint for the blocks together, when the reviewer chose it',
    'reviewer',
    'The reviewer chose this viewpoint to assess the blocks as a group.',
  ),
  keyGroupReviewerReason: t(
    'key-viewpoint',
    'Group discussion: why one viewpoint for the blocks together, when the reviewer chose it and said why',
    'reviewer',
    'The reviewer chose this viewpoint to assess the blocks as a group: {reason}.',
  ),
  keyGroup: t(
    'key-viewpoint',
    'Group discussion: why one viewpoint for the blocks together',
    'run',
    'This viewpoint was chosen to assess the blocks as a group because it sees {seenCount} at once, with {shares} of their ground in view: more of the group than any other viewpoint assessed, so the blocks are most visible together from here.',
  ),
  keyGroupImpact: t(
    'key-viewpoint',
    'Group discussion: why one viewpoint for the blocks together, chosen by impact (23)',
    'run',
    'This viewpoint was chosen to assess the blocks as a group as the visual impact is most significant from it: it sees {seenCount} at once, and of {scope} it shows the most alteration of the landform.',
  ),
  keyImpactRunnerUp: t(
    'key-viewpoint-next',
    'Key viewpoint by impact: the next viewpoint',
    'run',
    'Next is {runnerUp}, at {runnerPercent}%.',
  ),
  keyImpactNoSignificance: t(
    'key-viewpoint-significance',
    'Key viewpoint by impact: no significance given',
    'run',
    'No viewpoint’s significance is given in Table 3, so the choice rests on the alteration alone; the reviewer confirms it.',
  ),
  groupLeftOut: t(
    'group-left-out',
    'Group discussion: blocks the group viewpoint does not see',
    'run',
    '{blockList} {isAre} not seen from there and {isAre} assessed from {itsTheir} own key viewpoint.',
  ),
  groupLocation: t(
    'location',
    'Group discussion: where the blocks are and that they are seen',
    'run',
    '{blockList} are located on {landform} and are visible from the {viewpoint} viewpoint.',
  ),
  groupLocationSub: t(
    'location',
    'Group discussion: where the blocks are, on a sub-landform, and that they are seen (23)',
    'run',
    '{blockList} are located in {parent} within {landform} and are visible from the {viewpoint} viewpoint.',
  ),
  locationSub: t(
    'location',
    'Block discussion: where the block is, on a sub-landform, and that it is seen',
    'run',
    'Block {block} is located in {parent} within {landform} and is visible from the {viewpoint} viewpoint.',
  ),
  distanceRange: t(
    'distance',
    'Group discussion: the viewing distance as the range of the blocks’ own distances (23)',
    'run',
    'The viewing distance is between {near} and {far} km from the {viewpoint} viewpoint, {distanceRating} viewing distance.',
  ),
  glimpses: t(
    'glimpses',
    'Block discussion: a block seen only in glimpses',
    'run',
    'Block {block} is located on {landform}; from the {viewpoint} viewpoint at most glimpses of it may be seen.',
  ),
  locationOutside: t(
    'location',
    'Block discussion: a block seen from the viewpoint that lies in none of the landforms outlined from it',
    'run',
    'Block {block} lies outside the landforms outlined from the {viewpoint} viewpoint and is visible from it.',
  ),
  glimpsesOutside: t(
    'glimpses',
    'Block discussion: a block glimpsed from the viewpoint that lies in none of the landforms outlined from it',
    'run',
    'Block {block} lies outside the landforms outlined from the {viewpoint} viewpoint; from there at most glimpses of it may be seen.',
  ),
  notVisible: t(
    'not-visible',
    'Block discussion: a block no significant viewpoint sees',
    'run',
    '{blockList} {isAre} not expected to be visible from any of the viewpoints assessed, so {itsTheir} response to the lines of force, {itsTheir} borrowing from the natural character of the landscape and {itsTheir} position on the landform cannot be assessed.',
  ),
  visibility: t(
    'visibility',
    'Block discussion: level of impact and FPPR visibility term',
    'reviewer',
    'The visibility of the proposed block is {impact} and {visibility}.',
  ),
  groupVisibility: t(
    'visibility',
    'Group discussion: level of impact and FPPR visibility term for the blocks together',
    'reviewer',
    'Assessed together, the visual impact of the blocks is {impact} and their visibility {visibility}.',
  ),
  scale: t(
    'scale',
    'Block discussion: size term and the percent alteration',
    'run',
    'The scale of the alteration is {sizeTerm} relative to the landform ({percent}% alteration).',
  ),
  scaleShared: t(
    'scale',
    'Block discussion: size term when the landform’s figure counts other blocks in view',
    'run',
    'The scale of the alteration is {sizeTerm} relative to the landform ({percent}% alteration, a figure that also counts {others} {where}).',
  ),
  scaleSame: t(
    'scale',
    'Block discussion: a second block read on the same figure, not repeated',
    'run',
    'Its scale is read on the same landform figure as Block {first}’s, as the figure counts the blocks together.',
  ),
  scaleGroup: t(
    'scale',
    'Group discussion: size term for the blocks together',
    'run',
    'Assessed as a group, the alteration is {sizeTerm} in scale relative to the landform ({percent}% alteration).',
  ),
  scaleByBlock: t(
    'scale-by-block',
    'Group discussion: each block’s own size term, from its share of the run’s view',
    'run',
    'By block, from each block’s share of the blocks’ visible extent in the run: {list}.',
  ),
  scaleOutside: t(
    'scale-outside',
    'Block discussion: the key viewpoint’s landform does not hold the block',
    'run',
    'As outlined from this viewpoint, {landform} does not take in the {subject}, so its figure here ({percent}%) does not measure {itThem}.',
  ),
  scaleOutsideSame: t(
    'scale-outside',
    'Block discussion: a second block outside the same landform, not repeated',
    'run',
    'As with Block {first}, {landform} as outlined from this viewpoint does not take in this block.',
  ),
  scaleOutsideAll: t(
    'scale-outside',
    'Block discussion: no landform read from the key viewpoint holds the block',
    'run',
    'As outlined from this viewpoint, none of {landforms} takes in the {subject}, so no figure here measures {itThem}.',
  ),
  scaleMeasuredAt: t(
    'scale-measured-at',
    'Block discussion: where the block’s alteration is measured instead',
    'run',
    'Of the viewpoints whose landform shows the alteration, {viewpoint} sees the most of it, and {landform} reads {percent}% ({sizeTerm}) from there.',
  ),
  forceLines: t(
    'force-lines',
    'Block discussion: response to the lines of force',
    'reviewer',
    'The visual response to the lines of force is {forceLines}.',
  ),
  borrow: t(
    'borrow',
    'Block discussion: borrowing from the natural character of the landscape',
    'reviewer',
    'How the {subject} {borrowsBorrow} from the natural character of the landscape is rated {borrow}.',
  ),
  edges: t('edges', 'Block discussion: edge treatment', 'reviewer', 'The edge treatments are assessed as {edges}.'),
  distance: t(
    'distance',
    'Block discussion: viewing distance as a design rating',
    'run',
    'The block is located at a {distanceRating} viewing distance of {km} km from the {viewpoint} viewpoint.',
  ),
  distanceAtLeast: t(
    'distance',
    'Block discussion: viewing distance when only the nearest block in view is measured',
    'run',
    'Block {block} is at least {km} km from the {viewpoint} viewpoint, the distance to the nearest block in view; its own distance was not measured.',
  ),
  distanceShared: t(
    'distance',
    'Discussion: viewing distance when several blocks are in view',
    'run',
    'The nearest block in view is {km} km from the {viewpoint} viewpoint, a {distanceRating} viewing distance.',
  ),
  position: t(
    'position',
    'Block discussion: position on the landform',
    'reviewer',
    'The position of the opening within the landform is {position} as seen from this viewpoint.',
  ),
  groupPosition: t(
    'position',
    'Group discussion: position on the landform',
    'reviewer',
    'The position of the openings within the landform is {position} as seen from this viewpoint.',
  ),
  design: t(
    'design',
    'Block discussion: design character',
    'reviewer',
    'The visual design character of the alteration from the {viewpoint} viewpoint is {design}.',
  ),
  closing: t(
    'closing',
    'Block discussion: closing line',
    'reviewer',
    'The VQO of {vqo} is {extent} for {blockList} within {landform}.',
  ),
  closingOutside: t(
    'closing',
    'Block discussion: closing line for a block no landform outlined from the viewpoint holds',
    'reviewer',
    'The VQO of {vqo} is {extent} for {blockList}.',
  ),
  conclusion: t(
    'conclusion',
    'Conclusion',
    'reviewer',
    'The VQO of {vqo} is considered {extent} for {blockList}, as the alteration is i) {defVisibility}, ii) {defScale}, and iii) {defDesign}.',
  ),
  conclusionFigures: t(
    'conclusion-figures',
    'Conclusion: the figures at the key viewpoints',
    'run',
    'From {keyPhrase}, the percent alteration is {figures}.',
  ),
  otherPlanned: t(
    'other-planned',
    'Blocks of another sale or cutting permit, named once',
    'run',
    '{blockList} {isAre} planned under {underPhrase}. {ItThey} {isAre} drawn on the renders and counted in the percent alteration, as the landform will carry {itThem}, but {isAre} assessed in {itsTheir} own VIA and {isAre} not discussed as part of this proposal.',
  ),
} as const

/** 2001 guidebook forms with analysis sheets or analysed photos (03, 05). */
export const FORM_2001 = {
  calcLine: t('calc-line', 'Calculation box result', 'run', '%Alteration: {percent}% ({className})'),
  zone: t('zone', 'Viewpoint table: distance and zone', 'run', '{km} Km ({zone})'),
  ocular: t(
    'ocular',
    'Assessing the basic VQO definition: ocular term',
    'reviewer',
    'From {viewpoint} the alteration is {ocular}.',
  ),
  numeric: t(
    'numeric',
    'Assessing the numerical ranges',
    'run',
    'At {percent}% of the {basis}, the alteration falls in the {className} range ({range}).',
  ),
  objective: t(
    'objective',
    'The established objective against the figure',
    'run',
    'The established VQO is {objectiveName}; the figure is {standing} its range.',
  ),
} as const

/** The 2022 handbook's Appendix 1, one per viewpoint (06, 07). */
export const APPENDIX_1 = {
  x: t('x', '3.4.2 initial % alteration', 'run', 'X = a + b + c = {a} + {b} + {c} = {x}% ({initialClass})'),
  y: t('y', '3.4.3 adjustment', 'reviewer', 'Y = {y}; X (1 + 0.14 Y) = {adjusted}% ({adjustedClass})'),
  rating: t('rating', '3.5.1 rating', 'reviewer', 'The VQO of {vqo} is {rating} from {viewpoint}.'),
  rationale: t('rationale', '3.5.2 rationale', 'reviewer', '{rationale}'),
} as const

/** Public referral packages (11-15): the objective paragraph, the verdict and the captions. */
export const REFERRAL = {
  objective: t(
    'objective',
    'The objective paragraph',
    'scene',
    'The established visual quality objective for the landform on which {project} is situated is {objectiveName}: when seen from a significant public viewpoint the alteration is to be {defVisibility}, {defScale}, and {defDesign}. In perspective view it should generally not exceed {ceiling}% of the landform.',
  ),
  verdict: t(
    'verdict',
    'The verdict',
    'run',
    'From the viewpoints simulated, the visual quality objective is expected to be {extentLower} by {openingPhrase} ({percent}% of the landform at {viewpoint}).',
  ),
  caption: t('caption', 'Simulation caption', 'run', 'Viewpoint #{n}: {viewpoint}'),
  plain: t('plain', 'Plain-language caption', 'run', '{project} is {plainVisibility} from {viewpoint}.'),
} as const

/** 04's comparison strip. */
export const COMPARISON_STRIP = {
  caption: t('caption', 'Strip row caption', 'run', '{km} km viewing distance to centre of block'),
  footer: t(
    'footer',
    'Strip footer',
    'run',
    'All views scaled to viewing distance for comparison, {hfov}° field of view.',
  ),
} as const

/** 02's district summary rows. */
export const DISTRICT_SUMMARY = {
  total: t(
    'total',
    'Total perspective alteration',
    'run',
    'Existing {existing}% + proposed {proposed}% = {total}% of the {basis}',
  ),
  guidelines: t(
    'guidelines',
    'Within the % guidelines',
    'run',
    'Within the % alteration guidelines for {objective} ({printedRanges}): {withinGuidelines}',
  ),
} as const

/**
 * A plain-language phrase for how much of the proposal a viewpoint sees, for referral captions (15): from the run's
 * callouts only.
 */
export function plainVisibility(blocks: ReadonlyArray<{ status: string; visiblePercent: number }>): string | null {
  if (!blocks.length) return null
  if (blocks.some((b) => b.status === 'unknown')) return null
  const seen = blocks.filter((b) => b.status === 'visible' || b.status === 'possible glimpses')
  if (!seen.length) return 'not visible'
  const glimpses = seen.every((b) => b.status === 'possible glimpses')
  if (glimpses) return seen.length === 1 ? 'not visible except for one small patch' : 'barely visible, in small patches'
  return seen.length === blocks.length ? 'visible' : 'partly visible'
}

/** The run's impact and visibility terms for a block nothing of which is seen; a seen block's are the reviewer's. */
export function unseenTerms(status: string): { impact: string; visibility: string } | null {
  return status === 'not visible' ? { impact: 'not visible', visibility: 'not easily distinguishable' } : null
}
