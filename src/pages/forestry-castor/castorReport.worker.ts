/// <reference lib="webworker" />
import type { CastorReportRequest, CastorReportResponse } from './protocol'
import { createCastorReportHandler } from './reportWorkerCore'

const scope = globalThis as unknown as DedicatedWorkerGlobalScope
const handle = createCastorReportHandler((response: CastorReportResponse, transfer: Transferable[] = []) =>
  scope.postMessage(response, transfer),
)

scope.onmessage = (event: MessageEvent<CastorReportRequest>) => {
  void handle(event.data)
}
