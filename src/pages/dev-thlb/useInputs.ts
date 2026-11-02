import { useCallback, useMemo, useRef, useState } from 'react'
import {
  detectDatasets,
  expandZips,
  listLayers,
  type DetectedDataset,
  type LayerInfo,
  type SourceFile,
} from '../dev-avast/gdal'
import { EMPTY_FIELDS, guessFields } from './inputs'
import type { Fields, InputRole } from './types'

export type InputEntry = {
  dataset: DetectedDataset
  role: InputRole
  layers: LayerInfo[]
  layer: string
  fields: Fields
  status: 'reading' | 'ready' | 'error'
  error?: string
}
let counter = 0

export function useInputs() {
  const [entries, setEntries] = useState<InputEntry[]>([])
  const datasetsRef = useRef<DetectedDataset[]>([])
  const [pending, setPending] = useState(0)
  const update = useCallback((id: string, patch: Partial<InputEntry>) => {
    setEntries((current) => current.map((entry) => (entry.dataset.id === id ? { ...entry, ...patch } : entry)))
  }, [])
  const add = useCallback(
    async (role: InputRole, files: SourceFile[]) => {
      setPending((value) => value + 1)
      try {
        const detected = await expandZips(detectDatasets(files, `thlb-${++counter}`))
        if (!detected.length)
          throw new Error(
            'No vector dataset found. Choose a GeoJSON, GeoPackage, shapefile, zipped dataset, or .gdb folder.',
          )
        datasetsRef.current = [...datasetsRef.current, ...detected]
        setEntries((current) => [
          ...current,
          ...detected.map(
            (dataset): InputEntry => ({
              dataset,
              role,
              layers: [],
              layer: '',
              fields: EMPTY_FIELDS,
              status: 'reading',
            }),
          ),
        ])
        for (const dataset of detected) {
          try {
            const layers = (await listLayers(datasetsRef.current, dataset)).filter(
              (layer) => !layer.geometryType || /polygon/i.test(layer.geometryType),
            )
            const layer =
              layers.find((item) => {
                const fields = guessFields(
                  role,
                  item.fields.map((field) => field.name),
                )
                return role === 'official' || role === 'proxy' ? !!fields.factor : role === 'vri' ? !!fields.age : true
              }) ?? layers[0]
            if (!layer) throw new Error('No polygon layer found.')
            update(dataset.id, {
              layers,
              layer: layer.name,
              fields: guessFields(
                role,
                layer.fields.map((field) => field.name),
              ),
              status: 'ready',
            })
          } catch (error) {
            update(dataset.id, { status: 'error', error: error instanceof Error ? error.message : String(error) })
          }
        }
      } finally {
        setPending((value) => value - 1)
      }
    },
    [update],
  )
  const remove = useCallback((id: string) => {
    datasetsRef.current = datasetsRef.current.filter((dataset) => dataset.id !== id)
    setEntries((current) => current.filter((entry) => entry.dataset.id !== id))
  }, [])
  const setLayer = useCallback(
    (entry: InputEntry, name: string) => {
      const layer = entry.layers.find((item) => item.name === name)
      update(entry.dataset.id, {
        layer: name,
        fields: guessFields(entry.role, layer?.fields.map((field) => field.name) ?? []),
      })
    },
    [update],
  )
  const datasets = useMemo(() => entries.map((entry) => entry.dataset), [entries])
  return { entries, datasets, add, remove, update, setLayer, pending }
}
