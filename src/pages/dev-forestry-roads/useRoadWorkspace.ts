import type { RoadFeatureSelection } from './roadSelection'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { safeAnalyzeRoad } from './analysisResult'
import { createDemoProject, demoTerrain, loadLidarTerrain, terrainFromMetadata } from './terrain'
import { parseProject } from './project'
import type { Alignment, RoadAnalysis, RoadProject, TerrainSource } from './types'

const DATABASE = 'pgmaps-forestry-roads-v1'
async function storedProject(value?: RoadProject, key = 'current'): Promise<RoadProject | undefined> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('projects')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result,
        transaction = db.transaction('projects', value ? 'readwrite' : 'readonly')
      const operation = value
        ? transaction.objectStore('projects').put(value, key)
        : transaction.objectStore('projects').get(key)
      let result: RoadProject | undefined
      operation.onsuccess = () => {
        if (!value) result = operation.result as RoadProject | undefined
      }
      transaction.oncomplete = () => {
        db.close()
        resolve(result)
      }
      transaction.onerror = () => {
        db.close()
        reject(transaction.error)
      }
    }
  })
}

export function useRoadWorkspace() {
  const [project, setProject] = useState(createDemoProject)
  const current = useRef(project)
  const [source, setSource] = useState<TerrainSource>(demoTerrain)
  const [station, setStation] = useState(0)
  const [featureSelection, setFeatureSelection] = useState<RoadFeatureSelection | null>(null)
  const [busyState, setBusyState] = useState({ message: 'Opening road workspace…', id: 1 })
  const [busyCancel, setBusyCancel] = useState<{ label: string; onCancel: () => void } | null>(null)
  const busy = busyState.message
  const setBusy = useCallback((message: string) => {
    setBusyState((previous) => ({ message, id: previous.id + (!previous.message && message ? 1 : 0) }))
    if (!message) setBusyCancel(null)
  }, [])
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [canPersist, setCanPersist] = useState(false)
  const [saving, setSaving] = useState('')
  const [revision, setRevision] = useState(0)
  const history = useRef<{ past: RoadProject[]; future: RoadProject[] }>({ past: [], future: [] })
  const lastEdit = useRef(0)
  const abort = useRef<AbortController | null>(null)

  const commit = useCallback((next: RoadProject, remember = true) => {
    if (remember && Date.now() - lastEdit.current > 450)
      history.current.past = [...history.current.past.slice(-29), current.current]
    if (remember) {
      history.current.future = []
      lastEdit.current = Date.now()
    }
    current.current = next
    setProject(next)
    setRevision((n) => n + 1)
  }, [])
  const update = useCallback(
    (change: (previous: RoadProject) => RoadProject) => commit(change(current.current)),
    [commit],
  )
  const updateAlignment = useCallback(
    (change: (alignment: Alignment) => Alignment) =>
      update((p) => ({
        ...p,
        alignments: p.alignments.map((a) => (a.id === p.activeAlignmentId ? change(a) : a)),
      })),
    [update],
  )

  const restore = useCallback(
    async (next: RoadProject, signal?: AbortSignal) => {
      let terrain = terrainFromMetadata(next.terrain)
      if (!terrain && next.terrain.kind === 'geotiff') {
        const { loadTerrainMetadata } = await import('./terrain')
        terrain = await loadTerrainMetadata(next.terrain, signal)
      }
      if (!terrain && next.terrain.kind === 'regional') {
        const coords = next.alignments.flatMap((a) => a.points.map((p) => p.coordinate))
        const { loadRegionalTerrain } = await import('./terrain')
        const loaded = await loadRegionalTerrain(
          [
            Math.min(...coords.map((p) => p[0])) - 0.001,
            Math.min(...coords.map((p) => p[1])) - 0.001,
            Math.max(...coords.map((p) => p[0])) + 0.001,
            Math.max(...coords.map((p) => p[1])) + 0.001,
          ],
          signal,
        )
        terrain = loaded.source
        next = { ...next, terrain: loaded.metadata }
      }
      if (!terrain) throw Error('This project needs its original terrain. Import its GeoTIFF before reopening.')
      if (signal?.aborted) return
      setSource(terrain)
      commit(next, false)
      setStation(0)
      history.current = { past: [], future: [] }
      setCanPersist(true)
    },
    [commit],
  )

  useEffect(() => {
    const controller = new AbortController()
    abort.current = controller
    async function open() {
      try {
        const saved = await storedProject().catch(() => undefined)
        if (controller.signal.aborted) return
        // ?example=training is a deliberate, network-free teaching/testing mode.
        if (new URLSearchParams(location.search).get('example') === 'training') {
          setCanPersist(true)
          return
        }
        if (saved) {
          await restore(parseProject(saved), controller.signal)
          if (!controller.signal.aborted) setNotice('Restored your locally saved road project.')
        } else {
          const loaded = await loadLidarTerrain(controller.signal, setBusy)
          if (controller.signal.aborted) return
          setCanPersist(true)
          const alignments = loaded.alignments!
          const initial = createDemoProject()
          setSource(loaded.source)
          commit(
            {
              ...initial,
              name: 'BC LiDAR road planning',
              terrain: loaded.metadata,
              alignments,
              activeAlignmentId: alignments[0].id,
              context: [],
              cables: [],
            },
            false,
          )
        }
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(
            `${cause instanceof Error ? cause.message : 'Could not load terrain.'} The visible terrain is the synthetic training example; your saved project has not been overwritten.`,
          )
      } finally {
        if (!controller.signal.aborted) {
          setBusy('')
          setReady(true)
        }
      }
    }
    void open()
    return () => controller.abort()
  }, [commit, restore, setBusy])

  useEffect(() => {
    if (!ready || !canPersist || busy || error) return
    const timer = window.setTimeout(() => {
      setSaving('Saving locally…')
      const key = new URLSearchParams(location.search).get('example') === 'training' ? 'training' : 'current'
      try {
        const valid = parseProject(project)
        storedProject(valid, key)
          .then(() => setSaving('Saved on this device'))
          .catch(() => setSaving('Local save unavailable — download your project'))
      } catch (cause) {
        setSaving(`Last valid save retained: ${cause instanceof Error ? cause.message : 'correct the current inputs'}`)
      }
    }, 650)
    return () => window.clearTimeout(timer)
  }, [project, ready, canPersist, busy, error])

  // Every edit recalculates every alternative; the time is reported as the cost process time.
  const { analyses, processMs } = useMemo(() => {
    const started = performance.now()
    const analyses = new Map(
      project.alignments.map((a): [string, RoadAnalysis] => [
        a.id,
        safeAnalyzeRoad(a, source, project.settings, project.context),
      ]),
    )
    return { analyses, processMs: performance.now() - started }
  }, [project.alignments, project.settings, project.context, source])
  const alignment = project.alignments.find((a) => a.id === project.activeAlignmentId) ?? project.alignments[0]
  const analysis = analyses.get(alignment.id)!
  const undo = () => {
    const previous = history.current.past.pop()
    if (!previous) return
    const terrain = terrainFromMetadata(previous.terrain)
    if (!terrain) {
      history.current.past.push(previous)
      setError('Reload this terrain before undoing the source change.')
      return
    }
    history.current.future.push(current.current)
    setSource(terrain)
    commit(previous, false)
    lastEdit.current = 0
  }
  const redo = () => {
    const next = history.current.future.pop()
    if (!next) return
    const terrain = terrainFromMetadata(next.terrain)
    if (!terrain) {
      history.current.future.push(next)
      return
    }
    history.current.past.push(current.current)
    setSource(terrain)
    commit(next, false)
    lastEdit.current = 0
  }
  return {
    project,
    source,
    alignment,
    analysis,
    analyses,
    processMs,
    station,
    setStation,
    featureSelection,
    setFeatureSelection,
    commit,
    update,
    updateAlignment,
    restore,
    enablePersistence: () => setCanPersist(true),
    ready,
    setSource,
    busy,
    busyId: busyState.id,
    busyCancel,
    setBusyCancel,
    setBusy,
    notice,
    setNotice,
    error,
    setError,
    saving,
    undo,
    redo,
    canUndo: revision >= 0 && history.current.past.length > 0,
    canRedo: history.current.future.length > 0,
  }
}
export type RoadWorkspace = ReturnType<typeof useRoadWorkspace>
