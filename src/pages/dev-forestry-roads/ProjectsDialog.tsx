import { NativeSelect } from '@/components/ui/form-field'
import { useState } from 'react'
import { ArrowLeft, Copy, FolderOpen, LibraryBig, Mountain, Plus, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PanelDialog } from '@/components/ui/dialog-shell'
import { InlineAlert } from '@/components/ui/map-panels'
import { Field, NumberField, roadFieldClass } from './Controls'
import type { LibraryEntry } from './projectLibrary'
import type { Coordinate } from './types'
import { ROAD_SCENARIOS, type RoadScenarioId } from './scenarios'

/** How a new project gets its terrain. Every kind but the BC sample starts with one straight road. */
export type NewProject = { name: string } & (
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
  portalContainer,
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
  portalContainer?: HTMLElement | null
}) {
  const [view, setView] = useState<'list' | 'new' | 'scenarios'>('list')
  const [confirm, setConfirm] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<NewProject['kind']>('regional')
  const [place, setPlace] = useState(0)
  const [lat, setLat] = useState<number | null>(null)
  const [lon, setLon] = useState<number | null>(null)
  const [sizeKm, setSizeKm] = useState(3)
  const preset = PLACES[place].centre ?? centre
  const at: Coordinate = [lon ?? preset[0], lat ?? preset[1]]
  const close = (next: boolean) => {
    onOpenChange(next)
    if (!next) {
      setView('list')
      setConfirm(null)
    }
  }
  const create = () => {
    const title = name.trim() || (kind === 'regional' ? `Road project near ${PLACES[place].label}` : 'New road project')
    onCreate(kind === 'regional' ? { name: title, kind, centre: at, sizeKm } : ({ name: title, kind } as NewProject))
    setName('')
    close(false)
  }
  return (
    <PanelDialog
      open={open}
      onOpenChange={close}
      title={view === 'list' ? 'Projects & scenarios' : view === 'scenarios' ? 'Scenario library' : 'New project'}
      subtitle={
        view === 'list'
          ? 'Saved in this browser'
          : view === 'scenarios'
            ? 'Each example loads its own terrain and map context'
            : 'Choose where its terrain comes from'
      }
      size="lg"
      portalContainer={portalContainer}
      contentProps={{ 'data-testid': 'road-projects-dialog' }}
    >
      <fieldset disabled={busy} className="min-w-0 space-y-4">
        {view === 'list' ? (
          <>
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
            {onScenario && (
              <Button variant="outline" className="w-full" onClick={() => setView('scenarios')}>
                <LibraryBig className="size-4" />
                Browse {ROAD_SCENARIOS.length} example scenarios
              </Button>
            )}
            <ul className="divide-y rounded-lg border" aria-label="Saved projects">
              {library.map((entry) => {
                const current = entry.id === activeId
                return (
                  <li key={entry.id} className="flex items-center gap-2 p-2.5">
                    <Mountain className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {entry.name}
                        {current && (
                          <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                            Open now
                          </span>
                        )}
                      </p>
                      <p className="truncate text-xs text-muted-foreground" title={entry.terrain}>
                        {entry.roads} road{entry.roads === 1 ? '' : 's'} · {entry.terrain} · edited{' '}
                        {ago(entry.updatedAt)}
                      </p>
                    </div>
                    {confirm === entry.id ? (
                      <span className="flex shrink-0 items-center gap-1">
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
                      <span className="flex shrink-0 items-center gap-1">
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
              {!library.length && (
                <li className="p-3 text-sm text-muted-foreground">No projects saved in this browser yet.</li>
              )}
            </ul>
            <p className="text-xs text-muted-foreground">
              Projects autosave here as you edit and stay in this browser only. Use Save → Save project JSON to keep a
              copy or move one to another device. Imported terrain is stored with its project.
            </p>
          </>
        ) : view === 'scenarios' ? (
          <>
            <Button variant="ghost" size="sm" className="-ml-2" onClick={() => setView('list')}>
              <ArrowLeft className="size-4" />
              All projects
            </Button>
            <div className="grid gap-3 sm:grid-cols-2" aria-label="Road scenario library">
              {ROAD_SCENARIOS.map((scenario) => (
                <article key={scenario.id} className="flex flex-col gap-2 rounded-lg border p-3">
                  <div>
                    <h3 className="text-sm font-semibold">{scenario.name}</h3>
                    <p className="mt-0.5 text-xs font-medium text-primary">{scenario.terrain}</p>
                  </div>
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
            <InlineAlert>
              Every scenario opens as a new editable project. Your current project stays in Projects. Public road
              tenures and harvest openings load for the real landscapes; missing sources are reported. A mapped road
              does not establish its age, condition or permission to use it.
            </InlineAlert>
          </>
        ) : (
          <>
            <Button variant="ghost" size="sm" className="-ml-2" onClick={() => setView('list')}>
              <ArrowLeft className="size-4" />
              All projects
            </Button>
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
                  <NativeSelect
                    className={roadFieldClass}
                    value={place}
                    onChange={(e) => {
                      setPlace(Number(e.target.value))
                      setLat(null)
                      setLon(null)
                    }}
                  >
                    {PLACES.map((p, i) => (
                      <option key={p.label} value={i}>
                        {p.label}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <div className="grid grid-cols-3 gap-2">
                  <NumberField label="Latitude" value={at[1]} min={-85} max={85} step={0.001} onChange={setLat} />
                  <NumberField label="Longitude" value={at[0]} min={-180} max={180} step={0.001} onChange={setLon} />
                  <NumberField label="Area (km)" value={sizeKm} min={1} max={10} step={1} onChange={setSizeKm} />
                </div>
                <p className="text-xs text-muted-foreground">
                  A {sizeKm} × {sizeKm} km square around this point. The project starts with a straight 300 m road at
                  its centre: drag its ends, or use Peg road to draw your own.
                </p>
              </div>
            )}
            {kind === 'import' && (
              <InlineAlert>
                Create opens the file picker. The road starts across the middle of the imported terrain. Set the DEM
                vertical datum in the Terrain tab first if the file does not carry one.
              </InlineAlert>
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
