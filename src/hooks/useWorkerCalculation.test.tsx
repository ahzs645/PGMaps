import { act, create } from 'react-test-renderer'
import { it, expect, vi } from 'vitest'
import { useWorkerCalculation } from './useWorkerCalculation'

it('discards superseded and cancelled replies, reports failures and releases the current worker on unmount', () => {
  const workers: Worker[] = []
  const finished = vi.fn()
  function factory() {
    const worker = { terminate: vi.fn(), postMessage: vi.fn() } as unknown as Worker
    workers.push(worker)
    return worker
  }
  let task: ReturnType<typeof useWorkerCalculation<string, number>>
  function Panel() {
    task = useWorkerCalculation<string, number>(factory, finished)
    return null
  }
  let view: ReturnType<typeof create>
  act(() => {
    view = create(<Panel />)
  })
  act(() => task.run('older'))
  act(() => task.run('current'))
  expect(workers[0].terminate).toHaveBeenCalledTimes(1)
  const answer = (worker: Worker, result: number) =>
    worker.onmessage?.call(worker, { data: { result } } as MessageEvent)
  act(() => answer(workers[0], 99))
  expect(task!.busy).toBe(true)
  act(() => answer(workers[1], 0))
  expect(task!.result).toBe(0)
  expect(finished).toHaveBeenLastCalledWith(0)
  act(() => task.run('cancelled'))
  act(() => task.clear())
  act(() => answer(workers[2], 90))
  expect(task!.result).toBeNull()
  act(() => task.run('fail'))
  act(() => workers[3].onmessage?.call(workers[3], { data: { error: 'Missing geometry' } } as MessageEvent))
  expect(task!.error).toBe('Missing geometry')
  expect(task!.busy).toBe(false)
  act(() => task.run('pending'))
  act(() => view.unmount())
  act(() => answer(workers[4], 123))
  expect(workers[4].terminate).toHaveBeenCalledTimes(1)
  expect(finished).toHaveBeenLastCalledWith(null)
})
