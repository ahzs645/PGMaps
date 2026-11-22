/**
 * Step 1's import line (`importMessage` on the page): what an import, a lookup or a run that could not start says,
 * with its kind stated where it is written rather than read from its wording. A failure is an error in the header and
 * the step whatever it begins with ("The scenario contains invalid numeric inputs."). DOM-free.
 */
export type ImportNoticeKind = 'progress' | 'info' | 'error'

export type ImportNotice = { text: string; kind: ImportNoticeKind }

export const importNotice = {
  /** Work under way: "Reading…". */
  progress: (text: string): ImportNotice => ({ text, kind: 'progress' }),
  info: (text: string): ImportNotice => ({ text, kind: 'info' }),
  error: (text: string): ImportNotice => ({ text, kind: 'error' }),
}

/** Whether a notice reads as an error (the header's and the step's tone). */
export const importNoticeIsError = (notice: ImportNotice | null | undefined): boolean => notice?.kind === 'error'
