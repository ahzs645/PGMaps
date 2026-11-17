import { useCallback, useMemo, useState } from 'react'
import { engineeringGeometry } from './engine'
import { calculateCulverts } from './engineering'
import type { DrainageRun } from './drainageRun'
import { DITCH_DETAIL_CELL_M } from './hydrology'
import { createEngineeringDesign } from './engineeringTypes'
import type { Alignment, RoadAnalysis, RoadProject, TerrainSource } from './types'
import {
  acceptedCulverts,
  batchBasis,
  batchStepLabel,
  confirmSides,
  DEFAULT_BATCH_PIPE,
  draftsFromCandidates,
  draftsFromSpacing,
  editDraft,
  previewBatch,
  trialSpacingProblem,
  type BatchPipeDefaults,
  type BatchRow,
  type CrossDrainDraft,
  type TrialSpacing,
} from './crossDrainBatch'
import { draftBarrelFeatures } from './crossDrainBatchPlan'

const uid = () => crypto.randomUUID()

export interface CrossDrainBatch {
  /** Candidate sites ticked in the drainage table. */
  selected: ReadonlySet<string>
  toggle: (id: string) => void
  setSelected: (ids: string[]) => void
  rows: BatchRow[]
  pipe: BatchPipeDefaults
  setPipe: (pipe: BatchPipeDefaults) => void
  previewSelected: () => void
  fillSpacing: (spacing: TrialSpacing) => string | null
  edit: (id: string, patch: Parameters<typeof editDraft>[1]) => void
  confirmAll: () => void
  clear: () => void
  /** Why the batch cannot be added as it stands; null when it can. */
  blocked: string | null
  /** The road or the drainage run changed since the preview was built. */
  changed: boolean
  refresh: () => void
  accept: () => void
  /** Draft barrels on the plan (`crossDrainBatchPlan.ts`). */
  plan: GeoJSON.Feature[]
}

/**
 * The page's state for placing cross-drains in a batch (`crossDrainBatch.ts`): selected candidate
 * sites, the drafts, and a preview checked through the engine on the road as calculated. The batch
 * is added only while the road and drainage run still match what the preview was built on, in one
 * named undo step; the drainage run then reads stale, because its inputs include the culverts.
 */
export function useCrossDrainBatch({
  project,
  alignment,
  calculatedAlignment,
  analysis,
  source,
  run,
  drainageStale,
  drainageFingerprint,
  commit,
  setNotice,
}: {
  project: RoadProject
  alignment: Alignment
  calculatedAlignment: Alignment
  analysis: RoadAnalysis
  source: TerrainSource
  run: DrainageRun | null
  drainageStale: boolean
  drainageFingerprint: string
  /** Commits the project as one named undo step; false when it was refused. */
  commit: (next: RoadProject, label: string) => boolean
  setNotice: (notice: string) => void
}): CrossDrainBatch {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [drafts, setDrafts] = useState<CrossDrainDraft[]>([])
  const [basis, setBasis] = useState<string | null>(null)
  const [pipe, setPipe] = useState<BatchPipeDefaults>(DEFAULT_BATCH_PIPE)
  // Drafts belong to one road; switching roads starts over.
  const [roadId, setRoadId] = useState(alignment.id)
  if (roadId !== alignment.id) {
    setRoadId(alignment.id)
    setSelectedIds([])
    setDrafts([])
    setBasis(null)
  }
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])
  const fromRun = drafts.some((d) => d.origin === 'candidate')
  const currentBasis = useMemo(
    () => batchBasis(alignment, project.settings, fromRun ? drainageFingerprint : null),
    [alignment, project.settings, fromRun, drainageFingerprint],
  )
  const calculate = useMemo(() => {
    const geometry = engineeringGeometry(calculatedAlignment, source)
    return (culverts: Parameters<typeof calculateCulverts>[0]) =>
      calculateCulverts(culverts, calculatedAlignment, analysis, source, geometry)
  }, [calculatedAlignment, analysis, source])
  const existing = useMemo(() => alignment.engineering?.culverts ?? [], [alignment.engineering?.culverts])
  const streamStations = useMemo(
    () => [
      ...(run?.crossings.map((c) => c.chainage) ?? []),
      ...analysis.crossings.filter((c) => c.kind === 'stream').map((c) => c.chainage),
    ],
    [run, analysis.crossings],
  )
  const context = useMemo(
    () => ({
      analysis,
      existing,
      existingResults: analysis.engineering?.culverts ?? [],
      streamStations,
      pipe,
      calculate,
    }),
    [analysis, existing, streamStations, pipe, calculate],
  )
  const rows = useMemo(() => (drafts.length ? previewBatch(drafts, context) : []), [drafts, context])
  const plan = useMemo(() => draftBarrelFeatures(rows), [rows])

  const toggle = useCallback(
    (id: string) => setSelectedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])),
    [],
  )
  const start = (next: CrossDrainDraft[], usesRun: boolean) => {
    setDrafts(next)
    setBasis(batchBasis(alignment, project.settings, usesRun ? drainageFingerprint : null))
  }
  const previewSelected = () => {
    if (!run || drainageStale) return
    const made = draftsFromCandidates(run.lowPoints, selected, {
      screening: run.cellM > DITCH_DETAIL_CELL_M,
      newId: uid,
    })
    // Sites already in the preview keep their rows and edits.
    const kept = drafts.filter((d) => d.origin !== 'candidate' || !made.some((m) => m.siteId === d.siteId))
    const next = [...kept, ...made].sort((a, b) => a.chainage - b.chainage)
    start(
      next,
      next.some((d) => d.origin === 'candidate'),
    )
    setNotice(
      `${made.length} draft culvert${made.length === 1 ? '' : 's'} added to the preview. Confirm each inlet side.`,
    )
  }
  const fillSpacing = (spacing: TrialSpacing) => {
    const problem = trialSpacingProblem(spacing, analysis.length)
    if (problem) return problem
    const made = draftsFromSpacing(spacing, {
      newId: uid,
      groundAtEnds: (draft) => {
        const [r] = previewBatch([{ ...draft, inletSide: 'left' }], { ...context, existing: [], existingResults: [] })
        return r.result ? [r.result.profile[0].groundElevation, r.result.profile.at(-1)!.groundElevation] : [null, null]
      },
    })
    const kept = drafts.filter((d) => d.origin === 'candidate')
    const next = [...kept, ...made].sort((a, b) => a.chainage - b.chainage)
    start(next, kept.length > 0)
    return null
  }
  const edit = (id: string, patch: Parameters<typeof editDraft>[1]) =>
    setDrafts((list) => list.map((d) => (d.id === id ? editDraft(d, patch) : d)))
  const ready = acceptedCulverts(rows)
  const changed = basis !== null && basis !== currentBasis
  const blocked = !rows.length
    ? 'Nothing to add.'
    : alignment !== calculatedAlignment
      ? 'The road has an input that does not calculate; fix it first.'
      : changed
        ? 'The road or the drainage run changed since this preview. Review the rows, then refresh.'
        : fromRun && (drainageStale || !run)
          ? 'The drainage run is out of date. Re-run it, then refresh the preview.'
          : !ready.length
            ? 'No included row is ready: confirm sides and clear the refusals.'
            : null
  const accept = () => {
    if (blocked) return
    // A road with no engineering inputs yet gets the empty design, as the culvert editor does.
    const engineering = alignment.engineering ?? createEngineeringDesign()
    const next: RoadProject = {
      ...project,
      alignments: project.alignments.map((a) =>
        a.id === alignment.id
          ? { ...a, engineering: { ...engineering, culverts: [...engineering.culverts, ...ready] } }
          : a,
      ),
    }
    if (!commit(next, batchStepLabel(ready.length))) return
    const added = new Set(ready.map((c) => c.id))
    setDrafts((list) => list.filter((d) => !added.has(d.id)))
    setSelectedIds([])
    setNotice(
      `${batchStepLabel(ready.length)}: one Undo removes them. The drainage run is now out of date; re-run it to check the new culverts.`,
    )
  }
  return {
    selected,
    toggle,
    setSelected: setSelectedIds,
    rows,
    pipe,
    setPipe,
    previewSelected,
    fillSpacing,
    edit,
    confirmAll: () => setDrafts(confirmSides),
    clear: () => {
      setDrafts([])
      setBasis(null)
    },
    blocked,
    changed,
    refresh: () => setBasis(currentBasis),
    accept,
    plan,
  }
}
