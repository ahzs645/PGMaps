import { useLayoutEffect } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useFetchAll, useFetchData, type FetchDataState, type UseFetchDataOptions } from './useFetchData'

const fixtures = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('@/lib/fetchJson', async (original) => ({
  ...(await original<typeof import('@/lib/fetchJson')>()),
  fetchJson: fixtures.fetch,
}))

let tree: ReactTestRenderer | undefined
let single: FetchDataState<number>
let batch: FetchDataState<(number | null)[]>
function validate(json: unknown): number {
  if (!json || typeof json !== 'object' || !('value' in json) || typeof json.value !== 'number')
    throw new Error('Dataset has no numeric value')
  return json.value
}
function Single({ url, options }: { url: string; options?: UseFetchDataOptions<number> }) {
  const result = useFetchData(url, { transform: validate, ...options })
  useLayoutEffect(() => {
    single = result
  })
  return null
}
function Batch({ urls }: { urls: string[] }) {
  const result = useFetchAll(urls, { transform: validate })
  useLayoutEffect(() => {
    batch = result
  })
  return null
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}
beforeEach(() => {
  fixtures.fetch.mockReset()
})
afterEach(() => {
  act(() => tree?.unmount())
  tree = undefined
})

it('reports invalid cached data on remount without throwing during render, then recovers on repeated retries', async () => {
  fixtures.fetch.mockResolvedValue({ value: null })
  await act(async () => {
    tree = create(<Single url="/test/invalid-cached-transform" />)
  })
  expect(single).toMatchObject({ data: null, loading: false, error: 'Dataset has no numeric value' })
  act(() => tree!.unmount())
  await act(async () => {
    tree = create(<Single url="/test/invalid-cached-transform" />)
  })
  expect(single).toMatchObject({ data: null, loading: false, error: 'Dataset has no numeric value' })
  expect(fixtures.fetch).toHaveBeenCalledTimes(1)

  fixtures.fetch.mockResolvedValue({ value: 12 })
  await act(async () => {
    single.retry()
  })
  expect(single).toMatchObject({ data: 12, loading: false, error: null })
  fixtures.fetch.mockResolvedValue({ value: 21 })
  await act(async () => {
    single.retry()
  })
  expect(single).toMatchObject({ data: 21, loading: false, error: null })
  expect(fixtures.fetch).toHaveBeenCalledTimes(3)
})

it('retains the shared raw response for consumers with a different validation policy', async () => {
  fixtures.fetch.mockResolvedValue({ value: null })
  await act(async () => {
    tree = create(<Single url="/test/per-consumer-transform" />)
  })
  expect(single.error).toBe('Dataset has no numeric value')
  act(() => tree!.unmount())
  await act(async () => {
    tree = create(<Single url="/test/per-consumer-transform" options={{ transform: () => 0 }} />)
  })
  expect(single).toMatchObject({ data: 0, loading: false, error: null })
  expect(fixtures.fetch).toHaveBeenCalledTimes(1)
})

it('does not cache an invalidated in-flight response after a newer retry has succeeded', async () => {
  const old = deferred<{ value: number }>()
  fixtures.fetch.mockReturnValueOnce(old.promise).mockResolvedValue({ value: 8 })
  await act(async () => {
    tree = create(<Single url="/test/invalidated-request" />)
  })
  expect(single.loading).toBe(true)
  await act(async () => {
    single.retry()
  })
  expect(single.data).toBe(8)
  await act(async () => {
    old.resolve({ value: -1 })
  })
  expect(single.data).toBe(8)
  act(() => tree!.unmount())
  fixtures.fetch.mockResolvedValue({ value: 9 })
  await act(async () => {
    tree = create(<Single url="/test/invalidated-request" />)
  })
  expect(single.data).toBe(9)
  expect(fixtures.fetch).toHaveBeenCalledTimes(3)
})

it('runs every batch retry, including the second retry after cache bypass is already active', async () => {
  fixtures.fetch.mockResolvedValue({ value: 1 })
  await act(async () => {
    tree = create(<Batch urls={['/test/repeated-batch-a', '/test/repeated-batch-b']} />)
  })
  expect(batch.data).toEqual([1, 1])
  fixtures.fetch.mockResolvedValue({ value: 2 })
  await act(async () => {
    batch.retry()
  })
  expect(batch).toMatchObject({ data: [2, 2], loading: false, error: null })
  fixtures.fetch.mockResolvedValue({ value: 3 })
  await act(async () => {
    batch.retry()
  })
  expect(batch).toMatchObject({ data: [3, 3], loading: false, error: null })
  expect(fixtures.fetch).toHaveBeenCalledTimes(6)
})
