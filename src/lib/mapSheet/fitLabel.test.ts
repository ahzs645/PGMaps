import { describe, expect, it } from 'vitest'
import { fitLabel, LABEL_LINE_HEIGHT, textWidth } from './textMetrics'

const LABEL = 'Riparian management zone (screen)'

describe('fitLabel', () => {
  it('keeps a label that fits on one line as it is', () => {
    expect(fitLabel('Stream', 6.5, 100, 12)).toEqual({ lines: ['Stream'], size: 6.5 })
  })

  it('wraps a long label onto two lines before shortening it', () => {
    const width = textWidth('Riparian management', 6.5) + 1
    const fitted = fitLabel(LABEL, 6.5, width, 2 * 6.5 * LABEL_LINE_HEIGHT + 1)
    expect(fitted.lines).toHaveLength(2)
    expect(fitted.lines.join(' ')).toBe(LABEL)
    expect(fitted.size).toBe(6.5)
  })

  it('shrinks to fit two lines in a shorter row', () => {
    const width = textWidth('Riparian management', 6.5) + 1
    const fitted = fitLabel(LABEL, 6.5, width, 2 * 6.5 * LABEL_LINE_HEIGHT * 0.9)
    expect(fitted.lines.join(' ')).toBe(LABEL)
    expect(fitted.size).toBeLessThan(6.5)
    expect(fitted.size).toBeGreaterThanOrEqual(6.5 * 0.8)
  })

  it('shortens with "..." only when wrapping and shrinking cannot hold it', () => {
    const fitted = fitLabel(LABEL, 6.5, textWidth(LABEL, 6.5) * 0.3, 6.5)
    expect(fitted.lines).toHaveLength(1)
    expect(fitted.lines[0].endsWith('...')).toBe(true)
    expect(textWidth(fitted.lines[0], fitted.size)).toBeLessThanOrEqual(textWidth(LABEL, 6.5) * 0.3)
  })
})
