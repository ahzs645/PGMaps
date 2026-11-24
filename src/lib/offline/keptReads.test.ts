import { describe, expect, it, vi } from 'vitest'
import {
  COPY_READ_AT_HEADER,
  copyReadAt,
  createKeptFetch,
  keptCopySource,
  keptReadKey,
  oldestCopy,
  readAtOf,
  type KeptCopy,
} from './keptReads'

const URL_A = 'https://openmaps.gov.bc.ca/geo/pub/wfs?typeName=INVENTORY&CQL_FILTER=BBOX(1,2,3,4)'
const URL_B = 'https://openmaps.gov.bc.ca/geo/pub/wfs?typeName=INVENTORY&CQL_FILTER=BBOX(5,6,7,8)'
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

function harness({ on = true }: { on?: boolean } = {}) {
  const kept = new Map<string, KeptCopy>()
  const state = {
    on,
    now: new Date('2026-11-18T10:00:00.000Z'),
    network: async (): Promise<Response> => json({ live: 1 }),
  }
  const used: Array<{ url: string; readAt: string }> = []
  const fetchSpy = vi.fn(async () => state.network())
  const keptFetch = createKeptFetch({
    fetch: fetchSpy as unknown as typeof fetch,
    store: {
      read: async (url) => kept.get(url) ?? null,
      write: async (url, copy) => void kept.set(url, copy),
    },
    enabled: () => state.on,
    now: () => state.now,
    onCopyUsed: (use) => used.push(use),
  })
  /** Let the copy of a successful read finish being written. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
  const offline = () => {
    state.network = async () => {
      throw new TypeError('Failed to fetch')
    }
  }
  return { kept, state, used, fetchSpy, keptFetch, settle, offline }
}

describe('a read with copies switched off', () => {
  it('is the plain fetch: nothing is kept and a failure is the failure', async () => {
    const h = harness({ on: false })
    expect(await (await h.keptFetch(URL_A)).json()).toEqual({ live: 1 })
    await h.settle()
    expect(h.kept.size).toBe(0)
    h.offline()
    await expect(h.keptFetch(URL_A)).rejects.toThrow('Failed to fetch')
    expect(h.used).toEqual([])
  })

  it('does not answer from a copy kept while it was on', async () => {
    const h = harness()
    await h.keptFetch(URL_A)
    await h.settle()
    h.state.on = false
    h.offline()
    await expect(h.keptFetch(URL_A)).rejects.toThrow('Failed to fetch')
  })
})

describe('how soon the source is asked', () => {
  it('calls the source in the same tick when the switch answers at once', () => {
    const h = harness({ on: false })
    void h.keptFetch(URL_A)
    expect(h.fetchSpy).toHaveBeenCalledOnce()
  })

  it('ends a read cancelled while the switch was being read as fetch ends it', async () => {
    const source = vi.fn(async () => json({ live: 1 }))
    const slow = createKeptFetch({
      fetch: source as unknown as typeof fetch,
      store: { read: async () => null, write: async () => undefined },
      enabled: () => new Promise((resolve) => setTimeout(() => resolve(false), 0)),
      now: () => new Date(),
    })
    const controller = new AbortController()
    const read = slow(URL_A, { signal: controller.signal })
    controller.abort()
    await expect(read).rejects.toMatchObject({ name: 'AbortError' })
    expect(source).not.toHaveBeenCalled()
  })
})

describe('a read with copies switched on', () => {
  it('returns the live answer unmarked and keeps a copy stamped with the time it was read', async () => {
    const h = harness()
    const response = await h.keptFetch(URL_A)
    expect(copyReadAt(response)).toBeNull()
    expect(await response.json()).toEqual({ live: 1 })
    await h.settle()
    expect(h.kept.get(URL_A)?.readAt).toBe('2026-11-18T10:00:00.000Z')
  })

  it('answers a failed connection from the copy, carrying the copy’s own time', async () => {
    const h = harness()
    await h.keptFetch(URL_A)
    await h.settle()
    h.offline()
    h.state.now = new Date('2026-11-25T08:00:00.000Z')
    const response = await h.keptFetch(URL_A)
    expect(response.ok).toBe(true)
    expect(await response.json()).toEqual({ live: 1 })
    expect(response.headers.get(COPY_READ_AT_HEADER)).toBe('2026-11-18T10:00:00.000Z')
    expect(readAtOf(response, h.state.now)).toBe('2026-11-18T10:00:00.000Z')
    expect(h.used).toEqual([{ url: URL_A, readAt: '2026-11-18T10:00:00.000Z' }])
  })

  it('answers only the same request: another box has no copy and fails', async () => {
    const h = harness()
    await h.keptFetch(URL_A)
    await h.settle()
    h.offline()
    await expect(h.keptFetch(URL_B)).rejects.toThrow('Failed to fetch')
    expect(h.used).toEqual([])
  })

  it('falls back on a server error and passes a refusal through', async () => {
    const h = harness()
    await h.keptFetch(URL_A)
    await h.settle()
    h.state.network = async () => json({ error: 'down' }, 503)
    expect(copyReadAt(await h.keptFetch(URL_A))).toBe('2026-11-18T10:00:00.000Z')
    // No copy of this one: the server's own answer comes back.
    expect((await h.keptFetch(URL_B)).status).toBe(503)
    h.state.network = async () => json({ error: 'bad filter' }, 400)
    const refused = await h.keptFetch(URL_A)
    expect(refused.status).toBe(400)
    expect(copyReadAt(refused)).toBeNull()
  })

  it('never answers a cancelled read from a copy', async () => {
    const h = harness()
    await h.keptFetch(URL_A)
    await h.settle()
    const controller = new AbortController()
    controller.abort()
    h.state.network = async () => {
      throw new DOMException('Aborted', 'AbortError')
    }
    await expect(h.keptFetch(URL_A, { signal: controller.signal })).rejects.toThrow('Aborted')
    expect(h.used).toEqual([])
  })

  it('replaces a copy with a newer read and does not keep a failed one', async () => {
    const h = harness()
    await h.keptFetch(URL_A)
    await h.settle()
    h.state.now = new Date('2026-11-19T10:00:00.000Z')
    h.state.network = async () => json({ live: 2 })
    await h.keptFetch(URL_A)
    await h.settle()
    expect(h.kept.get(URL_A)?.readAt).toBe('2026-11-19T10:00:00.000Z')
    h.state.network = async () => json({ error: 'bad' }, 400)
    await h.keptFetch(URL_A)
    await h.settle()
    expect(new TextDecoder().decode(h.kept.get(URL_A)!.body)).toBe('{"live":2}')
  })

  it('does not fail a read whose copy could not be written, and leaves a POST alone', async () => {
    const h = harness()
    const failing = createKeptFetch({
      fetch: (async () => json({ live: 1 })) as unknown as typeof fetch,
      store: {
        read: async () => null,
        write: async () => {
          throw new Error('QuotaExceededError')
        },
      },
      enabled: () => true,
      now: () => h.state.now,
    })
    expect(await (await failing(URL_A)).json()).toEqual({ live: 1 })
    await h.keptFetch(URL_A, { method: 'POST', body: '{}' })
    await h.settle()
    expect(h.kept.size).toBe(0)
  })
})

describe('a form POST (a WFS read by a shape’s own polygons)', () => {
  const WFS = 'https://openmaps.gov.bc.ca/geo/pub/wfs'
  const FORM = { 'content-type': 'application/x-www-form-urlencoded' }
  const post = (body: string) => ({ method: 'POST', headers: FORM, body })

  it('is kept under the URL its form would make as a GET, and answers only the same form', async () => {
    const h = harness()
    const ask = 'typeNames=pub%3AINVENTORY&CQL_FILTER=INTERSECTS(GEOMETRY%2CSRID%3D4326%3BPOLYGON((1+2%2C3+4)))'
    expect(keptReadKey(WFS, post(ask))).toBe(`${WFS}?${ask}`)
    await h.keptFetch(WFS, post(ask))
    await h.settle()
    expect([...h.kept.keys()]).toEqual([`${WFS}?${ask}`])
    h.offline()
    const copy = await h.keptFetch(WFS, post(ask))
    expect(copyReadAt(copy)).toBe('2026-11-18T10:00:00.000Z')
    expect(h.used).toEqual([{ url: `${WFS}?${ask}`, readAt: '2026-11-18T10:00:00.000Z' }])
    // Another shape is another request: it has no copy and fails as before.
    await expect(h.keptFetch(WFS, post(ask.replace('1+2', '5+6')))).rejects.toThrow('Failed to fetch')
  })

  it('leaves a POST of any other body alone', () => {
    expect(keptReadKey(WFS, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })).toBeNull()
    expect(keptReadKey(WFS, { method: 'POST', body: 'a=1' })).toBeNull()
    expect(keptReadKey(WFS, { method: 'POST', headers: FORM, body: new Blob(['a=1']) })).toBeNull()
    expect(keptReadKey(WFS, { method: 'POST', headers: new Headers(FORM), body: 'a=1' })).toBe(`${WFS}?a=1`)
    expect(keptReadKey(`${WFS}?service=WFS`, post('a=1'))).toBe(`${WFS}?service=WFS&a=1`)
  })
})

describe('reading a response’s time', () => {
  it('is now for a live read', () => {
    const now = new Date('2026-11-20T00:00:00.000Z')
    expect(readAtOf(json({}), now)).toBe('2026-11-20T00:00:00.000Z')
  })

  it('takes the oldest copy of a result built from several reads', () => {
    expect(oldestCopy([null, '2026-11-18T10:00:00.000Z', undefined, '2026-11-12T10:00:00.000Z'])).toBe(
      '2026-11-12T10:00:00.000Z',
    )
    expect(oldestCopy([null, undefined])).toBeUndefined()
  })

  it('names a source that came from a copy', () => {
    expect(keptCopySource('BC VRI rank-1 WFS')).toBe('BC VRI rank-1 WFS · kept copy')
  })
})
