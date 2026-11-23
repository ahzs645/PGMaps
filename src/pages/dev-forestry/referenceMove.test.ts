import { describe, expect, it } from 'vitest'

import { movedReference, referenceMoveLine, referenceMoveOffer } from './referenceMove'

// Made-up file names only: no real VIA case, block or place.
const files = ['Example VIA report.pdf', 'Sheet A.pdf', 'case.json']

describe('referenceMoveOffer', () => {
  it('offers the move when every part names a file the project carries', () => {
    expect(referenceMoveOffer({ sourceDocument: 'Example VIA report.pdf | Sheet A.pdf' }, files)).toEqual({
      parts: ['Example VIA report.pdf', 'Sheet A.pdf'],
    })
    // One file alone, and names compared as the archive keeps them (case, characters a file system refuses).
    expect(referenceMoveOffer({ sourceDocument: 'sheet a.PDF' }, files)).toEqual({ parts: ['sheet a.PDF'] })
    expect(referenceMoveOffer({ sourceDocument: 'Sheet:A.pdf' }, ['Sheet-A.pdf'])).toEqual({ parts: ['Sheet:A.pdf'] })
  })

  it('offers nothing when a part is not one of the files, or names one only partly', () => {
    expect(referenceMoveOffer({ sourceDocument: 'Example VIA report.pdf | A higher level plan' }, files)).toBeNull()
    expect(referenceMoveOffer({ sourceDocument: 'Example VIA report' }, files)).toBeNull()
    expect(referenceMoveOffer({ sourceDocument: 'Sheet A.pdf, page 2' }, files)).toBeNull()
  })

  it('offers nothing for a blank field or a project with no files', () => {
    expect(referenceMoveOffer({}, files)).toBeNull()
    expect(referenceMoveOffer({ sourceDocument: '  |  ' }, files)).toBeNull()
    expect(referenceMoveOffer(null, files)).toBeNull()
    expect(referenceMoveOffer({ sourceDocument: 'Sheet A.pdf' }, [])).toBeNull()
  })

  it('offers nothing once the move is made', () => {
    const moved = movedReference({ sourceDocument: 'Sheet A.pdf', licence: 'A00000' })
    expect(referenceMoveOffer(moved, files)).toBeNull()
  })
})

describe('movedReference', () => {
  it('moves the field into Historical reference and clears it, changing nothing else', () => {
    expect(movedReference({ sourceDocument: 'Sheet A.pdf | case.json', licence: 'A00000' })).toEqual({
      licence: 'A00000',
      referenceDocument: 'Sheet A.pdf | case.json',
    })
  })

  it('appends to a Historical reference already given, without repeating a part it holds', () => {
    expect(
      movedReference({ sourceDocument: 'sheet a.pdf | case.json', referenceDocument: 'An earlier note | Sheet A.pdf' }),
    ).toEqual({ referenceDocument: 'An earlier note | Sheet A.pdf | case.json' })
  })

  it('leaves Historical reference as it was when the field is blank', () => {
    expect(movedReference({ sourceDocument: '', referenceDocument: 'An earlier note' })).toEqual({
      referenceDocument: 'An earlier note',
    })
  })

  it('says how many files it would move and that nothing changed yet', () => {
    expect(referenceMoveLine({ parts: ['a', 'b'] })).toMatch(/names only 2 files .* nothing has been changed/)
    expect(referenceMoveLine({ parts: ['a'] })).toMatch(/names only a file /)
  })
})
