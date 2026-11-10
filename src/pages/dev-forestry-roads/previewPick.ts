/**
 * What a click on an export preview opens: a title block or the report's issue box opens the issue
 * stamp; a plot-book sheet opens its chapter's settings; a report heading opens the report's
 * contents at that section. The preview reads the clicked element and its ancestors and hands them
 * here. No DOM access.
 */
import { reportSectionForHeading, type ReportSectionId } from './reportContents'

export type PreviewPick = { view: 'issue' } | { view: 'setup'; chapter?: string; section?: ReportSectionId }

/** One element from the clicked one outwards, as the preview reads it. */
export interface PickedElement {
  tag: string
  classes?: readonly string[]
  /** `data-role` */
  role?: string | null
  /** `data-chapter` */
  chapter?: string | null
  text?: string | null
}

/** Clickable parts of a preview, for its pointer cursor. */
export const PREVIEW_PICK_SELECTOR = '[data-role="title-block"], [data-chapter], dl.issue, h2'

export function previewPick(chain: readonly PickedElement[]): PreviewPick | null {
  for (const element of chain) {
    const tag = element.tag.toLowerCase()
    if (element.role === 'title-block' || (tag === 'dl' && element.classes?.includes('issue'))) return { view: 'issue' }
    if (tag === 'h2') {
      const section = reportSectionForHeading(element.text ?? '')
      return section ? { view: 'setup', section } : null
    }
    if (element.chapter) return { view: 'setup', chapter: element.chapter }
  }
  return null
}
