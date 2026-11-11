import { describe, expect, it } from 'vitest'
import { splitUnit } from './Controls'

describe('splitUnit', () => {
  it('moves a short bracketed unit into the field', () => {
    expect(splitUnit('Grade limit (%)')).toEqual({ text: 'Grade limit', unit: '%' })
    expect(splitUnit('Minimum radius (m)')).toEqual({ text: 'Minimum radius', unit: 'm' })
    expect(splitUnit('Cut ($/m³)')).toEqual({ text: 'Cut', unit: '$/m³' })
    expect(splitUnit('Design speed (km/h)')).toEqual({ text: 'Design speed', unit: 'km/h' })
  })
  it('leaves labels without a unit alone', () => {
    expect(splitUnit('Maximum grade %')).toBeNull()
    expect(splitUnit('Reusable cut factor')).toBeNull()
    expect(splitUnit('Offset (optional)')).toBeNull()
    expect(splitUnit('Width (left side)')).toBeNull()
  })
})
