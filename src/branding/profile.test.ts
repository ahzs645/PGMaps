import { describe, expect, it } from 'vitest'

import {
  blanksFilledFromProfile,
  designationText,
  EMPTY_PROFILE,
  nameWithDesignation,
  parsePreparerProfile,
  profileIsEmpty,
  profileSummary,
} from './profile'
import { fitLogoBox, printedLogoSvg, brandedHtml } from './presentation'
import type { UploadedLogo } from './model'

const profile = {
  name: 'J. Smith',
  designation: 'RPF',
  registration: '#4521',
  organisation: 'Northwood Forestry',
  contact: '',
}

describe('your details', () => {
  it('reads a stored profile, trimming each field and leaving absent ones empty', () => {
    expect(parsePreparerProfile({ name: '  J. Smith ', designation: 'RPF' })).toEqual({
      ...EMPTY_PROFILE,
      name: 'J. Smith',
      designation: 'RPF',
    })
    expect(parsePreparerProfile({ ...EMPTY_PROFILE, name: 'J. Smith' })).toEqual({ ...EMPTY_PROFILE, name: 'J. Smith' })
    expect(() => parsePreparerProfile({ name: 'x'.repeat(201) })).toThrow(/Name/)
    expect(() => parsePreparerProfile({ name: 4 })).toThrow()
    expect(() => parsePreparerProfile('J. Smith')).toThrow()
  })

  it('prints a registration number only beside a designation', () => {
    expect(designationText(profile)).toBe('RPF #4521')
    expect(designationText({ designation: 'RPF', registration: '' })).toBe('RPF')
    expect(designationText({ designation: '', registration: '4521' })).toBe('')
    expect(nameWithDesignation('J. Smith', 'RPF #4521')).toBe('J. Smith, RPF #4521')
    expect(nameWithDesignation('', 'RPF')).toBe('')
  })

  it('names the person in one line, or says it is not set', () => {
    expect(profileSummary(profile)).toBe('J. Smith, RPF #4521 · Northwood Forestry')
    expect(profileSummary(null)).toBe('Not set')
    expect(profileIsEmpty({ ...EMPTY_PROFILE, contact: ' ' })).toBe(true)
  })

  it('fills only the fields a record leaves blank, and never with an empty value', () => {
    expect(
      blanksFilledFromProfile(
        { preparedBy: 'A. Other', organisation: '' },
        { preparedBy: 'J. Smith', designation: 'RPF', organisation: '' },
      ),
    ).toEqual({ designation: 'RPF' })
  })
})

describe('the printed logo', () => {
  const logo: UploadedLogo = {
    name: 'mark.png',
    format: 'PNG',
    dataUrl: 'data:image/png;base64,AAAA',
    width: 400,
    height: 100,
  }

  it('keeps its own proportions inside the box', () => {
    expect(fitLogoBox(logo, 10, 20, 100, 50)).toEqual({ x: 10, y: 32.5, width: 100, height: 25 })
  })

  it('draws the user’s own logo in place of a brand, and nothing without either', () => {
    expect(printedLogoSvg(undefined, logo, 0, 0, 100, 50)).toContain('href="data:image/png;base64,AAAA"')
    expect(printedLogoSvg(undefined, null, 0, 0, 100, 50)).toBe('')
  })

  it('heads a document with the user’s logo when no brand is chosen, and leaves drawing sheets to their title blocks', () => {
    const page =
      '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'"></head><body><h1>Report</h1></body></html>'
    const headed = brandedHtml(page, undefined, logo)
    expect(headed).toContain('<body><header data-brand-header')
    expect(headed).toContain('img-src data:')
    expect(brandedHtml(page)).toBe(page)
    const sheets = '<html><head></head><body><section class="sheet"></section></body></html>'
    expect(brandedHtml(sheets, undefined, logo)).toBe(sheets)
  })
})
