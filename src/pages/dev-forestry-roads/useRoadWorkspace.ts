import type { RoadFeatureSelection } from './roadSelection'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { safeAnalyzeRoad } from './analysisResult'
import { createDemoProject, demoTerrain, terrainFromMetadata } from './terrain'
import { loadRoadScenario } from './scenarios'
import { parseProject } from './project'
import {
  addProject,
  deleteProject,
  readLibrary,
  readProject,
  writeProject,
  writeTraining,
  type LibraryEntry,
} from './projectLibrary'
import type { Alignment, RoadAnalysis, RoadProject, TerrainSource } from './types'

const training = () => new URLSearchParams(location.search).get('example') === 'training'

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
  // The open project's slot in this browser's library; null in training mode, which keeps its own.
  const [projectId, setProjectIdState] = useState<string | null>(null)
  // Saves read the id from a ref, so two quick saves never open two slots.
  const projectIdRef = useRef<string | null>(null)
  const setProjectId = useCallback((id: string | null) => {
    projectIdRef.current = id
    setProjectIdState(id)
  }, [])
  const [library, setLibrary] = useState<LibraryEntry[]>([])
  const libraryRef = useRef(library)
  libraryRef.current = library
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

  /** Opens a project. `id` is its library slot; omit it to keep the project as a new one. */
  const restore = useCallback(
    async (next: RoadProject, signal?: AbortSignal, id: string | null = crypto.randomUUID()) => {
      let terrain = terrainFromMetadata(next.terrain)
      if (!terrain && next.terrain.kind === 'geotiff') {
        const { loadTerrainMetadata } = await import('./terrain')
        terrain = await loadTerrainMetadata(next.terrain, signal)
      }
      if (!terrain && next.terrain.kind === 'regional') {
        const coords = next.alignments.flatMap((a) => a.points.map((p) => p.coordinate))
        const { loadRegionalTerrain } = await import('./terrain')
        // The recorded extent where there is one (older files have none), widened to every road.
        const recorded = next.terrain.bounds
        const loaded = await loadRegionalTerrain(
          [
            Math.min(recorded?.[0] ?? Infinity, ...coords.map((p) => p[0] - 0.001)),
            Math.min(recorded?.[1] ?? Infinity, ...coords.map((p) => p[1] - 0.001)),
            Math.max(recorded?.[2] ?? -Infinity, ...coords.map((p) => p[0] + 0.001)),
            Math.max(recorded?.[3] ?? -Infinity, ...coords.map((p) => p[1] + 0.001)),
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
      if (!training()) setProjectId(id)
      setCanPersist(true)
    },
    [commit, setProjectId],
  )
  /** Makes an already-built project the open one, in a new library slot. */
  const startProject = useCallback(
    (next: RoadProject, terrain: TerrainSource) => {
      setSource(terrain)
      commit(next, false)
      setStation(0)
      setFeatureSelection(null)
      history.current = { past: [], future: [] }
      if (!training()) setProjectId(crypto.randomUUID())
      setCanPersist(true)
    },
    [commit, setProjectId],
  )

  useEffect(() => {
    const controller = new AbortController()
    abort.current = controller
    async function open() {
      try {
        // ?example=training is a deliberate, network-free teaching/testing mode.
        if (training()) {
          setCanPersist(true)
          return
        }
        let saved: RoadProject | undefined, savedId: string | null
        try {
          const stored = await readLibrary()
          setLibrary(stored.entries)
          savedId = stored.entries.some((e) => e.id === stored.activeId)
            ? stored.activeId
            : (stored.entries[0]?.id ?? null)
          saved = savedId ? await readProject(savedId) : undefined
        } catch {
          // A failed read does not establish that this device has no project. In
          // particular, a transient storage failure must not authorize replacing
          // an existing save with the default terrain once storage recovers.
          throw Error(
            'Could not read the locally saved road project. Reopen a project or explicitly choose terrain to recover.',
          )
        }
        if (controller.signal.aborted) return
        if (saved) {
          await restore(parseProject(saved), controller.signal, savedId)
          if (!controller.signal.aborted) setNotice('Restored your locally saved road project.')
        } else {
          const loaded = await loadRoadScenario('bc-lidar', { signal: controller.signal, onProgress: setBusy })
          if (controller.signal.aborted) return
          startProject(loaded.project, loaded.source)
          setNotice(`${loaded.notice} Start your own from Projects → New project.`)
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
  }, [restore, startProject, setBusy])

  const persist = useCallback(
    async (value: RoadProject) => {
      if (training()) return writeTraining(value)
      // Nothing is open after a startup restore failed; the explicit action that enabled saving
      // starts a new slot, so the save that could not be restored is never overwritten.
      let id = projectIdRef.current
      if (!id) {
        id = crypto.randomUUID()
        setProjectId(id)
      }
      setLibrary(await writeProject(id, value, libraryRef.current))
    },
    [setProjectId],
  )
  useEffect(() => {
    if (!ready || !canPersist || busy || error) return
    const timer = window.setTimeout(() => {
      setSaving('Saving locally…')
      try {
        persist(parseProject(project))
          .then(() =>
            setSaving(
              training()
                ? 'Training session saved · reload starts fresh; download to keep edits'
                : 'Saved on this device',
            ),
          )
          .catch(() => setSaving('Local save unavailable — download your project'))
      } catch (cause) {
        setSaving(`Last valid save retained: ${cause instanceof Error ? cause.message : 'correct the current inputs'}`)
      }
    }, 650)
    return () => window.clearTimeout(timer)
  }, [project, ready, canPersist, busy, error, persist])

  /** Saves the open project now, so switching away never loses the last edits. */
  const flush = useCallback(async () => {
    try {
      await persist(parseProject(current.current))
    } catch {
      // An invalid draft keeps its last valid save, as autosave does.
    }
  }, [persist])
  const openProject = useCallback(
    async (id: string, signal?: AbortSignal) => {
      await flush()
      const stored = await readProject(id)
      if (!stored) {
        setLibrary(await deleteProject(id, libraryRef.current))
        throw Error('That project is no longer saved in this browser.')
      }
      const project = parseProject(stored)
      await restore(project, signal, id)
      // Record it as the one to reopen now, not at the next autosave.
      setLibrary(await writeProject(id, project, libraryRef.current))
    },
    [flush, restore],
  )
  const duplicateProject = useCallback(
    async (id: string) => {
      const stored = id === projectId ? current.current : await readProject(id)
      if (!stored) throw Error('That project is no longer saved in this browser.')
      const copy = parseProject({ ...stored, name: `${stored.name} copy`.slice(0, 200) })
      setLibrary(await addProject(crypto.randomUUID(), copy, libraryRef.current))
    },
    [projectId],
  )
  const removeProject = useCallback(
    async (id: string) => {
      if (id === projectId) throw Error('Open another project before deleting this one.')
      setLibrary(await deleteProject(id, libraryRef.current))
    },
    [projectId],
  )

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
    startProject,
    projectId,
    library,
    flush,
    openProject,
    duplicateProject,
    removeProject,
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
