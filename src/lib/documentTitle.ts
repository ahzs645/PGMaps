/**
 * A printed document's title (`docs/shared-ui.md`, **Document titles**). Every tool that prints files follows the same
 * rule: the title follows a name the tool already has (the project's name, the site's) until the person types their
 * own, and clearing it follows the name again. Only a title the person typed is stored, so a project that never set
 * one is saved exactly as before, and renaming the project renames every document that still follows it.
 * DOM-free.
 */

/** The longest title a person can type. */
export const MAX_DOCUMENT_TITLE = 200

/** What is stored for a title as typed: the trimmed text, or nothing (follow the name) when it is blank. */
export function storedDocumentTitle(typed: string | undefined | null): string | undefined {
  const text = (typed ?? '').replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, MAX_DOCUMENT_TITLE) : undefined
}

/** The title a document prints: the person's own, else the name it follows. */
export function documentTitle(own: string | undefined | null, follows: string): string {
  return storedDocumentTitle(own) ?? follows
}

/** Whether the title follows the name, i.e. the person has not set one. */
export const followsName = (own: string | undefined | null) => storedDocumentTitle(own) === undefined

/**
 * Reads a stored title from a saved file: absent, blank or not text reads as following, so an older file and a file
 * from a newer version both open. A title longer than the limit is cut to it.
 */
export function parseDocumentTitle(raw: unknown): string | undefined {
  return typeof raw === 'string' ? storedDocumentTitle(raw) : undefined
}

/** `{ [key]: title }` when the person set one, else `{}`, so a record that follows the name keeps no key. */
export function withDocumentTitle<K extends string>(key: K, own: string | undefined): { [P in K]?: string } {
  const title = storedDocumentTitle(own)
  return (title === undefined ? {} : { [key]: title }) as { [P in K]?: string }
}

/** A file name's stem from a title: letters and digits kept, every other run turned to `-`, at most `max` characters. */
export const titleFileStem = (title: string, fallback: string, max = 70) =>
  (title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || fallback).slice(0, max)
