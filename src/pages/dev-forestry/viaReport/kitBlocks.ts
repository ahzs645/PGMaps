/**
 * A report part defined as a document-kit JSON component (`recipeJson/components/`), read as the report's own blocks
 * (`ReportBlock`), so the one definition feeds every format: the PDF, the HTML, the Markdown and the draft read the
 * blocks this gives, and the Word route renders the same component through the engine and reads it back here too.
 * The part is rendered by the recipe engine over the facts object (`reportFacts.ts`, `engineParts.ts`); what it
 * leaves to complete is what its blocks declare as `pending`, in its own words. Loaded with the engine, never with
 * the page.
 *
 * The mapping is kept to the block kinds where it is exact: a heading, a paragraph of plain text (`text`), a list of
 * plain items, fields of label, value and source, a tick-box question, and the signature lines (`via.signature`).
 * Anything else is refused, naming it. No DOM or network access, and no kit code.
 */
import type { FieldRow, Provenance, ReportBlock } from './model'

const PROVENANCE: readonly Provenance[] = ['run', 'reviewer', 'scene', 'table', 'fixed']
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function fail(where: string, message: string): never {
  throw new Error(`VIA report part ${where}: ${message}`)
}

function provenance(value: unknown, where: string): Provenance {
  if (typeof value === 'string' && (PROVENANCE as readonly string[]).includes(value)) return value as Provenance
  return fail(where, `a source of ${JSON.stringify(value)}, which is not one of ${PROVENANCE.join(', ')}`)
}

/** Plain text: a string, or one text run with no look of its own. */
function plain(value: unknown, where: string): string {
  if (typeof value === 'string') return value
  if (isRecord(value) && value.type === 'text' && typeof value.text === 'string' && Object.keys(value).length === 2)
    return value.text
  return fail(where, 'text that is not plain (only plain text maps exactly onto a report block)')
}

function only(block: Record<string, unknown>, keys: readonly string[], where: string) {
  for (const key of Object.keys(block))
    if (!keys.includes(key)) fail(where, `a ${String(block.type)} with "${key}", which a report block cannot carry`)
}

/** A text that is plain, or blank: a run list or string that prints nothing is null. */
function plainOrNull(value: unknown, where: string): string | null {
  if (value === null || value === undefined) return null
  if (Array.isArray(value)) {
    if (!value.length) return null
    return value.map((item) => plain(item, where)).join('')
  }
  const text = plain(value, where)
  return text === '' ? null : text
}

/** The custom block kind that holds a report's signature lines. */
export const SIGNATURE_KIND = 'via.signature'

/**
 * The engine's blocks for one part as report blocks, exactly, and what the part declared to complete (its blocks'
 * `pending`, in order).
 */
export function readPart(blocks: readonly unknown[], part: string): { blocks: ReportBlock[]; toComplete: string[] } {
  const toComplete: string[] = []
  const out = blocks.map((block, i): ReportBlock => {
    const where = `${part}, block ${i + 1}`
    if (!isRecord(block)) return fail(where, 'a block that is not an object')
    if (Array.isArray(block.pending))
      for (const item of block.pending) {
        if (!isRecord(item) || typeof item.what !== 'string') fail(where, 'a pending item without words')
        toComplete.push(item.what as string)
      }
    const own = { ...block }
    delete own.pending
    return reportBlock(own, where)
  })
  return { blocks: out, toComplete }
}

/** Kit blocks (as written in a component, or as the recipe engine rendered them) as report blocks, exactly. */
export function reportBlocksOf(blocks: readonly unknown[], part: string): ReportBlock[] {
  return readPart(blocks, part).blocks
}

function reportBlock(block: Record<string, unknown>, where: string): ReportBlock {
  switch (block.type) {
    case 'heading': {
      only(block, ['type', 'level', 'content'], where)
      const level = block.level
      if (level !== 1 && level !== 2 && level !== 3) return fail(where, 'a heading level other than 1, 2 or 3')
      return { kind: 'heading', level, text: plain(block.content, where) }
    }
    case 'paragraph':
      only(block, ['type', 'content', 'source'], where)
      return { kind: 'text', text: plain(block.content, where), source: provenance(block.source, where) }
    case 'list': {
      only(block, ['type', 'items', 'ordered', 'source'], where)
      if (!Array.isArray(block.items)) return fail(where, 'a list without items')
      return {
        kind: 'list',
        items: block.items.map((item) => plain(item, where)),
        ...(block.ordered === true ? { ordered: true } : {}),
        source: provenance(block.source, where),
      }
    }
    case 'fields': {
      only(block, ['type', 'rows', 'title', 'layout'], where)
      if (block.layout !== undefined && block.layout !== 'table')
        return fail(where, 'fields laid out other than as a table')
      if (!Array.isArray(block.rows)) return fail(where, 'fields without rows')
      const rows = block.rows.map((row): FieldRow => {
        if (!isRecord(row)) return fail(where, 'a field row that is not an object')
        only(row, ['label', 'value', 'source'], where)
        return {
          label: plain(row.label, where),
          value: plainOrNull(row.value, where),
          source: provenance(row.source, where),
        }
      })
      // As `fields()` builds them: the title key is there, undefined when none.
      return { kind: 'fields', rows, title: typeof block.title === 'string' ? block.title : undefined }
    }
    case 'choices': {
      only(block, ['type', 'label', 'options', 'chosen', 'source', 'answer', 'boxed'], where)
      if (!Array.isArray(block.options)) return fail(where, 'a question without options')
      const chosen = block.chosen === null || block.chosen === undefined ? null : plain(block.chosen, where)
      return {
        kind: 'choices',
        label: plain(block.label, where),
        options: block.options.map((option) => plain(option, where)),
        chosen,
        source: provenance(block.source, where),
        ...(block.answer !== undefined ? { answer: plainOrNull(block.answer, where) } : {}),
        ...(block.boxed === true ? { boxed: true } : {}),
      }
    }
    case 'custom': {
      only(block, ['type', 'kind', 'data'], where)
      const data = block.data
      if (block.kind !== SIGNATURE_KIND || !isRecord(data) || !Array.isArray(data.lines))
        return fail(where, `a custom block of kind ${JSON.stringify(block.kind)}, which has no exact report block`)
      return { kind: 'signature', lines: data.lines.map((line) => plain(line, where)) }
    }
    default:
      return fail(where, `a ${JSON.stringify(block.type)} block, which has no exact report block`)
  }
}
