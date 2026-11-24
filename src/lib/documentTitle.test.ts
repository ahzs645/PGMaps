import { describe, expect, it } from 'vitest'

import {
  documentTitle,
  followsName,
  MAX_DOCUMENT_TITLE,
  parseDocumentTitle,
  storedDocumentTitle,
  titleFileStem,
  withDocumentTitle,
} from './documentTitle'

describe('document title', () => {
  it('follows the name until a title is set, and again once it is cleared', () => {
    expect(documentTitle(undefined, 'Tabor Main')).toBe('Tabor Main')
    expect(documentTitle('Haul road, phase 2', 'Tabor Main')).toBe('Haul road, phase 2')
    expect(documentTitle('', 'Tabor Main')).toBe('Tabor Main')
    expect(documentTitle('   ', 'Tabor Main')).toBe('Tabor Main')
    expect(followsName(undefined)).toBe(true)
    expect(followsName(' x ')).toBe(false)
  })

  it('stores only what was typed, trimmed and capped', () => {
    expect(storedDocumentTitle('  Haul   road  ')).toBe('Haul road')
    expect(storedDocumentTitle('')).toBeUndefined()
    expect(storedDocumentTitle('x'.repeat(MAX_DOCUMENT_TITLE + 5))).toHaveLength(MAX_DOCUMENT_TITLE)
  })

  it('reads a saved title tolerantly and keeps no key for one that follows', () => {
    expect(parseDocumentTitle(undefined)).toBeUndefined()
    expect(parseDocumentTitle(42)).toBeUndefined()
    expect(parseDocumentTitle(' Plan A ')).toBe('Plan A')
    expect(withDocumentTitle('title', undefined)).toEqual({})
    expect(Object.keys(withDocumentTitle('title', ''))).toEqual([])
    expect(withDocumentTitle('title', 'Plan A')).toEqual({ title: 'Plan A' })
  })

  it('names a file from a title', () => {
    expect(titleFileStem('Haul road, phase 2', 'road')).toBe('Haul-road-phase-2')
    expect(titleFileStem('***', 'road')).toBe('road')
  })
})
