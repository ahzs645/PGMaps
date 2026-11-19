import { describe, expect, it } from 'vitest'
import { DEFAULT_EMPTY_FIELDS, emptyFieldsMode, emptyFieldText, parseEmptyFields } from './emptyFields'

describe('what a field left empty prints', () => {
  it('is blank by default and the earlier wording only when asked', () => {
    expect(DEFAULT_EMPTY_FIELDS).toBe('blank')
    expect(emptyFieldText(undefined, 'Not recorded')).toBe('')
    expect(emptyFieldText(null, 'Not recorded')).toBe('')
    expect(emptyFieldText({}, 'Not recorded')).toBe('')
    expect(emptyFieldText('blank', 'Not recorded')).toBe('')
    expect(emptyFieldText({ emptyFields: 'blank' }, 'Not recorded')).toBe('')
    expect(emptyFieldText('stated', 'Not recorded')).toBe('Not recorded')
    expect(emptyFieldText({ emptyFields: 'stated' }, 'Revision not recorded')).toBe('Revision not recorded')
  })

  it('can leave the field its label instead of nothing', () => {
    expect(emptyFieldText(undefined, 'Revision not recorded', 'Rev')).toBe('Rev')
    expect(emptyFieldText('stated', 'Revision not recorded', 'Rev')).toBe('Revision not recorded')
  })

  it('reads the mode from settings, absent as blank', () => {
    expect(emptyFieldsMode(undefined)).toBe('blank')
    expect(emptyFieldsMode({})).toBe('blank')
    expect(emptyFieldsMode({ emptyFields: 'stated' })).toBe('stated')
  })

  it('reads a file: absent and the default leave nothing to store, another value is refused', () => {
    expect(parseEmptyFields(undefined)).toBeUndefined()
    expect(parseEmptyFields('blank')).toBeUndefined()
    expect(parseEmptyFields('stated')).toBe('stated')
    expect(() => parseEmptyFields('dash')).toThrow(/blank or "Not recorded"/)
    expect(() => parseEmptyFields(1)).toThrow(/blank or "Not recorded"/)
  })
})
