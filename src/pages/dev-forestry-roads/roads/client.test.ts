import { afterEach, describe, expect, it, vi } from 'vitest'
import { runProjection } from './client'
import { getCLUSExample } from './examples'
import { projectRoads } from './projectRoads'

class TestWorker {
  static instances: TestWorker[] = []
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: { message: string }) => void) | null = null
  onmessageerror: (() => void) | null = null
  terminate = vi.fn()
  postMessage = vi.fn()
  constructor() {
    TestWorker.instances.push(this)
  }
}
afterEach(() => {
  vi.unstubAllGlobals()
  TestWorker.instances = []
})
describe('network worker lifecycle', () => {
  it('terminates immediately on cancellation and ignores a late result', async () => {
    vi.stubGlobal('Worker', TestWorker)
    const controller = new AbortController(),
      input = getCLUSExample()
    const pending = runProjection(input, { signal: controller.signal }),
      worker = TestWorker.instances[0]
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    worker.onmessage?.({ data: { type: 'done', result: projectRoads(input) } })
    await rejected
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(input.grid.values.length).toBe(25)
  })
  it('reports calculation errors and terminates worker resources', async () => {
    vi.stubGlobal('Worker', TestWorker)
    const pending = runProjection(getCLUSExample()),
      worker = TestWorker.instances[0]
    const rejected = expect(pending).rejects.toThrow('No valid road cells')
    worker.onmessage?.({ data: { type: 'error', message: 'No valid road cells' } })
    await rejected
    expect(worker.terminate).toHaveBeenCalledOnce()
  })
  it('forwards progress and resolves only the completed result', async () => {
    vi.stubGlobal('Worker', TestWorker)
    const onProgress = vi.fn(),
      input = getCLUSExample(),
      expected = projectRoads(input)
    const pending = runProjection(input, { onProgress }),
      worker = TestWorker.instances[0]
    worker.onmessage?.({ data: { type: 'progress', message: 'Routing 2/4' } })
    expect(onProgress).toHaveBeenCalledWith('Routing 2/4')
    worker.onmessage?.({ data: { type: 'done', result: expected } })
    expect(await pending).toBe(expected)
    expect(worker.terminate).toHaveBeenCalledOnce()
  })
})
