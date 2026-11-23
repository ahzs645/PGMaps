import { useEffect, useRef, useState } from 'react'

export type CalculationReply<Result> = { result: Result } | { error: string }

/** A single on-demand calculation. Replacing the inputs or unmounting releases its worker. */
export function useWorkerCalculation<Input, Result>(
  createWorker: () => Worker,
  onResult: (value: Result | null) => void,
) {
  const active = useRef<Worker | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(
    () => () => {
      active.current?.terminate()
      active.current = null
    },
    [],
  )
  function clear(message = '') {
    active.current?.terminate()
    active.current = null
    setBusy(false)
    setError(message)
    setResult(null)
    onResult(null)
  }
  function run(input: Input) {
    clear()
    try {
      const worker = createWorker()
      active.current = worker
      setBusy(true)
      const complete = (reply: CalculationReply<Result>) => {
        if (active.current !== worker) return
        worker.terminate()
        active.current = null
        setBusy(false)
        if ('error' in reply) setError(reply.error)
        else {
          setResult(reply.result)
          onResult(reply.result)
        }
      }
      worker.onmessage = (event: MessageEvent<CalculationReply<Result>>) => complete(event.data)
      worker.onerror = (event) => complete({ error: event.message || 'Calculation failed.' })
      worker.onmessageerror = () => complete({ error: 'Unable to read the calculation result.' })
      worker.postMessage(input)
    } catch (e) {
      clear(e instanceof Error ? e.message : 'Unable to start the calculation.')
    }
  }
  return { result, busy, error, clear, run }
}
