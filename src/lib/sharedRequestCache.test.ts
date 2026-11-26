import { describe, expect, it, vi } from 'vitest'
import { SharedRequestCache } from './sharedRequestCache'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('SharedRequestCache', () => {
  it('shares one request between callers and keeps the value for the next', async () => {
    const cache = new SharedRequestCache<string>({ maxEntries: 4 })
    const read = deferred<string>()
    const load = vi.fn(() => read.promise)
    const a = cache.load('m', load)
    const b = cache.load('m', load)
    read.resolve('manifest')
    await expect(Promise.all([a, b])).resolves.toEqual(['manifest', 'manifest'])
    await expect(cache.load('m', load)).resolves.toBe('manifest')
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('lets one caller leave without failing the other, and aborts once nobody waits', async () => {
    const cache = new SharedRequestCache<string>({ maxEntries: 4 })
    const read = deferred<string>()
    let shared: AbortSignal | undefined
    const load = (signal: AbortSignal) => {
      shared = signal
      return read.promise
    }
    const first = new AbortController()
    const second = new AbortController()
    const a = cache.load('m', load, first.signal)
    const b = cache.load('m', load, second.signal)
    first.abort()
    await expect(a).rejects.toThrow('Aborted')
    expect(shared?.aborted).toBe(false)
    read.resolve('manifest')
    await expect(b).resolves.toBe('manifest')

    const lone = new AbortController()
    const c = cache.load('other', load, lone.signal)
    lone.abort()
    await expect(c).rejects.toThrow('Aborted')
    expect(shared?.aborted).toBe(true)
  })

  it('does not keep a failure', async () => {
    const cache = new SharedRequestCache<string>({ maxEntries: 4 })
    await expect(cache.load('m', () => Promise.reject(new Error('404')))).rejects.toThrow('404')
    await expect(cache.load('m', () => Promise.resolve('ok'))).resolves.toBe('ok')
  })

  it('evicts the least recently used past the entry and byte budgets', () => {
    const cache = new SharedRequestCache<number>({ maxEntries: 3, maxBytes: 10, sizeOf: (value) => value })
    cache.set('a', 2)
    cache.set('b', 2)
    cache.set('c', 2)
    cache.peek('a')
    cache.set('d', 2)
    expect(cache.peek('b')).toBeUndefined()
    expect(cache.peek('a')).toBe(2)
    cache.set('e', 9)
    expect(cache.size).toBe(1)
    cache.set('huge', 11)
    expect(cache.peek('huge')).toBeUndefined()
    expect(cache.peek('e')).toBe(9)
  })
})
