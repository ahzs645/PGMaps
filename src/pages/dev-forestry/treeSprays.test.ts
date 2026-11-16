import { describe, expect, it } from 'vitest'

import { TREE_DRAWING_IDS } from './forest'
import {
  SPRAY_ALPHA_CUT,
  SPRAY_CELL_PIXELS,
  SPRAY_COLUMNS,
  SPRAY_KINDS,
  SPRAY_ROWS,
  buildSpraySheet,
  sampleSpray,
  sprayCellUv,
  sprayKind,
} from './treeSprays'

describe('the spray sheet', () => {
  const sheet = buildSpraySheet()

  it('holds every foliage picture in its own cell', () => {
    expect(sheet.width).toBe(SPRAY_COLUMNS * SPRAY_CELL_PIXELS)
    expect(sheet.height).toBe(SPRAY_ROWS * SPRAY_CELL_PIXELS)
    expect(SPRAY_KINDS.length).toBeLessThanOrEqual(SPRAY_COLUMNS * SPRAY_ROWS)
    expect(buildSpraySheet()).toBe(sheet)
  })

  it('draws each picture as a ragged bough: neither a solid card nor a few stray needles', () => {
    for (const kind of SPRAY_KINDS) {
      const [u0, v0, u1, v1] = sprayCellUv(kind)
      let covered = 0
      let bright = 0
      const steps = 64
      for (let j = 0; j < steps; j += 1)
        for (let i = 0; i < steps; i += 1) {
          const [light, cover] = sampleSpray(
            sheet,
            u0 + ((i + 0.5) / steps) * (u1 - u0),
            v0 + ((j + 0.5) / steps) * (v1 - v0),
          )
          if (cover >= SPRAY_ALPHA_CUT) {
            covered += 1
            bright += light
          }
        }
      const share = covered / (steps * steps)
      expect(share).toBeGreaterThan(0.15)
      expect(share).toBeLessThan(0.8)
      // Brightness varies needle to needle but is never black: the tree's colour shows through.
      expect(bright / covered).toBeGreaterThan(0.3)
    }
  })

  it('keeps each cell to itself', () => {
    for (const kind of SPRAY_KINDS) {
      const [u0, v0, u1, v1] = sprayCellUv(kind)
      const index = SPRAY_KINDS.indexOf(kind)
      expect(Math.floor(u0 * SPRAY_COLUMNS)).toBe(index % SPRAY_COLUMNS)
      expect(Math.floor(((u0 + u1) / 2) * SPRAY_COLUMNS)).toBe(index % SPRAY_COLUMNS)
      expect(Math.floor(((v0 + v1) / 2) * SPRAY_ROWS)).toBe(Math.floor(index / SPRAY_COLUMNS))
      expect(u1).toBeGreaterThan(u0)
      expect(v1).toBeGreaterThan(v0)
    }
  })

  it('gives every drawing a picture: needles to conifers, leaves to broadleaves and the shrub', () => {
    for (const drawing of TREE_DRAWING_IDS) expect(SPRAY_KINDS).toContain(sprayKind(drawing))
    expect(sprayKind('pine')).toBe('pine')
    expect(sprayKind('pineYoung')).toBe('pine')
    expect(sprayKind('hemlock')).toBe('hemlock')
    expect(sprayKind('spruce')).toBe('bough')
    expect(sprayKind('blackSpruceYoung')).toBe('bough')
    expect(sprayKind('birch')).toBe('leaf')
    expect(sprayKind('shrub')).toBe('leaf')
    expect(sprayKind('cottonwood')).toBe('cottonwood')
  })
})
