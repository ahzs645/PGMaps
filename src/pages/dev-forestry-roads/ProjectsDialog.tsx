import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Copy, FolderOpen, LibraryBig, Mountain, Plus, Search, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PanelDialog } from '@/components/ui/dialog-shell'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert } from '@/components/ui/map-panels'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { ListHeader } from '@/components/ui/result-list'
import { Field, NumberField, roadFieldClass, RoadSelect } from './Controls'
import { BcAccessDiscoveryPanel } from './BcAccessDiscoveryPanel'
import { BC_ACCESS_EXAMPLES } from './bcAccessExamples'
import type { LibraryEntry } from './projectLibrary'
import { DesignStandardsFields } from './DesignStandardsFields'
import type { JobStandards } from './jobStandards'
import type { Coordinate } from './types'
import { ROAD_SCENARIOS, type RoadScenarioId, type ScenarioContent } from './scenarios'

/**
 * How a new project gets its terrain, and the design standards entered for it. Regional and imported
 * terrain start with no road; the BC sample and the training example bring their example roads.
 */
export type NewProject = { name: string; standards?: JobStandards } & (
  | { kind: 'lidar' }
  | { kind: 'regional'; centre: Coordinate; sizeKm: number }
  | { kind: 'import' }
  | { kind: 'training' }
)

const PLACES: { label: string; centre: Coordinate | null }[] = [
  { label: 'Centre of the open project', centre: null },
  { label: 'Prince George', centre: [-122.75, 53.92] },
  { label: 'Kamloops', centre: [-120.33, 50.67] },
  { label: 'Vernon', centre: [-119.27, 50.27] },
  { label: 'Williams Lake', centre: [-122.14, 52.13] },
  { label: 'Smithers', centre: [-127.17, 54.78] },
]
const STARTS = [
  {
    kind: 'regional',
    title: 'Regional DEM at a place',
    detail: 'Coarse open terrain anywhere, for corridor screening. Loads in a few seconds.',
  },
  {
    kind: 'import',
    title: 'Import your own terrain',
    detail: 'A GeoTIFF DEM or a LAS/LAZ point cloud for preliminary design.',
  },
  {
    kind: 'lidar',
    title: 'BC 1 m LiDAR sample',
    detail: 'The published 093G086 tile with an example road to explore.',
  },
  {
    kind: 'training',
    title: 'Training example',
    detail: 'Synthetic ground with no downloads, for learning the tools.',
  },
] as const

const ago = (time: number) => {
  const minutes = Math.round((Date.now() - time) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return new Date(time).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** The projects kept in this browser, and the way to start a new one. */
export function ProjectsDialog({
  open,
  onOpenChange,
  library,
  activeId,
  centre,
  busy,
  onOpen,
  onDuplicate,
  onDelete,
  onOpenFile,
  onCreate,
  onScenario,
  onOpenBcOpening,
  portalContainer,
  newProjectRequest,
  startingStandards,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  library: LibraryEntry[]
  activeId: string | null
  /** Centre of the open project, offered as the default place for a regional DEM. */
  centre: Coordinate
  busy: boolean
  onOpen: (id: string) => void
  onDuplicate: (id: string) => void
  onDelete: (id: string) => void
  onOpenFile: () => void
  onCreate: (start: NewProject) => void
  onScenario?: (id: RoadScenarioId) => void
  /** Resolves only after a new investigation workspace has loaded; rejection leaves discovery open. */
  onOpenBcOpening?: (openingId: string) => Promise<void>
  portalContainer?: HTMLElement | null
  /** Rises each time something outside asks for the new-project form. */
  newProjectRequest?: number
  /** What the new-project form's design standards start from. Omitted, the form does not ask. */
  startingStandards?: JobStandards
}) {
  const [view, setView] = useState<'list' | 'new' | 'scenarios' | 'discover'>('list')
  // A request from outside the dialog opens it straight on the new-project form.
  const [seenNewRequest, setSeenNewRequest] = useState(newProjectRequest)
  if (newProjectRequest !== seenNewRequest) {
    setSeenNewRequest(newProjectRequest)
    if (newProjectRequest) setView('new')
  }
  const [cutblockFilter, setCutblockFilter] = useState<'all' | 'with' | 'without'>('all')
  const [scenarioFilter, setScenarioFilter] = useState<'all' | 'records' | 'design' | 'training'>('all')
  const [scenarioSearch, setScenarioSearch] = useState('')
  const [savedSearch, setSavedSearch] = useState('')
  const [savedFilter, setSavedFilter] = useState<'all' | 'studies' | 'designs'>('all')
  const [openingExample, setOpeningExample] = useState<string | null>(null)
  const [exampleError, setExampleError] = useState('')
  const pendingExample = useRef(false)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const [confirm, setConfirm] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<NewProject['kind']>('regional')
  const [place, setPlace] = useState(0)
  const [lat, setLat] = useState<number | null>(null)
  const [lon, setLon] = useState<number | null>(null)
  const [sizeKm, setSizeKm] = useState(3)
  const [standards, setStandards] = useState(startingStandards)
  const preset = PLACES[place].centre ?? centre
  const at: Coordinate = [lon ?? preset[0], lat ?? preset[1]]
  const savedNeedle = savedSearch.trim().toLowerCase()
  const savedEntries = library.filter(
    (entry) =>
      (!savedNeedle ||
        [entry.name, entry.openingId, entry.terrain].some((text) => text?.toLowerCase().includes(savedNeedle))) &&
      (savedFilter === 'all' || (entry.workspaceMode === 'access-investigation') === (savedFilter === 'studies')),
  )
  const scenarioNeedle = scenarioSearch.trim().toLowerCase()
  const examples = onOpenBcOpening
    ? BC_ACCESS_EXAMPLES.filter(
        (example) =>
          (scenarioFilter === 'all' || scenarioFilter === 'records') &&
          cutblockFilter !== 'without' &&
          (!scenarioNeedle ||
            [example.title, example.description, example.openingId].some((text) =>
              text.toLowerCase().includes(scenarioNeedle),
            )),
      )
    : []
  const scenarios = ROAD_SCENARIOS.filter((scenario) => {
    if (scenario.kind === 'history-pilot' && onOpenBcOpening) return false
    if (!onScenario) return false
    const category =
      scenario.kind === 'history-pilot' ? 'records' : scenario.kind === 'training' ? 'training' : 'design'
    return (
      (scenarioFilter === 'all' || category === scenarioFilter) &&
      (cutblockFilter === 'all' || (scenario.contents.cutblocks !== 'none') === (cutblockFilter === 'with')) &&
      (!scenarioNeedle ||
        [scenario.name, scenario.terrain, scenario.detail, scenario.focus].some((text) =>
          text.toLowerCase().includes(scenarioNeedle),
        ))
    )
  })
  const scenarioCount =
    (onScenario
      ? ROAD_SCENARIOS.filter((scenario) => !onOpenBcOpening || scenario.kind !== 'history-pilot').length
      : 0) + (onOpenBcOpening ? BC_ACCESS_EXAMPLES.length : 0)
  const close = (next: boolean) => {
    onOpenChange(next)
    if (!next) {
      setView('list')
      setConfirm(null)
      setExampleError('')
    }
  }
  const create = () => {
    const title = name.trim() || (kind === 'regional' ? `Road project near ${PLACES[place].label}` : 'New road project')
    onCreate(
      kind === 'regional'
        ? { name: title, standards, kind, centre: at, sizeKm }
        : ({ name: title, standards, kind } as NewProject),
    )
    setName('')
    setStandards(startingStandards)
    close(false)
  }
  const openBcStudy = async (openingId: string) => {
    if (!onOpenBcOpening) throw Error('Opening BC studies is unavailable in this workspace.')
    await onOpenBcOpening(openingId)
    if (mounted.current) close(false)
  }
  const openExample = async (openingId: string) => {
    if (pendingExample.current || busy) return
    pendingExample.current = true
    setOpeningExample(openingId)
    setExampleError('')
    try {
      await openBcStudy(openingId)
    } catch (cause) {
      if (mounted.current)
        setExampleError(
          `Could not open study for opening ${openingId}. ${cause instanceof Error ? cause.message : String(cause)}`,
        )
    } finally {
      pendingExample.current = false
      if (mounted.current) setOpeningExample(null)
    }
  }
  return (
    <PanelDialog
      open={open}
      onOpenChange={close}
      // Each sub-view goes back from the header, above its title, rather than from a button in the body.
      eyebrow={
        view === 'list' ? undefined : (
          <button
            type="button"
            className="-ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5 normal-case tracking-normal hover:bg-accent hover:text-foreground touch:min-h-10"
            onClick={() => setView('list')}
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            All projects
          </button>
        )
      }
      title={
        view === 'list'
          ? 'Projects & scenarios'
          : view === 'scenarios'
            ? 'Scenario library'
            : view === 'discover'
              ? 'Find BC cutblocks'
              : 'New project'
      }
      subtitle={
        view === 'list'
          ? 'Saved in this browser'
          : view === 'scenarios'
            ? 'Live BC investigations, design examples and synthetic training'
            : view === 'discover'
              ? 'Search ministry records, then open an access study'
              : 'Choose where its terrain comes from'
      }
      size="lg"
      portalContainer={portalContainer}
      contentProps={{ 'data-testid': 'road-projects-dialog' }}
    >
      <fieldset disabled={busy || openingExample !== null} className="min-w-0 space-y-4">
        {view === 'list' ? (
          <>
            {onOpenBcOpening && (
              <div className="min-w-0 rounded-lg border border-primary/30 bg-primary/5 p-3">
                <Button className="w-full" onClick={() => setView('discover')}>
                  <Search className="size-4" />
                  Find BC cutblocks
                </Button>
                <p className="mt-2 text-xs text-muted-foreground">
                  Search by opening, licence, cutting permit or timber mark. Start a study with actual block and road
                  records.
                </p>
              </div>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              <Button onClick={() => setView('new')}>
                <Plus className="size-4" />
                New project
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  close(false)
                  onOpenFile()
                }}
              >
                <FolderOpen className="size-4" />
                Open project file
              </Button>
            </div>
            {(onScenario || onOpenBcOpening) && (
              <Button variant="outline" className="w-full" onClick={() => setView('scenarios')}>
                <LibraryBig className="size-4" />
                Browse {scenarioCount} example scenarios
              </Button>
            )}
            <Field label="Search saved projects">
              <input
                className={roadFieldClass}
                value={savedSearch}
                placeholder="Project name or opening ID"
                onChange={(event) => {
                  setSavedSearch(event.target.value)
                  setConfirm(null)
                }}
              />
            </Field>
            <SegmentedControl
              label="Saved project type"
              size="sm"
              value={savedFilter}
              onChange={setSavedFilter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'studies', label: 'Access studies' },
                { value: 'designs', label: 'Design projects' },
              ]}
            />
            <ListHeader count={savedEntries.length} noun={['saved project', 'saved projects']} sticky={false} />
            <ul className="divide-y rounded-lg border" aria-label="Saved projects">
              {savedEntries.map((entry) => {
                const current = entry.id === activeId
                return (
                  <li key={entry.id} className="flex min-w-0 flex-wrap items-center gap-2 p-2.5">
                    <Mountain className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm font-medium">
                        {entry.name}
                        {current && (
                          <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-3xs font-semibold text-primary">
                            Open now
                          </span>
                        )}
                      </p>
                      <p className="text-xs font-medium text-primary">
                        {entry.workspaceMode === 'access-investigation' ? 'Access study' : 'Design project'}
                        {entry.openingId && ` · Opening ${entry.openingId}`}
                      </p>
                      <p className="break-words text-xs text-muted-foreground">{savedRecordSummary(entry)}</p>
                      <p className="truncate text-xs text-muted-foreground" title={entry.terrain}>
                        {entry.terrain} · edited {ago(entry.updatedAt)}
                      </p>
                    </div>
                    {confirm === entry.id ? (
                      <span className="flex w-full shrink-0 items-center justify-end gap-1 sm:w-auto">
                        <span className="text-xs">Delete?</span>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-7"
                          onClick={() => {
                            onDelete(entry.id)
                            setConfirm(null)
                          }}
                        >
                          Delete
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7" onClick={() => setConfirm(null)}>
                          Keep
                        </Button>
                      </span>
                    ) : (
                      <span className="flex w-full shrink-0 items-center justify-end gap-1 sm:w-auto">
                        {!current && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7"
                            aria-label={`Open ${entry.name}`}
                            onClick={() => {
                              onOpen(entry.id)
                              close(false)
                            }}
                          >
                            Open
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          aria-label={`Duplicate ${entry.name}`}
                          title="Duplicate"
                          onClick={() => onDuplicate(entry.id)}
                        >
                          <Copy className="size-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          aria-label={`Delete ${entry.name}`}
                          title={current ? 'Open another project before deleting this one' : 'Delete'}
                          disabled={current}
                          onClick={() => setConfirm(entry.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </span>
                    )}
                  </li>
                )
              })}
              {!savedEntries.length && (
                <li className="p-3 text-sm text-muted-foreground">
                  {library.length
                    ? 'No saved projects match this search and type.'
                    : 'No projects saved in this browser yet.'}
                </li>
              )}
            </ul>
            <p className="text-xs text-muted-foreground">
              Projects autosave here as you edit and stay in this browser only. Use Save → Save project JSON to keep a
              copy or move one to another device. Imported terrain is stored with its project.
            </p>
          </>
        ) : view === 'scenarios' ? (
          <>
            <Field label="Search example scenarios">
              <input
                className={roadFieldClass}
                value={scenarioSearch}
                placeholder="Place, opening ID or learning topic"
                onChange={(event) => setScenarioSearch(event.target.value)}
              />
            </Field>
            <Field label="Scenario purpose">
              <RoadSelect
                ariaLabel="Scenario purpose"
                className={roadFieldClass}
                value={scenarioFilter}
                onValueChange={(value) => setScenarioFilter(value as typeof scenarioFilter)}
                options={[
                  { value: 'all', label: 'All examples' },
                  { value: 'records', label: 'Actual BC record investigations' },
                  { value: 'design', label: 'Road design examples' },
                  { value: 'training', label: 'Synthetic training examples' },
                ]}
              />
            </Field>
            <SegmentedControl
              label="Show scenarios"
              size="sm"
              fullWidth={false}
              value={cutblockFilter}
              onChange={setCutblockFilter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'with', label: 'With cutblocks' },
                { value: 'without', label: 'No cutblocks' },
              ]}
            />
            <ListHeader count={examples.length + scenarios.length} noun={['example', 'examples']} sticky={false} />
            {openingExample && <InlineAlert loading>Opening study for {openingExample}…</InlineAlert>}
            {exampleError && (
              <InlineAlert tone="error" title="Study not opened">
                {exampleError}
              </InlineAlert>
            )}
            <div className="grid gap-3 sm:grid-cols-2" aria-label="Road scenario library">
              {examples.map((example) => (
                <article
                  key={example.id}
                  className="flex min-w-0 flex-col gap-2 rounded-lg border border-emerald-600/30 bg-emerald-600/5 p-3"
                  data-scenario={example.id}
                  data-cutblocks="mapped"
                >
                  <div>
                    <h3 className="break-words text-sm font-semibold">{example.title}</h3>
                    <p className="mt-0.5 text-xs font-medium text-emerald-800 dark:text-emerald-300">
                      Actual BC record investigation
                    </p>
                  </div>
                  <ul className="flex flex-wrap gap-1" aria-label={`${example.title} contents`}>
                    <ContentChip kind="cutblocks" content="mapped" />
                    <ContentChip kind="roads" content="mapped" />
                  </ul>
                  <p className="text-xs text-muted-foreground">{example.description}</p>
                  <p className="text-xs text-muted-foreground">
                    Opening {example.openingId} · loads current ministry records
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-auto w-full"
                    aria-label={`Open study for ${example.title}`}
                    onClick={() => void openExample(example.openingId)}
                  >
                    <Search className="size-3.5" />
                    Open study
                  </Button>
                </article>
              ))}
              {scenarios.map((scenario) => (
                <article
                  key={scenario.id}
                  className="flex min-w-0 flex-col gap-2 rounded-lg border p-3"
                  data-scenario={scenario.id}
                  data-cutblocks={scenario.contents.cutblocks}
                >
                  <div>
                    <h3 className="break-words text-sm font-semibold">{scenario.name}</h3>
                    <p className="mt-0.5 text-xs font-medium text-primary">{scenario.terrain}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {scenario.kind === 'training'
                        ? 'Synthetic training example'
                        : scenario.kind === 'history-pilot'
                          ? 'Actual BC record investigation'
                          : 'Road design example'}
                    </p>
                  </div>
                  <ul className="flex flex-wrap gap-1" aria-label={`${scenario.name} contents`}>
                    <ContentChip kind="cutblocks" content={scenario.contents.cutblocks} />
                    <ContentChip kind="roads" content={scenario.contents.roads} />
                  </ul>
                  <p className="text-xs text-muted-foreground">{scenario.detail}</p>
                  <p className="text-xs text-muted-foreground">{scenario.focus}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-auto w-full"
                    aria-label={`Load ${scenario.name}`}
                    onClick={() => {
                      onScenario?.(scenario.id)
                      close(false)
                    }}
                  >
                    <Mountain className="size-3.5" />
                    Load scenario
                  </Button>
                </article>
              ))}
            </div>
            {examples.length + scenarios.length === 0 && (
              <p className="text-sm text-muted-foreground">No examples match this search and the selected filters.</p>
            )}
            <InlineAlert>
              Every example opens a new project; your current project stays saved. BC record investigations load source
              evidence without a designed road. Design examples include proposed alignments, and training examples use
              synthetic context. Live record counts can change. A nearby or intersecting road does not establish that it
              was constructed for or used by a block.
            </InlineAlert>
          </>
        ) : view === 'discover' ? (
          <>
            <BcAccessDiscoveryPanel onOpenStudy={openBcStudy} disabled={busy} active={open} />
          </>
        ) : (
          <>
            <Field label="Project name">
              <input
                className={roadFieldClass}
                value={name}
                maxLength={200}
                placeholder="e.g. Tabor Mountain spur"
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <div role="radiogroup" aria-label="Starting terrain" className="grid gap-2 sm:grid-cols-2">
              {STARTS.map((start, index) => (
                <button
                  key={start.kind}
                  type="button"
                  role="radio"
                  aria-checked={kind === start.kind}
                  tabIndex={kind === start.kind ? 0 : -1}
                  onClick={() => setKind(start.kind)}
                  onKeyDown={(event) => {
                    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
                    event.preventDefault()
                    const next =
                      event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? STARTS.length - 1
                          : (index +
                              (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1) +
                              STARTS.length) %
                            STARTS.length
                    setKind(STARTS[next].kind)
                    event.currentTarget.parentElement
                      ?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
                      [next]?.focus()
                  }}
                  className={`rounded-lg border p-3 text-left transition-colors ${kind === start.kind ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted'}`}
                >
                  <span className="block text-sm font-medium">{start.title}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{start.detail}</span>
                </button>
              ))}
            </div>
            {kind === 'regional' && (
              <div className="space-y-2 rounded-lg border p-3">
                <Field label="Place">
                  <RoadSelect
                    ariaLabel="Place"
                    className={roadFieldClass}
                    value={String(place)}
                    onValueChange={(value) => {
                      setPlace(Number(value))
                      setLat(null)
                      setLon(null)
                    }}
                  >
                    {PLACES.map((p, i) => (
                      <option key={p.label} value={i}>
                        {p.label}
                      </option>
                    ))}
                  </RoadSelect>
                </Field>
                <div className="grid grid-cols-3 gap-2">
                  <NumberField label="Latitude" value={at[1]} min={-85} max={85} step={0.001} onChange={setLat} />
                  <NumberField label="Longitude" value={at[0]} min={-180} max={180} step={0.001} onChange={setLon} />
                  <NumberField label="Area (km)" value={sizeKm} min={1} max={10} step={1} onChange={setSizeKm} />
                </div>
                <p className="text-xs text-muted-foreground">
                  A {sizeKm} × {sizeKm} km square around this point. The project starts with no road: peg or sketch one,
                  or load a mapped road.
                </p>
              </div>
            )}
            {kind === 'import' && (
              <InlineAlert>
                Create opens the file picker: one GeoTIFF, or one or more LAS/LAZ tiles. You are asked for the CRS or
                vertical datum if the files do not state them. The road starts across the middle of the terrain.
              </InlineAlert>
            )}
            {standards && (
              <section className="space-y-2 rounded-lg border p-3" aria-label="Design standards">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-medium">Design standards</h3>
                  <InfoTip label="About design standards">
                    What this job&apos;s roads are designed to. The grade and curve checks, the swept path and the
                    Review list read these, and the first road takes the running-surface width and design vehicle. They
                    start from the workspace&apos;s usual values: change the ones your job sets, leave the rest, and
                    edit them later under Review → Design standards. They are your inputs, not a certified road
                    standard.
                  </InfoTip>
                </div>
                <DesignStandardsFields value={standards} onChange={setStandards} />
              </section>
            )}
            <Button className="w-full" onClick={create}>
              {kind === 'import' ? <Upload className="size-4" /> : <Plus className="size-4" />}
              {kind === 'import' ? 'Create and choose terrain file' : 'Create project'}
            </Button>
            <p className="text-xs text-muted-foreground">
              The open project stays saved in this browser; switch back to it from Projects.
            </p>
          </>
        )}
      </fieldset>
    </PanelDialog>
  )
}

function savedRecordSummary(entry: LibraryEntry) {
  const counts = [
    `${entry.roads} designed alignment${entry.roads === 1 ? '' : 's'}`,
    ...(entry.blocks === undefined ? [] : [`${entry.blocks} block part${entry.blocks === 1 ? '' : 's'}`]),
    ...(entry.roadRecords === undefined
      ? []
      : [`${entry.roadRecords} context road record${entry.roadRecords === 1 ? '' : 's'}`]),
  ]
  return counts.join(' · ')
}

const CONTENT_LABELS = {
  cutblocks: { mapped: 'Mapped cutblocks', synthetic: 'Synthetic block', none: 'No cutblocks' },
  roads: { mapped: 'Mapped roads', synthetic: 'Synthetic roads', none: 'No mapped roads' },
} as const

/** One fact about a scenario's context; "none" reads muted so the cards with content stand out. */
function ContentChip({ kind, content }: { kind: keyof typeof CONTENT_LABELS; content: ScenarioContent }) {
  return (
    <li
      className={`rounded-full border px-2 py-0.5 text-3xs font-medium ${
        content === 'none'
          ? 'border-dashed text-muted-foreground'
          : content === 'mapped'
            ? 'border-emerald-600/30 bg-emerald-600/10 text-emerald-800 dark:text-emerald-300'
            : 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300'
      }`}
    >
      {CONTENT_LABELS[kind][content]}
    </li>
  )
}
