import type { ElevationSource } from '@/lib/forestry/terrain/terrain'
import { adoptViewLandform } from './viewLandform'
import { DEFAULT_VISUAL_QUALITY_CLASS_ID } from './vqo'
import { withDrawnMask } from './assessmentMasks'
import { treatmentTargets } from './referenceTreatment'
import { chosenValues } from './referenceMeasurements'
import type { ReferenceCapture } from './referenceComparison'
import { ReferenceMeasurements } from './ReferenceMeasurementsPanel'
import { importReferenceCase, mergeReferences, readReferenceCase } from './referenceMeasurements'
import type { ProjectAttachment } from './projectArchive'
import {
  CheckboxField,
  FORM_INPUT_CLASS,
  FormField,
  StyledSelect,
  NullableNumberField,
  NumberField,
} from '@/components/ui/form-field'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ToolSection } from '@/components/ui/tool-section'
import { Button } from '@/components/ui/button'
import { FileButton } from '@/components/ui/file-button'
import { formatMeasure } from '@/lib/format'
import { InlineAlert } from '@/components/ui/map-panels'
import { FieldRecordDialog, ToolFieldPanel } from './ToolFieldPanel'
import { importFieldImage } from './toolImports'
import { formatPct } from './measureFormat'
import { DIAGNOSTIC_LABEL, runFigures, withheldText } from './runFigures'
import { SightlineProfileChart } from './SightlineProfileChart'
import { createId, type ForestryScene } from './scene'
import {
  comparisonScene,
  earlierToolViews,
  emptyTools,
  greenUpJobs,
  greenUpSensitiveOpenings,
  greenUpSensitivityAges,
  matrixJobs,
  parseGrowthCurve,
  parseTools,
  serializeTools,
  stabilityJobs,
  summarizeRun,
  timelineScene,
  withPlannedViews,
  type FieldRecord,
  type PhotoJob,
  type ToolJob,
  type ToolRun,
  type ToolsDocument,
  type ToolView,
} from './assessmentTools'
import { loadTools, saveTools } from './toolsStorage'
import { useToolRunner } from './useToolRunner'
import { buildEvidenceHtml, evidenceGaps, evidencePdfBlob } from './toolEvidence'
import type { AnalysisResult, Viewpoint } from './types'
import type { SightlineProfile } from './sightlineProfile'
import { RunRevisionReadout, useRunRevision } from './RunRevisionReadout'
import { readCastorHeightCurves, type LibraryCurve } from './castorCurves'
import { RecoveryTable } from './RecoveryTable'
import { greenUpSensitiveSentence } from './recoverySummary'
import { DroughtRiskPanel } from './DroughtRiskPanel'
import type { PhotoInputs } from './ReferenceRegistration'
import type { SightlineArchive } from './ReferenceRunPanel'
import { buildSceneInput, findSceneLandform, sceneFingerprint } from './sceneInput'
import { fieldRecordRoom, linkPhotoJob, unlinkPhotoJob, withFlights } from './photoRecords'

type Props = {
  referenceTerrain: ElevationSource | null
  referenceCaptures: ReferenceCapture[]
  projectAttachments: ProjectAttachment[]
  onAttachCase: (file: File) => void
  /** A sheet camera confirmed in Reference measurements, handed to the own photo window for that photo record. */
  onLineUpInOwnPhoto: PhotoInputs['lineUpInOwnPhoto']
  /** Opens Save & export on the sightline replay archive. */
  onSaveSightlineArchive?: () => void
  scene: ForestryScene
  result: AnalysisResult | null
  currentStation: number
  onChange: (scene: ForestryScene) => void
  onRun: (scene: ForestryScene) => void
  analysisRunning: boolean
  onImportScene: (scene: ForestryScene) => void
  /** A photo's original bytes, kept as a project attachment beside the field record it became. */
  onOriginalPhoto: (file: File, recordId: string) => void
  /** The views of interest as viewpoints (`plannedToolViews`): what runs and evidence are filed under. */
  plannedViews: ToolView[]
  /** Lists a view of interest at a photo's place and returns its id; null when it cannot. */
  onAddViewAt?: (point: { lng: number; lat: number }, name: string) => string | null
  /** Lists a viewpoint recorded before the views of interest with them, under its own id; null when it cannot. */
  onListView?: (view: ToolView) => string | null
  /** Removes a photo record with its original and any view's link to it (`useFieldPhoto`'s `removePhoto`). */
  onRemovePhoto?: (id: string) => void
}
/** The record's camera: changing any of them unchecks its alignment. */
const CAMERA_FIELDS: ReadonlyArray<keyof FieldRecord> = ['lng', 'lat', 'altitude', 'bearing', 'pitch', 'roll', 'hfov']
/** A loaded curve's span, for its option label: ages covered and the height it reaches. */
const curveReach = (c: LibraryCurve) =>
  `ages ${c.points[0].age}–${c.points[c.points.length - 1].age}, ${c.points[c.points.length - 1].height.toFixed(1)} m`
const hectares = (value: number) => formatMeasure(value, 'ha', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function useAssessmentTools({
  referenceTerrain,
  referenceCaptures,
  projectAttachments,
  onAttachCase,
  onLineUpInOwnPhoto,
  onSaveSightlineArchive,
  scene,
  result,
  currentStation,
  onChange,
  onRun,
  analysisRunning,
  onImportScene,
  onOriginalPhoto,
  plannedViews,
  onAddViewAt,
  onListView,
  onRemovePhoto,
}: Props) {
  // The run retained in Reference measurements: this session only, saved through Save & export, never the project.
  const [sightlineArchive, setSightlineArchive] = useState<SightlineArchive | null>(null)
  const [d, setDocument] = useState<ToolsDocument>(emptyTools),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState<string | null>(null)
  const [optionName, setOptionName] = useState(''),
    [selectedViews, setSelectedViews] = useState<string[]>([]),
    [selectedLandforms, setSelectedLandforms] = useState<string[]>([])
  const [years, setYears] = useState(
      `${scene.assessmentYear ?? new Date().getFullYear()}, ${(scene.assessmentYear ?? new Date().getFullYear()) + 10}`,
    ),
    [curve, setCurve] = useState(''),
    [curveNote, setCurveNote] = useState<{ text: string; skipped: string[] } | null>(null),
    [openedRun, setOpenedRun] = useState<string | null>(null),
    [reportView, setReportView] = useState('')
  const [profile, setProfile] = useState<SightlineProfile | null>(null),
    [inspectTarget, setInspectTarget] = useState(''),
    [inspectIndex, setInspectIndex] = useState(0),
    [inspectStation, setInspectStation] = useState(0)
  const documentRef = useRef(d),
    saveQueue = useRef(Promise.resolve()),
    workspaceChanged = useRef(false),
    workspaceGeneration = useRef(0)
  documentRef.current = d
  // Every viewpoint as the tools read it: the views of interest, then any recorded before them.
  const viewsDocument = useMemo(() => withPlannedViews(d, plannedViews), [d, plannedViews])
  const plannedRef = useRef(plannedViews)
  plannedRef.current = plannedViews
  const [selectedField, setSelectedField] = useState<string | null>(null),
    [fieldBusy, setFieldBusy] = useState(false),
    [fieldError, setFieldError] = useState<string | null>(null)
  const key = useMemo(() => sceneFingerprint(scene), [scene]),
    runner = useToolRunner(key)
  // The previous run's headline beside this one's, after a boundary edit or an applied design.
  const revisionReadout = useRunRevision(result, scene, d.options)
  const { cancel: cancelTools, run: runTools } = runner
  useEffect(() => {
    let active = true
    loadTools()
      .then((next) => {
        if (active && !workspaceChanged.current) {
          setDocument(next)
          setCurve(next.growthCurve.map((p) => `${p.age},${p.height}`).join('\n'))
        }
      })
      .catch((e) => {
        if (active) setError(`Stored workspace could not be loaded: ${String(e)}. Import your backup to recover it.`)
      })
      .finally(() => {
        if (active) setLoaded(true)
      })
    return () => {
      active = false
    }
  }, [])
  useEffect(() => {
    setProfile(null)
  }, [key])
  useEffect(() => {
    if (analysisRunning) cancelTools()
  }, [analysisRunning, cancelTools])
  const change = useCallback((update: ToolsDocument | ((current: ToolsDocument) => ToolsDocument)) => {
    workspaceChanged.current = true
    const next = typeof update === 'function' ? update(documentRef.current) : update
    setDocument(next)
    documentRef.current = next
    saveQueue.current = saveQueue.current
      .catch(() => {})
      .then(() => saveTools(next))
      .catch((e) => setError(`Local storage failed: ${String(e)}. Export the workspace to preserve edits.`))
  }, [])
  const perform = (action: () => void) => {
    setError(null)
    try {
      action()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  const complete = (runs: ToolRun[]) => {
    change({ ...documentRef.current, runs })
    setOpenedRun(null)
  }
  const run = (jobs: ToolJob[]) => {
    if (analysisRunning) throw new Error('Wait for or cancel the current scene analysis before starting a batch.')
    void runner.run(jobs, complete)
  }
  const toggle = (ids: string[], id: string) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])
  const onUseView = (viewpoint: Viewpoint) => onChange({ ...scene, viewpoint })
  const inspect = useCallback(
    (targetId: string, sampleIndex: number, stationIndex: number) => {
      if (!result || analysisRunning) return
      setInspectTarget(targetId)
      setInspectIndex(sampleIndex)
      setInspectStation(stationIndex)
      setProfile(null)
      void runTools(
        [{ id: 'inspection', name: 'Sightline inspection', kind: 'stability', scene: structuredClone(scene) }],
        () => {},
        { targetId, sampleIndex, stationIndex },
        (next) => setProfile(next.sightlineProfile ?? null),
      )
    },
    [result, analysisRunning, scene, runTools],
  )
  const record = () => {
    if (!result) throw new Error('Run the current scene before recording its assessment.')
    const existing = d.runs.find((r) => r.id === openedRun)
    if (existing && sceneFingerprint(existing.scene) !== key)
      throw new Error('The opened assessment has changed. Record it as a new assessment instead.')
    const next: ToolRun = {
      ...(existing ?? {
        id: createId('assessment'),
        name: optionName.trim() || scene.viewpoint.name,
        kind: 'matrix' as const,
      }),
      viewId: existing?.viewId ?? (reportView || undefined),
      scene: structuredClone(scene),
      summary: summarizeRun(scene, result),
      error: null,
      generatedAt: new Date().toISOString(),
    }
    if (!existing && d.runs.length >= 12)
      throw new Error('Remove an assessment before recording another, or export this workspace first.')
    change({ ...d, runs: existing ? d.runs.map((r) => (r.id === existing.id ? next : r)) : [...d.runs, next] })
    setOpenedRun(next.id)
  }
  const importWorkspace = async (file: File) => {
    setError(null)
    try {
      if (file.size > 100_000_000) throw new Error('Workspace exceeds 100 MB.')
      const read = parseTools(JSON.parse(await file.text()))
      // The export carries its scene's views of interest as viewpoints too; the scene brings them back as views.
      const listed = new Set((read.currentScene?.viewsOfInterest ?? []).map((view) => view.id))
      const parsed = { ...read, views: read.views.filter((view) => !listed.has(view.id)) }
      runner.cancel()
      workspaceGeneration.current++
      change(parsed)
      if (parsed.currentScene) onImportScene(parsed.currentScene)
      setCurve(parsed.growthCurve.map((p) => `${p.age},${p.height}`).join('\n'))
      setOpenedRun(null)
      setSelectedViews([])
      setSelectedLandforms([])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  /** Replaces the loaded curve library with a Castor file's height–age curves; assignments to vanished curves go. */
  const loadCastorCurves = async (file: File) => {
    setError(null)
    setCurveNote(null)
    try {
      if (file.size > 64 * 1024 * 1024) throw new Error('A Castor file over 64 MB is too large to read here.')
      // Castor's readers load only when a file is chosen, so they stay out of this page's bundle.
      const [{ castorCsvRows }, { parseCastorSession }] = await Promise.all([
        import('@/features/forestry-castor/inputs'),
        import('@/features/forestry-castor/persistence'),
      ])
      const read = readCastorHeightCurves(file.name, await file.text(), {
        csvRows: castorCsvRows,
        projectYields: (text) => parseCastorSession(text).project.yieldCurves,
      })
      if (!read.curves.length)
        throw new Error(`No usable height–age curve in ${file.name}. ${read.skipped.slice(0, 3).join(' ')}`)
      const ids = new Set(read.curves.map((c) => c.id))
      change((current) => ({
        ...current,
        curveLibrary: read.curves,
        blockCurves: Object.fromEntries(Object.entries(current.blockCurves).filter(([, id]) => ids.has(id))),
      }))
      setCurveNote({
        text: `Loaded ${read.curves.length} height–age curve${read.curves.length === 1 ? '' : 's'} from ${file.name}.`,
        skipped: read.skipped,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  const curveById = useMemo(() => new Map(d.curveLibrary.map((c) => [c.id, c])), [d.curveLibrary])
  const greenUpAges = greenUpSensitivityAges(scene.settings.greenUpAgeYears)
  const sensitiveOpenings = greenUpSensitiveOpenings(
    scene,
    greenUpAges,
    scene.assessmentYear ?? new Date().getFullYear(),
  )
  const message = (
    <>
      {!loaded && <InlineAlert>Loading saved assessment workspace…</InlineAlert>}
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      {runner.error && <InlineAlert tone="error">{runner.error}</InlineAlert>}
      {runner.running && (
        <InlineAlert loading>
          <p>{runner.progress || 'Starting analysis…'}</p>
          <Button size="sm" variant="outline" className="mt-2 touch:h-10" onClick={runner.cancel}>
            Cancel tool run
          </Button>
        </InlineAlert>
      )}
    </>
  )
  const busy = !loaded || runner.running || analysisRunning
  /** Imports an image as an attachment, filed under `viewId` when that is a viewpoint, and opens it. */
  const importField = async (file: File, kind: FieldRecord['kind'], viewId: string | null = null) => {
    const full = fieldRecordRoom(documentRef.current.fields.length, 1)
    if (full) {
      setFieldError(full)
      return
    }
    setFieldBusy(true)
    setFieldError(null)
    const generation = workspaceGeneration.current
    try {
      const f = await importFieldImage(file, kind, viewId)
      if (generation !== workspaceGeneration.current) return
      const latest = documentRef.current
      const over = fieldRecordRoom(latest.fields.length, 1)
      if (over) throw new Error(over)
      if (!withPlannedViews(latest, plannedRef.current).views.some((v) => v.id === f.viewId)) f.viewId = null
      change({ ...latest, fields: withFlights([...latest.fields, f]) })
      if (kind === 'photo') onOriginalPhoto(file, f.id)
      setSelectedField(f.id)
    } catch (e) {
      setFieldError(e instanceof Error ? e.message : String(e))
    } finally {
      setFieldBusy(false)
    }
  }
  const field = (
    <>
      {loaded && (
        <ToolFieldPanel
          document={d}
          onChange={change}
          earlier={earlierToolViews(d, plannedViews)}
          onOpen={setSelectedField}
          onImport={(file, kind) => void importField(file, kind)}
          busy={fieldBusy || busy}
          error={fieldError}
          onUseView={onUseView}
          onRemovePhoto={onRemovePhoto}
          onListView={
            onListView &&
            ((view) => {
              // Listed under its own id, so its photographs and runs follow; the workspace's copy goes.
              const id = onListView(view)
              if (id) change((current) => ({ ...current, views: current.views.filter((v) => v.id !== view.id) }))
              return id
            })
          }
        />
      )}
    </>
  )
  /** The attachment dialog, rendered beside the sidebar's sections so a folded section never closes it. */
  const fieldDialog = (
    <FieldRecordDialog
      document={d}
      onChange={change}
      views={viewsDocument.views}
      result={result}
      selected={selectedField}
      onClose={() => setSelectedField(null)}
      onAddViewAt={onAddViewAt}
    />
  )
  const design = (
    <>
      {message}
      <ToolSection
        summary=""
        toggleProps={{ 'data-forestry-disclosure': '' }}
        title="Saved design alternatives"
        help="Alternatives supply proposed blocks and retained patches. Every run uses the same current landform, existing openings, surfaces, settings and station. Complete reviewer ratings separately in step 4."
        defaultOpen
      >
        <div className="space-y-2 text-xs">
          <FormField label="Design alternative name">
            <input className={FORM_INPUT_CLASS} value={optionName} onChange={(e) => setOptionName(e.target.value)} />
          </FormField>
          <Button
            size="sm"
            variant="outline"
            disabled={!loaded || d.options.length >= 12 || !optionName.trim()}
            onClick={() =>
              change({
                ...d,
                options: [
                  ...d.options,
                  { id: createId('option'), name: optionName.trim(), scene: structuredClone(scene) },
                ],
              })
            }
          >
            Save current design alternative
          </Button>
          {d.options.map((o) => (
            <div className="space-y-1 border-b py-2" key={o.id}>
              <p className="font-medium">{o.name}</p>
              <div className="flex flex-wrap gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => onChange(comparisonScene(scene, o.scene))}
                >
                  Apply design
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    change({
                      ...d,
                      options: d.options.map((v) => (v.id === o.id ? { ...v, scene: structuredClone(scene) } : v)),
                    })
                  }
                >
                  Update saved design
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => change({ ...d, options: d.options.filter((v) => v.id !== o.id) })}
                >
                  Remove {o.name}
                </Button>
              </div>
            </div>
          ))}
          <Button
            size="sm"
            disabled={busy || !d.options.length || !result}
            onClick={() =>
              perform(() => {
                const station = result!.stations[currentStation] ?? result!.stations[result!.assessmentStationIndex]
                const base = {
                  ...scene,
                  viewpoint: {
                    ...scene.viewpoint,
                    mode: 'spot' as const,
                    coordinates: [[station.lng, station.lat] as [number, number]],
                  },
                }
                run(
                  d.options.map((o) => ({
                    id: createId('comparison'),
                    name: o.name,
                    kind: 'comparison',
                    scene: comparisonScene(base, o.scene),
                  })),
                )
              })
            }
          >
            Compare designs at current station
          </Button>
        </div>
      </ToolSection>
      <ToolSection
        summary=""
        toggleProps={{ 'data-forestry-disclosure': '' }}
        title="Viewpoint and landform matrix"
        help={
          <>
            <span className="block">
              Select significant viewpoints recorded in step 2 and reviewed landforms. Each pair has its own denominator
              and worst station; values are never pooled across landforms.
            </span>
            <span className="mt-1.5 block">
              Maximum 12 jobs per batch. A completed batch replaces the previous result set; export important runs
              first.
            </span>
          </>
        }
      >
        <div className="space-y-2 text-xs">
          {viewsDocument.views.map((v) => (
            <CheckboxField
              key={v.id}
              label={v.name}
              checked={selectedViews.includes(v.id)}
              onCheckedChange={() => setSelectedViews(toggle(selectedViews, v.id))}
            />
          ))}
          {!viewsDocument.views.length && <p>Add a view of interest in step 2 first.</p>}
          {scene.targets
            .filter((t) => t.role === 'landscape')
            .map((t) => (
              <CheckboxField
                key={t.id}
                label={t.name}
                checked={selectedLandforms.includes(t.id)}
                onCheckedChange={() => setSelectedLandforms(toggle(selectedLandforms, t.id))}
              />
            ))}
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              perform(() =>
                run(
                  matrixJobs(
                    scene,
                    viewsDocument.views.filter((v) => selectedViews.includes(v.id)),
                    selectedLandforms,
                  ),
                ),
              )
            }
          >
            Run independent assessments
          </Button>
        </div>
      </ToolSection>
      <ToolSection
        summary=""
        toggleProps={{ 'data-forestry-disclosure': '' }}
        title="Sampling and screening sensitivity"
        help="Compare finer area sampling, closer stations, eye height ±0.5 m, and screening toggled against the baseline. These comparisons reveal dependence on assumptions; they are not confidence intervals."
      >
        <div className="space-y-2 text-xs">
          <Button size="sm" disabled={busy} onClick={() => perform(() => run(stabilityJobs(scene)))}>
            Run sensitivity comparisons
          </Button>
        </div>
      </ToolSection>
      <ToolSection
        summary=""
        toggleProps={{ 'data-forestry-disclosure': '' }}
        title="Harvest scheduling and recovery"
        help={
          <>
            <span className="block">
              Each year is an independent scenario. Before its scheduled year a proposal is omitted; during that year it
              is proposed alteration; afterward it becomes an existing opening. The supplied height–age curve controls
              green-up accounting. Screening uses current canopy assumptions, not a simulated future stand.
            </span>
            <span className="mt-1.5 block">
              A block grows on its own curve when you give it one from a Castor yield table, else on the supplied curve.
              Outside a curve’s recorded ages, the scene’s stated green-up-age assumption applies.
            </span>
            <span className="mt-1.5 block">
              A partial cut harvested in an earlier year keeps its Table 6 figure (volume removed against residual
              height, as recorded) until the same green-up test says the regeneration in its gaps has reached green-up
              height; then it counts nothing. Its residual trees are not grown, because Table 6 rises with residual
              height.
            </span>
          </>
        }
      >
        <div className="space-y-2 text-xs">
          {scene.targets
            .filter((t) => t.role === 'block')
            .map((t) => (
              <div key={t.id} className="space-y-1.5" data-recovery-block={t.id}>
                <NullableNumberField
                  label={`Planned harvest year for ${t.name}`}
                  min={1900}
                  max={2200}
                  value={t.plannedHarvestYear ?? null}
                  onValueChange={(plannedHarvestYear) =>
                    onChange({
                      ...scene,
                      targets: scene.targets.map((v) => (v.id === t.id ? { ...v, plannedHarvestYear } : v)),
                    })
                  }
                />
                {!!d.curveLibrary.length && (
                  <FormField label={`Height–age curve for ${t.name}`}>
                    <StyledSelect
                      value={d.blockCurves[t.id] ?? ''}
                      onChange={(e) =>
                        change((current) => {
                          const next = { ...current.blockCurves }
                          if (e.target.value) next[t.id] = e.target.value
                          else delete next[t.id]
                          return { ...current, blockCurves: next }
                        })
                      }
                    >
                      <option value="">Supplied curve below</option>
                      {d.curveLibrary.map((c) => (
                        <option key={c.id} value={c.id}>
                          Castor curve {c.label} · {curveReach(c)}
                        </option>
                      ))}
                    </StyledSelect>
                  </FormField>
                )}
              </div>
            ))}
          <div className="flex flex-wrap items-center gap-2">
            <FileButton
              label="Load Castor yield curves"
              accept=".csv,.json"
              disabled={busy}
              onFiles={([file]) => void loadCastorCurves(file)}
            >
              Load Castor yield curves
            </FileButton>
            {!!d.curveLibrary.length && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  change((current) => ({ ...current, curveLibrary: [], blockCurves: {} }))
                  setCurveNote(null)
                }}
              >
                Remove loaded curves
              </Button>
            )}
          </div>
          {curveNote && (
            <InlineAlert tone={curveNote.skipped.length ? 'warning' : 'info'}>
              <p>{curveNote.text}</p>
              {!!curveNote.skipped.length && (
                <p className="mt-1">
                  Left out: {curveNote.skipped.slice(0, 4).join(' ')}
                  {curveNote.skipped.length > 4 ? ` …and ${curveNote.skipped.length - 4} more.` : ''}
                </p>
              )}
            </InlineAlert>
          )}
          {!curveNote && !!d.curveLibrary.length && (
            <p className="text-muted-foreground">
              {d.curveLibrary.length} Castor curve{d.curveLibrary.length === 1 ? '' : 's'} loaded from{' '}
              {d.curveLibrary[0].source}.
            </p>
          )}
          <FormField label="Assessment years, separated by commas">
            <input className={FORM_INPUT_CLASS} value={years} onChange={(e) => setYears(e.target.value)} />
          </FormField>
          <FormField label="Height–age curve: age,height in metres per line">
            <textarea
              rows={4}
              className={FORM_INPUT_CLASS}
              value={curve}
              onChange={(e) => setCurve(e.target.value)}
              placeholder={'0,0\n10,3\n20,8'}
            />
          </FormField>
          <FormField label="Height–age curve source">
            <input
              className={FORM_INPUT_CLASS}
              value={d.growthSource}
              onChange={(e) => change({ ...d, growthSource: e.target.value })}
            />
          </FormField>
          <Button
            size="sm"
            disabled={busy || !result}
            onClick={() =>
              perform(() => {
                const values = years.split(',').map((v) => v.trim()),
                  dates = values.map(Number)
                if (
                  values.some((v) => !v) ||
                  !dates.length ||
                  dates.length > 12 ||
                  dates.some((y) => !Number.isInteger(y) || y < 1900 || y > 2200) ||
                  new Set(dates).size !== dates.length
                )
                  throw new Error('Enter 1–12 distinct years between 1900 and 2200.')
                const growth = parseGrowthCurve(curve)
                if (growth.length && !d.growthSource.trim())
                  throw new Error('Record the supplied height–age curve source.')
                const heights = Object.fromEntries(result!.targets.map((t) => [t.targetId, t.vegHeightMeters]))
                const byBlock: Record<string, LibraryCurve> = {}
                for (const [blockId, curveId] of Object.entries(d.blockCurves)) {
                  const loaded = curveById.get(curveId)
                  if (loaded) byBlock[blockId] = loaded
                }
                const jobs: ToolJob[] = dates.map((y) => ({
                  id: createId('timeline'),
                  name: `Assessment ${y}`,
                  kind: 'timeline',
                  year: y,
                  scene: timelineScene(scene, y, growth, heights, byBlock),
                }))
                change({ ...d, growthCurve: growth })
                run(jobs)
              })
            }
          >
            Run recovery timeline
          </Button>
          <RecoveryTable runs={d.runs} kind="timeline" />
        </div>
      </ToolSection>
      <ToolSection
        summary=""
        toggleProps={{ 'data-forestry-disclosure': 'green-up-sensitivity' }}
        title="Green-up age sensitivity"
        help={
          <>
            <span className="block">
              The green-up age is a stated planning assumption: the references give the height a slope needs, not how
              long a site takes to reach it. This runs the scene at {greenUpAges.join(', ')} years and sets the
              landform’s figures side by side. The scene’s own age is not changed.
            </span>
            <span className="mt-1.5 block">
              Openings with a complete field check or a supplied recovery estimate keep their share in every run. These
              are assumption comparisons, not confidence intervals.
            </span>
            <span className="mt-1.5 block">
              The age also decides which openings are cleared ground. An opening read as greened up keeps its inventory
              canopy, which screens what lies behind it, so a shorter age can raise the perspective figure.
            </span>
          </>
        }
      >
        <div className="space-y-2 text-xs">
          <p data-green-up-sensitive>{greenUpSensitiveSentence(sensitiveOpenings, greenUpAges)}</p>
          <Button size="sm" disabled={busy || !result} onClick={() => perform(() => run(greenUpJobs(scene)))}>
            Run green-up sensitivity
          </Button>
          <RecoveryTable runs={d.runs} kind="greenup" />
        </div>
      </ToolSection>
      <DroughtRiskPanel landform={findSceneLandform(scene)} />
      <ToolSection
        summary=""
        toggleProps={{ 'data-forestry-disclosure': '' }}
        title="Inspect a sightline"
        help="Click an analysis sample on the map, or select a sample and station below, to trace it through the numerical terrain and screening surface."
      >
        <div className="space-y-2 text-xs">
          <FormField label="Sightline target">
            <StyledSelect
              value={inspectTarget}
              onChange={(e) => {
                setInspectTarget(e.target.value)
                setInspectIndex(0)
              }}
            >
              <option value="">Choose target</option>
              {result?.targets.map((t) => (
                <option key={t.targetId} value={t.targetId}>
                  {scene.targets.find((v) => v.id === t.targetId)?.name ?? t.targetId} · {t.sampleCount} samples
                </option>
              ))}
            </StyledSelect>
          </FormField>
          <NumberField
            label="Sample index (zero based)"
            min={0}
            max={(result?.targets.find((t) => t.targetId === inspectTarget)?.sampleCount ?? 1) - 1}
            value={inspectIndex}
            onValueChange={setInspectIndex}
          />
          <FormField label="Viewing station">
            <StyledSelect value={inspectStation} onChange={(e) => setInspectStation(Number(e.target.value))}>
              {result?.stations.map((s, i) => (
                <option key={i} value={i}>
                  Station {i + 1} · {s.distanceAlongMeters.toFixed(0)} m
                </option>
              ))}
            </StyledSelect>
          </FormField>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !result || !inspectTarget}
            onClick={() =>
              perform(() => {
                const t = result?.targets.find((t) => t.targetId === inspectTarget)
                if (!t || !Number.isInteger(inspectIndex) || inspectIndex < 0 || inspectIndex >= t.sampleCount)
                  throw new Error('Choose a valid sample index.')
                inspect(inspectTarget, inspectIndex, inspectStation)
              })
            }
          >
            Trace selected sightline
          </Button>
          {profile && <SightlineProfileChart profile={profile} />}
        </div>
      </ToolSection>
      {!!d.runs.length && (
        <ToolSection
          summary=""
          toggleProps={{ 'data-forestry-disclosure': '' }}
          title="Saved assessment results"
          defaultOpen
        >
          <div className="space-y-3 text-xs">
            {d.runs.map((r) => (
              <div key={r.id} className="space-y-1 border-b pb-3">
                <p className="font-medium">{r.name}</p>
                {r.summary ? (
                  <>
                    <SavedRunFigures summary={r.summary} />
                    <p>
                      {r.summary.quality?.numericalReady ? 'Scenario estimate available' : 'Provisional'} · measured
                      class {r.summary.numericalClass ?? 'withheld'} · reviewer rating{' '}
                      {r.summary.via.rating?.label ?? 'pending'}
                    </p>
                    <p>
                      Block area {hectares(r.summary.blockAreaHa)} · visible block ground{' '}
                      {hectares(r.summary.visibleHa)}
                    </p>
                  </>
                ) : (
                  <InlineAlert tone="error">{r.error}</InlineAlert>
                )}
                <div className="flex flex-wrap gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setOpenedRun(r.id)
                      onChange(structuredClone(r.scene))
                      onRun(r.scene)
                    }}
                  >
                    Open and review assessment
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => change({ ...d, runs: d.runs.filter((v) => v.id !== r.id) })}
                  >
                    Remove result {r.name}
                  </Button>
                </div>
              </div>
            ))}
            <p>
              Open a run, complete judgments in step 4, then record it in step 5. Opening reruns saved inputs against
              available inventory and does not overwrite the stored result.
            </p>
          </div>
        </ToolSection>
      )}
    </>
  )
  // Save & export's *VIA evidence package* options: which viewpoint the record is for, recording the run, and the
  // checklist of what the package still lacks. The package itself is written from that output.
  const report = (
    <div className="space-y-3 text-xs" data-via-evidence="">
      {message}
      <FormField label="Assessment evidence viewpoint">
        <StyledSelect value={reportView} onChange={(e) => setReportView(e.target.value)}>
          <option value="">Not linked</option>
          {viewsDocument.views.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </StyledSelect>
      </FormField>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy || !result} onClick={() => perform(record)}>
          {openedRun ? 'Update reviewed assessment record' : 'Record current assessment'}
        </Button>
        {openedRun && (
          <Button size="sm" variant="ghost" onClick={() => setOpenedRun(null)}>
            Record next assessment separately
          </Button>
        )}
      </div>
      <div>
        <p className="font-medium text-foreground">Evidence checklist · {evidenceGaps(viewsDocument).length} gaps</p>
        <ul className="list-disc space-y-1 py-1 pl-4">
          {evidenceGaps(viewsDocument).map((g) => (
            <li key={g}>{g}</li>
          ))}
          {!evidenceGaps(viewsDocument).length && (
            <li>Expected evidence categories present. Check content and adequacy.</li>
          )}
        </ul>
      </div>
    </div>
  )
  // Save & export's *Assessment workspace* options: bringing a saved workspace back in.
  const workspaceImport = (
    <FileButton
      label="Import assessment workspace"
      accept=".json"
      disabled={busy}
      onFiles={([file]) => void importWorkspace(file)}
    >
      Import assessment workspace
    </FileButton>
  )
  // Field-record photographs, for lining one up with the road view (Field photo), and a
  // confirmed camera written back to its record, unchecked until the reviewer ticks it there.
  const photoRecords = useMemo(() => d.fields.filter((f) => f.kind === 'photo'), [d.fields])
  // A changed camera is unchecked again until the reviewer ticks it; an acceptance, a job or a note leaves it be.
  const updateFieldRecord = useCallback(
    (id: string, patch: Partial<FieldRecord>) =>
      change((current) => ({
        ...current,
        fields: current.fields.map((f) =>
          f.id === id
            ? { ...f, ...patch, ...(CAMERA_FIELDS.some((key) => key in patch) ? { alignmentChecked: false } : {}) }
            : f,
        ),
      })),
    [change],
  )
  /**
   * Adds own photos opened in the photo window as field records (`photoRecordFromOwn`), grouped into flights. Returns
   * why they do not fit, adding none, or null once added.
   */
  const addPhotoRecords = useCallback(
    (records: FieldRecord[]): string | null => {
      const fresh = records.filter((r) => !documentRef.current.fields.some((f) => f.id === r.id))
      const full = fieldRecordRoom(documentRef.current.fields.length, fresh.length)
      if (full) return full
      if (fresh.length) change((current) => ({ ...current, fields: withFlights([...current.fields, ...fresh]) }))
      return null
    },
    [change],
  )
  /** Links a photo to a job (`on`) or takes it off one; `targetId` names the view, block or opening it is for. */
  const setPhotoJob = useCallback(
    (recordId: string, job: PhotoJob, on: boolean, targetId: string | null = null) =>
      change((current) => ({
        ...current,
        fields: current.fields.map((f) =>
          f.id !== recordId ? f : on ? linkPhotoJob(f, job, targetId) : unlinkPhotoJob(f, job, targetId),
        ),
      })),
    [change],
  )
  /** Removes a field record, as its row's *Remove* does; the page drops its attachment and any view's link to it. */
  const removeFieldRecord = useCallback(
    (id: string) => change((current) => ({ ...current, fields: current.fields.filter((f) => f.id !== id) })),
    [change],
  )
  /** How many field records the workspace holds now, read when asked: the photo window checks room before reading. */
  const fieldCount = useCallback(() => documentRef.current.fields.length, [])
  /** A field record as held now, read through the ref so a workspace restored this tick is already there. */
  const fieldRecord = useCallback((id: string) => documentRef.current.fields.find((f) => f.id === id) ?? null, [])
  const revision = revisionReadout ? <RunRevisionReadout readout={revisionReadout} /> : null
  /** The package and the workspace backup for Save & export, written from the stored document. */
  const evidence = {
    loaded,
    gaps: evidenceGaps(viewsDocument),
    counts: { views: viewsDocument.views.length, runs: d.runs.length, fields: d.fields.length },
    pdf: () => evidencePdfBlob(withPlannedViews(parseTools(documentRef.current), plannedRef.current)),
    html: () => buildEvidenceHtml(withPlannedViews(parseTools(documentRef.current), plannedRef.current)),
    // The views of interest go in with the rest, so a run or photo filed under one reads back under its name.
    workspaceJson: () =>
      serializeTools({ ...withPlannedViews(documentRef.current, plannedRef.current), currentScene: scene }),
    /** The workspace as stored, for the project file: its scene carries the views of interest itself. */
    storedWorkspaceJson: () => serializeTools({ ...documentRef.current, currentScene: undefined }),
  }
  /** Replaces the stored workspace with a project file's (`projectFile.ts`); the page sets the scene itself. */
  const restoreWorkspace = (text: string | null) =>
    replaceWorkspace(text === null ? emptyTools() : parseTools(JSON.parse(text)))
  /**
   * Starts a new site (*New site* or a sample): the last site's photographs and evidence images, design options,
   * runs, earlier viewpoints, block curve assignments and reference measurements go, and with them the stored copy.
   * The growth curve and the Castor curve library stay: they are the reviewer's inputs, not the site's records.
   */
  const startNewSite = () => {
    const { growthCurve, growthSource, curveLibrary } = documentRef.current
    setSightlineArchive(null)
    replaceWorkspace({ ...emptyTools(), growthCurve, growthSource, curveLibrary })
  }
  function replaceWorkspace(parsed: ToolsDocument) {
    workspaceGeneration.current++
    runner.cancel()
    change(parsed)
    setCurve(parsed.growthCurve.map((p) => `${p.age},${p.height}`).join('\n'))
    setOpenedRun(null)
    setSelectedViews([])
    setSelectedLandforms([])
    setSelectedField(null)
    setError(null)
  }
  return {
    restoreWorkspace,
    startNewSite,
    sightlineArchive,
    /** The historical VIA review: its row count, whether the workspace has loaded, and its dialog. */
    reference: {
      count: d.referenceMeasurements.length,
      loaded,
    },
    referencePanel: (open: boolean, onOpenChange: (open: boolean) => void) => (
      <ReferenceMeasurements
        key={workspaceGeneration.current}
        open={open}
        onOpenChange={onOpenChange}
        runActions={{
          retain: setSightlineArchive,
          retained: sightlineArchive,
          onSaveArchive: onSaveSightlineArchive,
          input: (row) => {
            const v = viewsDocument.views.find((v) => v.id === row.viewId)
            if (!v || !scene.targets.some((t) => t.id === row.landformId && t.role === 'landscape'))
              throw Error('Choose an available view and mapped landform.')
            return buildSceneInput({ ...scene, viewpoint: v.viewpoint, activeLandformId: row.landformId })
          },
        }}
        rows={d.referenceMeasurements}
        loaded={loaded}
        captures={referenceCaptures}
        photoInputs={{ ground: referenceTerrain, photos: d.fields, lineUpInOwnPhoto: onLineUpInOwnPhoto }}
        geometry={{
          blocks: scene.targets.filter((t) => t.role === 'block'),
          onAdopt: (row, choice, role, blockId) => {
            const chosen = chosenValues(row)
            const source =
              [
                choice.source,
                chosen.boundaryType,
                chosen.boundaryDate,
                ...(role === 'treatment'
                  ? [
                      chosen.residualStems && chosen.residualStems + ' residual stems/ha',
                      chosen.treesRemoved && chosen.treesRemoved + '% of trees removed',
                      chosen.volumeRemoved && chosen.volumeRemoved + '% of volume removed',
                    ]
                  : []),
              ]
                .filter(Boolean)
                .join(' · ') + (chosenValues(row).studyDate ? ' · study ' + chosenValues(row).studyDate : '')
            const target = {
              id: createId(role),
              name: choice.name,
              role: 'landscape' as const,
              geometry: choice.geometry,
              source,
              objectiveId: DEFAULT_VISUAL_QUALITY_CLASS_ID,
              vac: null,
              harvestYear: null,
              clearcutPercent: null,
            }
            let next = scene
            let landformId = row.landformId
            if (role === 'landscape') {
              next = adoptViewLandform(scene, row.viewId, target)
              if (next === scene)
                throw Error('List this workspace viewpoint in Views of interest before adopting its landform.')
              landformId = next.viewsOfInterest!.find((v) => v.id === row.viewId)!.landformId!
            } else if (role === 'block' || role === 'treatment') {
              if (blockId === 'new' && role === 'block')
                next = { ...scene, targets: [...scene.targets, { ...target, role: 'block' }] }
              else {
                const block = scene.targets.find((t) => t.id === blockId && t.role === 'block')
                if (!block) throw Error('Select a proposal in the current scene.')
                if (d.options.length >= 12)
                  throw Error('The design library is full. Free a design slot to keep the previous boundary.')
                const replacements =
                  role === 'treatment'
                    ? treatmentTargets(block, target, chosen)
                    : [{ ...block, geometry: choice.geometry, source }]
                change((current) => ({
                  ...current,
                  options: [
                    ...current.options,
                    {
                      id: createId('option'),
                      name: 'Before boundary change · ' + block.name,
                      scene: structuredClone(scene),
                    },
                  ],
                }))
                next = {
                  ...scene,
                  targets: scene.targets.flatMap((t) => (t === block ? replacements : [t])),
                }
              }
            } else {
              const scoped = role === 'natural' || role === 'private' || role === 'rock'
              if (scoped && !scene.targets.some((t) => t.id === row.landformId && t.role === 'landscape'))
                throw Error('Choose the mapped landform for this exclusion.')
              const kind = role === 'rock' ? 'natural' : role
              if (
                (scene.masks ?? []).some(
                  (m) =>
                    m.kind === kind &&
                    !!m.mappedRock === (role === 'rock') &&
                    m.landformId === (scoped ? row.landformId : undefined) &&
                    JSON.stringify(m.geometry) === JSON.stringify(choice.geometry),
                )
              )
                throw Error('This outline is already applied.')
              next = {
                ...scene,
                masks: withDrawnMask(scene.masks ?? [], {
                  id: target.id,
                  name: choice.name,
                  geometry: choice.geometry,
                  source,
                  kind,
                  ...(scoped ? { landformId: row.landformId } : {}),
                  ...(role === 'rock' ? { mappedRock: true } : {}),
                }),
              }
            }
            const field =
              role === 'landscape'
                ? 'outline'
                : role === 'treatment'
                  ? 'treatmentUnits'
                  : role === 'block'
                    ? 'proposal'
                    : role === 'retained'
                      ? 'retention'
                      : 'exclusions'
            change((current) => ({
              ...current,
              referenceMeasurements: current.referenceMeasurements.map((r) =>
                r.id === row.id
                  ? {
                      ...r,
                      landformId,
                      corrections: {
                        ...r.corrections,
                        [field]: [chosenValues(r)[field], source + ' · ' + choice.name].filter(Boolean).join('\n'),
                      },
                      useSource: r.useSource?.filter((k) => k !== field),
                    }
                  : r,
              ),
            }))
            onChange(next)
          },
        }}
        onAdd={() => {
          const id = createId('reviewer-row')
          const row = { id, caseId: 'reviewer', viewId: '', landformId: '', printed: {}, corrections: {} }
          change((current) => ({
            ...current,
            referenceMeasurements: mergeReferences(current.referenceMeasurements, [row]),
          }))
          return id
        }}
        views={viewsDocument.views}
        landforms={scene.targets.filter((t) => t.role === 'landscape')}
        attachments={projectAttachments}
        onChange={(row) =>
          change((current) => ({
            ...current,
            referenceMeasurements: current.referenceMeasurements.map((r) => (r.id === row.id ? row : r)),
          }))
        }
        onImport={async (file) => {
          const generation = workspaceGeneration.current
          const rows = importReferenceCase(await readReferenceCase(file), {
            views: viewsDocument.views,
            landforms: scene.targets.filter((t) => t.role === 'landscape'),
            attachments: projectAttachments.map((a) => a.name),
          })
          if (generation !== workspaceGeneration.current) return 'Workspace changed during import.'
          const current = documentRef.current
          const merged = mergeReferences(current.referenceMeasurements, rows)
          const count = merged.length - current.referenceMeasurements.length
          if (JSON.stringify(merged) !== JSON.stringify(current.referenceMeasurements)) {
            change({ ...current, referenceMeasurements: merged })
            if (file instanceof File && !projectAttachments.some((a) => a.blob === file)) onAttachCase(file)
          }
          return count
            ? `Imported ${count} reference measurement${count === 1 ? '' : 's'}.`
            : rows.length
              ? 'Checked existing rows for additional source fields.'
              : 'This case contains no reference measurements.'
        }}
      />
    ),
    field,
    design,
    report,
    workspaceImport,
    evidence,
    revision,
    inspect,
    cancel: runner.cancel,
    running: runner.running,
    photoRecords,
    updateFieldRecord,
    addPhotoRecords,
    setPhotoJob,
    removeFieldRecord,
    fieldCount,
    fieldRecord,
    fieldDialog,
    /** The attachments filed under a viewpoint, for its row. */
    fieldsFor: (viewId: string) => d.fields.filter((f) => f.viewId === viewId),
    openField: setSelectedField,
    importField: (file: File, kind: FieldRecord['kind'], viewId: string) => void importField(file, kind, viewId),
    fieldBusy: fieldBusy || busy,

    /** Saved design alternatives, so a saved view can say which one it shows. */
    designOptions: d.options,
  }
}

/** A saved run's figures through the one readiness rule (`runFigures`): a provisional run's only as diagnostic. */
function SavedRunFigures({ summary }: { summary: Parameters<typeof runFigures>[0] }) {
  const figures = runFigures(summary)
  if (figures.state === 'ready')
    return (
      <p>
        Perspective: {formatPct(figures.perspective?.cumulativePercent, 2, 'withheld')} · planimetric:{' '}
        {formatPct(figures.planimetric?.cumulativePercent, 2, 'withheld')}
      </p>
    )
  return (
    <>
      <p>{withheldText(figures)}</p>
      <p className="text-muted-foreground">
        {DIAGNOSTIC_LABEL}: perspective {formatPct(figures.diagnostic.perspective?.cumulativePercent, 2, 'withheld')} ·
        planimetric {formatPct(figures.diagnostic.planimetric?.cumulativePercent, 2, 'withheld')}
      </p>
    </>
  )
}
