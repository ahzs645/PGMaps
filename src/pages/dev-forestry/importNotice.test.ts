import { describe, expect, it } from 'vitest'

import { importNotice, importNoticeIsError } from './importNotice'

describe('step 1’s import line', () => {
  it('is an error by its kind, never by how it is worded', () => {
    // A run that could not start says so in its own words.
    expect(importNoticeIsError(importNotice.error('The scenario contains invalid numeric inputs.'))).toBe(true)
    // A message that happens to start like an error but is not one.
    expect(importNoticeIsError(importNotice.info('Could not be simpler: imported 2 polygons.'))).toBe(false)
    expect(importNoticeIsError(importNotice.progress('Reading…'))).toBe(false)
    expect(importNoticeIsError(null)).toBe(false)
  })
})
