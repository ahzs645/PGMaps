import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { defaultTrip, findFamily, loadModel, readTrip, routeGpx, tripHash, type Model } from './routing'

let model: Model
beforeAll(async () => {
  vi.stubGlobal('fetch', async (url: string) => {
    const bytes = await readFile(path.resolve('public/data/flatten-sf', path.basename(url)))
    return new Response(bytes, { headers: { 'Content-Length': String(bytes.length) } })
  })
  model = await loadModel()
}, 30000)
afterAll(() => vi.unstubAllGlobals())

describe('Flatten SF native routing adapter', () => {
  it('preserves the uploaded default-route benchmark and the distance/climbing frontier', async () => {
    const family = await findFamily(model, defaultTrip(), new AbortController().signal)
    expect(family.members).toHaveLength(30)
    const flat = family.members[family.members.length - 1]
    // Recorded from the original uploaded app, before the React/MapLibre port.
    expect(flat.stats.distance_m).toBeCloseTo(7822.2, 6)
    expect(flat.stats.elev_gain_m).toBeCloseTo(83.29, 6)
    for (let i = 1; i < family.members.length; i++) {
      expect(family.members[i].stats.distance_m).toBeGreaterThanOrEqual(family.members[i - 1].stats.distance_m)
      expect(family.members[i].stats.elev_gain_m).toBeLessThanOrEqual(family.members[i - 1].stats.elev_gain_m + 0.001)
    }
    const gpx = routeGpx(flat, 'Trick Dog & <Golden Gate Park>')
    expect(gpx).toContain('Trick Dog &amp; &lt;Golden Gate Park&gt;')
    expect(gpx.match(/<trkpt /g)?.length).toBe(flat.coordinates.length)
    expect(gpx).not.toMatch(/NaN|undefined|Infinity/)
  }, 30000)

  it('cancels a superseded search before publishing a final family', async () => {
    const controller = new AbortController()
    await expect(findFamily(model, defaultTrip(), controller.signal, () => controller.abort())).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('previews the original shortest and flat extremes without waiting for all alternatives', async () => {
    const trip = defaultTrip()
    const preview = await findFamily(model, trip, new AbortController().signal, undefined, true)
    expect(preview.partial).toBe(true)
    expect(preview.members[0].stats.distance_m).toBeLessThan(preview.members[preview.members.length - 1].stats.distance_m)
    expect(preview.members[preview.members.length - 1].stats.distance_m).toBeCloseTo(7822.2, 6)
    expect(preview.members[preview.members.length - 1].stats.elev_gain_m).toBeCloseTo(83.29, 6)
  })

  it('returns a closed loop preview rooted at the dragged start', async () => {
    const family = await findFamily(model, { ...defaultTrip(), loop: true, loopMi: 2 }, new AbortController().signal, undefined, true)
    const arcs = family.members[0].arcs
    expect(family.loop).toBe(true)
    expect(model.graph.arcTail(arcs[0])).toBe(model.graph.head[arcs[arcs.length - 1]])
  })

  it('finds a closed loop using the imported graph', async () => {
    const family = await findFamily(model, { ...defaultTrip(), loop: true, loopMi: 2 }, new AbortController().signal)
    expect(family.loop).toBe(true)
    expect(family.members.length).toBeGreaterThan(0)
    const arcs = family.members[0].arcs
    expect(model.graph.arcTail(arcs[0])).toBe(model.graph.head[arcs[arcs.length - 1]])
  }, 30000)

  it('round-trips legacy trip and loop links, including escaped labels', () => {
    const trip = { ...defaultTrip(), from: { ...defaultTrip().from!, label: 'Café & Park 🐉' }, mode: 'bike' as const, calm: false, t: 0.4 }
    expect(readTrip(tripHash(trip)!)).toMatchObject({ mode: 'bike', calm: false, t: 0.4, from: trip.from })
    const loop = { ...trip, loop: true, loopMi: 3.5, outBack: true, loopIndex: 2 }
    expect(readTrip(tripHash(loop)!)).toMatchObject({ loop: true, loopMi: 3.5, outBack: true, loopIndex: 2 })
    expect(readTrip('#t~0~0~-122.4~37.7~w~0.5~Outside~SF')).toEqual(defaultTrip())
    expect(readTrip('#l~-122.4~37.7~w~NaN~0~Start')).toEqual(defaultTrip())
  })
})
