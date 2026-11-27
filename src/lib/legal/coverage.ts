/**
 * How far the rule packs reach into each source, section by section: which pack rules and which
 * ground screens cite it (read from the packs and `ground/instruments.json`, so it can never drift
 * from them), beside the section-by-section review in `packages/legal-rules/catalogue/section-review/`
 * (what each section bears on, whether the rules really test it, and what a rule would need).
 * The review is a reading, not a legal opinion; the citations are facts about the packs. DOM-free.
 */
import type { Pack } from '../../../packages/legal-rules/src/contract'
import { orderRefs, parseProvision } from './provisions'

export type Relevance =
  | 'block'
  | 'landscape'
  | 'plan'
  | 'tenure'
  | 'silviculture'
  | 'roads'
  | 'range'
  | 'definitions'
  | 'admin'
  | 'enforcement'
  | 'repealed'
export type GapPriority = 'high' | 'medium' | 'low'

export interface CoverageEntry {
  /** Section number, or the order's provision id. */
  n: string
  relevance: Relevance
  bearsOn: string
  /** The reviewer's judgement of how far the rules test it: rule, partial, screen, code, none, n/a. */
  review: string
  coveredBy?: string[]
  gapPriority?: GapPriority
  gapNote?: string
  encodable?: string
  proposedFacts?: string[]
}
export interface CoverageReview {
  format: 'pgmaps-coverage-review/v1'
  source: string
  reviewedOn: string
  method: string
  sections: CoverageEntry[]
}

export interface Citing {
  kind: 'rule' | 'screen'
  /** "bc.fppr@1.1.0:limit-60" or "ground:ogma". */
  id: string
  label: string
}

export interface GroundCitations {
  id: string
  label: string
}

const OUTSIDE_A_BLOCK: Relevance[] = ['admin', 'enforcement', 'definitions', 'repealed', 'tenure']

/** The key a section is indexed under: "bc.fppr:64", "bc.omineca.ada-sra.2006:C.5". */
export const sectionKey = (source: string, n: string) => `${source}:${n}`

/**
 * Who cites what. `sourceOf` maps a pack's source address to its catalogue id; `isOrder` says
 * whether a catalogue id numbers its provisions as an order does.
 */
export function citationIndex(
  packs: Pack[],
  ground: (GroundCitations & Record<string, unknown>)[],
  sourceOf: (url: string) => string | undefined,
  isOrder: (id: string) => boolean,
) {
  const index = new Map<string, Citing[]>()
  const add = (source: string, provision: string, c: Citing) => {
    // An order's provision cited by its own id ("Strategy 1.02", "1.A.k") is indexed under that id too.
    const refs = isOrder(source)
      ? [{ kind: 'order' as const, provision }, ...orderRefs(provision)]
      : parseProvision(provision, source)
    for (const ref of refs) {
      const key =
        ref.kind === 'order'
          ? ref.other
            ? null
            : sectionKey(source, ref.provision)
          : sectionKey(ref.source ?? source, ref.section)
      if (!key) continue
      const list = index.get(key) ?? []
      if (!list.some((x) => x.id === c.id)) list.push(c)
      index.set(key, list)
    }
  }
  for (const p of packs)
    for (const r of p.rules) {
      const source = sourceOf(p.sources.find((s) => s.id === r.source)?.url ?? '')
      if (source)
        add(source, r.provision, { kind: 'rule', id: `${p.id}@${p.version}:${r.id}`, label: `${p.title}: ${r.title}` })
      // An exception a rule lists cites its own provision, so the law that makes it is reached too.
      for (const x of r.exceptions ?? []) {
        const from = sourceOf(p.sources.find((s) => s.id === x.source)?.url ?? '')
        if (from)
          add(from, x.provision, {
            kind: 'rule',
            id: `${p.id}@${p.version}:${r.id}#${x.id}`,
            label: `${p.title}: ${r.title}, exception`,
          })
      }
    }
  const walk = (o: unknown, c: Citing): void => {
    if (Array.isArray(o)) o.forEach((x) => walk(x, c))
    else if (o && typeof o === 'object') {
      const x = o as { source?: unknown; provision?: unknown }
      if (typeof x.source === 'string' && typeof x.provision === 'string') add(x.source, x.provision, c)
      for (const v of Object.values(o)) walk(v, c)
    }
  }
  for (const g of ground) walk(g, { kind: 'screen', id: `ground:${g.id}`, label: `On this ground: ${g.label}` })
  return index
}

export type SectionState = 'rule' | 'screen' | 'gap-high' | 'gap-medium' | 'gap-low' | 'outside' | 'unreviewed'

/**
 * A section's place on the coverage map. A rule citing it puts it on the map as ruled even when
 * the review finds the rule only partly tests it; the review's gap note says what is left.
 */
export function sectionState(cited: Citing[] | undefined, review: CoverageEntry | undefined): SectionState {
  if (cited?.some((c) => c.kind === 'rule')) return 'rule'
  if (review?.gapPriority === 'high') return 'gap-high'
  if (review?.gapPriority === 'medium') return 'gap-medium'
  if (cited?.length) return 'screen'
  if (review?.gapPriority === 'low') return 'gap-low'
  if (!review) return 'unreviewed'
  return OUTSIDE_A_BLOCK.includes(review.relevance) || review.review === 'n/a' ? 'outside' : 'gap-low'
}

export const STATE_LABEL: Record<SectionState, string> = {
  rule: 'A rule cites it',
  screen: 'A map screen cites it',
  'gap-high': 'Gap: high',
  'gap-medium': 'Gap: medium',
  'gap-low': 'Gap: low',
  outside: 'Not about a block',
  unreviewed: 'Not reviewed',
}

/** Sections with a gap, highest priority first, for the to-do list. */
export function gapsOf(reviews: CoverageReview[]) {
  const rank: Record<GapPriority, number> = { high: 0, medium: 1, low: 2 }
  return reviews
    .flatMap((r) => r.sections.filter((s) => s.gapPriority).map((s) => ({ source: r.source, entry: s })))
    .sort((a, b) => rank[a.entry.gapPriority!] - rank[b.entry.gapPriority!])
}

/** The review as CSV, one row a section, for working through the gaps outside PGMaps. */
export function coverageCsv(reviews: CoverageReview[], index: Map<string, Citing[]>) {
  const cell = (v: unknown) => {
    const s = Array.isArray(v) ? v.join('; ') : v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const rows = [
    [
      'source',
      'section',
      'relevance',
      'cited_by',
      'review',
      'gap_priority',
      'bears_on',
      'gap_note',
      'proposed_questions',
    ],
  ]
  for (const r of reviews)
    for (const s of r.sections)
      rows.push([
        r.source,
        s.n,
        s.relevance,
        (index.get(sectionKey(r.source, s.n)) ?? []).map((c) => c.id).join('; '),
        s.review,
        s.gapPriority ?? '',
        s.bearsOn,
        s.gapNote ?? '',
        (s.proposedFacts ?? []).join(' | '),
      ])
  return rows.map((row) => row.map(cell).join(',')).join('\n') + '\n'
}
