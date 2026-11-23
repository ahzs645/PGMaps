/**
 * Projects saved before the office fields had a *Historical reference* (`referenceDocument`) put a historical VIA's
 * reference, the documents it was read from, in *Objective established by* (`sourceDocument`), the field that names
 * the objective's authority. This module says when that field reads as such a reference, and moves it on the
 * reviewer's click: never on its own, and never anything else. No DOM or network access.
 */
import type { FormMetadata } from './pdf/fs1252'
import { projectAttachmentName } from './projectAttachmentName'

const SEPARATOR = ' | '

const comparable = (name: string) => projectAttachmentName(name.normalize('NFC')).toLocaleLowerCase('en')

const partsOf = (text: string | undefined) =>
  (text ?? '')
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)

/**
 * The parts of `sourceDocument` to move, or null when there is nothing to offer: the field is blank, or one of its
 * " | "-separated parts is not the name of a file the project carries. A part that names a file only partly, or
 * an order or a plan, keeps the whole field where it is: only a field made wholly of the project's own files reads
 * as a historical reference rather than the objective's authority.
 */
export function referenceMoveOffer(
  metadata: Pick<FormMetadata, 'sourceDocument'> | null | undefined,
  attachmentNames: readonly string[],
): { parts: string[] } | null {
  const parts = partsOf(metadata?.sourceDocument)
  if (!parts.length || !attachmentNames.length) return null
  const names = new Set(attachmentNames.map(comparable))
  return parts.every((part) => names.has(comparable(part))) ? { parts } : null
}

/**
 * `metadata` with `sourceDocument`'s parts added to the end of `referenceDocument` (a part it already holds is not
 * repeated) and `sourceDocument` removed. Every other field is as it was.
 */
export function movedReference(metadata: FormMetadata): FormMetadata {
  const moving = partsOf(metadata.sourceDocument)
  const rest = { ...metadata }
  delete rest.sourceDocument
  if (!moving.length) return rest
  const held = partsOf(metadata.referenceDocument)
  const seen = new Set(held.map(comparable))
  const added = moving.filter((part) => {
    const key = comparable(part)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const existing = metadata.referenceDocument?.trim() ?? ''
  const referenceDocument = [existing, ...added].filter(Boolean).join(SEPARATOR)
  return { ...rest, ...(referenceDocument ? { referenceDocument } : {}) }
}

/** The one line that says what the move would do, for the open receipt and beside the field. */
export function referenceMoveLine(offer: { parts: readonly string[] }): string {
  const count = offer.parts.length
  return `Objective established by names only ${count === 1 ? 'a file' : `${count} files`} this project carries, which reads as the historical VIA's reference rather than the objective's authority. You can move it to Historical reference; nothing has been changed.`
}
