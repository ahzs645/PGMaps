import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { detectDatasets, expandZips, listLayers, readLayer, type DetectedDataset, type LayerInfo, type SourceFile } from './gdal'
import {
  candidatesFromGeoJson,
  guessCandidateFields,
  guessDensityFields,
  type CandidateFields,
  type DensityFields,
} from './inputs'
import type { Candidate } from './types'

export type InputRole = 'candidates' | 'avast' | 'lidar'

export type InputEntry = {
  dataset: DetectedDataset
  role: InputRole
  status: 'reading' | 'ready' | 'error'
  error?: string
  layers: LayerInfo[]
  layer: string
  candidateFields: CandidateFields
  densityFields: DensityFields
}

const isPolygonLayer = (layer: LayerInfo) => !layer.geometryType || /polygon/i.test(layer.geometryType)

/** The layer to start from: AVAST's TimberAnalysis_Base, otherwise the first polygon layer. */
export function defaultLayer(role: InputRole, layers: LayerInfo[]): LayerInfo | undefined {
  const polygons = layers.filter(isPolygonLayer)
  if (role === 'avast') {
    return polygons.find((layer) => layer.name === 'TimberAnalysis_Base')
      ?? polygons.find((layer) => guessDensityFields(layer.fields.map((field) => field.name)).densityField)
      ?? polygons[0]
  }
  if (role === 'lidar') return polygons.find((layer) => guessDensityFields(layer.fields.map((field) => field.name)).densityField) ?? polygons[0]
  return polygons.find((layer) => !/area.?of.?interest/i.test(layer.name)) ?? polygons[0]
}

const EMPTY_CANDIDATE_FIELDS: CandidateFields = { idField: '', operatingAreaField: null, areaField: null, sourceTypeField: null }
const EMPTY_DENSITY_FIELDS: DensityFields = { densityField: '', slopeField: null, operatingAreaField: null }

let datasetCounter = 0

export function useAvastInputs() {
  const [entries, setEntries] = useState<InputEntry[]>([])
  const entriesRef = useRef(entries)
  useEffect(() => { entriesRef.current = entries }, [entries])

  const update = useCallback((id: string, patch: Partial<InputEntry> | ((entry: InputEntry) => Partial<InputEntry>)) => {
    setEntries((current) => current.map((entry) => entry.dataset.id === id
      ? { ...entry, ...(typeof patch === 'function' ? patch(entry) : patch) }
      : entry))
  }, [])

  const setLayer = useCallback((id: string, layerName: string) => {
    update(id, (entry) => {
      const layer = entry.layers.find((item) => item.name === layerName)
      const fields = layer?.fields.map((field) => field.name) ?? []
      return { layer: layerName, candidateFields: guessCandidateFields(fields), densityFields: guessDensityFields(fields) }
    })
  }, [update])

  const addFiles = useCallback(async (role: InputRole, files: SourceFile[]) => {
    datasetCounter += 1
    const detected = await expandZips(detectDatasets(files, `${role}${datasetCounter}`))
    if (!detected.length) return 0
    const added: InputEntry[] = detected.map((dataset) => ({
      dataset, role, status: 'reading', layers: [], layer: '',
      candidateFields: EMPTY_CANDIDATE_FIELDS, densityFields: EMPTY_DENSITY_FIELDS,
    }))
    setEntries((current) => [...current, ...added])
    const all = [...entriesRef.current.map((entry) => entry.dataset), ...detected]
    for (const dataset of detected) {
      try {
        const layers = await listLayers(all, dataset)
        const layer = defaultLayer(role, layers)
        const fields = layer?.fields.map((field) => field.name) ?? []
        update(dataset.id, {
          status: layer ? 'ready' : 'error',
          error: layer ? undefined : 'No polygon layer found.',
          layers,
          layer: layer?.name ?? '',
          candidateFields: guessCandidateFields(fields),
          densityFields: guessDensityFields(fields),
        })
      } catch (error) {
        update(dataset.id, { status: 'error', error: error instanceof Error ? error.message : String(error) })
      }
    }
    return detected.length
  }, [update])

  const remove = useCallback((id: string) => {
    setEntries((current) => current.filter((entry) => entry.dataset.id !== id))
  }, [])

  const datasets = useMemo(() => entries.map((entry) => entry.dataset), [entries])
  return { entries, datasets, addFiles, remove, update, setLayer }
}

type CandidateCache = Map<string, Promise<GeoJSON.FeatureCollection>>

/** Candidate polygons from every candidate input, re-mapped in memory when a field choice changes. */
export function useCandidates(entries: InputEntry[], datasets: DetectedDataset[]) {
  const cache = useRef<CandidateCache>(new Map())
  const [state, setState] = useState<{ candidates: Candidate[]; loading: boolean; error: string | null; skipped: number }>({
    candidates: [], loading: false, error: null, skipped: 0,
  })
  const ready = entries.filter((entry) => entry.role === 'candidates' && entry.status === 'ready' && entry.layer)
  const signature = JSON.stringify(ready.map((entry) => [entry.dataset.id, entry.layer, entry.candidateFields]))
  const datasetsRef = useRef(datasets)
  useEffect(() => { datasetsRef.current = datasets }, [datasets])

  useEffect(() => {
    let cancelled = false
    if (!ready.length) {
      setState({ candidates: [], loading: false, error: null, skipped: 0 })
      return
    }
    setState((current) => ({ ...current, loading: true, error: null }))
    ;(async () => {
      const candidates: Candidate[] = []
      let skipped = 0
      for (const entry of ready) {
        const key = `${entry.dataset.id}:${entry.layer}`
        let pending = cache.current.get(key)
        if (!pending) {
          pending = readLayer(datasetsRef.current, entry.dataset, entry.layer, { fields: [] })
          cache.current.set(key, pending)
          pending.catch(() => cache.current.delete(key))
        }
        const collection = await pending
        const result = candidatesFromGeoJson(collection, entry.candidateFields, entry.dataset.label, entry.dataset.id)
        candidates.push(...result.candidates)
        skipped += result.skipped
      }
      if (!cancelled) setState({ candidates, loading: false, error: null, skipped })
    })().catch((error) => {
      if (!cancelled) setState({ candidates: [], loading: false, error: error instanceof Error ? error.message : String(error), skipped: 0 })
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  return state
}
