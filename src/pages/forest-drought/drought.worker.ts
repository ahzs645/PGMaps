/// <reference lib="webworker" />
import { parseClimateCsv, runSimulation } from '@/features/forest-drought/model'
import type { SimulationRequest, SimulationResponse } from './protocol'

const scope = globalThis as unknown as DedicatedWorkerGlobalScope

scope.onmessage = (event: MessageEvent<SimulationRequest>) => {
  const request = event.data
  const post = (response: SimulationResponse) => scope.postMessage(response)
  try {
    const started = performance.now()
    post({ id: request.id, type: 'progress', fraction: 0 })
    const climate = parseClimateCsv(request.csv)
    const result = runSimulation(
      {
        climate,
        latitude: request.latitude,
        soils: request.soils,
        scenarios: request.scenarios,
        summaryPolicy: request.summaryPolicy,
      },
      (fraction) => post({ id: request.id, type: 'progress', fraction }),
    )
    post({ id: request.id, type: 'complete', result, elapsedMs: performance.now() - started, dayCount: climate.length })
  } catch (cause: unknown) {
    post({ id: request.id, type: 'error', message: cause instanceof Error ? cause.message : 'The calculation failed.' })
  }
}
