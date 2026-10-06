import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ClipboardList, GitCompareArrows } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CollapsibleSection, InlineAlert, SidebarSection } from '@/components/ui/map-panels'
import { ToolFieldPanel, ToolField, TOOL_INPUT } from './ToolFieldPanel'
import { SightlineProfileChart } from './SightlineProfileChart'
import { createId, type ForestryScene } from './scene'
import { sceneFingerprint } from './sceneInput'
import {
  comparisonScene,
  emptyTools,
  matrixJobs,
  parseGrowthCurve,
  parseTools,
  serializeTools,
  stabilityJobs,
  summarizeRun,
  timelineScene,
  type ToolJob,
  type ToolRun,
  type ToolsDocument,
} from './assessmentTools'
import { loadTools, saveTools } from './toolsStorage'
import { useToolRunner } from './useToolRunner'
import { buildEvidenceHtml, evidenceGaps, exportEvidencePdf } from './toolEvidence'
import type { AnalysisResult, Viewpoint } from './types'
import type { SightlineProfile } from './sightlineProfile'

type Props = {
  scene: ForestryScene
  result: AnalysisResult | null
  currentStation: number
  onChange: (scene: ForestryScene) => void
  onRun: (scene: ForestryScene) => void
  analysisRunning: boolean
  onImportScene: (scene: ForestryScene) => void
}
function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type })),
    a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function useAssessmentTools({
  scene,
  result,
  currentStation,
  onChange,
  onRun,
  analysisRunning,
  onImportScene,
}: Props) {
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
    [openedRun, setOpenedRun] = useState<string | null>(null),
    [reportView, setReportView] = useState('')
  const [profile, setProfile] = useState<SightlineProfile | null>(null),
    [inspectTarget, setInspectTarget] = useState(''),
    [inspectIndex, setInspectIndex] = useState(0),
    [inspectStation, setInspectStation] = useState(0),
    [exporting, setExporting] = useState(false)
  const importInput = useRef<HTMLInputElement>(null),
    documentRef = useRef(d),
    saveQueue = useRef(Promise.resolve())
  documentRef.current = d
  const key = useMemo(() => sceneFingerprint(scene), [scene]),
    runner = useToolRunner(key)
  const { cancel: cancelTools, run: runTools } = runner
  useEffect(() => {
    let active = true
    loadTools()
      .then((next) => {
        if (active) {
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
      const parsed = parseTools(JSON.parse(await file.text()))
      runner.cancel()
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
  const message = (
    <>
      {!loaded && <InlineAlert>Loading saved assessment workspace…</InlineAlert>}
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      {runner.error && <InlineAlert tone="error">{runner.error}</InlineAlert>}
      {runner.running && (
        <div role="status" className="space-y-2 text-xs">
          <p>{runner.progress || 'Starting analysis…'}</p>
          <Button size="sm" variant="outline" onClick={runner.cancel}>
            Cancel tool run
          </Button>
        </div>
      )}
    </>
  )
  const busy = !loaded || runner.running || analysisRunning
  const field = (
    <>
      {loaded && (
        <ToolFieldPanel
          document={d}
          onChange={change}
          result={result}
          viewpoint={scene.viewpoint}
          activeLandformId={scene.activeLandformId ?? null}
          currentStation={currentStation}
          onUseView={onUseView}
        />
      )}
    </>
  )
  const design = (
    <SidebarSection title="Design comparisons and diagnostic tools" icon={GitCompareArrows} headingLevel={3}>
      {message}
      <CollapsibleSection
        toggleProps={{ 'data-forestry-disclosure': '' }}
        label="Saved design alternatives"
        defaultOpen
      >
        <div className="space-y-2 py-3 text-xs">
          <ToolField label="Design alternative name">
            <input className={TOOL_INPUT} value={optionName} onChange={(e) => setOptionName(e.target.value)} />
          </ToolField>
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
          <p>
            Alternatives supply proposed blocks and retained patches. Every run uses the same current landform, existing
            openings, surfaces, settings and station. Complete reviewer ratings separately in step 4.
          </p>
        </div>
      </CollapsibleSection>
      <CollapsibleSection toggleProps={{ 'data-forestry-disclosure': '' }} label="Viewpoint and landform matrix">
        <div className="space-y-2 py-3 text-xs">
          <p>
            Select significant viewpoints recorded in step 2 and reviewed landforms. Each pair has its own denominator
            and worst station; values are never pooled across landforms.
          </p>
          {d.views.map((v) => (
            <label className="flex gap-2" key={v.id}>
              <input
                type="checkbox"
                checked={selectedViews.includes(v.id)}
                onChange={() => setSelectedViews(toggle(selectedViews, v.id))}
              />
              {v.name}
            </label>
          ))}
          {!d.views.length && <p>Record a viewpoint in step 2 first.</p>}
          {scene.targets
            .filter((t) => t.role === 'landscape')
            .map((t) => (
              <label className="flex gap-2" key={t.id}>
                <input
                  type="checkbox"
                  checked={selectedLandforms.includes(t.id)}
                  onChange={() => setSelectedLandforms(toggle(selectedLandforms, t.id))}
                />
                {t.name}
              </label>
            ))}
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              perform(() =>
                run(
                  matrixJobs(
                    scene,
                    d.views.filter((v) => selectedViews.includes(v.id)),
                    selectedLandforms,
                  ),
                ),
              )
            }
          >
            Run independent assessments
          </Button>
          <p>
            Maximum 12 jobs per batch. A completed batch replaces the previous result set; export important runs first.
          </p>
        </div>
      </CollapsibleSection>
      <CollapsibleSection toggleProps={{ 'data-forestry-disclosure': '' }} label="Sampling and screening sensitivity">
        <div className="space-y-2 py-3 text-xs">
          <p>
            Compare finer area sampling, closer stations, eye height ±0.5 m, and screening toggled against the baseline.
            These comparisons reveal dependence on assumptions; they are not confidence intervals.
          </p>
          <Button size="sm" disabled={busy} onClick={() => perform(() => run(stabilityJobs(scene)))}>
            Run sensitivity comparisons
          </Button>
        </div>
      </CollapsibleSection>
      <CollapsibleSection toggleProps={{ 'data-forestry-disclosure': '' }} label="Harvest scheduling and recovery">
        <div className="space-y-2 py-3 text-xs">
          <p>
            Each year is an independent scenario. Before its scheduled year a proposal is omitted; during that year it
            is proposed alteration; afterward it becomes an existing opening. The supplied height–age curve controls
            green-up accounting. Screening uses current canopy assumptions, not a simulated future stand.
          </p>
          {scene.targets
            .filter((t) => t.role === 'block')
            .map((t) => (
              <ToolField key={t.id} label={`Planned harvest year for ${t.name}`}>
                <input
                  type="number"
                  min="1900"
                  max="2200"
                  className={TOOL_INPUT}
                  value={t.plannedHarvestYear ?? ''}
                  onChange={(e) =>
                    onChange({
                      ...scene,
                      targets: scene.targets.map((v) =>
                        v.id === t.id
                          ? { ...v, plannedHarvestYear: e.target.value ? Number(e.target.value) : null }
                          : v,
                      ),
                    })
                  }
                />
              </ToolField>
            ))}
          <ToolField label="Assessment years, separated by commas">
            <input className={TOOL_INPUT} value={years} onChange={(e) => setYears(e.target.value)} />
          </ToolField>
          <ToolField label="Height–age curve: age,height in metres per line">
            <textarea
              rows={4}
              className={TOOL_INPUT}
              value={curve}
              onChange={(e) => setCurve(e.target.value)}
              placeholder={'0,0\n10,3\n20,8'}
            />
          </ToolField>
          <ToolField label="Height–age curve source">
            <input
              className={TOOL_INPUT}
              value={d.growthSource}
              onChange={(e) => change({ ...d, growthSource: e.target.value })}
            />
          </ToolField>
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
                const jobs: ToolJob[] = dates.map((y) => ({
                  id: createId('timeline'),
                  name: `Assessment ${y}`,
                  kind: 'timeline',
                  year: y,
                  scene: timelineScene(scene, y, growth, heights),
                }))
                change({ ...d, growthCurve: growth })
                run(jobs)
              })
            }
          >
            Run recovery timeline
          </Button>
          <p>
            Outside the supplied curve, the scene’s stated green-up-age assumption applies. Prior-year partial cuts
            require a supported stand model and are rejected.
          </p>
        </div>
      </CollapsibleSection>
      <CollapsibleSection toggleProps={{ 'data-forestry-disclosure': '' }} label="Inspect a sightline">
        <div className="space-y-2 py-3 text-xs">
          <p>
            Click an analysis sample on the map, or select a sample and station below, to trace it through the numerical
            terrain and screening surface.
          </p>
          <ToolField label="Sightline target">
            <select
              className={TOOL_INPUT}
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
            </select>
          </ToolField>
          <ToolField label="Sample index (zero based)">
            <input
              type="number"
              min="0"
              max={(result?.targets.find((t) => t.targetId === inspectTarget)?.sampleCount ?? 1) - 1}
              className={TOOL_INPUT}
              value={inspectIndex}
              onChange={(e) => setInspectIndex(Number(e.target.value))}
            />
          </ToolField>
          <ToolField label="Viewing station">
            <select
              className={TOOL_INPUT}
              value={inspectStation}
              onChange={(e) => setInspectStation(Number(e.target.value))}
            >
              {result?.stations.map((s, i) => (
                <option key={i} value={i}>
                  Station {i + 1} · {s.distanceAlongMeters.toFixed(0)} m
                </option>
              ))}
            </select>
          </ToolField>
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
      </CollapsibleSection>
      {!!d.runs.length && (
        <CollapsibleSection
          toggleProps={{ 'data-forestry-disclosure': '' }}
          label="Saved assessment results"
          defaultOpen
        >
          <div className="space-y-3 py-3 text-xs">
            {d.runs.map((r) => (
              <div key={r.id} className="space-y-1 border-b pb-3">
                <p className="font-medium">{r.name}</p>
                {r.summary ? (
                  <>
                    <p>
                      Perspective: {r.summary.perspectiveAlteration?.cumulativePercent?.toFixed(2) ?? 'withheld'}% ·
                      planimetric: {r.summary.planimetricAlteration?.cumulativePercent?.toFixed(2) ?? 'withheld'}%
                    </p>
                    <p>
                      {r.summary.quality?.numericalReady ? 'Scenario estimate available' : 'Provisional'} · measured
                      class {r.summary.numericalClass ?? 'withheld'} · reviewer rating{' '}
                      {r.summary.via.rating?.label ?? 'pending'}
                    </p>
                    <p>
                      Block area {r.summary.blockAreaHa.toFixed(2)} ha · visible block ground{' '}
                      {r.summary.visibleHa.toFixed(2)} ha
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
        </CollapsibleSection>
      )}
    </SidebarSection>
  )
  const report = (
    <SidebarSection title="VIA evidence package and workspace" icon={ClipboardList} headingLevel={3}>
      <div className="space-y-3 text-xs">
        {message}
        <ToolField label="Assessment evidence viewpoint">
          <select className={TOOL_INPUT} value={reportView} onChange={(e) => setReportView(e.target.value)}>
            <option value="">Not linked</option>
            {d.views.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </ToolField>
        <Button size="sm" variant="outline" disabled={busy || !result} onClick={() => perform(record)}>
          {openedRun ? 'Update reviewed assessment record' : 'Record current assessment'}
        </Button>
        {openedRun && (
          <Button size="sm" variant="ghost" onClick={() => setOpenedRun(null)}>
            Record next assessment separately
          </Button>
        )}
        <p>
          Record after completing step 4. Attach photos, matching simulations, a topographic map and design annotations
          in step 2. Use the road view’s existing image download for a simulation attachment.
        </p>
        <CollapsibleSection
          toggleProps={{ 'data-forestry-disclosure': '' }}
          label={`Evidence checklist · ${evidenceGaps(d).length} gaps`}
          defaultOpen
        >
          <ul className="list-disc space-y-1 py-2 pl-4">
            {evidenceGaps(d).map((g) => (
              <li key={g}>{g}</li>
            ))}
            {!evidenceGaps(d).length && <li>Expected evidence categories present. Check content and adequacy.</li>}
          </ul>
        </CollapsibleSection>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={!loaded || exporting}
            onClick={() => {
              setExporting(true)
              setError(null)
              void Promise.resolve()
                .then(() => exportEvidencePdf(parseTools(d)))
                .catch((e) => setError(String(e)))
                .finally(() => setExporting(false))
            }}
          >
            Export VIA evidence PDF
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!loaded}
            onClick={() =>
              perform(() => download('forestry-via-evidence.html', buildEvidenceHtml(parseTools(d)), 'text/html'))
            }
          >
            Export printable evidence
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!loaded}
            onClick={() =>
              perform(() =>
                download(
                  'forestry-assessment-workspace.json',
                  serializeTools({ ...d, currentScene: scene }),
                  'application/json',
                ),
              )
            }
          >
            Export assessment workspace
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => importInput.current?.click()}>
            Import assessment workspace
          </Button>
        </div>
        <input
          ref={importInput}
          className="hidden"
          type="file"
          accept=".json"
          aria-label="Import assessment workspace"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void importWorkspace(f)
          }}
        />
        <p>
          JSON includes saved inputs, local rasters, hashes, results, judgments and resized attachments. Stored on this
          device in IndexedDB; export a backup before clearing browser data. Imported results are historical records,
          not verified new calculations. This native VIA evidence report is separate from the historical FS1252 form.
        </p>
      </div>
    </SidebarSection>
  )
  return { field, design, report, inspect, cancel: runner.cancel, running: runner.running }
}
