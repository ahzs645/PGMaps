import { describe, expect, it } from 'vitest'
import { hatchLines, labelSpacer, labelsAlongLine } from './drawOps'

describe('drawing helpers', () => {
  it('spaces hatch lines evenly at the asked angle', () => {
    const lines = hatchLines({ x: 0, y: 0, w: 50, h: 50 }, 45, 5)
    const [[ax, ay], [bx, by]] = lines[0]
    // Rising to the right on paper: y falls as x grows.
    expect((Math.atan2(-(by - ay), bx - ax) * 180) / Math.PI).toBeCloseTo(45)
    const offset = (line: number[][]) => line[0][0] * Math.SQRT1_2 + line[0][1] * Math.SQRT1_2
    expect(Math.abs(offset(lines[1]) - offset(lines[0]))).toBeCloseTo(5)
    expect(hatchLines({ x: 0, y: 0, w: 10, h: 10 }, 0, 0)).toEqual([])
  })

  it('places upright labels along a line inside the frame only', () => {
    const frame = { x: 0, y: 0, w: 1000, h: 100 }
    const line: [number, number][] = [
      [0, 50],
      [1000, 50],
    ]
    const labels = labelsAlongLine(line, 200, 20, frame)
    expect(labels.map((label) => label.x)).toEqual([100, 300, 500, 700, 900])
    expect(labels.every((label) => label.angle === 0)).toBe(true)
    // Drawn right to left, the text still reads left to right.
    const reversed = labelsAlongLine([...line].reverse(), 200, 20, frame)
    expect(reversed.every((label) => Math.abs(label.angle) <= 90)).toBe(true)
    expect(
      labelsAlongLine(
        [
          [0, 2],
          [1000, 2],
        ],
        200,
        20,
        frame,
      ),
    ).toEqual([])
  })

  it('keeps labels apart', () => {
    const free = labelSpacer(10)
    expect(free(0, 0)).toBe(true)
    expect(free(5, 5)).toBe(false)
    expect(free(20, 0)).toBe(true)
  })
})
