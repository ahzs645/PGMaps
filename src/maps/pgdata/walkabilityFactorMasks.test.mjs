// The prebuilt walkability masks come from bcdatamapper through the data sync
// (docs/walkability-factor-masks.md). A mask set built from other source files,
// or missing a mask the worker can ask for, would leave the live heatmap
// rasterizing every layer in the browser (about 25 s) with nothing reported.
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  MASKS_PUBLIC_PATH,
  collectRequiredMaskSpecs,
  loadWorkerApi,
  publicFilePath,
  sha256,
} from '../../../scripts/lib/walkability-factor-masks.mjs'

const REBUILD = 'run `npm run walkability:build-factor-masks` and commit the result in vendor/bcdatamapper'

describe('prebuilt walkability factor masks', () => {
  const masks = JSON.parse(readFileSync(MASKS_PUBLIC_PATH, 'utf8'))

  it('holds every mask the worker can ask for', async () => {
    const api = await loadWorkerApi()
    const missing = collectRequiredMaskSpecs(api)
      .map(([key]) => key)
      .filter((key) => !masks.masks[key])
    expect(missing, `masks missing; ${REBUILD}`).toEqual([])
    expect(masks.cellSizeM).toBe(api.CELL_M)
  })

  it('was built from the source files the app now serves', async () => {
    const api = await loadWorkerApi()
    const layerUrls = [...new Set(api.FACTORS.map((factor) => api.LAYERS[factor.layerKey].file))]
    expect(Object.keys(masks.inputs ?? {})).toEqual(expect.arrayContaining(layerUrls))
    const changed = Object.entries(masks.inputs).filter(([url, hash]) => {
      const file = publicFilePath(url)
      return !existsSync(file) || sha256(readFileSync(file)) !== hash
    })
    expect(
      changed.map(([url]) => url),
      `source changed since the masks were built; ${REBUILD}`,
    ).toEqual([])
  })
})
