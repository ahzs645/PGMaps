import { describe, expect, it } from 'vitest'
import { analyzeRoad, effectiveWidths, offsetCoordinate } from './engine'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE } from './terrain'
import type { Alignment, Coordinate, WidthOverride } from './types'
import { appliedTapers, duplicateWideningAt, fullWidthRange, limitedTaper } from './wideningEntry'

const origin: Coordinate = [-122.8, 53.9]
const turnout = (changes: Partial<WidthOverride> = {}): WidthOverride => ({
  id: 't',
  name: 'Pullout',
  kind: 'turnout',
  side: 'right',
  start: 675,
  end: 705,
  taper: 10,
  extraWidth: 4.5,
  ...changes,
})
const road = (overrides: WidthOverride[]): Alignment => ({
  id: 'r',
  name: 'Road',
  color: '#16817a',
  points: [
    { id: 'a', coordinate: origin, radiusM: 0 },
    { id: 'b', coordinate: offsetCoordinate(origin, 0, 900), radiusM: 0 },
  ],
  vertical: [],
  template: { ...DEFAULT_TEMPLATE },
  overrides,
})

describe('what Start, End and the tapers of a widening mean', () => {
  it('puts the tapers inside Start and End, as the engine builds them', () => {
    const v = turnout({ entryTaperM: 7.5, exitTaperM: 7.5 })
    expect(fullWidthRange(v)).toEqual({ from: 682.5, to: 697.5 })
    // The engine agrees: full width between those stations, base width at Start and End.
    const width = (s: number) => effectiveWidths(road([v]), s).rightWidth - DEFAULT_TEMPLATE.rightWidth
    expect([675, 682.5, 690, 697.5, 705].map(width)).toEqual([0, 4.5, 4.5, 4.5, 0])
    expect(width(678.75)).toBeCloseTo(2.25, 9)
  })

  it('applies the shared taper to an unset end, at most half the range', () => {
    expect(appliedTapers(turnout())).toEqual({ entry: 10, exit: 10 })
    expect(appliedTapers(turnout({ start: 682.5, end: 697.5 }))).toEqual({ entry: 7.5, exit: 7.5 })
    expect(fullWidthRange(turnout({ start: 682.5, end: 697.5 }))).toEqual({ from: 690, to: 690 })
    expect(fullWidthRange(turnout({ end: 675 }))).toBeNull()
  })
})

describe('a typed taper that the range cannot carry', () => {
  it('keeps a taper that fits exactly as typed', () => {
    expect(limitedTaper(turnout(), 'entry', 7.5)).toEqual({ taperM: 7.5, note: null })
    expect(limitedTaper(turnout({ exitTaperM: 7.5 }), 'entry', 22.5)).toEqual({ taperM: 22.5, note: null })
  })

  it('holds it to the room beside the other taper and says what it did and why', () => {
    // The walkthrough: 682.5–697.5 entered as Start and End, with the shared taper still 10 m.
    const short = turnout({ start: 682.5, end: 697.5, exitTaperM: 10 })
    const { taperM, note } = limitedTaper(short, 'entry', 7.5)
    expect(taperM).toBe(5)
    expect(note).toBe(
      'Entry taper limited to 5 m, not 7.5 m: Start to End is 15 m and the exit taper takes 10 m. Start and End include the tapers, so move them apart or shorten the other taper.',
    )
    // The value it applies is one the engine accepts; the typed one was not.
    const analyse = (entryTaperM: number) =>
      analyzeRoad(road([{ ...short, entryTaperM }]), { elevationAt: () => 800 }, DEFAULT_ROAD_SETTINGS)
    expect(() => analyse(7.5)).toThrow(/Widenings need a valid station range/)
    expect(analyse(taperM).length).toBeCloseTo(900, 3)
    expect(limitedTaper(short, 'exit', 12).note).toMatch(
      /^Exit taper limited to 7\.5 m, not 12 m: .* the entry taper takes 7\.5 m\./,
    )
    expect(limitedTaper(short, 'entry', -1)).toEqual({
      taperM: 0,
      note: 'Entry taper set to 0 m: a taper cannot be negative.',
    })
  })
})

describe('duplicating a widening to a new station', () => {
  it('copies it to the station asked for, the same length', () => {
    const { copy, error } = duplicateWideningAt(turnout({ entryTaperM: 7.5, exitTaperM: 7.5 }), 515, 900, 'copy')
    expect(error).toBeNull()
    expect(copy).toMatchObject({
      id: 'copy',
      name: 'Pullout copy',
      start: 515,
      end: 545,
      entryTaperM: 7.5,
      side: 'right',
    })
  })

  it('refuses a copy that would run off the road and gives the stations that work', () => {
    expect(duplicateWideningAt(turnout(), 880, 900, 'copy')).toEqual({
      copy: null,
      error: 'A 30 m copy must start between 0 and 870 m to stay on the road.',
    })
    expect(duplicateWideningAt(turnout(), -1, 900, 'copy').copy).toBeNull()
    expect(duplicateWideningAt(turnout(), 870, 900, 'copy').copy).toMatchObject({ start: 870, end: 900 })
    expect(duplicateWideningAt(turnout(), 0, 20, 'copy').error).toBe('This 30 m turnout is longer than the road.')
  })
})
