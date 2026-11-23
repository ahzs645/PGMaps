import { describe, expect, it } from 'vitest'

import { VIA_DOCUMENT_FORMATS } from './formats'
import { documentMarkdown, viewsLeftOutMarkdown } from './markdown'
import { resolveViaDocument, withViewsToComplete, type DocumentFacts } from './resolve'

// A package whose views have no class pass: the document holds no viewpoint. Made-up names only.
const facts: DocumentFacts = { project: 'Block X1', viewpoints: [] }
const leftOut = [
  {
    name: 'Viewpoint 1',
    reason: 'its analysis sheet could not be drawn: its class pass was not taken when it was saved',
  },
  { name: 'Viewpoint 2', reason: 'not captured' },
]

describe('a VIA document with no class pass', () => {
  for (const format of VIA_DOCUMENT_FORMATS)
    it(`${format.id} is filled, each view's figure listed under Reviewer to complete`, () => {
      const doc = withViewsToComplete(resolveViaDocument(format, facts), leftOut)
      expect(doc.viewpoints).toEqual([])
      expect(doc.toComplete.filter((item) => item.id === 'figure').map((item) => item.viewpoint)).toEqual([
        'Viewpoint 1',
        'Viewpoint 2',
      ])
      const markdown = documentMarkdown(doc, facts) + viewsLeftOutMarkdown(leftOut)
      const toComplete = markdown.slice(markdown.indexOf('## Reviewer to complete'))
      expect(toComplete).toContain('- Viewpoint 1: figure (needs a capture with its class pass)')
      expect(toComplete).toContain('- Viewpoint 2: figure (needs a capture with its class pass)')
      // Why each was left out closes the file; no percentage is printed for a figure nobody gave.
      expect(markdown).toContain('- Viewpoint 2: not captured.')
      expect(markdown).not.toContain('- Pixel figure (')
    })

  it('leaves a document whose views all have figures as it was', () => {
    const doc = resolveViaDocument(VIA_DOCUMENT_FORMATS[0], facts)
    expect(withViewsToComplete(doc, [])).toBe(doc)
    const listed = withViewsToComplete(doc, leftOut)
    expect(doc.toComplete).toHaveLength(listed.toComplete.length - leftOut.length)
  })
})
