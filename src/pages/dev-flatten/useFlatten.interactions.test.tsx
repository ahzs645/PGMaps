import { act, create } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadModel, type Family, type Model } from './routing'
import { useFlatten } from './useFlatten'

const workers = vi.hoisted(() => ({
  blocked: false,
  route: vi.fn(),
  instances: [] as { dispose: ReturnType<typeof vi.fn> }[],
}))
vi.mock('./routing', async (original) => ({
  ...(await original<typeof import('./routing')>()),
  loadModel: vi.fn(),
}))
vi.mock('./routing-worker', () => ({
  RoutingWorker: vi.fn(function () {
    if (workers.blocked) throw new Error('Blocked by browser')
    const instance = { route: workers.route, dispose: vi.fn() }
    workers.instances.push(instance)
    return instance
  }),
}))

const model = {} as Model
const family: Family = { members: [], partial: false, loop: false, tried: 2 }
let view: ReturnType<typeof create> | undefined
function Probe() {
  const state = useFlatten('pg')
  return (
    <button
      data-error={state.error}
      data-loading={state.loading}
      data-tried={state.family?.tried}
      onClick={state.retry}
    >
      Retry
    </button>
  )
}

beforeEach(() => {
  workers.blocked = false
  workers.instances.length = 0
  workers.route.mockReset().mockResolvedValue(family)
  vi.mocked(loadModel).mockReset().mockResolvedValue(model)
  vi.stubGlobal('window', { location: { hash: '' }, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.stubGlobal('history', { state: null, replaceState: vi.fn() })
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() })
})
afterEach(() => {
  if (view) act(() => view?.unmount())
  view = undefined
  vi.unstubAllGlobals()
})

describe('Flatten model and worker lifecycle', () => {
  it('shows a blocked worker startup and recovers on Retry with the same cached model', async () => {
    workers.blocked = true
    await act(async () => {
      view = create(<Probe />)
    })
    expect(view!.root.findByType('button').props['data-error']).toContain('Could not start the routing worker')
    expect(view!.root.findByType('button').props['data-loading']).toBe(false)
    expect(workers.route).not.toHaveBeenCalled()
    workers.blocked = false
    await act(async () => {
      view!.root.findByType('button').props.onClick()
    })
    expect(vi.mocked(loadModel)).toHaveBeenCalledTimes(2)
    expect(workers.route).toHaveBeenCalledTimes(1)
    expect(view!.root.findByType('button').props['data-error']).toBeNull()
    expect(view!.root.findByType('button').props['data-tried']).toBe(2)
  })

  it('aborts stale route results and disposes the previous worker on Retry', async () => {
    let finishOld!: (result: Family) => void
    workers.route.mockImplementationOnce(
      () =>
        new Promise<Family>((resolve) => {
          finishOld = resolve
        }),
    )
    await act(async () => {
      view = create(<Probe />)
    })
    const firstSignal = workers.route.mock.calls[0][2] as AbortSignal
    await act(async () => {
      view!.root.findByType('button').props.onClick()
    })
    expect(firstSignal.aborted).toBe(true)
    expect(workers.instances[0].dispose).toHaveBeenCalledOnce()
    expect(workers.instances).toHaveLength(2)
    await act(async () => {
      finishOld({ ...family, tried: 1 })
    })
    expect(view!.root.findByType('button').props['data-tried']).toBe(2)
  })

  it('does not allocate a worker when a model resolves after unmount', async () => {
    let finishModel!: (model: Model) => void
    vi.mocked(loadModel).mockReturnValueOnce(
      new Promise((resolve) => {
        finishModel = resolve
      }),
    )
    await act(async () => {
      view = create(<Probe />)
    })
    act(() => view!.unmount())
    view = undefined
    await act(async () => {
      finishModel(model)
    })
    expect(workers.instances).toHaveLength(0)
  })
})
