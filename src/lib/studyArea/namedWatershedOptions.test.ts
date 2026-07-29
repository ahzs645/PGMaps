import { describe, expect, it } from 'vitest'
import {
  getDefaultLevelForSource,
  getLevelOptionsForSource,
  isValidLevelForSource,
} from './options'

describe('named watershed boundary options', () => {
  it('exposes named watersheds as a separate source with exact stream-order variants', () => {
    const levels = getLevelOptionsForSource('namedWatershed')

    expect(levels).toHaveLength(10)
    expect(levels.map((option) => option.label)).toEqual([
      'Stream Order 10',
      'Stream Order 9',
      'Stream Order 8',
      'Stream Order 7',
      'Stream Order 6',
      'Stream Order 5',
      'Stream Order 4',
      'Stream Order 3',
      'Stream Order 2',
      'Stream Order 1',
    ])
    expect(getDefaultLevelForSource('namedWatershed')).toBe('namedWatershedOrder10')
  })

  it('does not retain named watersheds as a general watershed hierarchy level', () => {
    expect(getLevelOptionsForSource('watershed').map((option) => option.label)).toEqual([
      'Major River Basin',
      'Watershed Group',
      'Assessment Watershed',
    ])
    expect(isValidLevelForSource('watershed', 'namedWatershedOrder8')).toBe(false)
    expect(isValidLevelForSource('namedWatershed', 'namedWatershedOrder8')).toBe(true)
  })
})
