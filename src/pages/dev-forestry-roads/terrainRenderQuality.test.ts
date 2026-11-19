import { describe, expect, it } from 'vitest'
import {
  MAX_TERRAIN_RENDER_SIDE,
  TERRAIN_MOVING_RENDER_LIMITS,
  TERRAIN_RENDER_LIMITS,
  terrainRenderSize,
  type TerrainRenderQuality,
} from './terrainRenderQuality'

describe('3D terrain drawing-buffer quality', () => {
  const viewport = { width: 800, height: 450, devicePixelRatio: 3 }

  it('draws a dense screen sharply at rest and reduces Auto while moving', () => {
    expect(terrainRenderSize({ ...viewport, quality: 'auto' })).toEqual({
      width: 1600,
      height: 900,
      pixelRatio: 2,
    })
    expect(terrainRenderSize({ ...viewport, quality: 'auto', moving: true })).toEqual({
      width: 1000,
      height: 562,
      pixelRatio: 1.25,
    })
    expect(terrainRenderSize({ ...viewport, devicePixelRatio: 1, quality: 'auto' })).toEqual({
      width: 800,
      height: 450,
      pixelRatio: 1,
    })
  })

  it('holds an explicit High or Efficient choice through camera movement', () => {
    for (const quality of ['high', 'efficient'] as const) {
      const still = terrainRenderSize({ ...viewport, quality })
      expect(terrainRenderSize({ ...viewport, quality, moving: true })).toEqual(still)
    }
    expect(terrainRenderSize({ ...viewport, quality: 'efficient' })).toEqual({
      width: 800,
      height: 450,
      pixelRatio: 1,
    })
  })

  it('bounds memory for large, dense and unusually wide viewports without stretching the scene', () => {
    const qualities: TerrainRenderQuality[] = ['auto', 'high', 'efficient']
    for (const [width, height] of [
      [3840, 2160],
      [2160, 3840],
      [7680, 4320],
      [100000, 250],
    ])
      for (const quality of qualities)
        for (const moving of [false, true]) {
          const result = terrainRenderSize({ width, height, devicePixelRatio: 4, quality, moving })
          const limits = quality === 'auto' && moving ? TERRAIN_MOVING_RENDER_LIMITS : TERRAIN_RENDER_LIMITS[quality]
          expect(result.width * result.height).toBeLessThanOrEqual(limits.maxPixels)
          expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(MAX_TERRAIN_RENDER_SIDE)
          expect(result.pixelRatio).toBeLessThanOrEqual(limits.pixelRatio)
          // A single ratio preserves the aspect; integer buffers lose less than one pixel per side.
          expect(Math.abs(result.width - width * result.pixelRatio)).toBeLessThan(1)
          expect(Math.abs(result.height - height * result.pixelRatio)).toBeLessThan(1)
        }
    const large = { width: 3840, height: 2160, devicePixelRatio: 2 }
    const auto = terrainRenderSize({ ...large, quality: 'auto' })
    const high = terrainRenderSize({ ...large, quality: 'high' })
    expect(high.width * high.height).toBeGreaterThan(auto.width * auto.height * 1.9)
  })

  it('respects a smaller device dimension limit and never rounds a hidden view to zero', () => {
    const smallDevice = terrainRenderSize({ ...viewport, quality: 'high', maxDimension: 1024 })
    expect(smallDevice.width).toBe(1024)
    expect(smallDevice.height).toBe(576)
    for (const invalid of [0, -20, NaN, Infinity]) {
      expect(
        terrainRenderSize({ width: invalid, height: invalid, devicePixelRatio: invalid, quality: 'auto' }),
      ).toEqual({
        width: 1,
        height: 1,
        pixelRatio: 1,
      })
    }
    const tiny = terrainRenderSize({ width: 0.2, height: 0.5, devicePixelRatio: 0.5, quality: 'auto' })
    expect(tiny).toEqual({ width: 1, height: 1, pixelRatio: 0.5 })
  })

  it('keeps extreme finite measurements bounded and produces a finite positive ratio', () => {
    for (const [width, height] of [
      [Number.MAX_VALUE, 1],
      [1, Number.MAX_VALUE],
      [Number.MAX_VALUE, Number.MAX_VALUE],
    ]) {
      const result = terrainRenderSize({ width, height, devicePixelRatio: Number.MAX_VALUE, quality: 'high' })
      expect(Number.isFinite(result.pixelRatio)).toBe(true)
      expect(result.pixelRatio).toBeGreaterThan(0)
      expect(result.width).toBeGreaterThanOrEqual(1)
      expect(result.height).toBeGreaterThanOrEqual(1)
      expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(MAX_TERRAIN_RENDER_SIDE)
      expect(result.width * result.height).toBeLessThanOrEqual(TERRAIN_RENDER_LIMITS.high.maxPixels)
    }
  })
})
