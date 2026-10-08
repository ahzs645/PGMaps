import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { defaultTrip, findFamily, isCityCoordinate, loadModel, readTrip, routeGpx, snapPoint, tripHash, type Model } from './routing'

let model: Model
beforeAll(async () => {
  vi.stubGlobal('fetch', async (url: string) => {
    const bytes = await readFile(path.resolve('public', url.replace(/^\//, '')))
    return new Response(bytes)
  })
  model = await loadModel(false, 'pg')
})
afterAll(() => vi.unstubAllGlobals())

describe('Prince George imported graph', () => {
  it('routes City Hall to UNBC with a valid climbing frontier and local search', async () => {
    const trip = defaultTrip('pg')
    const family = await findFamily(model, trip, new AbortController().signal)
    expect(family.members.length).toBeGreaterThan(1)
    for (let i = 1; i < family.members.length; i++) {
      expect(family.members[i].stats.distance_m).toBeGreaterThanOrEqual(family.members[i - 1].stats.distance_m)
      expect(family.members[i].stats.elev_gain_m).toBeLessThanOrEqual(family.members[i - 1].stats.elev_gain_m + .001)
    }
    const flat = family.members.at(-1)!
    expect(flat.stats.distance_m).toBeGreaterThan(5000)
    expect(flat.stats.distance_m).toBeLessThan(25000)
    expect(flat.stats.elev_gain_m).toBeGreaterThan(50)
    expect(flat.stats.elev_gain_m).toBeLessThan(700)
    expect(Math.abs(flat.stats.elev_gain_m - flat.stats.elev_loss_m - (flat.stats.end_elev_m - flat.stats.start_elev_m))).toBeLessThan(2)
    expect(flat.coordinates.every(([lon, lat]) => isCityCoordinate(lon, lat, 'pg'))).toBe(true)
    expect(model.index.search('Prince George City Hall')[0].name).toBe('Prince George City Hall')
    expect(model.index.search('Trick Dog')).toHaveLength(0)
    expect(routeGpx(flat, 'City Hall to UNBC', 'PGMaps Flatten PG')).not.toMatch(/NaN|undefined|Infinity/)
    console.info('Prince George benchmark:', flat.stats.distance_m, flat.stats.elev_gain_m, family.members.length)
  }, 30000)

  it('uses bike permissions and closes a loop at the chosen start', async () => {
    const trip = { ...defaultTrip('pg'), mode: 'bike' as const }
    const family = await findFamily(model, trip, new AbortController().signal)
    const from = snapPoint(model, trip.from!, 'bike'), to = snapPoint(model, trip.to!, 'bike')
    for (const member of family.members) {
      expect(model.graph.arcTail(member.arcs[0])).toBe(from.node)
      expect(model.graph.head[member.arcs.at(-1)!]).toBe(to.node)
    }
    const loops = await findFamily(model, { ...trip, loop: true, loopMi: 2 }, new AbortController().signal)
    const arcs = loops.members[0].arcs
    expect(model.graph.arcTail(arcs[0])).toBe(model.graph.head[arcs.at(-1)!])
  }, 30000)

  it('round-trips PG links and rejects a link for the other city', () => {
    const trip = defaultTrip('pg'), hash = tripHash(trip)!
    const restored = readTrip(hash, 'pg')
    expect(restored.from!.label).toBe(trip.from!.label)
    expect(restored.from!.lon).toBeCloseTo(trip.from!.lon, 5)
    expect(restored.to!.lat).toBeCloseTo(trip.to!.lat, 5)
    expect(readTrip(hash)).toEqual(defaultTrip())
    expect(readTrip(tripHash(defaultTrip())!, 'pg')).toEqual(trip)
    expect(isCityCoordinate(-122.81, 53.89, 'pg')).toBe(true)
    expect(isCityCoordinate(-122.81, 37.89, 'pg')).toBe(false)
  })
})
