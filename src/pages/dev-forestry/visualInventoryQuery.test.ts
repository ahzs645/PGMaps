import { afterEach, describe, expect, it, vi } from 'vitest'

import { VLI_WFS_LAYER } from './bcVisualInventory'
import { queryVisualInventory } from './visualInventoryQuery'

const unit = (objectId: number, polygon: number, evqo: string | null) => ({
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [-121.94, 53.92],
        [-121.92, 53.92],
        [-121.92, 53.94],
        [-121.94, 53.92],
      ],
    ],
  },
  properties: { OBJECTID: objectId, VLI_POLYGON_NO: polygon, REC_EVQO_CODE: evqo },
})

afterEach(() => vi.unstubAllGlobals())

describe('queryVisualInventory', () => {
  it('reads the units live from the WFS layer', async () => {
    const fetch = vi.fn(async (_url: string) =>
      Response.json({ numberMatched: 2, features: [unit(1, 337, 'R'), unit(2, 350, 'PR')] }),
    )
    vi.stubGlobal('fetch', fetch)
    const result = await queryVisualInventory([-121.95, 53.91, -121.9, 53.95])
    expect(new URL(String(fetch.mock.calls[0][0])).searchParams.get('typeName')).toBe(VLI_WFS_LAYER)
    expect(result.units.map((entry) => [entry.polygonNumber, entry.objectiveId])).toEqual([
      ['337', 'retention'],
      ['350', 'partial-retention'],
    ])
    expect(result.truncated).toBe(false)
    expect(Number.isNaN(Date.parse(result.retrievedAt))).toBe(false)
  })

  it('says when the area holds more than one read returns', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ numberMatched: 5000, features: [unit(1, 337, 'R')] }))
    expect((await queryVisualInventory([-122, 53, -121, 54])).truncated).toBe(true)
  })

  it('reports an outage as an error, never as an empty inventory', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(queryVisualInventory([-122, 53, -121, 54])).rejects.toThrow(/could not be reached/)
    vi.stubGlobal('fetch', async () => new Response('busy', { status: 503 }))
    await expect(queryVisualInventory([-122, 53, -121, 54])).rejects.toThrow(/503/)
  })

  it('passes a cancellation through untouched', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', async () => {
      controller.abort()
      throw new DOMException('Aborted', 'AbortError')
    })
    await expect(queryVisualInventory([-122, 53, -121, 54], controller.signal)).rejects.toThrow('Aborted')
  })
})
