import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BOOK, bookFromDisk } from '../../../scripts/legal-rules/coverage-book'
import { anchor } from './coverageBook'

describe('coverage book', () => {
  it('matches the review and the shipped packs (rebuild with npm run legal:coverage-book)', () => {
    expect(readFileSync(BOOK, 'utf8') === bookFromDisk()).toBe(true)
  })

  it('links to a heading the way GitHub anchors it', () => {
    expect(anchor('Forest and Range Practices Act, SBC 2002 c. 69')).toBe(
      'forest-and-range-practices-act-sbc-2002-c-69',
    )
  })
})
