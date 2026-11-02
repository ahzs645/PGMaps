/// <reference lib="webworker" />
import { createLazPerf, type LazPerf } from 'laz-perf'
import wasmUrl from 'laz-perf/lib/web/laz-perf.wasm?url'
import { runRestoration } from './run'
import type { RestorationOptions } from './model'

const scope = globalThis as unknown as DedicatedWorkerGlobalScope
scope.onmessage = async ({ data }: MessageEvent<{ files: File[]; options: RestorationOptions }>) => {
  let laz: Promise<LazPerf> | undefined
  try {
    const result = await runRestoration(
      data.files,
      data.options,
      () => (laz ??= createLazPerf({ locateFile: () => wasmUrl })),
      (progress) => scope.postMessage({ type: 'progress', progress }),
    )
    scope.postMessage(
      { type: 'done', result },
      Object.values(result.rasters).map((r) => r.values.buffer),
    )
  } catch (error) {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
