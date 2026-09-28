import { describe, expect, it } from 'vitest'
import { loadFeaturePages } from './featurePages'
const plan = {
  id: 'buildings',
  title: 'Buildings',
  url: 'https://example.test/FeatureServer/1',
  where: '1=1',
  fields: ['OBJECTID'],
}
const bounds: [number, number, number, number] = [14, 50, 15, 51]
const features = (offset: number, count: number) =>
  Array.from({ length: count }, (_, i) => ({ type: 'Feature', properties: { OBJECTID: offset + i }, geometry: null }))
describe('progressive feature pages', () => {
  it('draws the first page, overlaps later requests, and publishes in stable order through the last page', async () => {
    const offsets: number[] = []
    const published: number[] = []
    const pending: Array<() => void> = []
    const request = (async (input: RequestInfo | URL) => {
      const offset = Number(new URL(String(input)).searchParams.get('resultOffset'))
      offsets.push(offset)
      if (offset)
        await new Promise<void>((resolve) => {
          pending.push(resolve)
          if (pending.length === 3) pending.reverse().forEach((done) => done())
        })
      const count = Math.min(2000, Math.max(0, 4501 - offset))
      return new Response(
        JSON.stringify({ features: features(offset, count), exceededTransferLimit: offset + count < 4501 }),
      )
    }) as typeof fetch
    const result = await loadFeaturePages(
      plan,
      bounds,
      0.01,
      new AbortController().signal,
      (f) => published.push(f.length),
      request,
    )
    expect(offsets).toEqual([0, 2000, 4000, 6000])
    expect(published).toEqual([2000, 4501])
    expect(result.map((f) => f.properties?.OBJECTID)).toEqual(Array.from({ length: 4501 }, (_, i) => i))
  })
  it('does not publish a completed response after cancellation', async () => {
    const controller = new AbortController()
    const published: unknown[] = []
    const request = (async () => {
      controller.abort()
      return new Response(JSON.stringify({ features: features(0, 1) }))
    }) as typeof fetch
    await expect(
      loadFeaturePages(plan, bounds, 0.01, controller.signal, (f) => published.push(f), request),
    ).rejects.toThrow()
    expect(published).toEqual([])
  })
  it('retains first-page progress but reports a later-page failure', async () => {
    const published: number[] = []
    const request = (async (input: RequestInfo | URL) =>
      new URL(String(input)).searchParams.get('resultOffset') === '0'
        ? new Response(JSON.stringify({ features: features(0, 2000), exceededTransferLimit: true }))
        : new Response('', { status: 503 })) as typeof fetch
    await expect(
      loadFeaturePages(plan, bounds, 0.01, new AbortController().signal, (f) => published.push(f.length), request),
    ).rejects.toThrow('503')
    expect(published).toEqual([2000])
  })
})
