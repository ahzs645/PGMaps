import { describe, expect, it } from 'vitest'
import { parseCsvRecords, parseCsvRows, splitCsvLine } from './parseCsv'

describe('parseCsvRows', () => {
  it('keeps delimiters and newlines that appear inside quoted fields', () => {
    const text = 'name,note\n"Prince George, BC","line one\nline two"\n'
    expect(parseCsvRows(text)).toEqual([
      ['name', 'note'],
      ['Prince George, BC', 'line one\nline two'],
    ])
  })

  it('unescapes doubled quotes inside a quoted field', () => {
    expect(parseCsvRows('a\n"say ""hi"""')).toEqual([['a'], ['say "hi"']])
  })

  it('handles CRLF line endings and a missing trailing newline', () => {
    expect(parseCsvRows('a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('drops blank rows by default and keeps them when asked', () => {
    expect(parseCsvRows('a,b\n\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
    expect(parseCsvRows('a,b\n\n1,2\n', { skipEmptyRows: false })).toEqual([
      ['a', 'b'],
      [''],
      ['1', '2'],
      [''],
    ])
  })

  it('supports a tab delimiter', () => {
    expect(parseCsvRows('a\tb\n1\t2', { delimiter: '\t' })).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
})

describe('parseCsvRecords', () => {
  it('maps rows onto trimmed header keys', () => {
    expect(parseCsvRecords('site , pm25\nPlaza,7')).toEqual([{ site: 'Plaza', pm25: '7' }])
  })

  it('reads missing trailing cells back as empty strings', () => {
    expect(parseCsvRecords('a,b,c\n1,2')).toEqual([{ a: '1', b: '2', c: '' }])
  })

  it('leaves absent columns undefined so ?? fallback chains still work', () => {
    const [record] = parseCsvRecords('Date,pm25\n2026-01-01,7')
    expect(record.date).toBeUndefined()
    expect(record.Date).toBe('2026-01-01')
  })

  it('returns nothing for empty input', () => {
    expect(parseCsvRecords('')).toEqual([])
  })
})

describe('splitCsvLine', () => {
  it('splits a single line without dropping empty cells', () => {
    expect(splitCsvLine('a,,c')).toEqual(['a', '', 'c'])
  })

  it('respects quoted delimiters', () => {
    expect(splitCsvLine('"a,b",c')).toEqual(['a,b', 'c'])
  })
})
