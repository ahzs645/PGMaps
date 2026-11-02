/// <reference lib="webworker" />
import { analyze } from './analysis'
import type { AnalysisInput, AnalysisResult, Settings } from './types'

export type Request = { input: AnalysisInput; settings: Settings }
export type Response = { result: AnalysisResult } | { error: string }
self.onmessage = (event: MessageEvent<Request>) => {
  try {
    self.postMessage({ result: analyze(event.data.input, event.data.settings) } satisfies Response)
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) } satisfies Response)
  }
}
