import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  BookOpen,
  ChartNoAxesCombined,
  Database,
  Download,
  FlaskConical,
  FolderOpen,
  Map as MapIcon,
  Play,
  Save,
  Settings2,
  Square,
  Trees,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FormField, SelectField } from '@/components/ui/form-field'
import { InlineAlert } from '@/components/ui/map-panels'
import { StatGroup } from '@/components/ui/stat-group'
import { TabBar } from '@/components/ui/tab-bar'
import { ExternalLink } from '@/components/ui/text-button'
import { downloadBlob, downloadText } from '@/lib/download'
import { castorConfig, createExampleProject, importCastorFiles } from '@/features/forestry-castor/inputs'
import { CASTOR_IMPORT_LIMIT_BYTES } from '@/features/forestry-castor/inputTables'
import { castorReportBundle } from '@/features/forestry-castor/outputs'
import { importCastorRaster } from '@/features/forestry-castor/rasterInputs'
import {
  loadCastorDraft,
  parseCastorSession,
  saveCastorDraft,
  serializeCastorSession,
} from '@/features/forestry-castor/persistence'
import {
  DEFAULT_CASTOR_CONFIG,
  type CastorConfig,
  type CastorProject,
  type CastorResult,
} from '@/features/forestry-castor/types'
import { validateCastorProject } from '@/features/forestry-castor/validation'
import { JsonEditor, number, Section } from './forestry-castor/common'
import { MethodsPanel } from './forestry-castor/MethodsPanel'
import { ResultsPanel } from './forestry-castor/ResultsPanel'
import { ScenarioSettings } from './forestry-castor/ScenarioSettings'
import { SpatialPanel } from './forestry-castor/SpatialPanel'
import { useCastorSimulation } from './forestry-castor/useCastorSimulation'

type View = 'setup' | 'results' | 'map' | 'methods'
type RasterRole = 'salvage' | 'blocks' | 'zone' | 'harvest-period' | 'harvest-schedule'
const EXAMPLE_SHA = '8d19a48acba51de568d6994b8b41c0d9b6d3533aa6ea8c7a0e3cd95afe23535d'
const EXAMPLE_URL = `${import.meta.env.BASE_URL}data/forestry-castor/simple_castordb.sqlite?v=${EXAMPLE_SHA}`

export default function DevForestryCastor({ standalone = false }: { standalone?: boolean } = {}) {
  const [project, setProject] = useState<CastorProject | null>(null)
  const [config, setConfig] = useState<CastorConfig>(DEFAULT_CASTOR_CONFIG)
  const [view, setView] = useState<View>('setup')
  const [baseline, setBaseline] = useState<CastorResult | null>(null)
  const [importBusy, setImportBusy] = useState(false)
  const [importError, setImportError] = useState('')
  const [draftLoading, setDraftLoading] = useState(true)
  const [draftMessage, setDraftMessage] = useState('')
  const [draftError, setDraftError] = useState('')
  const [exportBusy, setExportBusy] = useState(false)
  const [exportError, setExportError] = useState('')
  const [rasterRole, setRasterRole] = useState<RasterRole>('salvage')
  const [zoneName, setZoneName] = useState('imported-zone')
  const fileInput = useRef<HTMLInputElement>(null)
  const rasterInput = useRef<HTMLInputElement>(null)
  const importGeneration = useRef(0)
  const importController = useRef<AbortController | null>(null)
  const { state, run, cancel, invalidate } = useCastorSimulation()
  const result = state.status === 'complete' ? state.result : null
  const validation = useMemo(() => (project ? validateCastorProject(project, config) : null), [project, config])
  const running = state.status === 'running'

  useEffect(() => {
    const previous = document.title
    document.title = 'Castor forest scenarios · PGMaps'
    return () => {
      document.title = previous
    }
  }, [])
  useEffect(() => {
    let alive = true
    void loadCastorDraft()
      .then((draft) => {
        if (!alive) return
        if (draft) {
          setProject(draft.project)
          setConfig(draft.config)
          setDraftMessage(
            'Recovered the last scenario inputs from this browser. Run again to calculate current results.',
          )
        }
      })
      .catch((cause: unknown) => {
        if (alive) setDraftError(cause instanceof Error ? cause.message : 'The saved draft could not be recovered.')
      })
      .finally(() => {
        if (alive) setDraftLoading(false)
      })
    return () => {
      alive = false
      importGeneration.current += 1
      importController.current?.abort()
    }
  }, [])
  useEffect(() => {
    if (!project || draftLoading || validation?.errors.length) return
    let alive = true
    const timer = window.setTimeout(() => {
      void saveCastorDraft(project, config)
        .then(() => {
          if (alive) {
            setDraftMessage('Scenario inputs saved in this browser.')
            setDraftError('')
          }
        })
        .catch((cause: unknown) => {
          if (alive)
            setDraftError(
              `Local draft saving failed. Download a session to keep your work. ${cause instanceof Error ? cause.message : ''}`,
            )
        })
    }, 600)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [project, config, draftLoading, validation])
  useEffect(() => {
    if (state.status === 'complete') setView('results')
  }, [state])

  const stopImport = useCallback(() => {
    importGeneration.current += 1
    importController.current?.abort()
    importController.current = null
    setImportBusy(false)
  }, [])
  const install = (next: CastorProject, suppliedConfig?: CastorConfig) => {
    invalidate()
    setProject(next)
    setConfig(suppliedConfig ?? castorConfig(next))
    setBaseline(null)
    setImportError('')
    setExportError('')
    setDraftMessage('Saving scenario inputs…')
    setView('setup')
  }
  const updateProject = (next: CastorProject) => {
    stopImport()
    invalidate()
    setProject(next)
    setExportError('')
    setDraftMessage('Saving scenario inputs…')
    setView('setup')
  }
  const updateConfig = (next: CastorConfig) => {
    stopImport()
    invalidate()
    setConfig(next)
    setExportError('')
    setDraftMessage('Saving scenario inputs…')
    setView('setup')
  }
  const openFiles = async (files: File[]) => {
    stopImport()
    const id = importGeneration.current
    setImportBusy(true)
    setImportError('')
    try {
      if (files.reduce((bytes, file) => bytes + file.size, 0) > CASTOR_IMPORT_LIMIT_BYTES)
        throw new Error('The selected files exceed the 64 MB import limit.')
      if (files.length === 1 && files[0].name.toLowerCase().endsWith('.json')) {
        const text = await files[0].text()
        const data: unknown = JSON.parse(text)
        if (data && typeof data === 'object' && 'schema' in data && data.schema === 'pgmaps-castor-session-v1') {
          const session = parseCastorSession(text)
          if (id === importGeneration.current) {
            install(session.project, session.config)
            setDraftMessage('Scenario inputs and settings restored. Run again to verify the saved outputs.')
          }
          return
        }
      }
      const next = await importCastorFiles(files)
      if (id === importGeneration.current) install(next)
    } catch (cause: unknown) {
      if (id === importGeneration.current)
        setImportError(cause instanceof Error ? cause.message : 'The input files could not be loaded.')
    } finally {
      if (id === importGeneration.current) setImportBusy(false)
    }
  }
  const loadUpstream = async () => {
    stopImport()
    const id = importGeneration.current
    const controller = new AbortController()
    importController.current = controller
    setImportBusy(true)
    setImportError('')
    try {
      const response = await fetch(EXAMPLE_URL, { signal: controller.signal })
      if (!response.ok) throw new Error(`The upstream example could not load (HTTP ${response.status}).`)
      const bytes = await response.arrayBuffer()
      if (bytes.byteLength !== 696320)
        throw new Error('The example database has an unexpected size. The download was not used.')
      if (!globalThis.crypto?.subtle) throw new Error('Checking the example database requires HTTPS or localhost.')
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (value) =>
        value.toString(16).padStart(2, '0'),
      ).join('')
      if (hash !== EXAMPLE_SHA)
        throw new Error('The example database does not match its pinned checksum. The download was not used.')
      const next = await importCastorFiles([new File([bytes], 'simple_castordb.sqlite')])
      if (id === importGeneration.current) install(next)
    } catch (cause: unknown) {
      if (id === importGeneration.current)
        setImportError(cause instanceof Error ? cause.message : 'The upstream example could not load.')
    } finally {
      if (id === importGeneration.current) setImportBusy(false)
    }
  }
  const saveSession = () => {
    if (!project) return
    try {
      downloadText(serializeCastorSession(project, config, result), 'castor-session.json', 'application/json')
      setExportError('')
    } catch (cause: unknown) {
      setExportError(cause instanceof Error ? cause.message : 'The session could not be saved.')
    }
  }
  const openRaster = async (file: File) => {
    if (!project) return
    stopImport()
    const id = importGeneration.current
    setImportBusy(true)
    setImportError('')
    try {
      const next = await importCastorRaster(project, file, rasterRole, zoneName)
      if (id !== importGeneration.current) return
      updateProject(next)
      if (rasterRole === 'harvest-period' || rasterRole === 'harvest-schedule') {
        const lastPeriod = next.schedule?.reduce((last, entry) => Math.max(last, entry.period), 0) ?? 0
        setConfig({ ...config, mode: 'schedule', periods: Math.max(config.periods, lastPeriod) })
      }
    } catch (cause: unknown) {
      if (id === importGeneration.current)
        setImportError(cause instanceof Error ? cause.message : 'The raster could not be imported.')
    } finally {
      if (id === importGeneration.current) setImportBusy(false)
    }
  }

  return (
    <div className="min-h-full bg-gradient-to-b from-background to-muted/25">
      <div className="mx-auto max-w-[1500px] px-4 pb-12 pt-24 sm:px-6 sm:pt-28 md:pt-12">
        {standalone ? (
          <a
            href="https://pgmaps.ahmadjalil.com/dev/forestry"
            className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> PGMaps forestry tools
          </a>
        ) : (
          <Link
            to="/dev/forestry"
            className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Forestry tools
          </Link>
        )}
        <header className="mb-6 flex flex-col justify-between gap-4 sm:flex-row">
          <div className="max-w-3xl">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-teal-700 dark:text-teal-400">
              <Trees className="size-5" /> Forest management scenarios
            </div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Castor forest scenarios</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
              Explore how harvest targets, growth and management constraints change a forest over time. Keep the
              scenario, maps and reports together as you compare possible futures.
            </p>
          </div>
          <Badge tone="success" variant="outline" className="self-start">
            Runs in your browser
          </Badge>
        </header>

        <Section
          title="Your landscape"
          description="Open a local scenario, use BC's source example, or explore the clearly labelled synthetic demonstration. Imported forest data stays in this browser."
        >
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={draftLoading || importBusy} onClick={() => fileInput.current?.click()}>
              <FolderOpen className="size-4" /> Import scenario files
            </Button>
            <Button
              variant="outline"
              disabled={draftLoading || importBusy}
              onClick={() => {
                stopImport()
                install(createExampleProject())
              }}
            >
              <FlaskConical className="size-4" /> Load synthetic demonstration
            </Button>
            <Button variant="outline" disabled={draftLoading || importBusy} onClick={() => void loadUpstream()}>
              <Database className="size-4" /> Load upstream SQLite example
            </Button>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept=".json,.csv,.sqlite,.sqlite3,.db,.geojson"
              className="sr-only"
              aria-label="Import Castor scenario files"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? [])
                event.target.value = ''
                if (files.length) void openFiles(files)
              }}
            />
          </div>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            Accepts a scenario or saved-session JSON, a Castor SQLite database, or named CSV tables with optional
            spatial files.{' '}
            <ExternalLink href="https://github.com/ahzs645/PGMaps/blob/main/docs/forestry-castor.md">
              Input formats and model contract
            </ExternalLink>
          </p>
          {(draftLoading || importBusy) && (
            <InlineAlert loading className="mt-3">
              {draftLoading ? 'Checking for a saved local scenario…' : 'Reading and validating the selected data…'}
            </InlineAlert>
          )}
          {importError && (
            <InlineAlert tone="error" title="Inputs could not be loaded" className="mt-3">
              {importError}
            </InlineAlert>
          )}
          {draftError && (
            <InlineAlert tone="warning" className="mt-3">
              {draftError}
            </InlineAlert>
          )}
          {project && (
            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold">{project.name}</h2>
                {project.provenance.synthetic && (
                  <Badge tone="warning" size="sm">
                    Synthetic demonstration
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{project.description}</p>
              {config.mode === 'queue' &&
                !project.harvestFlows.some(
                  (flow) => flow.period <= config.periods && flow.targetM3 * config.targetMultiplier > 0,
                ) && (
                  <InlineAlert title="No active harvest-flow targets">
                    Set live or salvage targets in the Scenario tab to run a harvest queue. Growth and any committed
                    partial-cut treatments can still run without queue targets.
                  </InlineAlert>
                )}
              <StatGroup
                variant="tiles"
                size="sm"
                columns={4}
                items={[
                  { label: 'Forest pixels', value: number(project.pixels.length) },
                  {
                    label: 'Landscape area',
                    value: `${number(
                      project.pixels.reduce((sum, pixel) => sum + pixel.areaHa, 0),
                      1,
                    )} ha`,
                  },
                  {
                    label: 'Harvesting land base',
                    value: `${number(
                      project.pixels.reduce((sum, pixel) => sum + pixel.thlbHa, 0),
                      1,
                    )} ha`,
                  },
                  { label: 'Yield curves', value: number(project.yieldCurves.length) },
                ]}
              />
              <p className="text-xs text-muted-foreground">
                {validation?.errors.length ? 'Resolve invalid inputs before saving this draft.' : draftMessage}
              </p>
              <details className="rounded-lg border p-3">
                <summary className="cursor-pointer text-sm font-medium">Overlay a local GeoTIFF</summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <SelectField
                    label="Raster meaning"
                    value={rasterRole}
                    onChange={(event) => setRasterRole(event.target.value as RasterRole)}
                  >
                    <option value="salvage">Salvage volume (m³/ha)</option>
                    <option value="blocks">Harvest block identifiers</option>
                    <option value="zone">Management zone identifiers</option>
                    <option value="harvest-period">Harvest period (one band)</option>
                    <option value="harvest-schedule">Harvest schedule (one band per period)</option>
                  </SelectField>
                  {rasterRole === 'zone' && (
                    <FormField label="Imported zone name">
                      <input
                        value={zoneName}
                        onChange={(event) => setZoneName(event.target.value)}
                        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                      />
                    </FormField>
                  )}
                </div>
                <p className="my-3 text-xs leading-5 text-muted-foreground">
                  The raster must match this project's grid, resolution and projected CRS. The import preserves no-data
                  semantics and performs no resampling. Scheduled harvest overlays switch the scenario to
                  supplied-schedule mode.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={importBusy || !project.grid}
                  onClick={() => rasterInput.current?.click()}
                >
                  <FolderOpen className="size-4" /> Import raster overlay
                </Button>
                {!project.grid && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Attach a regular projected grid before importing raster overlays.
                  </p>
                )}
                <input
                  ref={rasterInput}
                  className="sr-only"
                  type="file"
                  accept=".tif,.tiff"
                  aria-label="Import Castor raster overlay"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    if (file) void openRaster(file)
                  }}
                />
              </details>
            </div>
          )}
        </Section>

        {project && (
          <>
            <div className="my-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3">
              <div className="flex flex-wrap gap-2">
                {running ? (
                  <Button variant="outline" onClick={cancel}>
                    <Square className="size-4" /> Cancel run
                  </Button>
                ) : (
                  <Button
                    disabled={importBusy || !!validation?.errors.length}
                    onClick={() => {
                      setView('setup')
                      run(project, config)
                    }}
                  >
                    <Play className="size-4" /> Run forest scenario
                  </Button>
                )}
                <Button variant="outline" disabled={!!validation?.errors.length} onClick={saveSession}>
                  <Save className="size-4" /> Save session JSON
                </Button>
                <Button
                  variant="outline"
                  disabled={!result || exportBusy}
                  onClick={async () => {
                    if (!result) return
                    setExportBusy(true)
                    setExportError('')
                    try {
                      downloadBlob(await castorReportBundle(project, result), 'castor-report-bundle.zip')
                    } catch (cause: unknown) {
                      setExportError(cause instanceof Error ? cause.message : 'The report bundle could not be created.')
                    } finally {
                      setExportBusy(false)
                    }
                  }}
                >
                  <Download className="size-4" /> {exportBusy ? 'Preparing reports…' : 'Download complete report'}
                </Button>
              </div>
              <div
                className="text-xs text-muted-foreground"
                role="status"
                aria-live="polite"
                data-testid="castor-run-status"
              >
                {state.status === 'idle'
                  ? (state.message ?? 'Ready to run.')
                  : state.status === 'running'
                    ? state.progress.message
                    : state.status === 'complete'
                      ? `Scenario complete · ${number(state.elapsedMs / 1000, 2)} s`
                      : 'Scenario could not complete.'}
              </div>
            </div>
            {running && (
              <progress
                className="mb-4 h-2 w-full accent-teal-700"
                aria-label="Forest scenario progress"
                value={state.progress.completed}
                max={Math.max(1, state.progress.total)}
              />
            )}
            {state.status === 'error' && (
              <InlineAlert tone="error" className="mb-4">
                {state.message}
              </InlineAlert>
            )}
            {exportError && (
              <InlineAlert tone="error" className="mb-4">
                {exportError}
              </InlineAlert>
            )}
            {!!validation?.errors.length && (
              <InlineAlert tone="error" title="Review scenario inputs" className="mb-4">
                <ul className="list-disc space-y-1 pl-4">
                  {validation.errors.map((issue, index) => (
                    <li key={index}>
                      {issue.path}: {issue.message}
                    </li>
                  ))}
                </ul>
              </InlineAlert>
            )}
            <TabBar<View>
              value={view}
              onChange={setView}
              idPrefix="castor"
              label="Castor workflow"
              stretch
              options={[
                { value: 'setup', label: 'Scenario', icon: Settings2 },
                { value: 'results', label: 'Reports', icon: ChartNoAxesCombined, disabled: !result },
                { value: 'map', label: 'Maps', icon: MapIcon, disabled: !result },
                { value: 'methods', label: 'Methods', icon: BookOpen },
              ]}
              className="mb-5"
            />
            <div
              role="tabpanel"
              id="castor-panel-setup"
              aria-labelledby="castor-tab-setup"
              hidden={view !== 'setup'}
              className="space-y-5"
            >
              {!!validation?.warnings.length && (
                <details className="rounded-lg border bg-card p-4">
                  <summary className="cursor-pointer text-sm font-medium">
                    Input notes ({validation.warnings.length})
                  </summary>
                  <ul className="mt-3 list-disc space-y-2 pl-5 text-xs leading-5 text-muted-foreground">
                    {validation.warnings.map((warning, index) => (
                      <li key={index}>{warning}</li>
                    ))}
                  </ul>
                </details>
              )}
              <ScenarioSettings
                project={project}
                config={config}
                onProjectChange={updateProject}
                onConfigChange={updateConfig}
              />
              <JsonEditor
                label="Complete project"
                value={project}
                onApply={(value) => {
                  const checked = validateCastorProject(value, config)
                  if (checked.errors.length)
                    throw new Error(checked.errors.map((issue) => `${issue.path}: ${issue.message}`).join('\n'))
                  updateProject(value as CastorProject)
                }}
                description="Advanced editing of pixel attributes, treatments, zones, yield assignments, adjacency, supplied landings and georeferencing. Apply validates the entire project before replacing the working scenario."
              />
            </div>
            <div
              role="tabpanel"
              id="castor-panel-results"
              aria-labelledby="castor-tab-results"
              hidden={view !== 'results'}
            >
              {result && (
                <ResultsPanel
                  result={result}
                  baseline={baseline}
                  onKeepBaseline={() => setBaseline(result)}
                  onClearBaseline={() => setBaseline(null)}
                />
              )}
            </div>
            <div role="tabpanel" id="castor-panel-map" aria-labelledby="castor-tab-map" hidden={view !== 'map'}>
              {result && view === 'map' && <SpatialPanel project={project} result={result} />}
            </div>
            <div
              role="tabpanel"
              id="castor-panel-methods"
              aria-labelledby="castor-tab-methods"
              hidden={view !== 'methods'}
            >
              <MethodsPanel project={project} result={result} />
            </div>
          </>
        )}
        {!project && !draftLoading && (
          <div className="mt-6">
            <MethodsPanel project={null} result={null} />
          </div>
        )}
      </div>
    </div>
  )
}
