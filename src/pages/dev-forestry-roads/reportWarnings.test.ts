import { describe, expect, it } from 'vitest'
import { flagNotes, groupNamedWarnings, numberRanges } from './reportWarnings'

const INVERTS = 'Enter both surveyed/design invert elevations to calculate pipe grade and cover.'

describe('groupNamedWarnings', () => {
  it('prints a sentence repeated for every culvert once, with the culverts as ranges', () => {
    const warnings = [1, 2, 3, 5, 6].map((n) => `Culvert ${n}: ${INVERTS}`)
    expect(groupNamedWarnings(warnings)).toEqual([`Culverts 1–3, 5–6: ${INVERTS}`])
  })

  it('keeps the figure that differs between culverts beside each one', () => {
    const grouped = groupNamedWarnings([
      'Culvert 1: Barrel is shorter than the centred daylight span (25.57 m).',
      'Culvert 2: Barrel is shorter than the centred daylight span (41.83 m).',
    ])
    expect(grouped).toEqual([
      'Culverts 1–2: Barrel is shorter than the centred daylight span. (1: 25.57 m · 2: 41.83 m)',
    ])
  })

  it('leaves warnings about other things in place and in order', () => {
    const grouped = groupNamedWarnings([
      'Terrain gap at 0+499.3.',
      `Culvert 1: ${INVERTS}`,
      `Culvert 2: ${INVERTS}`,
      'Last.',
    ])
    expect(grouped).toEqual(['Terrain gap at 0+499.3.', `Culverts 1–2: ${INVERTS}`, 'Last.'])
  })

  it('does not change a warning that occurs once', () => {
    expect(groupNamedWarnings([`Culvert 7: ${INVERTS}`])).toEqual([`Culvert 7: ${INVERTS}`])
  })
})

describe('numberRanges', () => {
  it('compresses runs', () => expect(numberRanges([8, 1, 2, 3, 5, 7])).toBe('1–3, 5, 7–8'))
})

describe('flagNotes', () => {
  it('numbers each distinct message once and cites it from every row', () => {
    const { cells, notes } = flagNotes([
      [INVERTS, 'Barrel is shorter than the centred daylight span (25.57 m).'],
      [INVERTS],
      [],
    ])
    expect(notes).toEqual([INVERTS, 'Barrel is shorter than the centred daylight span.'])
    expect(cells).toEqual(['1, 2 (25.57 m)', '1', ''])
  })
})
