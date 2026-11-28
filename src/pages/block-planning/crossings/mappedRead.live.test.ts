/**
 * The mapped crossing read against DataBC itself, on a made-up 400 m square near Prince George with
 * PSCIS sites round it. Off by default: `CROSSINGS_LIVE=1 npx vitest run mappedRead.live` runs it.
 * It checks that each layer reads, that every record arrives cut to the reader's fields, and that
 * the candidates carry their evidence; the figures it prints go in the planner contract's record of
 * live runs.
 */
import type { Polygon } from 'geojson'
import { describe, expect, it } from 'vitest'
import { crossingOverlay } from '../oldForest/oldForest'
import { CROSSING_LAYERS, readMappedCrossings } from './mappedRead'

const LIVE = process.env.CROSSINGS_LIVE === '1'

const SQUARE: Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [-122.6632, 53.7882],
      [-122.6572, 53.7882],
      [-122.6572, 53.7918],
      [-122.6632, 53.7918],
      [-122.6632, 53.7882],
    ],
  ],
}

/** A made-up 600 m square on forest roads north-west of Prince George, with PSCIS sites along them. */
const FOREST: Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [-122.91, 54.293],
      [-122.9008, 54.293],
      [-122.9008, 54.2984],
      [-122.91, 54.2984],
      [-122.91, 54.293],
    ],
  ],
}

const NAMES =
  /CLIENT_NAME|RESPONSIBLE_PARTY|CONSULTANT|CREW|AGENCY|ROAD_NAME|ROAD_SECTION_NAME|MAP_LABEL|WORKS_DESCRIPTION|ASSESSMENT_COMMENT|SOURCE_REF/

describe.skipIf(!LIVE)('mapped crossings, live', () => {
  it.each([
    ['near the city, with PSCIS sites and no tenured road', SQUARE, 1000],
    ['on forest roads', FOREST, 500],
  ] as const)(
    'reads roads, streams, PSCIS and the evidence round a block %s',
    { timeout: 300_000 },
    async (_, footprint, metres) => {
      const asked: string[] = []
      const started = Date.now()
      const read = await readMappedCrossings({
        footprint,
        block: 'b',
        schedule: 's',
        shape: 'shape',
        signature: 'sig',
        corridor: { by: 'distance', metres },
        fetch: async (url, init) => {
          asked.push(new URLSearchParams(init?.body ?? '').get('typeNames') ?? url)
          return fetch(url, init)
        },
        overlay: crossingOverlay,
        readOn: '2026-11-27',
        onProgress: (stage) => console.log(`${((Date.now() - started) / 1000).toFixed(1)} s ${stage}`),
      })
      console.log(`Read in ${((Date.now() - started) / 1000).toFixed(1)} s with ${asked.length} requests.`)
      for (const l of read.layers)
        console.log(`${l.label}: ${l.status} ${l.count}${l.message ? ` (${l.message})` : ''}`)
      const byOrigin = (o: string) => read.candidates.filter((c) => c.origin === o).length
      console.log(
        `Candidates: ${read.candidates.length} (${byOrigin('mapped')} mapped, ${byOrigin('pscis')} PSCIS only)`,
      )
      for (const c of read.candidates.slice(0, 12))
        console.log(
          `  ${c.label} · ${c.distanceM} m · ${c.aliases.map((a) => `${a.source}:${a.id}`).join(' ')} · ${c.evidence.map((e) => e.kind).join(',')} · ${c.sightings.map((s) => `${s.source}@${s.date}`).join(',')}${c.note ? ` · ${c.note}` : ''}`,
        )
      expect(read.layers.find((l) => l.id === 'sections')?.status).toBe('read')
      expect(read.layers.find((l) => l.id === 'streams')?.status).not.toBe('failed')
      expect(read.candidates.length).toBeGreaterThan(0)
      // Every value kept is one the reader listed; no name field came through.
      const listed = new Set<string>(Object.values(CROSSING_LAYERS).flatMap((l) => [...l.fields]))
      for (const c of read.candidates)
        for (const e of c.evidence)
          for (const k of Object.keys(e.values ?? {})) {
            expect(NAMES.test(k)).toBe(false)
            if (/^[A-Z_0-9]+$/.test(k)) expect(listed.has(k)).toBe(true)
          }
    },
  )
})
