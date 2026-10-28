import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { vi } from 'vitest'
import { loadModel } from './routing'
import type { CityId } from './cities'

/** Serves `public/` to the routing loader and loads a city's graph, for the unit tests. */
export async function loadTestModel(city: CityId, buildStreets = false) {
  vi.stubGlobal('fetch', async (url: string) => {
    const bytes = await readFile(path.resolve('public', url.replace(/^\//, '')))
    return new Response(bytes, { headers: { 'Content-Length': String(bytes.length) } })
  })
  return loadModel(buildStreets, city)
}
