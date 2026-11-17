import { describe, expect, it } from 'vitest'
import { PhotoCache, typedArrayBytes } from './photoCache'

describe('the photo cache', () => {
  it('keeps the most recently used entries within its count', () => {
    const evicted: string[] = []
    const cache = new PhotoCache<number>({ maxEntries: 2, onEvict: (key) => evicted.push(key) })
    cache.set('a', 1)
    cache.set('b', 2)
    expect(cache.get('a')).toBe(1) // a is now the most recent
    cache.set('c', 3)
    expect(cache.keys()).toEqual(['a', 'c'])
    expect(cache.has('b')).toBe(false)
    expect(evicted).toEqual(['b'])
    expect(cache.peek('a')).toBe(1)
    cache.set('d', 4) // peek did not refresh a
    expect(cache.keys()).toEqual(['c', 'd'])
  })

  it('keeps entries within its byte budget, and refuses one larger than the whole budget', () => {
    const cache = new PhotoCache<Float32Array>({ maxEntries: 10, maxBytes: 1000 })
    cache.set('a', new Float32Array(100)) // 400 bytes
    cache.set('b', new Float32Array(100))
    expect(cache.bytes).toBe(800)
    cache.set('c', new Float32Array(100))
    expect(cache.keys()).toEqual(['b', 'c'])
    expect(cache.bytes).toBe(800)
    expect(cache.set('huge', new Float32Array(1000))).toBe(false)
    expect(cache.keys()).toEqual(['b', 'c'])
    // Replacing an entry counts its new size once.
    cache.set('b', new Float32Array(10))
    expect(cache.bytes).toBe(440)
    expect(cache.delete('b')).toBe(true)
    expect(cache.bytes).toBe(400)
    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.bytes).toBe(0)
  })

  it('counts the typed arrays inside a value', () => {
    expect(typedArrayBytes({ width: 2, data: new Uint8ClampedArray(16), rows: [new Float64Array(3)] })).toBe(40)
    expect(typedArrayBytes('text')).toBe(0)
    expect(typedArrayBytes(new ArrayBuffer(12))).toBe(12)
  })

  it('makes a value once for callers asking at the same time, and tries again after a failure', async () => {
    const cache = new PhotoCache<string>({ maxEntries: 4 })
    let made = 0
    const make = () => new Promise<string>((resolve) => setTimeout(() => resolve(`v${++made}`), 5))
    const [a, b] = await Promise.all([cache.getOrCreate('k', make), cache.getOrCreate('k', make)])
    expect([a, b, made]).toEqual(['v1', 'v1', 1])
    expect(await cache.getOrCreate('k', make)).toBe('v1')
    await expect(cache.getOrCreate('bad', () => Promise.reject(Error('no')))).rejects.toThrow('no')
    expect(cache.has('bad')).toBe(false)
    expect(await cache.getOrCreate('bad', () => Promise.resolve('ok'))).toBe('ok')
  })

  it('keeps a shared load running while any caller still waits, and stops it once none does', async () => {
    const cache = new PhotoCache<string>({ maxEntries: 4 })
    let loadSignal: AbortSignal | null = null
    let finish: (value: string) => void = () => {}
    const make = (signal: AbortSignal) => {
      loadSignal = signal
      return new Promise<string>((resolve, reject) => {
        finish = resolve
        signal.addEventListener('abort', () => reject(signal.reason))
      })
    }
    const first = new AbortController(),
      second = new AbortController()
    const a = cache.getOrCreate('k', make, first.signal)
    const b = cache.getOrCreate('k', make, second.signal)
    first.abort()
    await expect(a).rejects.toBeDefined()
    // The second caller still waits, so the load goes on and its value is kept.
    expect(loadSignal!.aborted).toBe(false)
    finish('v')
    expect(await b).toBe('v')
    expect(cache.peek('k')).toBe('v')

    // Every caller gone: the load is stopped and nothing kept, so the next ask makes it again.
    const third = new AbortController()
    const c = cache.getOrCreate('j', make, third.signal)
    third.abort()
    await expect(c).rejects.toBeDefined()
    expect(loadSignal!.aborted).toBe(true)
    expect(cache.has('j')).toBe(false)
    const again = cache.getOrCreate('j', make)
    finish('w')
    expect(await again).toBe('w')
  })
})
