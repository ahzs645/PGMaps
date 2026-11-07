import { describe, expect, it } from 'vitest'
import { derivedRoadName, shortRoadNames } from './roadNames'

describe('derivedRoadName', () => {
  it('replaces a generated ending instead of stacking it', () => {
    expect(derivedRoadName('Hillside · optimized profile · optimized profile', 'gentlest')).toBe('Hillside · gentlest')
    expect(derivedRoadName('Hillside · lowest cost', 'optimized profile')).toBe('Hillside · optimized profile')
    expect(derivedRoadName('Hillside · training', 'shortest')).toBe('Hillside · training · shortest')
  })

  it('numbers a name another road already uses', () => {
    const taken = ['Hillside · optimized profile', 'Hillside · optimized profile 2']
    expect(derivedRoadName('Hillside · optimized profile', 'optimized profile', taken)).toBe(
      'Hillside · optimized profile 3',
    )
  })
})

describe('shortRoadNames', () => {
  it('reduces a saved project to what tells its roads apart', () => {
    expect(
      shortRoadNames([
        'Hillside access · training',
        'Contour alternative · training',
        'Hillside access · training · optimized profile',
        'Hillside access · training · optimized profile · optimized profile',
        'Hillside access · training · optimized profile · optimized profile · gentlest',
      ]),
    ).toEqual([
      'Hillside access',
      'Contour alternative',
      'Hillside access · optimized profile',
      'Hillside access · optimized profile 2',
      'Hillside access · gentlest',
    ])
  })

  it('calls the parent the original when every road comes from it', () => {
    expect(shortRoadNames(['Main', 'Main · gentlest', 'Main · shortest'])).toEqual(['Original', 'gentlest', 'shortest'])
  })

  it('leaves a single road its name', () => {
    expect(shortRoadNames(['Main · training'])).toEqual(['Main · training'])
  })
})
