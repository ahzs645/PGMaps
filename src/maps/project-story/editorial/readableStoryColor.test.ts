import { expect, it } from 'vitest'
import { readableStoryColor } from './readableStoryColor'
it('keeps dark source text and makes pale source colors readable on white', () => {
  expect(readableStoryColor('47266C')).toBe('#47266c')
  for (const hex of ['FFE800', 'ECECEC', 'F9D6D2', 'A5D9E8']) {
    const color = readableStoryColor(hex).slice(1)
    const linear = [0, 2, 4].map((i) => {
      const channel = parseInt(color.slice(i, i + 2), 16) / 255
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    })
    const luminance = linear.reduce((total, c, i) => total + c * [0.2126, 0.7152, 0.0722][i], 0)
    expect(1.05 / (luminance + 0.05)).toBeGreaterThanOrEqual(4.5)
  }
})
