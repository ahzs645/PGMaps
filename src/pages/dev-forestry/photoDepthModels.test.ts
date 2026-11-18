import { describe, expect, it } from 'vitest'

import { PHOTO_DEPTH_MODELS, depthModelUrls } from './photoDepthModels'

describe('the optional depth models', () => {
  it('names every file of a model at its pinned revision', () => {
    expect(depthModelUrls('da2-small')).toHaveLength(1)
    expect(depthModelUrls('da3-small')).toHaveLength(PHOTO_DEPTH_MODELS['da3-small'].files.length)
    for (const model of ['da2-small', 'da3-small'] as const)
      for (const url of depthModelUrls(model)) {
        expect(url.startsWith(PHOTO_DEPTH_MODELS[model].root)).toBe(true)
        // A revision hash, never a branch: the weights a browser keeps must be the ones the sizes were read from.
        expect(url).toMatch(/\/resolve\/[0-9a-f]{40}\//)
      }
  })
})
