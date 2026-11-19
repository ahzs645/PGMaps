/**
 * What a printed field a person left empty shows: the revision, who prepared it, a typed title-block
 * field. Blank by default, so a printed file carries no stand-in wording and the field can still be
 * written in by hand; `stated` prints the wording each product printed before ("Not recorded").
 * Only fields a person fills in go through here. A measured or data condition ("Not read", "Not
 * assessed", a supplier's term "Not stated", a block without terrain) keeps its own wording.
 * No DOM or network access.
 */

export type EmptyFields = 'blank' | 'stated'

export const DEFAULT_EMPTY_FIELDS: EmptyFields = 'blank'

export const EMPTY_FIELDS_OPTIONS: readonly { value: EmptyFields; label: string }[] = [
  { value: 'blank', label: 'Blank' },
  { value: 'stated', label: '“Not recorded”' },
]

/**
 * Reads the setting from a file. Absent and the default both read as undefined, so a file written
 * without the choice stays the same; any other value is refused.
 */
export function parseEmptyFields(raw: unknown): EmptyFields | undefined {
  if (raw === undefined || raw === DEFAULT_EMPTY_FIELDS) return undefined
  if (raw === 'stated') return raw
  throw Error('A field left empty prints blank or "Not recorded".')
}

/** The setting in force: given directly, or read from settings that may hold it. Absent is blank. */
export function emptyFieldsMode(setting: EmptyFields | { emptyFields?: EmptyFields } | null | undefined): EmptyFields {
  const mode = typeof setting === 'string' ? setting : setting?.emptyFields
  return mode === 'stated' ? 'stated' : DEFAULT_EMPTY_FIELDS
}

/**
 * What an empty field prints: `wording` (the product's earlier stand-in) when the setting says so,
 * else `blank`, which is the empty value or the field's own label left with nothing after it.
 */
export function emptyFieldText(
  setting: EmptyFields | { emptyFields?: EmptyFields } | null | undefined,
  wording: string,
  blank = '',
): string {
  return emptyFieldsMode(setting) === 'stated' ? wording : blank
}
