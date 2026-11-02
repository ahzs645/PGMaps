import { describe, expect, it } from 'vitest'
import { parsePublishedSelection } from './query'

describe('published selection links', () => {
  it('never supplies a soil regime when the link does not contain one', () => {
    expect(parsePublishedSelection('?bgc=SBSdw3')).toEqual({ bgc: 'SBSdw3', smr: '', period: '2050', issues: {} })
  })

  it('preserves an explicit exact code, soil and period together', () => {
    expect(parsePublishedSelection('?bgc=%20SBSdw3%20&smr=2&period=2080')).toEqual({
      bgc: 'SBSdw3',
      smr: 2,
      period: '2080',
      issues: {},
    })
  })

  it('leaves invalid supplied soil and period unselected with clear issues', () => {
    const selection = parsePublishedSelection('?bgc=SBSdw3&smr=99&period=2070')
    expect(selection.smr).toBe('')
    expect(selection.period).toBe('')
    expect(selection.issues.smr).toContain('codes 1–5')
    expect(selection.issues.period).toContain('six published periods')
  })

  it('rejects ambiguous duplicate parameters instead of choosing a value', () => {
    const selection = parsePublishedSelection('?bgc=SBSdw3&bgc=IDFdk1&smr=1&smr=5&period=2020&period=2080')
    expect(selection.bgc).toBe('')
    expect(selection.smr).toBe('')
    expect(selection.period).toBe('')
    expect(Object.keys(selection.issues).sort()).toEqual(['bgc', 'period', 'smr'])
  })
})
