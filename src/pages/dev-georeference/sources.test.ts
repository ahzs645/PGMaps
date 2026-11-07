import { describe, expect, it } from 'vitest'
import { sourcePixelToWorld, undoBytePredictor } from './sources'

describe('native source pixel frame', () => {
  it('uses continuous pixel centres with a non-zero GeoTIFF tie point', () => {
    expect(
      sourcePixelToWorld({ ModelTiepoint: [10, 20, 0, 1000, 2000, 0], ModelPixelScale: [2, 3, 0] }, [10, 20], true),
    ).toEqual([1001, 1998.5])
    expect(
      sourcePixelToWorld({ ModelTiepoint: [10, 20, 0, 1000, 2000, 0], ModelPixelScale: [2, 3, 0] }, [10, 20], false),
    ).toEqual([1000, 2000])
  })
  it('keeps a rotated source transform instead of guessing from its bounds', () => {
    expect(
      sourcePixelToWorld({ ModelTransformation: [2, 1, 0, 100, -1, -3, 0, 200, 0, 0, 1, 0, 0, 0, 0, 1] }, [0, 0], true),
    ).toEqual([101.5, 198])
  })
  it('undoes byte predictors per row and channel, including alpha', () => {
    expect([
      ...undoBytePredictor(new Uint8Array([10, 20, 30, 255, 2, 3, 4, 0, 100, 120, 140, 200, 5, 6, 7, 0]), 2, 4),
    ]).toEqual([10, 20, 30, 255, 12, 23, 34, 255, 100, 120, 140, 200, 105, 126, 147, 200])
  })
})
