import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { Button } from '@/components/ui/button'
import { AccessHistoryPanel } from '@/pages/dev-forestry-roads/AccessHistoryPanel'
import type { AccessHistorySelection, AccessHistoryWorkspace } from '@/pages/dev-forestry-roads/AccessHistorySelection'
import { createAccessHistoryState } from '@/pages/dev-forestry-roads/accessHistory'
import { BcAccessDiscoveryPanel } from '@/pages/dev-forestry-roads/BcAccessDiscoveryPanel'
import { loadBcAccessPilot } from '@/pages/dev-forestry-roads/bcAccessPilot'
import { parseProject } from '@/pages/dev-forestry-roads/project'
import { historicalMapFeatures } from '@/pages/dev-forestry-roads/accessHistoryMap'
import { createAccessHistoryTrainingProject } from '@/pages/dev-forestry-roads/trainingAccessHistoryScenario'
import { createDemoProject } from '@/pages/dev-forestry-roads/terrain'
import type { Coordinate, RoadProject } from '@/pages/dev-forestry-roads/types'
import '@/index.css'

function emptySourceProject(): RoadProject {
  const project = createDemoProject()
  return {
    ...project,
    name: 'Source record review',
    context: [],
    accessHistory: createAccessHistoryState(),
    alignments: project.alignments.map((alignment) => ({
      ...alignment,
      name: 'Unused design draft · evidence diagram only',
    })),
  }
}

const coordinatesOf = (project: RoadProject): Coordinate[] => [
  ...project.context.flatMap((feature) =>
    (feature.geometry.type === 'Polygon' ? feature.geometry.coordinates.flat() : feature.geometry.coordinates).map(
      ([x, y]) => [x, y] as Coordinate,
    ),
  ),
  ...(project.accessHistory?.structures.map((structure) => structure.coordinate) ?? []),
  ...(project.accessHistory?.anchors.map((anchor) => anchor.coordinate) ?? []),
]

function EvidenceDiagram({
  project,
  focus,
  selection,
  onSelect,
}: {
  project: RoadProject
  focus: Coordinate[] | null
  selection: AccessHistorySelection | null
  onSelect: (kind: AccessHistorySelection['kind'], id: string) => void
}) {
  const data = useMemo(() => historicalMapFeatures(project.context, project.accessHistory), [project])
  const coordinates = focus?.length ? focus : coordinatesOf(project)
  const extent = coordinates.length
    ? coordinates
    : [
        [-122.7, 53.9],
        [-122.69, 53.91],
      ]
  const centreLatitude = extent.reduce((sum, point) => sum + point[1], 0) / extent.length
  const cosLatitude = Math.cos((centreLatitude * Math.PI) / 180)
  const xs = extent.map((point) => point[0] * cosLatitude),
    ys = extent.map((point) => point[1])
  const raw = xs.reduce(
    (bounds, x, index) => [
      Math.min(bounds[0], x),
      Math.min(bounds[1], ys[index]),
      Math.max(bounds[2], x),
      Math.max(bounds[3], ys[index]),
    ],
    [Infinity, Infinity, -Infinity, -Infinity],
  )
  const padding = focus
    ? Math.max(0.009, (raw[2] - raw[0]) * 0.15, (raw[3] - raw[1]) * 0.15)
    : Math.max(0.001, (raw[2] - raw[0]) * 0.08, (raw[3] - raw[1]) * 0.08)
  const bounds = [raw[0] - padding, raw[1] - padding, raw[2] + padding, raw[3] + padding]
  const scale = Math.min(720 / (bounds[2] - bounds[0]), 430 / (bounds[3] - bounds[1]))
  const projectPoint = ([longitude, latitude]: number[]) => [
    40 + (longitude * cosLatitude - bounds[0]) * scale,
    470 - (latitude - bounds[1]) * scale,
  ]
  const line = (points: number[][], close = false) =>
    points.map((point, index) => `${index ? 'L' : 'M'}${projectPoint(point).join(',')}`).join(' ') + (close ? ' Z' : '')
  const activate = (event: KeyboardEvent<SVGElement>, kind: AccessHistorySelection['kind'], id: string) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onSelect(kind, id)
  }
  return (
    <div className="space-y-3 rounded-lg border bg-background p-3" data-testid="history-coordinate-diagram">
      <div>
        <h2 className="font-semibold">Evidence coordinate diagram</h2>
        <p className="text-sm text-muted-foreground">
          Loaded block and road coordinates, saved access assertions and reported structures. This is a diagram; it
          provides no basemap or terrain analysis.
        </p>
      </div>
      <svg
        viewBox="0 0 800 510"
        role="img"
        aria-label="Coordinate diagram of retained access records"
        className="w-full rounded border bg-slate-50"
      >
        <defs>
          <clipPath id="review-evidence-clip">
            <rect x="0" y="0" width="800" height="510" />
          </clipPath>
        </defs>
        <g clipPath="url(#review-evidence-clip)">
          {project.context
            .filter((feature) => feature.kind === 'harvest' || feature.kind === 'existing-road')
            .map((feature) => (
              <path
                key={feature.id}
                d={
                  feature.geometry.type === 'Polygon'
                    ? feature.geometry.coordinates.map((ring) => line(ring, true)).join(' ')
                    : line(feature.geometry.coordinates)
                }
                fill={feature.kind === 'harvest' ? '#bbf7d0' : 'none'}
                fillOpacity={0.7}
                fillRule="evenodd"
                stroke={feature.id === selection?.id ? '#0284c7' : feature.kind === 'harvest' ? '#15803d' : '#64748b'}
                strokeWidth={feature.id === selection?.id ? 6 : feature.kind === 'existing-road' ? 3 : 1.5}
                vectorEffect="non-scaling-stroke"
                role="button"
                tabIndex={0}
                aria-label={`Inspect ${feature.name}`}
                className="cursor-pointer focus:stroke-amber-600"
                onClick={() => onSelect(feature.kind === 'harvest' ? 'block' : 'road', feature.id)}
                onKeyDown={(event) => activate(event, feature.kind === 'harvest' ? 'block' : 'road', feature.id)}
              >
                <title>{feature.name}</title>
              </path>
            ))}
          {data.route.features.map((feature) =>
            feature.geometry.type === 'LineString' ? (
              <path
                key={String(feature.id)}
                d={line(feature.geometry.coordinates)}
                fill="none"
                stroke={String(feature.properties?.color)}
                strokeWidth={5}
                strokeDasharray="10 5"
                vectorEffect="non-scaling-stroke"
                role="button"
                tabIndex={0}
                aria-label={`Inspect saved route ${feature.properties?.name}`}
                className="cursor-pointer"
                onClick={() => onSelect('path', String(feature.id))}
                onKeyDown={(event) => activate(event, 'path', String(feature.id))}
              >
                <title>
                  {feature.properties?.relationship} · {feature.properties?.date} · {feature.properties?.status}
                </title>
              </path>
            ) : null,
          )}
          {data.structures.features.map((feature) => {
            if (feature.geometry.type !== 'Point') return null
            const [cx, cy] = projectPoint(feature.geometry.coordinates)
            return (
              <circle
                key={String(feature.id)}
                cx={cx}
                cy={cy}
                r={7}
                fill={String(feature.properties?.color)}
                stroke="white"
                strokeWidth={2}
                role="button"
                tabIndex={0}
                aria-label={`Inspect ${feature.properties?.name}`}
                className="cursor-pointer"
                onClick={() => onSelect('structure', String(feature.id))}
                onKeyDown={(event) => activate(event, 'structure', String(feature.id))}
              >
                <title>
                  {feature.properties?.name} · {feature.properties?.status}
                </title>
              </circle>
            )
          })}
          {(project.accessHistory?.anchors ?? []).map((anchor) => {
            const [x, y] = projectPoint(anchor.coordinate)
            return (
              <g key={anchor.id}>
                <rect
                  x={x - 4}
                  y={y - 4}
                  width={8}
                  height={8}
                  fill={anchor.role === 'entrance' ? '#7c3aed' : '#334155'}
                  stroke="white"
                >
                  <title>
                    {anchor.name} · {anchor.role}
                  </title>
                </rect>
              </g>
            )
          })}
        </g>
      </svg>
      <p className="text-xs text-muted-foreground">
        Green areas: cutblock records · grey lines: mapped roads · blue: selected source record · dashed line: selected
        historical assertion · circles: structure records · squares: explicit anchors. Select a feature to read its
        evidence.
      </p>
      {data.legend.map((section) => (
        <div key={section.id} className="text-xs">
          <p className="font-medium">{section.title}</p>
          {section.entries.map((entry) => (
            <p key={entry.id}>{entry.label}</p>
          ))}
        </div>
      ))}
      <p className="text-xs">
        {project.context.filter((feature) => feature.kind === 'harvest').length} loaded blocks ·{' '}
        {project.context.filter((feature) => feature.kind === 'existing-road').length} loaded roads ·{' '}
        {project.accessHistory?.structures.length ?? 0} structure records
      </p>
    </div>
  )
}

function InterfaceReview() {
  const [project, setProject] = useState(emptySourceProject)
  const [discover, setDiscover] = useState(true)
  const current = useRef(project)
  const past = useRef<RoadProject[]>([])
  const [canUndo, setCanUndo] = useState(false)
  const [notice, setNotice] = useState(
    'Search ministry cutblock records. Checked openings: 60677, 56944, 11981 and 11984. Teaching examples are available separately.',
  )
  const [selection, setSelection] = useState<AccessHistorySelection | null>(null)
  const selectionRevision = useRef(0)
  const [focus, setFocus] = useState<Coordinate[] | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  const loading = useRef<AbortController | null>(null)
  useEffect(() => () => loading.current?.abort(), [])
  const update: AccessHistoryWorkspace['update'] = (change) => {
    const next = change(current.current)
    past.current = [...past.current.slice(-29), current.current]
    setCanUndo(true)
    current.current = next
    setProject(next)
  }
  const workspace: AccessHistoryWorkspace = {
    project,
    projectId: 'interface-review',
    alignment:
      project.alignments.find((alignment) => alignment.id === project.activeAlignmentId) ?? project.alignments[0],
    busy: '',
    update,
    setNotice,
    canUndo,
    undo: () => {
      const previous = past.current.pop()
      setCanUndo(past.current.length > 0)
      if (previous) {
        current.current = previous
        setProject(previous)
      }
    },
  }
  const reset = (next: RoadProject) => {
    loading.current?.abort()
    update(() => next)
    setSelection(null)
    setFocus(null)
  }
  const select = (kind: AccessHistorySelection['kind'], id: string) => {
    setSelection({ kind, id, revision: ++selectionRevision.current })
  }
  const openStudy = async (openingId: string) => {
    loading.current?.abort()
    const controller = new AbortController()
    loading.current = controller
    const pilot = await loadBcAccessPilot(openingId, controller.signal)
    if (controller.signal.aborted) throw new DOMException('Study loading cancelled.', 'AbortError')
    if (!pilot.blocks.length) throw Error('No mapped cutblock returned. The current study was kept.')
    const harvestStart = pilot.identity.records.find(
      (record) => record.source === 'ften-cutblock',
    )?.disturbanceStartDate
    const history = createAccessHistoryState(harvestStart)
    history.sources = pilot.sources
    const next = parseProject({
      ...emptySourceProject(),
      name: `Opening ${openingId} · real BC records`,
      context: [...pilot.blocks, ...pilot.roads],
      accessHistory: history,
    })
    loading.current = null
    reset(next)
    select('block', pilot.blocks[0].id)
    if (pilot.bounds)
      setFocus([
        [pilot.bounds[0], pilot.bounds[1]],
        [pilot.bounds[2], pilot.bounds[3]],
      ])
    setDiscover(false)
    setNotice(
      `Opened actual opening ${openingId}: ${pilot.blocks.length} block part(s), ${pilot.roads.length} mapped road part(s), ${pilot.roadCandidates.length} within 1 km of its footprint. No design road or historical route has been created.`,
    )
  }
  return (
    <main className="min-h-screen bg-background p-3 text-foreground sm:p-5">
      <header className="mx-auto mb-4 max-w-7xl space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          PGMaps · component review · PR #94
        </p>
        <h1 className="text-xl font-semibold sm:text-2xl">Block access and source evidence</h1>
        <p className="max-w-4xl text-sm text-muted-foreground">
          This page reuses the access-history interface and source queries. The coordinate diagram supports interface
          review where WebGL is unavailable. It is separate from the full road-design map and its terrain tools.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={discover ? 'default' : 'outline'} onClick={() => setDiscover(!discover)}>
            {discover ? 'Show current study' : 'Find BC cutblocks'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              reset(emptySourceProject())
              setDiscover(true)
              setNotice(
                'Empty source study ready. Open Access history and choose Load actual BC records, then review and add the returned records.',
              )
            }}
          >
            Start source-only review
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              reset(createAccessHistoryTrainingProject())
              setDiscover(false)
              setNotice('Loaded the synthetic teaching example.')
            }}
          >
            Load teaching example
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setFocus(null)}>
            Fit loaded records
          </Button>
          <a
            href="https://github.com/ahzs645/PGMaps/pull/94"
            target="_blank"
            rel="noreferrer"
            className="self-center text-sm underline"
          >
            Review PR #94
          </a>
        </div>
        <p className="text-xs" role="status">
          {notice}
        </p>
      </header>
      {discover && (
        <div className="mx-auto mb-4 max-w-7xl rounded-lg border p-4">
          <BcAccessDiscoveryPanel onOpenStudy={openStudy} active={discover} />
        </div>
      )}
      <div className="history-review-grid mx-auto grid max-w-7xl gap-4">
        <div ref={panel} className="history-review-panel min-w-0 rounded-lg border p-2" data-map-sidebar-scroll="true">
          <AccessHistoryPanel
            workspace={workspace}
            selection={selection}
            onLocate={setFocus}
            defaultOpen
            onInspectRecord={select}
            onSelectBlock={(id) => select('block', id)}
          />
        </div>
        <div className="min-w-0">
          <EvidenceDiagram
            project={project}
            focus={focus}
            selection={selection}
            onSelect={(kind, id) => {
              select(kind, id)
              const toggle = panel.current?.querySelector<HTMLButtonElement>(
                '[data-testid="road-access-history-toggle"]',
              )
              if (toggle?.getAttribute('aria-expanded') !== 'true') toggle?.click()
              panel.current?.scrollIntoView({ block: 'nearest' })
            }}
          />
        </div>
      </div>
      <footer className="mx-auto mt-4 max-w-7xl text-xs text-muted-foreground">
        Changes stay in this page until exported. Use the history bundle export to retain your review; resets remain
        undoable during this session.
      </footer>
    </main>
  )
}

const root = document.getElementById('root')
if (root) createRoot(root).render(<InterfaceReview />)
