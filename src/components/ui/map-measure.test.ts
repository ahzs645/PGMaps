import { describe, expect, it } from 'vitest'
import { measureHint, measureReadout } from './map-measure'

describe('measure tool wording', () => {
  it('says how to close each shape once it can', () => {
    expect(measureHint('polygon', true, 2)).toBe('Click to add points.')
    expect(measureHint('polygon', true, 3)).toBe('Click the first point or double-click to close.')
    expect(measureHint('line', true, 2, true)).toBe('Tap to add points; double-click or Finish to end.')
    expect(measureHint('circle', true, 1)).toBe('Click the edge to set the radius.')
    expect(measureHint('polygon', false, 4)).toBe('Measurement shown for this session only.')
  })

  it('reads only what the shape measures', () => {
    expect(measureReadout('line', { length: 1.5, area: 0 })).toEqual([{ label: 'Length', value: '1.5 km' }])
    expect(measureReadout('polygon', { length: 0.4, area: 25_000 })).toEqual([
      { label: 'Perimeter', value: '400 m' },
      { label: 'Area', value: '2.5 ha' },
    ])
    expect(measureReadout('circle', null).map((row) => row.value)).toEqual(['—', '—', '—'])
  })
})
