import { useEffect, useState } from 'react'
import workflowUrl from './workflows.generated.json?url'
import forestUrl from './forestry.generated.json?url'
import type { ForestData } from './forestry'
import modelUrl from './models.generated.json?url'
import type { ModelData, WorkflowData } from './analysisWorkflows'
export { default as cityJsonUrl } from './buildings.generated.city.jsonl?url'
export { workflowUrl, modelUrl, forestUrl }

export function useWorkflowData(enabled: boolean, analysisBase: string, sourceHash: string) {
  const [data, setData] = useState<{ workflows: WorkflowData; models: ModelData; forestry: ForestData } | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!enabled) return
    const abort = new AbortController()
    const timeout = window.setTimeout(() => abort.abort(), 30000)
    let active = true
    setData(null)
    setError('')
    const read = async (url: string) => {
      const response = await fetch(url, { signal: abort.signal })
      if (!response.ok) throw Error('Workflow data unavailable')
      return response.json()
    }
    Promise.all([
      read(workflowUrl),
      read(modelUrl),
      read(new URL('checksums.json', analysisBase).href),
      read(forestUrl),
    ])
      .then(
        ([workflows, models, checksums, forestry]: [
          WorkflowData,
          ModelData,
          Record<string, { sha256: string }>,
          ForestData,
        ]) => {
          if (
            workflows.schema_version !== 1 ||
            models.schema_version !== 1 ||
            forestry.schema_version !== 1 ||
            forestry.source_sha256 !== sourceHash ||
            workflows.source_sha256 !== sourceHash ||
            models.source_sha256 !== sourceHash
          )
            throw Error('Workflow source version mismatch. Results are hidden.')
          for (const [name, hash] of [
            ...Object.entries(workflows.input_sha256),
            ...Object.entries(forestry.input_sha256),
          ])
            if (checksums[name]?.sha256 !== hash) throw Error(`Workflow input mismatch: ${name}. Results are hidden.`)
          if (models.candidate_sha256 !== checksums['building-candidates.geojson']?.sha256)
            throw Error('Model candidate version mismatch')
          if (active) setData({ workflows, models, forestry })
        },
      )
      .catch((e) => {
        if (active) setError(abort.signal.aborted ? 'Workflow request timed out. Retry.' : String(e))
      })
      .finally(() => window.clearTimeout(timeout))
    return () => {
      active = false
      abort.abort()
      window.clearTimeout(timeout)
    }
  }, [enabled, analysisBase, sourceHash, attempt])
  return { data, error, retry: () => setAttempt((n) => n + 1) }
}
