import { describe, expect, it } from 'vitest'
import { boxesMeet } from './drawOps'
import {
  ACCESS_BOTTOM_PANEL,
  FIELD_SIDE_PANEL,
  fontSize,
  IMAGERY_PORTRAIT,
  LIDAR_SIDE_PANEL,
  resolveSheet,
  SHEET_TEMPLATES,
} from './layout'

describe('sheet layouts', () => {
  it('resolves to the measured tabloid points', () => {
    const lidar = resolveSheet(LIDAR_SIDE_PANEL, 'tabloid')
    expect(lidar.width).toBe(1224)
    expect(lidar.frame.x + lidar.frame.w).toBeCloseTo(901.0, 0)
    expect(lidar.frame.y + lidar.frame.h).toBeCloseTo(770.5, 0)
    const field = resolveSheet(FIELD_SIDE_PANEL, 'tabloid')
    expect(field.frame.x + field.frame.w).toBeCloseTo(964.8, 0)
    const access = resolveSheet(ACCESS_BOTTOM_PANEL, 'tabloid')
    expect(access.panels.find((p) => p.id === 'comments')!.rect.x).toBeCloseTo(302.4, 0)
    const imagery = resolveSheet(IMAGERY_PORTRAIT, 'tabloid')
    expect(imagery.width).toBe(792)
    expect(imagery.height).toBe(1224)
    expect(imagery.frame.y + imagery.frame.h).toBeCloseTo(1047.1, 0)
  })

  it('keeps the map, title and panels apart and on the page', () => {
    for (const template of SHEET_TEMPLATES)
      for (const paper of ['tabloid', 'letter', 'a3', 'a4'] as const) {
        const sheet = resolveSheet(template, paper)
        const inset = (r: { x: number; y: number; w: number; h: number }) => ({
          x: r.x + 0.5,
          y: r.y + 0.5,
          w: r.w - 1,
          h: r.h - 1,
        })
        for (const panel of sheet.panels) {
          expect(boxesMeet(inset(panel.rect), inset(sheet.frame))).toBe(false)
          expect(boxesMeet(inset(panel.rect), inset(sheet.title))).toBe(false)
          for (const other of sheet.panels)
            if (other !== panel) expect(boxesMeet(inset(panel.rect), inset(other.rect))).toBe(false)
          expect(panel.rect.x + panel.rect.w).toBeLessThanOrEqual(sheet.width)
          expect(panel.rect.y + panel.rect.h).toBeLessThanOrEqual(sheet.height)
        }
      }
  })

  it('scales type with the page, never below 4.5 pt', () => {
    const letter = resolveSheet(LIDAR_SIDE_PANEL, 'letter')
    expect(letter.k).toBeCloseTo(792 / 1224)
    expect(fontSize(letter, 16)).toBeCloseTo(16 * (792 / 1224))
    expect(fontSize(letter, 5)).toBe(4.5)
    expect(resolveSheet(IMAGERY_PORTRAIT, 'a4').template.orientation).toBe('portrait')
  })
})
