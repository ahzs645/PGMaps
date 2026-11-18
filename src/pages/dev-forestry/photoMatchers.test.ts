import { describe, expect, it } from 'vitest'
import {
  LEARNED_MATCH_FILES,
  LEARNED_SIDE_MULTIPLE,
  PHOTO_MATCHERS,
  isPhotoMatcher,
  learnedInputSize,
  lightGlueKeypoints,
  selectRows,
  strongestKeypoints,
} from './photoMatchers'

describe('photoMatchers', () => {
  it('names the bundled matcher and the optional one with its download size', () => {
    expect(PHOTO_MATCHERS.xfeat.megabytes).toBeNull()
    expect(PHOTO_MATCHERS['aliked-lightglue'].megabytes).toBe(48)
    expect(isPhotoMatcher('aliked-lightglue')).toBe(true)
    expect(isPhotoMatcher('toString')).toBe(false)
    for (const file of Object.values(LEARNED_MATCH_FILES)) {
      expect(file.path.startsWith('/models/photo-match/')).toBe(true)
      expect(file.size).toBeGreaterThan(1e6)
    }
  })

  it('sizes the detector input to the longer side, on the multiple, never larger than the picture', () => {
    expect(learnedInputSize(1050, 1400)).toEqual({ width: 768, height: 1024 })
    expect(learnedInputSize(1400, 1050)).toEqual({ width: 1024, height: 768 })
    const small = learnedInputSize(500, 375)
    expect(small).toEqual({ width: 512, height: 384 })
    expect(small.width % LEARNED_SIDE_MULTIPLE).toBe(0)
    expect(learnedInputSize(10, 10)).toEqual({ width: 32, height: 32 })
  })

  it('keeps the strongest keypoints, strongest first', () => {
    expect(strongestKeypoints([0.2, 0.9, 0.5, 0.9], 3)).toEqual([1, 3, 2])
    expect(strongestKeypoints([0.2, 0.9], 5)).toEqual([1, 0])
  })

  it('measures keypoints from the centre in half the longer side', () => {
    const points = lightGlueKeypoints([0, 0, 768, 1024, 384, 512], 768, 1024)
    expect(Array.from(points)).toEqual([-0.75, -1, 0.75, 1, 0, 0])
  })

  it('takes the named rows in order', () => {
    expect(Array.from(selectRows([1, 2, 3, 4, 5, 6], [2, 0], 2))).toEqual([5, 6, 1, 2])
  })
})
