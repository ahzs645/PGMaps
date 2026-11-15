import { describe, expect, it } from 'vitest'
import { gridContours } from '@/lib/mapSheet/contours'
import { SHEET_PRESETS } from './sheets'

describe('1:50,000 access sheet contours', () => {
  it('draws contours at 20 m with 100 m index lines', () => {
    const preset = SHEET_PRESETS['general-access']
    expect(preset.contours).toBe('default')
    expect(preset.contourIntervalM).toBe(20)
    expect(preset.contourIndexEvery).toBe(5)
  })

  it('records the index spacing so the legend names the index interval it drew', () => {
    // A ramp from 0 to 400 m across the grid.
    const width = 41,
      height = 3
    const values = new Float32Array(width * height).map((_, i) => (i % width) * 10)
    const result = gridContours({ width, height, values }, 20, 5)
    expect(result.indexEvery).toBe(5)
    const index = result.levels.filter((l) => l.index).map((l) => l.level)
    expect(index.every((level) => level % 100 === 0)).toBe(true)
    expect(result.levels.some((l) => !l.index && l.level % 100 !== 0)).toBe(true)
  })
})
