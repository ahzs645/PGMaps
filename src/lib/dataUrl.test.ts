import { describe, expect, it } from 'vitest'
import { dataUrl, withBase } from './dataUrl'

// BASE_URL is '/' under vitest, so these assert the pass-through behaviour that
// keeps the default deploy byte-identical.
describe('withBase', () => {
  it('leaves root-relative paths alone when the app is served from /', () => {
    expect(withBase('/data/monitors.csv')).toBe('/data/monitors.csv')
  })

  it('never rewrites absolute URLs', () => {
    expect(withBase('https://example.com/a.json')).toBe('https://example.com/a.json')
    expect(withBase('//cdn.example.com/a.json')).toBe('//cdn.example.com/a.json')
    expect(withBase('blob:abc')).toBe('blob:abc')
    expect(withBase('data:application/json,{}')).toBe('data:application/json,{}')
  })

  it('never rewrites already-relative paths', () => {
    expect(withBase('data/monitors.csv')).toBe('data/monitors.csv')
    expect(withBase('./a.json')).toBe('./a.json')
  })
})

describe('dataUrl', () => {
  it('joins segments under /data', () => {
    expect(dataUrl('census', 'catalog.json')).toBe('/data/census/catalog.json')
  })

  it('tolerates leading and trailing slashes on segments', () => {
    expect(dataUrl('/census/', '/catalog.json')).toBe('/data/census/catalog.json')
  })

  it('drops empty segments', () => {
    expect(dataUrl('census', '', 'catalog.json')).toBe('/data/census/catalog.json')
  })
})
