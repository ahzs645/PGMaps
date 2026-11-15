import { describe, expect, it } from 'vitest'

import {
  applyRgbMatrix,
  COLOR_VISION_MATRICES,
  COLOR_VISION_MODES,
  colorMatrixValues,
  colorVisionFilterId,
  isColorVisionMode,
} from './colorVision'

const distance = (a: readonly number[], b: readonly number[]) => Math.hypot(...a.map((value, i) => value - b[i]))

describe('colour-vision simulation', () => {
  it('keeps white white and black black in every mode', () => {
    for (const mode of COLOR_VISION_MODES) {
      const white = applyRgbMatrix(COLOR_VISION_MATRICES[mode], [1, 1, 1])
      for (const channel of white) expect(channel).toBeCloseTo(1, 2)
      expect(applyRgbMatrix(COLOR_VISION_MATRICES[mode], [0, 0, 0])).toEqual([0, 0, 0])
    }
  })

  it('gives red and green one hue for protan and deutan vision, and not for tritan', () => {
    // Chromaticity: the colour with its lightness divided out, so only hue and saturation remain.
    const chroma = (rgb: readonly number[]) => {
      const sum = rgb.reduce((total, value) => total + Math.max(0, value), 0)
      return rgb.map((value) => Math.max(0, value) / sum)
    }
    const red = [1, 0, 0] as const
    const green = [0, 1, 0] as const
    expect(distance(chroma(red), chroma(green))).toBeGreaterThan(1)
    for (const mode of ['protanopia', 'deuteranopia'] as const) {
      const m = COLOR_VISION_MATRICES[mode]
      expect(distance(chroma(applyRgbMatrix(m, red)), chroma(applyRgbMatrix(m, green)))).toBeLessThan(0.1)
    }
    const t = COLOR_VISION_MATRICES.tritanopia
    expect(distance(chroma(applyRgbMatrix(t, red)), chroma(applyRgbMatrix(t, green)))).toBeGreaterThan(0.5)
  })

  it('leaves greyscale with three equal channels', () => {
    const [r, g, b] = applyRgbMatrix(COLOR_VISION_MATRICES.achromatopsia, [0.8, 0.2, 0.4])
    expect(r).toBe(g)
    expect(g).toBe(b)
  })

  it('writes 20 feColorMatrix values with alpha passed through', () => {
    const values = colorMatrixValues(COLOR_VISION_MATRICES.deuteranopia).split(' ').map(Number)
    expect(values).toHaveLength(20)
    expect(values.slice(15)).toEqual([0, 0, 0, 1, 0])
    expect(colorVisionFilterId('tritanopia')).toBe('pgmaps-color-vision-tritanopia')
    expect(isColorVisionMode('deuteranopia')).toBe(true)
    expect(isColorVisionMode('off')).toBe(false)
  })
})
