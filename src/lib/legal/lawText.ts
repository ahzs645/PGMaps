/**
 * The text of the law as `scripts/legal-rules/import_bclaws.py` stores it
 * (`packages/legal-rules/catalogue/generated/<source>.sections.json`): each section as numbered
 * blocks, so a provision preview can show the section and mark the part a rule cites or quotes.
 * DOM-free; loading lives in `lawLibrary.ts`.
 */
import type { StatuteRef } from './provisions'

export interface LawBlock {
  /** Where the block sits in its section: "(1)(b)", or "" for the opening words. */
  ref: string
  depth: number
  text: string
  kind?: 'definition' | 'table'
  rows?: string[][]
}
export interface LawSection {
  id: string
  number: string
  title: string
  hierarchy: { type: string; number: string; name: string }[]
  repealed: boolean
  blocks: LawBlock[]
}
export interface LawSource {
  sourceId: string
  officialUrl: string
  retrievedAt: string
  sectionCount: number
  sections: LawSection[]
  licence: { name: string; url: string; notice: string }
}

/** Whitespace and the curly quotes BC Laws prints, folded so a quote matches however it was typed. */
export const fold = (text: string) =>
  text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim()

export const sectionText = (section: LawSection) => section.blocks.map((b) => b.text).join(' ')

export function findSection(source: LawSource, number: string) {
  return source.sections.find((s) => s.number === number)
}

/** Whether a quote is printed in the section, word for word. */
export function quoteFound(section: LawSection, quote: string) {
  return fold(sectionText(section)).includes(fold(quote))
}

/** The subsection labels of a ref, outermost first: "(2)(a)(i)" → ["2", "a", "i"]. */
const labels = (ref: string) => [...ref.matchAll(/\(([^)]+)\)/g)].map((m) => m[1])
const startsWith = (ref: string, prefix: string[]) => prefix.every((p, i) => labels(ref)[i] === p)

/**
 * The blocks a citation's subsection names, as a first and last index: "(1)(b)" is that paragraph
 * and everything under it; "(2)–(4)" runs from the first block of (2) to the last block of (4).
 * A whole-section citation, or one whose subsection is not in the text, marks nothing.
 */
export function citedSpan(section: LawSection, sub: StatuteRef['sub']): [number, number] | null {
  if (!sub) return null
  const [from, to = from] = sub.split('–')
  const a = labels(from)
  // "(3)(h)–(i)": the end shares the start's outer levels.
  const b = to === from ? a : [...a.slice(0, Math.max(0, a.length - labels(to).length)), ...labels(to)]
  const first = section.blocks.findIndex((x) => startsWith(x.ref, a))
  let last = -1
  section.blocks.forEach((x, i) => {
    if (startsWith(x.ref, b)) last = i
  })
  return first < 0 || last < first ? null : [first, last]
}

/** The block a quote starts in, so a preview can scroll to it; -1 when it is not printed. */
export function quoteBlock(section: LawSection, quote: string) {
  const want = fold(quote)
  const head = want.slice(0, Math.min(40, want.length))
  return section.blocks.findIndex((b) => fold(b.text).includes(head))
}
