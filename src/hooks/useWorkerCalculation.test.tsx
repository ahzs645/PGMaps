import { createRef, useImperativeHandle } from 'react'
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
  const task = createRef<ReturnType<typeof useWorkerCalculation<string, number>>>()
  function Panel() {
    const current = useWorkerCalculation<string, number>(factory, finished)
    useImperativeHandle(task, () => current)
    return null
  }
  let view: ReturnType<typeof create>
  act(() => {
    view = create(<Panel />)
  })
  act(() => task.current!.run('older'))
  act(() => task.current!.run('current'))
  expect(workers[0].terminate).toHaveBeenCalledTimes(1)
  const answer = (worker: Worker, result: number) =>
    worker.onmessage?.call(worker, { data: { result } } as MessageEvent)
  act(() => answer(workers[0], 99))
  expect(task.current!.busy).toBe(true)
  act(() => answer(workers[1], 0))
  expect(task.current!.result).toBe(0)
  expect(finished).toHaveBeenLastCalledWith(0)
  act(() => task.current!.run('cancelled'))
  act(() => task.current!.clear())
  act(() => answer(workers[2], 90))
  expect(task.current!.result).toBeNull()
  act(() => task.current!.run('fail'))
  act(() => workers[3].onmessage?.call(workers[3], { data: { error: 'Missing geometry' } } as MessageEvent))
  expect(task.current!.error).toBe('Missing geometry')
  expect(task.current!.busy).toBe(false)
  act(() => task.current!.run('pending'))
  act(() => view.unmount())
  act(() => answer(workers[4], 123))
  expect(workers[4].terminate).toHaveBeenCalledTimes(1)
  expect(finished).toHaveBeenLastCalledWith(null)
})
