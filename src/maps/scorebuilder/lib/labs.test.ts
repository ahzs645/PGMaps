import { describe, expect, it } from 'vitest'
import { getScoreLab, isOnLabPath, labHref } from './labs'

describe('isOnLabPath', () => {
  it('treats the trailing slash static hosts redirect to as the same page', () => {
    expect(isOnLabPath('/density-lab', 'density')).toBe(true)
    expect(isOnLabPath('/density-lab/', 'density')).toBe(true)
    expect(isOnLabPath('/score-builder/', 'index')).toBe(true)
  })

  it('does not match another lab, which is what stops a leaving lab rewriting the URL', () => {
    expect(isOnLabPath('/correlation-lab/', 'density')).toBe(false)
    expect(isOnLabPath('/labs/', 'index')).toBe(false)
  })
})

describe('labHref', () => {
  it('opens on the remembered study area', () => {
    expect(labHref(getScoreLab('density'), { source: 'census', level: 'da' })).toBe('/density-lab?src=census&level=da')
  })

  it('stays a plain path when nothing is remembered', () => {
    expect(labHref(getScoreLab('correlate'), null)).toBe('/correlation-lab')
  })
})
