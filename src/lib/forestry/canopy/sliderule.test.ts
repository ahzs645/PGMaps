import { describe, expect, it } from 'vitest'
import {
  failedGranules,
  fetchGroundPhotons,
  granuleDate,
  groundPhotonRequest,
  isSnowFree,
  parseGroundPhotonCsv,
  SlideRuleFileCollector,
  SlideRuleRecordReader,
} from './sliderule'

const enc = new TextEncoder()

/** One record as SlideRule frames it: version 2, type length, data length (big-endian), type\0, data. */
function record(type: string, data: Uint8Array) {
  const name = enc.encode(`${type}\0`)
  const out = new Uint8Array(8 + name.length + data.length)
  const view = new DataView(out.buffer)
  view.setUint16(0, 2)
  view.setUint16(2, name.length)
  view.setUint32(4, data.length)
  out.set(name, 8)
  out.set(data, 8 + name.length)
  return out
}
const filename = (name: string) => {
  const b = new Uint8Array(128)
  b.set(enc.encode(name))
  return b
}
function meta(name: string, size: number) {
  const b = new Uint8Array(136)
  b.set(filename(name))
  new DataView(b.buffer).setBigInt64(128, BigInt(size), true)
  return record('arrowrec.meta', b)
}
function data(name: string, bytes: Uint8Array) {
  const b = new Uint8Array(128 + bytes.length)
  b.set(filename(name))
  b.set(bytes, 128)
  return record('arrowrec.data', b)
}
function exception(code: number, text: string) {
  const b = new Uint8Array(264)
  new DataView(b.buffer).setInt32(0, code, true)
  b.set(enc.encode(text), 8)
  return record('exceptrec', b)
}
const join = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

// 093G086 at Prince George. 2023-07-01 is snow-free; 2023-12-29 is not.
const CSV = [
  'time_ns,latitude,longitude,height,atl08_class,spot,rgt',
  '1688212800000000000,53.89,-122.81,592.44,1,6,166',
  '1688212800000000000,53.8901,-122.8101,610.2,2,6,166',
  '1703851200000000000,53.8902,-122.8102,593.9,1,3,1',
  '',
].join('\n')

describe('SlideRule stream', () => {
  it('splits records across any chunking and rebuilds the file they carry', () => {
    const bytes = enc.encode(CSV)
    const stream = join(
      exception(0, 'running 30 seconds'),
      meta('pgmaps-ground.csv', bytes.length),
      data('pgmaps-ground.csv', bytes.subarray(0, 50)),
      data('pgmaps-ground.csv', bytes.subarray(50)),
    )
    for (const size of [1, 7, 64, stream.length]) {
      const reader = new SlideRuleRecordReader()
      const files = new SlideRuleFileCollector()
      for (let i = 0; i < stream.length; i += size)
        for (const r of reader.push(stream.subarray(i, i + size))) files.add(r)
      expect(reader.pending).toBe(0)
      expect(files.unfinished).toEqual([])
      expect(files.messages).toEqual([{ kind: 'exception', code: 0, text: 'running 30 seconds' }])
      expect(new TextDecoder().decode(files.files[0].bytes)).toBe(CSV)
    }
  })

  it('refuses a record of another version', () => {
    const bad = record('eventrec', new Uint8Array(4))
    new DataView(bad.buffer).setUint16(0, 3)
    expect(() => new SlideRuleRecordReader().push(bad)).toThrow(/version 3/)
  })
})

describe('ground photons', () => {
  it('keeps ground photons by column name and dates them in UTC', () => {
    const photons = parseGroundPhotonCsv(CSV)
    expect(photons).toEqual([
      { lon: -122.81, lat: 53.89, ellipsoidH: 592.44, date: '2023-07-01', spot: 6, rgt: 166 },
      { lon: -122.8102, lat: 53.8902, ellipsoidH: 593.9, date: '2023-12-29', spot: 3, rgt: 1 },
    ])
    expect(photons.map((p) => isSnowFree(p.date))).toEqual([true, false])
  })

  it('reads a WKT geometry column when there is no longitude and latitude', () => {
    const csv = 'time,geometry,height\n2023-07-01T12:00:00,"POINT (-122.81 53.89)",592.4\n'
    expect(parseGroundPhotonCsv(csv)).toEqual([
      { lon: -122.81, lat: 53.89, ellipsoidH: 592.4, date: '2023-07-01', spot: 0, rgt: 0 },
    ])
  })

  it('refuses a reply without heights rather than guessing', () => {
    expect(() => parseGroundPhotonCsv('time_ns,latitude,longitude\n1,2,3\n')).toThrow(/no height/)
  })

  it('asks for ground photons only, and refuses a box SlideRule would take too long over', () => {
    const body = groundPhotonRequest([-122.835, 53.88, -122.79, 53.907])
    expect(body.parms.atl08_class).toEqual(['atl08_ground'])
    expect(body.parms.output.format).toBe('csv')
    expect(body.parms.poly).toHaveLength(5)
    expect(() => groundPhotonRequest([-123, 53, -122, 54])).toThrow(/keep it under/)
  })

  // CMR lists one summer and one winter granule; SlideRule is asked for the summer one only.
  const GRANULES = ['ATL03_20230701040000_01660306_007_01.h5', 'ATL03_20231229170444_01662206_007_01.h5']
  const cmrThen = (slideRule: () => Response, asked: string[] = []) =>
    (async (url: string, init?: RequestInit) => {
      if (url.startsWith('https://cmr.earthdata.nasa.gov/'))
        return new Response(JSON.stringify({ feed: { entry: GRANULES.map((title) => ({ title })) } }), {
          headers: { 'cmr-hits': String(GRANULES.length) },
        })
      asked.push(String(init?.body))
      return slideRule()
    }) as unknown as typeof fetch

  it('names the granules SlideRule could not read', () => {
    const failed = failedGranules([
      { kind: 'exception', code: -2, text: '<AppServer.1> running 30 seconds' },
      { kind: 'exception', code: 0, text: `${GRANULES[0]}/gt1l generated 0 rows` },
      {
        kind: 'exception',
        code: -7,
        text: `Failure on resource ${GRANULES[1]}_dpyQXxz6 beam gt2r: H5Coro::Future read failure`,
      },
      { kind: 'exception', code: -1, text: `Failed to send data in ${GRANULES[1]}_dpyQXxz6: invalid dataframe` },
    ])
    expect(failed).toEqual([GRANULES[1]])
  })

  it('dates granules from their names', () => {
    expect(granuleDate(GRANULES[0])).toBe('2023-07-01')
    expect(granuleDate('ATL08_20230701040000_01660306_007_01.h5')).toBeNull()
  })

  it('asks SlideRule for snow-free granules only and returns snow-free photons', async () => {
    const bytes = enc.encode(CSV)
    const stream = join(meta('pgmaps-ground.csv', bytes.length), data('pgmaps-ground.csv', bytes))
    const asked: string[] = []
    const fakeFetch = cmrThen(
      () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(stream.subarray(0, 100))
              c.enqueue(stream.subarray(100))
              c.close()
            },
          }),
        ),
      asked,
    )
    const result = await fetchGroundPhotons([-122.82, 53.88, -122.8, 53.9], fakeFetch, { now: () => 0 })
    expect(JSON.parse(asked[0]).parms.resources).toEqual([GRANULES[0]])
    expect(result.granulesRead).toBe(1)
    expect(result.photons).toHaveLength(1)
    expect(result.allDates).toEqual(['2023-07-01', '2023-12-29'])
  })

  it('does not call SlideRule when no snow-free pass crosses the box', async () => {
    const asked: string[] = []
    const winterOnly = (async (url: string) =>
      url.startsWith('https://cmr.')
        ? new Response(JSON.stringify({ feed: { entry: [{ title: GRANULES[1] }] } }))
        : (asked.push(url), new Response(''))) as unknown as typeof fetch
    const result = await fetchGroundPhotons([-122.82, 53.88, -122.8, 53.9], winterOnly)
    expect(asked).toEqual([])
    expect(result).toMatchObject({ photons: [], granulesRead: 0, allDates: ['2023-12-29'] })
  })

  it('reports a reply that ended without a photon file as a failure, never as no photons', async () => {
    const stream = join(exception(-2, '<AppServer.1> running 600 seconds'))
    await expect(
      fetchGroundPhotons(
        [-122.82, 53.88, -122.8, 53.9],
        cmrThen(() => new Response(stream)),
      ),
    ).rejects.toThrow(/no photon file after running 600 s/)
  })
})
