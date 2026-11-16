/**
 * The reviewer's hand edits of a VIA report's printed values (`viaReview.reportEdits`). A part still fills its blocks
 * from the assessment; an edit then replaces one printed value (a field, a sentence, a table cell, a list item, a
 * ticked box or its answer) with the reviewer's own words, marked as the reviewer's. Every renderer draws the edited
 * report, so the draft, the PDF, the HTML and the Markdown agree. An edit is keyed by its part and its place in the
 * part (the heading it sits under, its label), never by the recipe, so two recipes that share a part share its edits.
 * An edit whose place the part no longer prints is kept and reported (`orphans`), never applied elsewhere. No DOM or
 * network access.
 */
import type { ReportBlock } from './model'

/** Edits by key (`EditTarget.key`). An empty string blanks the value. */
export type ReportEdits = Readonly<Record<string, string>>

export type EditKind = 'field' | 'text' | 'paragraph' | 'item' | 'cell' | 'choice' | 'answer'

/** One value of a report a reviewer can change by hand. */
export interface EditTarget {
  key: string
  /** The part's id and title. */
  partId: string
  part: string
  kind: EditKind
  /** What it is, for a list of edits: the heading it sits under and its own label. */
  label: string
  /** What the part printed, before any edit; null for a blank. */
  original: string | null
  /** The reviewer's edit, when there is one. */
  edited?: string
  /** A tick-box question's options: its edit is one of them, or empty for none ticked. */
  options?: readonly string[]
}

/** The key of a drawn value, for the draft's page: by the object that holds it, and a cell or option within it. */
export interface EditKeys {
  of(holder: object, sub?: string): string | undefined
}

const NO_KEYS: EditKeys = { of: () => undefined }
export const noEditKeys = NO_KEYS

/** A table cell's place within its table, as `EditKeys.of`'s `sub`. */
export const cellSub = (row: number, column: number) => `${row}:${column}`
/** A list item's place within its list. */
export const itemSub = (index: number) => `${index}`
/** A boxed question's answer line, beside its ticks. */
export const ANSWER_SUB = 'answer'

/**
 * One part's blocks with the reviewer's edits applied, and every value of it that can be edited. With no edit for
 * the part, `blocks` holds the very objects given.
 */
export function editPartBlocks(
  part: { id: string; title: string },
  blocks: readonly ReportBlock[],
  edits: ReportEdits,
): { blocks: ReportBlock[]; targets: EditTarget[]; keys: Map<object, Map<string, string>>; filled: string[] } {
  const targets: EditTarget[] = []
  const keys = new Map<object, Map<string, string>>()
  const filled: string[] = []
  const seen = new Map<string, number>()
  const keep = (holder: object, sub: string, key: string) => {
    const map = keys.get(holder) ?? new Map<string, string>()
    map.set(sub, key)
    keys.set(holder, map)
  }
  /** Registers one value and returns what prints: the edit when there is one, else the original. */
  const leaf = (
    scope: string,
    kind: EditKind,
    label: string,
    original: string | null,
    options?: readonly string[],
  ): { key: string; value: string | null; edited: boolean } => {
    const base = `${part.id}|${scope}|${kind}|${label}`
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    const key = n ? `${base}#${n + 1}` : base
    const has = Object.prototype.hasOwnProperty.call(edits, key)
    // A tick that is not one of the question's options is not applied: the options are the format's own.
    const usable = has && (!options || edits[key] === '' || options.includes(edits[key]))
    targets.push({
      key,
      partId: part.id,
      part: part.title,
      kind,
      label: [scope, label].filter(Boolean).join(' › ') || part.title,
      original,
      ...(usable ? { edited: edits[key] } : {}),
      ...(options ? { options } : {}),
    })
    if (!usable) return { key, value: original, edited: false }
    return { key, value: edits[key] === '' ? null : edits[key], edited: true }
  }
  const walk = (list: readonly ReportBlock[], scopeIn: string): ReportBlock[] => {
    let scope = scopeIn
    return list.map((block): ReportBlock => {
      switch (block.kind) {
        case 'heading':
          if (block.level >= 2) scope = block.text
          return block
        case 'fields': {
          let changed = false
          const rows = block.rows.map((row) => {
            const out = leaf(scope, 'field', [block.title, row.label].filter(Boolean).join(' › '), row.value)
            if (!out.edited) {
              keep(row, '', out.key)
              return row
            }
            changed = true
            if (row.value === null && out.value !== null) filled.push(row.label)
            const next = { ...row, value: out.value, source: 'reviewer' as const }
            keep(next, '', out.key)
            return next
          })
          return changed ? { ...block, rows } : block
        }
        case 'text': {
          const out = leaf(scope, 'text', '', block.text)
          const next = out.edited ? { ...block, text: out.value ?? '', source: 'reviewer' as const } : block
          keep(next, '', out.key)
          return next
        }
        case 'paragraph': {
          const original = block.sentences
            .map((s) => s.text ?? '')
            .filter(Boolean)
            .join(' ')
          const out = leaf(scope, 'paragraph', '', original || null)
          const next: ReportBlock = out.edited
            ? {
                kind: 'paragraph',
                sentences: out.value
                  ? [{ id: 'edited', text: out.value, source: 'reviewer', missing: [], template: '' }]
                  : [],
              }
            : block
          keep(next, '', out.key)
          return next
        }
        case 'list': {
          let changed = false
          const outs = block.items.map((item) => leaf(scope, 'item', '', item))
          const items = outs.map((out) => {
            if (out.edited) changed = true
            return out.value ?? ''
          })
          const next = changed ? { ...block, items, source: 'reviewer' as const } : block
          outs.forEach((out, index) => keep(next, itemSub(index), out.key))
          return next
        }
        case 'table': {
          let changed = false
          const outs = block.rows.map((row, r) =>
            row.map((cell, c) =>
              leaf(
                scope,
                'cell',
                [block.title, `row ${r + 1}`, block.columns[c] ?? `column ${c + 1}`].filter(Boolean).join(' › '),
                cell || null,
              ),
            ),
          )
          const rows = outs.map((row) =>
            row.map((out) => {
              if (out.edited) changed = true
              return out.value ?? ''
            }),
          )
          const next = changed ? { ...block, rows } : block
          outs.forEach((row, r) => row.forEach((out, c) => keep(next, cellSub(r, c), out.key)))
          return next
        }
        case 'choices': {
          const tick = leaf(scope, 'choice', block.label, block.chosen, block.options)
          const answer = block.answer === undefined ? null : leaf(scope, 'answer', block.label, block.answer ?? null)
          const next =
            tick.edited || answer?.edited
              ? {
                  ...block,
                  ...(tick.edited ? { chosen: tick.value, source: 'reviewer' as const } : {}),
                  ...(answer?.edited ? { answer: answer.value } : {}),
                }
              : block
          keep(next, '', tick.key)
          if (answer) keep(next, ANSWER_SUB, answer.key)
          return next
        }
        case 'form': {
          let changed = false
          const rows = block.rows.map((row) =>
            row.map((cell) => {
              const inner = walk(cell.blocks, cell.title)
              if (inner.every((b, i) => b === cell.blocks[i])) return cell
              changed = true
              return { ...cell, blocks: inner }
            }),
          )
          return changed ? { ...block, rows } : block
        }
        default:
          return block
      }
    })
  }
  const out = walk(blocks, '')
  return { blocks: out, targets, keys, filled }
}

/** The lookup the draft's page reads keys through, over every part's `keys`. */
export function editKeysOf(maps: ReadonlyArray<Map<object, Map<string, string>>>): EditKeys {
  return {
    of: (holder, sub = '') => {
      for (const map of maps) {
        const key = map.get(holder)?.get(sub)
        if (key) return key
      }
      return undefined
    },
  }
}

/** Edits kept for one of `partIds` whose place no part printed: shown to the reviewer, never applied. */
export function orphanEdits(edits: ReportEdits, partIds: readonly string[], targets: readonly EditTarget[]): string[] {
  const known = new Set(targets.map((target) => target.key))
  const parts = new Set(partIds)
  return Object.keys(edits).filter((key) => parts.has(key.slice(0, key.indexOf('|'))) && !known.has(key))
}

/** `edits` with `key` set to `value`, or dropped when `value` is null or equals what the part printed. */
export function withReportEdit(
  edits: ReportEdits | undefined,
  key: string,
  value: string | null,
  original?: string | null,
): Record<string, string> | undefined {
  const next: Record<string, string> = { ...edits }
  if (value === null || (original !== undefined && value === (original ?? ''))) delete next[key]
  else next[key] = value
  return Object.keys(next).length ? next : undefined
}

/** A stored `reportEdits`, read leniently: string values under string keys, anything else dropped. */
export function parseReportEdits(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const out: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>))
    if (typeof entry === 'string' && key.includes('|')) out[key] = entry
  return Object.keys(out).length ? out : undefined
}
