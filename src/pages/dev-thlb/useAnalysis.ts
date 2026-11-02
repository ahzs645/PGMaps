import { useCallback, useEffect, useRef, useState } from 'react'
import { clusterBoxes } from '../dev-avast/geometry'
import { readLayer } from '../dev-avast/gdal'
import { parsePolygons } from './inputs'
import { exampleInput } from './example'
import type { InputEntry } from './useInputs'
import type { AnalysisInput, AnalysisResult, Settings } from './types'
import type { Response } from './thlb.worker'

export function inputSignature(entries: InputEntry[], settings: Settings) {
  return JSON.stringify({
    entries: entries.map((entry) => [entry.dataset.id, entry.status, entry.layer, entry.fields]),
    settings,
  })
}

export function useAnalysis() {
  const [state, setState] = useState<{
    busy: boolean
    message: string
    error: string | null
    result: AnalysisResult | null
    signature: string
  }>({ busy: false, message: '', error: null, result: null, signature: '' })
  const generation = useRef(0)
  const worker = useRef<Worker | null>(null)
  useEffect(
    () => () => {
      generation.current++
      worker.current?.terminate()
    },
    [],
  )
  const cancel = useCallback(() => {
    generation.current++
    worker.current?.terminate()
    worker.current = null
    setState((current) => ({ ...current, busy: false, message: 'Run cancelled.' }))
  }, [])
  const run = useCallback(async (entries: InputEntry[], settings: Settings) => {
    const token = ++generation.current
    worker.current?.terminate()
    const signature = inputSignature(entries, settings)
    setState({ busy: true, message: 'Reading assessment polygons…', error: null, result: null, signature })
    try {
      let input: AnalysisInput
      if (settings.demo) input = exampleInput()
      else {
        input = {
          areas: [],
          official: [],
          proxy: [],
          vri: [],
          deferral: [],
          admin: [],
          assessedRoles: entries.map((entry) => entry.role),
          suppliedSources: [],
        }
        const datasets = entries.map((entry) => entry.dataset)
        const ordered = [
          ...entries.filter((entry) => entry.role === 'areas'),
          ...entries.filter((entry) => entry.role !== 'areas'),
        ]
        for (const entry of ordered) {
          if (token !== generation.current) return
          if (entry.status !== 'ready') throw new Error(`Finish loading or remove ${entry.dataset.label}.`)
          if ((entry.role === 'official' || entry.role === 'proxy') && !entry.fields.factor)
            throw new Error(`Choose a factor field for ${entry.dataset.label}.`)
          if (entry.role === 'areas' && !entry.fields.id)
            throw new Error(`Choose an assessment ID field for ${entry.dataset.label}.`)
          if (entry.role === 'vri' && !entry.fields.age)
            throw new Error(`Choose an age field for ${entry.dataset.label}.`)
          if (entry.role === 'admin' && !entry.fields.name)
            throw new Error(`Choose a name field for ${entry.dataset.label}.`)
          const boxes =
            entry.role === 'areas'
              ? undefined
              : clusterBoxes(
                  input.areas.map((area) => area.bbox),
                  1,
                )
          if (entry.role !== 'areas' && !input.areas.length) throw new Error('Add assessment polygons first.')
          setState((current) => ({ ...current, message: `Reading ${entry.dataset.label} near the assessment areas…` }))
          const collection = await readLayer(datasets, entry.dataset, entry.layer, {
            fields: [...new Set(Object.values(entry.fields).filter(Boolean))],
            boxes,
          })
          if (token !== generation.current) return
          const name = `${entry.dataset.label} / ${entry.layer}`
          input[entry.role].push(...parsePolygons(collection, entry.role, entry.fields, name))
          input.suppliedSources!.push({
            role: entry.role,
            name,
            features: collection.features.length,
            fields: { ...entry.fields },
          })
        }
      }
      if (token !== generation.current) return
      setState((current) => ({ ...current, message: 'Intersecting polygons and reconciling hectares…' }))
      const active = new Worker(new URL('./thlb.worker.ts', import.meta.url), { type: 'module' })
      worker.current = active
      active.onmessage = (event: MessageEvent<Response>) => {
        active.terminate()
        if (token !== generation.current) return
        worker.current = null
        if ('error' in event.data)
          setState({ busy: false, message: '', error: event.data.error, result: null, signature })
        else setState({ busy: false, message: 'Analysis complete.', error: null, result: event.data.result, signature })
      }
      active.onerror = (event) => {
        active.terminate()
        if (token === generation.current)
          setState({
            busy: false,
            message: '',
            error: event.message || 'Analysis worker failed.',
            result: null,
            signature,
          })
      }
      active.postMessage({ input, settings })
    } catch (error) {
      if (token === generation.current)
        setState({
          busy: false,
          message: '',
          error: error instanceof Error ? error.message : String(error),
          result: null,
          signature,
        })
    }
  }, [])
  return { ...state, run, cancel }
}
