import { useCallback, useEffect, useRef, useState } from 'react'
import { MAX_TOOL_JOBS, type ToolJob, type ToolRun } from './assessmentTools'
import { buildSceneInput } from './sceneInput'
import { summarizeRun } from './assessmentTools'
import type { AnalysisResult, AnalysisWorkerResponse } from './types'

/** One bounded sequential worker batch. Cancellation terminates CPU work and discards late replies. */
export function useToolRunner(sceneKey: string | null) {
  const worker = useRef<Worker | null>(null),
    generation = useRef(0),
    rejectPending = useRef<((error: Error) => void) | null>(null)
  const [running, setRunning] = useState(false),
    [progress, setProgress] = useState(''),
    [error, setError] = useState<string | null>(null)
  const cancel = useCallback(() => {
    generation.current++
    rejectPending.current?.(new Error('Cancelled'))
    rejectPending.current = null
    worker.current?.terminate()
    worker.current = null
    setRunning(false)
    setProgress('')
  }, [])
  useEffect(() => cancel, [cancel])
  useEffect(() => {
    cancel()
  }, [sceneKey, cancel])
  const run = useCallback(
    async (
      jobs: ToolJob[],
      onComplete: (records: ToolRun[]) => void,
      inspection?: { targetId: string; sampleIndex: number; stationIndex: number },
      onInspection?: (result: AnalysisResult) => void,
    ) => {
      cancel()
      setError(null)
      if (!jobs.length || jobs.length > MAX_TOOL_JOBS) {
        setError(`Use 1–${MAX_TOOL_JOBS} jobs per batch.`)
        return
      }
      const token = generation.current
      setRunning(true)
      let w: Worker
      try {
        w = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' })
        worker.current = w
      } catch (e) {
        setError(String(e))
        setRunning(false)
        return
      }
      const records: ToolRun[] = []
      for (let i = 0; i < jobs.length; i++) {
        if (token !== generation.current) return
        const job = structuredClone(jobs[i])
        try {
          const result = await new Promise<AnalysisResult>((resolve, reject) => {
            rejectPending.current = reject
            w.onmessage = (event: MessageEvent<AnalysisWorkerResponse>) => {
              const m = event.data
              if (token !== generation.current || m.requestId !== i + 1) return
              if (m.type === 'progress')
                setProgress(
                  `${i + 1}/${jobs.length} · ${job.name} · ${m.progress.phase} ${Math.round((100 * m.progress.completed) / Math.max(1, m.progress.total))}%`,
                )
              if (m.type === 'result') {
                rejectPending.current = null
                resolve(m.result)
              }
              if (m.type === 'error') {
                rejectPending.current = null
                reject(new Error(m.message))
              }
            }
            w.onerror = (e) => reject(new Error(e.message || 'The analysis worker stopped.'))
            w.postMessage({ type: 'analyze', requestId: i + 1, input: buildSceneInput(job.scene), inspection })
          })
          if (token !== generation.current) return
          onInspection?.(result)
          records.push({
            ...job,
            generatedAt: new Date().toISOString(),
            error: null,
            summary: summarizeRun(job.scene, result),
          })
        } catch (e) {
          if (token !== generation.current) return
          rejectPending.current = null
          records.push({
            ...job,
            generatedAt: new Date().toISOString(),
            summary: null,
            error: e instanceof Error ? e.message : String(e),
          })
        }
      }
      if (token !== generation.current) return
      w.terminate()
      worker.current = null
      setRunning(false)
      setProgress('')
      if (inspection && records[0]?.error) setError(records[0].error)
      onComplete(records)
    },
    [cancel],
  )
  return { running, progress, error, cancel, run }
}
