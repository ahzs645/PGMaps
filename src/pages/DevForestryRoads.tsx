import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Download, FolderOpen, PanelLeftClose, PanelLeftOpen, Pause, Play, Redo2, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FullscreenButton, FullscreenPanel, useElementFullscreen } from '@/components/ui/fullscreen-panel'
import { InlineAlert } from '@/components/ui/map-panels'
import { StatGroup } from '@/components/ui/stat-group'
import { TabBar } from '@/components/ui/tab-bar'
import { downloadText } from '@/lib/download'
import {
  CableChart,
  CrossSectionChart,
  formatRoadStation,
  MassHaulChart,
  ProfileChart,
} from './dev-forestry-roads/Charts'
import { DesignSidebar, type FileKind } from './dev-forestry-roads/DesignSidebar'
import { PlanView, type DrawMode } from './dev-forestry-roads/PlanView'
import { TerrainPreview } from './dev-forestry-roads/TerrainPreview'
import { analyzeCable, distance, nearestStation, offsetCoordinate } from './dev-forestry-roads/engine'
import {
  importAlignmentGeoJson,
  importContextGeoJson,
  parseProject,
  projectGeoJson,
  projectReportHtml,
  serializeProject,
  stationsCsv,
} from './dev-forestry-roads/project'
import {
  createDemoProject,
  DEFAULT_TEMPLATE,
  demoTerrain,
  loadLidarTerrain,
  loadRaster,
  loadRegionalTerrain,
} from './dev-forestry-roads/terrain'
import { suggestRoute } from './dev-forestry-roads/routing'
import { safeAnalyzeRoad } from './dev-forestry-roads/analysisResult'
import { useRoadWorkspace } from './dev-forestry-roads/useRoadWorkspace'
import type { Alignment, Coordinate, RoadAnalysis, RoadProject } from './dev-forestry-roads/types'

const uid = () => crypto.randomUUID()
const number = (v: number | null | undefined, decimals = 1) =>
  v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('en-CA', { maximumFractionDigits: decimals })
const colors = ['#d97706', '#2563eb', '#7c3aed', '#16a34a', '#db2777']
function newAlignment(points: Coordinate[], name: string, template = DEFAULT_TEMPLATE): Alignment {
  return {
    id: uid(),
    name,
    color: colors[Math.floor(Math.random() * colors.length)],
    points: points.map((coordinate) => ({ id: uid(), coordinate, radiusM: 0 })),
    vertical: [],
    template: { ...template },
    overrides: [],
  }
}
const boundsOf = (p: RoadProject): [number, number, number, number] => {
  const coords = p.alignments.flatMap((a) => a.points.map((p) => p.coordinate))
  return [
    Math.min(...coords.map((p) => p[0])) - 0.001,
    Math.min(...coords.map((p) => p[1])) - 0.001,
    Math.max(...coords.map((p) => p[0])) + 0.001,
    Math.max(...coords.map((p) => p[1])) + 0.001,
  ]
}

function StationTable({
  analysis,
  station,
  onStation,
}: {
  analysis: RoadAnalysis
  station: number
  onStation: (value: number) => void
}) {
  const active = nearestStation(analysis.stations, station)
  const [flagged, setFlagged] = useState(false)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <label className="mb-2 flex items-center gap-2 text-xs">
        <input type="checkbox" checked={flagged} onChange={(e) => setFlagged(e.target.checked)} />
        Show flagged stations only
      </label>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full whitespace-nowrap text-right text-xs" data-testid="road-station-table">
          <thead className="sticky top-0 bg-card">
            <tr>
              {[
                'Station',
                'Ground m',
                'Formation m',
                'Grade %',
                'Cut m²',
                'Fill m²',
                'Interval cut m³',
                'Interval fill m³',
                'Flags',
              ].map((h) => (
                <th key={h} className="border-b px-2 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {analysis.stations
              .filter((s) => !flagged || s.flags.length)
              .map((s) => (
                <tr
                  key={s.index}
                  aria-selected={active?.index === s.index}
                  className={active?.index === s.index ? 'bg-rose-500/10' : 'hover:bg-muted/50'}
                >
                  <td className="border-b px-2 py-1">
                    <button
                      className="font-mono underline decoration-dotted"
                      aria-label={`Select station ${s.chainage.toFixed(1)}`}
                      onClick={() => onStation(s.chainage)}
                    >
                      {formatRoadStation(s.chainage)}
                    </button>
                  </td>
                  {[
                    s.groundElevation,
                    s.designElevation,
                    s.gradePercent,
                    s.cutAreaM2,
                    s.fillAreaM2,
                    s.cutVolumeM3,
                    s.fillVolumeM3,
                  ].map((v, i) => (
                    <td key={i} className="border-b px-2 py-1">
                      {number(v)}
                    </td>
                  ))}
                  <td
                    className="max-w-64 truncate border-b px-2 py-1 text-left text-amber-700 dark:text-amber-400"
                    title={s.flags.join('; ')}
                  >
                    {s.flags.join('; ') || '—'}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function DevForestryRoads() {
  const w = useRoadWorkspace()
  const { project, analysis, alignment, source, update, updateAlignment, setStation, busy } = w
  const { ref, fullscreen, toggle } = useElementFullscreen<HTMLDivElement>()
  const [collapsed, setCollapsed] = useState(false)
  const [mode, setMode] = useState<DrawMode>('inspect')
  const [draft, setDraft] = useState<Coordinate[]>([])
  const [hover, setHover] = useState<Coordinate | null>(null)
  const [selectedPoint, setSelectedPoint] = useState<string | null>(null)
  const [fitRevision, setFitRevision] = useState(0)
  const [verticalReference, setVerticalReference] = useState('')
  const [detail, setDetail] = useState<'section' | 'terrain' | 'mass' | 'table' | 'compare' | 'cable'>('section')
  const [activeProfile, setActiveProfile] = useState<string | null>(null)
  const [activeCable, setActiveCable] = useState('')
  const [playing, setPlaying] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const fileKind = useRef<FileKind>('project')
  const operation = useRef<AbortController | null>(null)
  useEffect(() => {
    const previous = document.title
    document.title = 'Forest road design · PGMaps'
    return () => {
      document.title = previous
      operation.current?.abort()
    }
  }, [])

  const terrainProfile = useMemo(() => {
    const saved = project.profiles?.find((p) => p.id === activeProfile)
    const context = project.context.find((p) => p.id === activeProfile && p.geometry.type === 'LineString')
    const points =
      saved?.points ?? (context?.geometry.type === 'LineString' ? (context.geometry.coordinates as Coordinate[]) : null)
    if (!points || points.length < 2) return null
    const a = newAlignment(points, saved?.name ?? context!.name)
    a.id = activeProfile!
    a.points = points.map((coordinate, i) => ({ id: `${activeProfile}-${i}`, coordinate, radiusM: 0 }))
    a.color = '#0284c7'
    return a
  }, [project.profiles, project.context, activeProfile])
  const draftAlignment = useMemo(
    () => (mode === 'road' && draft.length >= 2 ? newAlignment(draft, 'Road being pegged', alignment.template) : null),
    [mode, draft, alignment.template],
  )
  const displayedAlignment = draftAlignment ?? terrainProfile ?? alignment
  const displayedAnalysis = useMemo(() => {
    if (displayedAlignment === alignment) return analysis
    const result = safeAnalyzeRoad(displayedAlignment, source, project.settings, [])
    if (!terrainProfile) return result
    const completeLength = result.stations.slice(1).reduce((length, station, index) => {
      const previous = result.stations[index]
      return previous.groundElevation !== null && station.groundElevation !== null
        ? length + station.chainage - previous.chainage
        : length
    }, 0)
    return {
      ...result,
      completeLength,
      coveragePercent: result.length > 0 ? (completeLength / result.length) * 100 : 0,
      maxGradePercent: Math.max(0, ...result.stations.map((s) => Math.abs(s.groundGradePercent ?? 0))),
      cutVolumeM3: 0,
      fillVolumeM3: 0,
      balanceM3: 0,
      estimatedCost: 0,
      surfaceVolumeM3: 0,
      clearingAreaM2: 0,
      stations: result.stations.map((s) => ({
        ...s,
        complete: s.groundElevation !== null,
        designElevation: null,
        gradePercent: s.groundGradePercent,
        cutAreaM2: null,
        fillAreaM2: null,
        cutVolumeM3: null,
        fillVolumeM3: null,
        massM3: null,
        leftDaylightM: null,
        rightDaylightM: null,
        section: s.section.map((x) => ({ ...x, design: null })),
        flags: s.groundElevation === null ? ['No terrain coverage'] : [],
      })),
      warnings: ['Ground-only terrain transect. No formation, earthwork or cost design is assigned.'],
    }
  }, [displayedAlignment, alignment, analysis, source, project.settings, terrainProfile])
  useEffect(() => {
    setStation((s) => Math.min(s, displayedAnalysis.length))
  }, [displayedAnalysis.length, setStation])
  const displayProject = useMemo(
    () =>
      displayedAlignment === alignment
        ? project
        : {
            ...project,
            alignments: [...project.alignments, displayedAlignment],
            activeAlignmentId: displayedAlignment.id,
          },
    [project, displayedAlignment, alignment],
  )
  const displayAnalyses = useMemo(
    () => new Map([...w.analyses, [displayedAlignment.id, displayedAnalysis]]),
    [w.analyses, displayedAlignment, displayedAnalysis],
  )
  const at = nearestStation(displayedAnalysis.stations, w.station)
  const cableLine = project.cables.find((c) => c.id === activeCable) ?? project.cables[0]
  const cableAnalysis = useMemo(() => (cableLine ? analyzeCable(cableLine, source) : null), [cableLine, source])
  const groundValues = displayedAnalysis.stations.map((s) => s.groundElevation).filter((x): x is number => x !== null)
  const grades = displayedAnalysis.stations.map((s) => s.gradePercent).filter((x): x is number => x !== null)
  const selectProfile = (id: string) => {
    const context = project.context.find((feature) => feature.id === id)
    if (context?.geometry.type === 'LineString' && context.geometry.coordinates.length > 2000) {
      w.setError('Crop this feature to at most 2,000 vertices for a terrain profile.')
      return
    }
    setActiveProfile(id || null)
    w.setStation(0)
    setMode('inspect')
    setDraft([])
    if (id && detail === 'mass') setDetail('section')
  }
  const beginMode = (next: DrawMode) => {
    if (w.busy) return
    setMode(next)
    setDraft([])
    setHover(null)
    setPlaying(false)
    if (next !== 'inspect') setActiveProfile(null)
  }

  const onDraw = useCallback(
    (coordinate: Coordinate) => {
      if (busy) return
      setDraft((previous) => {
        if (previous.length >= 2000 || (previous.length && distance(previous[previous.length - 1], coordinate) < 0.2))
          return previous
        return [...previous, coordinate]
      })
    },
    [busy],
  )
  const selectAlignment = useCallback(
    (id: string) => {
      if (busy) return
      update((p) => ({ ...p, activeAlignmentId: id }))
      setActiveProfile(null)
      setStation(0)
    },
    [update, setStation, busy],
  )
  const movePoint = useCallback(
    (id: string, coordinate: Coordinate) => {
      if (busy) return
      updateAlignment((a) => ({ ...a, points: a.points.map((p) => (p.id === id ? { ...p, coordinate } : p)) }))
    },
    [updateAlignment, busy],
  )
  const commitValidated = (next: RoadProject) => {
    if (busy) return false
    try {
      w.commit(parseProject(next))
      w.setError('')
      return true
    } catch (cause) {
      w.setError(cause instanceof Error ? cause.message : 'Could not apply this project edit.')
      return false
    }
  }
  const finishDraw = () => {
    if (busy || draft.length < (mode === 'avoid' ? 3 : 2)) return
    if (mode === 'road') {
      const next = newAlignment(draft, `Road ${project.alignments.length + 1}`, alignment.template)
      if (!commitValidated({ ...project, alignments: [...project.alignments, next], activeAlignmentId: next.id }))
        return
      setSelectedPoint(next.points[0].id)
    } else if (mode === 'profile') {
      const next = { id: uid(), name: `Terrain profile ${(project.profiles?.length ?? 0) + 1}`, points: draft }
      if (!commitValidated({ ...project, profiles: [...(project.profiles ?? []), next] })) return
      setActiveProfile(next.id)
      if (detail === 'mass') setDetail('section')
    } else if (mode === 'cable') {
      const next = {
        id: uid(),
        name: `D-line ${project.cables.length + 1}`,
        start: draft[0],
        end: draft[draft.length - 1],
        startHeight: 18,
        endHeight: 8,
        deflectionPercent: 5,
      }
      if (!commitValidated({ ...project, cables: [...project.cables, next] })) return
      setActiveCable(next.id)
      setDetail('cable')
    } else if (mode === 'stream' || mode === 'avoid') {
      const feature = {
        id: uid(),
        name: `${mode === 'stream' ? 'Stream' : 'Avoidance area'} ${project.context.length + 1}`,
        kind: mode,
        geometry:
          mode === 'stream'
            ? { type: 'LineString' as const, coordinates: draft }
            : { type: 'Polygon' as const, coordinates: [[...draft, draft[0]]] },
      }
      if (!commitValidated({ ...project, context: [...project.context, feature] })) return
    }
    setDraft([])
    setHover(null)
    setMode('inspect')
    w.setStation(0)
  }
  const run = async (message: string, action: (signal: AbortSignal) => Promise<void>) => {
    if (w.busy) return
    setMode('inspect')
    setDraft([])
    setPlaying(false)
    operation.current?.abort()
    const controller = new AbortController()
    operation.current = controller
    w.setBusy(message)
    w.setError('')
    try {
      await action(controller.signal)
    } catch (error) {
      if (!controller.signal.aborted) w.setError(error instanceof Error ? error.message : 'Operation failed.')
    } finally {
      if (operation.current === controller) w.setBusy('')
    }
  }
  const loadTerrain = (kind: 'lidar' | 'regional' | 'demo') =>
    void run('Loading terrain…', async (signal) => {
      if (kind === 'demo') {
        w.setSource(demoTerrain)
        w.commit(createDemoProject())
        w.setNotice('Synthetic training project loaded.')
      } else {
        const loaded =
          kind === 'lidar'
            ? await loadLidarTerrain(signal, w.setBusy)
            : await loadRegionalTerrain(boundsOf(project), signal)
        if (signal.aborted) return
        const replacingDemo = project.terrain.kind === 'demo' && kind === 'lidar'
        const alignments =
          replacingDemo && 'alignments' in loaded && loaded.alignments
            ? (loaded.alignments as Alignment[])
            : project.alignments
        w.setSource(loaded.source)
        w.commit({
          ...project,
          terrain: loaded.metadata,
          alignments,
          activeAlignmentId: alignments[0].id,
          ...(replacingDemo ? { context: [], cables: [], profiles: [], name: 'BC LiDAR road planning' } : {}),
        })
        w.setNotice(
          kind === 'lidar'
            ? 'Loaded the native 1 m LiDAR DTM. Example alignments remain unverified planning geometry.'
            : 'Regional reconnaissance DEM loaded. Quantities use this coarser source.',
        )
      }
      w.enablePersistence()
      beginMode('inspect')
      setActiveProfile(null)
      setFitRevision((n) => n + 1)
      w.setStation(0)
    })
  const requestFile = (kind: FileKind) => {
    if (w.busy) return
    fileKind.current = kind
    if (fileRef.current) {
      fileRef.current.accept = kind === 'terrain' ? '.tif,.tiff' : kind === 'project' ? '.json' : '.json,.geojson,.zip'
      fileRef.current.value = ''
      fileRef.current.click()
    }
  }
  const importFile = (file: File) =>
    void run(`Opening ${file.name}…`, async (signal) => {
      if (fileKind.current === 'terrain') {
        const loaded = await loadRaster(file, verticalReference)
        if (signal.aborted) return
        w.setSource(loaded.source)
        w.commit({ ...project, terrain: loaded.metadata })
        w.setNotice(
          'Imported terrain is now used by every analysis view. Alignments outside its footprint have missing elevations.',
        )
      } else {
        if (file.size > 120_000_000)
          throw Error('Import is too large. Use a cropped project or fewer context features.')
        let raw: unknown
        if (file.name.toLowerCase().endsWith('.zip')) {
          const shp = (await import('shpjs')).default
          const layers = await shp(await file.arrayBuffer())
          raw = Array.isArray(layers)
            ? { type: 'FeatureCollection', features: layers.flatMap((layer) => layer.features) }
            : layers
        } else raw = JSON.parse(await file.text())
        if (signal.aborted) return
        if (fileKind.current === 'project') await w.restore(parseProject(raw), signal)
        else if (fileKind.current === 'alignment') {
          const lines = importAlignmentGeoJson(raw).map((a) => ({
            ...a,
            id: uid(),
            points: a.points.map((p) => ({ ...p, id: uid() })),
          }))
          if (project.alignments.length + lines.length > 20) throw Error('A project supports up to 20 road alignments.')
          w.commit(
            parseProject({ ...project, alignments: [...project.alignments, ...lines], activeAlignmentId: lines[0].id }),
          )
        } else {
          const features = importContextGeoJson(raw).map((c) => ({ ...c, id: uid() }))
          const next = parseProject({ ...project, context: [...project.context, ...features] })
          w.commit(next)
        }
        w.setNotice(`Opened ${file.name}.`)
      }
      w.enablePersistence()
      setActiveProfile(null)
      setFitRevision((n) => n + 1)
    })
  const save = (kind: 'project' | 'geojson' | 'csv' | 'report') => {
    try {
      const safe = parseProject(project)
      const basename = (safe.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'forest-road').slice(0, 70)
      if (kind === 'project') downloadText(serializeProject(safe), `${basename}.road.json`, 'application/json')
      else if (kind === 'geojson')
        downloadText(
          JSON.stringify(projectGeoJson(safe, w.analyses), null, 2),
          `${basename}.geojson`,
          'application/geo+json',
        )
      else if (kind === 'csv')
        downloadText(
          stationsCsv(displayedAnalysis, project.terrain),
          `${basename}-stations.csv`,
          'text/csv;charset=utf-8',
        )
      else downloadText(projectReportHtml(safe, analysis), `${basename}-report.html`, 'text/html;charset=utf-8')
      w.setNotice(kind === 'report' ? 'Report downloaded. Open it and use Print / Save as PDF.' : 'Export downloaded.')
      w.setError('')
    } catch (error) {
      w.setError(error instanceof Error ? error.message : 'Could not export project.')
    }
  }
  const suggest = () =>
    void run('Searching terrain-cost routes…', async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const result = suggestRoute(
        alignment.points[0].coordinate,
        alignment.points[alignment.points.length - 1].coordinate,
        source,
        project.settings,
        project.context,
      )
      const next = newAlignment(result.coordinates, `${alignment.name} · terrain-cost suggestion`, alignment.template)
      w.commit(parseProject({ ...project, alignments: [...project.alignments, next], activeAlignmentId: next.id }))
      setActiveProfile(null)
      setFitRevision((n) => n + 1)
      w.setNotice(result.message)
    })
  const shiftSection = (metres: number) => {
    if (busy || !at || terrainProfile || draftAlignment) return
    const target = offsetCoordinate(at.coordinate, at.bearing + 90, metres)
    const nearest = alignment.points.reduce((a, b) =>
      distance(a.coordinate, at.coordinate) < distance(b.coordinate, at.coordinate) ? a : b,
    )
    if (distance(nearest.coordinate, at.coordinate) < 2) movePoint(nearest.id, target)
    else {
      let insert = 1,
        closest = Infinity
      for (let i = 1; i < alignment.points.length; i++) {
        const a = alignment.points[i - 1].coordinate,
          b = alignment.points[i].coordinate
        const score = distance(a, at.coordinate) + distance(at.coordinate, b) - distance(a, b)
        if (score < closest) {
          closest = score
          insert = i
        }
      }
      const shifted = {
        ...alignment,
        points: [
          ...alignment.points.slice(0, insert),
          { id: uid(), coordinate: target, radiusM: 0 },
          ...alignment.points.slice(insert),
        ],
      }
      if (
        commitValidated({
          ...project,
          alignments: project.alignments.map((a) => (a.id === alignment.id ? shifted : a)),
        })
      )
        w.setNotice(
          'Added a horizontal control at this section. Review neighbouring curve radii and the revised profile.',
        )
    }
  }
  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(
      () =>
        setStation((previous) => {
          const next = previous + project.settings.stationInterval
          if (next >= displayedAnalysis.length) {
            setPlaying(false)
            return displayedAnalysis.length
          }
          return next
        }),
      140,
    )
    return () => window.clearInterval(timer)
  }, [playing, displayedAnalysis.length, project.settings.stationInterval, setStation])
  const previewCoordinate = hover ?? draft[draft.length - 1]
  const previousCoordinate = hover ? draft[draft.length - 1] : draft[draft.length - 2]
  const leg = previousCoordinate && previewCoordinate ? distance(previousCoordinate, previewCoordinate) : 0
  const za = previousCoordinate ? source.elevationAt(...previousCoordinate) : NaN,
    zb = previewCoordinate ? source.elevationAt(...previewCoordinate) : NaN
  const pegGrade = leg > 0 && Number.isFinite(za + zb) ? ((zb - za) / leg) * 100 : null
  const isDrawing = !['inspect', 'edit'].includes(mode)
  const profileAnalysis = terrainProfile
    ? { ...displayedAnalysis, stations: displayedAnalysis.stations.map((s) => ({ ...s, designElevation: null })) }
    : displayedAnalysis
  return (
    <div
      ref={ref}
      data-fullscreen={fullscreen || undefined}
      className="flex min-h-full flex-col gap-2 bg-muted/20 px-3 pb-3 pt-20 xl:h-[calc(100dvh-64px)] xl:min-h-[720px] md:pt-3 [&[data-fullscreen]]:fixed [&[data-fullscreen]]:inset-0 [&[data-fullscreen]]:z-[1300] [&[data-fullscreen]]:h-dvh [&[data-fullscreen]]:bg-background [&[data-fullscreen]]:pt-3"
      data-testid="road-workspace"
    >
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="icon" className="size-8" asChild>
            <Link to="/dev/forestry" aria-label="Back to forestry tools">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Forest road design</h1>
            <p className="max-w-[58vw] truncate text-xs text-muted-foreground">{project.name}</p>
          </div>
          <span
            className={`hidden rounded-full border px-2 py-1 text-[10px] sm:block ${project.terrain.kind === 'demo' ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400' : 'border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400'}`}
          >
            {project.terrain.kind === 'demo'
              ? 'SYNTHETIC TRAINING'
              : `${project.terrain.resolutionM.toFixed(1)} m TERRAIN`}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className="mr-2 hidden max-w-40 truncate text-[10px] text-muted-foreground xl:inline" title={w.saving}>
            {w.saving}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            aria-label={collapsed ? 'Show road controls' : 'Hide road controls'}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            aria-label="Undo road edit"
            disabled={!!busy || !w.canUndo}
            onClick={w.undo}
          >
            <Undo2 className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            aria-label="Redo road edit"
            disabled={!!busy || !w.canRedo}
            onClick={w.redo}
          >
            <Redo2 className="size-4" />
          </Button>
          <Button variant="outline" size="sm" disabled={!!w.busy} onClick={() => requestFile('project')}>
            <FolderOpen className="mr-1 size-3" />
            Open
          </Button>
          <Button size="sm" disabled={!!w.busy} onClick={() => save('project')}>
            <Download className="mr-1 size-3" />
            Save
          </Button>
          <FullscreenButton title="Road workspace" fullscreen={fullscreen} onClick={toggle} compact />
        </div>
      </header>
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        data-testid="road-file-input"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) importFile(file)
        }}
      />
      {w.error && (
        <InlineAlert tone="error">
          <span role="alert">{w.error}</span>
          <Button variant="ghost" size="sm" className="ml-2" onClick={() => w.setError('')}>
            Dismiss
          </Button>
        </InlineAlert>
      )}
      {w.busy ? (
        <InlineAlert loading>{w.busy}</InlineAlert>
      ) : (
        w.notice && (
          <div role="status" className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span>{w.notice}</span>
            <button aria-label="Dismiss status" onClick={() => w.setNotice('')}>
              ×
            </button>
          </div>
        )
      )}
      <StatGroup
        variant="tiles"
        size="sm"
        className="shrink-0"
        items={[
          { label: 'Length', value: `${number(displayedAnalysis.length, 0)} m` },
          {
            label: 'Ground elevation',
            value: groundValues.length
              ? `${number(Math.min(...groundValues), 0)}–${number(Math.max(...groundValues), 0)} m`
              : 'Missing',
          },
          {
            label: terrainProfile ? 'Max ground grade' : 'Max design grade',
            value: `${number(displayedAnalysis.maxGradePercent)}%`,
            tone: displayedAnalysis.maxGradePercent > project.settings.maxGradePercent ? 'warning' : 'default',
          },
          ...(terrainProfile
            ? [
                {
                  label: 'Grade range',
                  value: grades.length
                    ? `${number(Math.min(...grades))} to ${number(Math.max(...grades))}%`
                    : 'Missing',
                },
              ]
            : [
                {
                  label: displayedAnalysis.coveragePercent < 99.99 ? 'Covered cut / fill' : 'Cut / fill',
                  value: displayedAnalysis.stations.length
                    ? `${number(displayedAnalysis.cutVolumeM3, 0)} / ${number(displayedAnalysis.fillVolumeM3, 0)} m³`
                    : 'Unavailable',
                },
                {
                  label: 'Covered estimate',
                  value: displayedAnalysis.stations.length
                    ? `$${number(displayedAnalysis.estimatedCost, 0)}`
                    : 'Unavailable',
                },
                {
                  label: 'Complete sections',
                  value: `${number(displayedAnalysis.coveragePercent)}%`,
                  tone: displayedAnalysis.coveragePercent < 99.99 ? ('warning' as const) : ('default' as const),
                },
              ]),
        ]}
      />
      <div
        className={`grid min-h-0 flex-1 gap-3 ${collapsed ? 'grid-cols-1' : 'xl:grid-cols-[310px_minmax(0,1fr)] lg:grid-cols-[280px_minmax(0,1fr)]'}`}
      >
        {!collapsed && (
          <DesignSidebar
            workspace={w}
            mode={mode}
            onMode={beginMode}
            onFile={requestFile}
            onTerrain={loadTerrain}
            verticalReference={verticalReference}
            onVerticalReference={setVerticalReference}
            selectedPoint={selectedPoint}
            onPoint={setSelectedPoint}
            onProfile={selectProfile}
            activeProfile={activeProfile}
            onDuplicate={() => {
              const a = structuredClone(alignment)
              a.id = uid()
              a.name = `${a.name} copy`
              a.color = colors[project.alignments.length % colors.length]
              a.points = a.points.map((p) => ({ ...p, id: uid() }))
              a.vertical = a.vertical.map((p) => ({ ...p, id: uid() }))
              a.overrides = a.overrides.map((p) => ({ ...p, id: uid() }))
              if (!commitValidated({ ...project, alignments: [...project.alignments, a], activeAlignmentId: a.id }))
                return
              setActiveProfile(null)
            }}
            onRemoveAlignment={() =>
              w.update((p) => ({
                ...p,
                alignments: p.alignments.filter((a) => a.id !== alignment.id),
                activeAlignmentId: p.alignments.find((a) => a.id !== alignment.id)!.id,
              }))
            }
            onSuggest={suggest}
            onSave={save}
          />
        )}
        <main className="flex min-h-0 min-w-0 flex-col gap-2" aria-label="Connected road views">
          {!displayedAnalysis.stations.length && (
            <InlineAlert tone="error">{displayedAnalysis.warnings.join(' ')}</InlineAlert>
          )}
          {isDrawing && (
            <div
              className="flex flex-wrap items-center gap-2 rounded-lg border border-teal-600/40 bg-teal-600/10 px-3 py-2 text-xs"
              data-testid="pegging-feedback"
            >
              <strong>{mode === 'road' ? 'Peg road' : `Draw ${mode}`}</strong>
              <span>Click plan to add points · {draft.length} points</span>
              <span className="font-mono">
                Leg {number(leg)} m · ground {number(zb)} m · grade{' '}
                <strong
                  className={
                    pegGrade !== null && Math.abs(pegGrade) > project.settings.maxGradePercent ? 'text-red-600' : ''
                  }
                >
                  {number(pegGrade)}%
                </strong>
              </span>
              <Button size="sm" onClick={finishDraw} disabled={draft.length < (mode === 'avoid' ? 3 : 2)}>
                Finish {mode}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!draft.length}
                onClick={() => setDraft((p) => p.slice(0, -1))}
              >
                Undo point
              </Button>
              <Button size="sm" variant="ghost" onClick={() => beginMode('inspect')}>
                Cancel drawing
              </Button>
            </div>
          )}
          {terrainProfile && (
            <div className="flex items-center justify-between rounded border border-sky-600/40 bg-sky-600/10 px-3 py-1 text-xs">
              <span>Terrain profile: {terrainProfile.name} · ground elevations and slopes only</span>
              <Button size="sm" variant="ghost" onClick={() => selectProfile('')}>
                Return to road
              </Button>
            </div>
          )}
          <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
            <FullscreenPanel
              title="Plan · alignment & terrain"
              compact
              className="flex min-h-[360px] flex-col xl:min-h-0"
              actions={<span className="text-[10px] text-muted-foreground">Orange road · red grade flag</span>}
            >
              {() => (
                <div className="min-h-[280px] flex-1">
                  <PlanView
                    project={displayProject}
                    alignment={displayedAlignment}
                    analyses={displayAnalyses}
                    source={source}
                    station={w.station}
                    onStation={w.setStation}
                    onSelectAlignment={selectAlignment}
                    mode={mode}
                    draft={draft}
                    onDraw={onDraw}
                    onMovePoint={movePoint}
                    onHover={setHover}
                    onSelectPoint={setSelectedPoint}
                    selectedPoint={selectedPoint}
                    fitRevision={fitRevision}
                  />
                </div>
              )}
            </FullscreenPanel>
            <div className="grid min-h-0 grid-rows-[minmax(220px,0.9fr)_minmax(260px,1fr)] gap-3">
              <FullscreenPanel
                title={terrainProfile ? 'Terrain profile · elevation & distance' : 'Road profile · ground & formation'}
                compact
                className="flex min-h-0 flex-col"
              >
                {() => (
                  <div className="min-h-0 flex-1">
                    <ProfileChart
                      terrainOnly={!!terrainProfile}
                      analysis={profileAnalysis}
                      alignment={displayedAlignment}
                      station={w.station}
                      onStation={w.setStation}
                      onVerticalChange={(vertical) => {
                        if (!busy && !terrainProfile && !draftAlignment) w.updateAlignment((a) => ({ ...a, vertical }))
                      }}
                    />
                  </div>
                )}
              </FullscreenPanel>
              <FullscreenPanel
                title={
                  detail === 'section'
                    ? 'Cross-section'
                    : detail === 'terrain'
                      ? '3D terrain'
                      : detail === 'mass'
                        ? 'Mass haul'
                        : detail === 'table'
                          ? 'Station schedule'
                          : detail === 'compare'
                            ? 'Compare alternatives'
                            : 'D-line clearance'
                }
                compact
                className="flex min-h-0 flex-col"
              >
                {() => (
                  <div className="flex min-h-0 flex-1 flex-col gap-2">
                    <TabBar
                      label="Road detail view"
                      value={detail}
                      onChange={setDetail}
                      options={[
                        { value: 'section', label: 'Section' },
                        { value: 'terrain', label: '3D' },
                        { value: 'mass', label: 'Mass haul', disabled: !!terrainProfile },
                        { value: 'table', label: 'Stations' },
                        { value: 'compare', label: 'Compare' },
                        { value: 'cable', label: 'D-line' },
                      ]}
                    />
                    <div className="min-h-0 flex-1">
                      {detail === 'section' && (
                        <CrossSectionChart
                          terrainOnly={!!terrainProfile}
                          station={
                            terrainProfile && at
                              ? {
                                  ...at,
                                  section: at.section.map((s) => ({ ...s, design: null })),
                                  cutAreaM2: null,
                                  fillAreaM2: null,
                                  leftDaylightM: null,
                                  rightDaylightM: null,
                                }
                              : at
                          }
                          onShift={busy || terrainProfile || draftAlignment ? undefined : shiftSection}
                        />
                      )}
                      {detail === 'terrain' && (
                        <TerrainPreview
                          terrainOnly={!!terrainProfile}
                          sourceLabel={project.terrain.name}
                          analysis={displayedAnalysis}
                          terrain={source}
                          station={w.station}
                          onStation={w.setStation}
                          playing={playing}
                        />
                      )}
                      {detail === 'mass' && !terrainProfile && (
                        <MassHaulChart analysis={displayedAnalysis} station={w.station} onStation={w.setStation} />
                      )}
                      {detail === 'table' && (
                        <StationTable analysis={displayedAnalysis} station={w.station} onStation={w.setStation} />
                      )}
                      {detail === 'compare' && (
                        <div className="h-full overflow-auto">
                          <table className="w-full text-right text-xs">
                            <thead>
                              <tr>
                                {['Alternative', 'Length m', 'Max %', 'Cut m³', 'Fill m³', 'Coverage', 'Cost CAD'].map(
                                  (h) => (
                                    <th key={h} className="border-b p-2">
                                      {h}
                                    </th>
                                  ),
                                )}
                              </tr>
                            </thead>
                            <tbody>
                              {project.alignments.map((a) => {
                                const result = w.analyses.get(a.id)!
                                return (
                                  <tr key={a.id} className={a.id === alignment.id ? 'bg-amber-500/10' : ''}>
                                    <td className="p-2 text-left">
                                      <button className="underline" onClick={() => selectAlignment(a.id)}>
                                        {a.name}
                                      </button>
                                    </td>
                                    {[
                                      number(result.length, 0),
                                      number(result.maxGradePercent),
                                      number(result.cutVolumeM3, 0),
                                      number(result.fillVolumeM3, 0),
                                      `${number(result.coveragePercent)}%`,
                                      `$${number(result.estimatedCost, 0)}`,
                                    ].map((n, i) => (
                                      <td key={i} className="p-2">
                                        {n}
                                      </td>
                                    ))}
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                          <p className="mt-2 text-[11px] text-muted-foreground">
                            Compare alternatives on the same terrain and rates. Partial quantities are not directly
                            comparable with complete quantities.
                          </p>
                        </div>
                      )}
                      {detail === 'cable' &&
                        (cableAnalysis ? (
                          <div className="flex h-full min-h-0 flex-col">
                            <select
                              aria-label="Active D-line"
                              className="mb-1 rounded border bg-background text-xs"
                              value={cableLine.id}
                              onChange={(e) => setActiveCable(e.target.value)}
                            >
                              {project.cables.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                            <div className="min-h-0 flex-1">
                              <CableChart analysis={cableAnalysis} />
                            </div>
                          </div>
                        ) : (
                          <div className="p-4 text-sm text-muted-foreground">
                            Draw a D-line in Review to inspect an assumed cable-clearance profile.
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </FullscreenPanel>
            </div>
          </div>
          <div
            className="flex shrink-0 flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2"
            data-testid="road-station-controller"
          >
            <Button
              size="icon"
              variant="outline"
              className="size-7"
              aria-label={playing ? 'Pause station playback' : 'Play station playback'}
              onClick={() => {
                if (w.station >= displayedAnalysis.length) w.setStation(0)
                setPlaying(!playing)
              }}
            >
              {playing ? <Pause className="size-3" /> : <Play className="size-3" />}
            </Button>
            <button
              className="rounded border px-2 py-1 text-xs"
              aria-label="Previous road station"
              onClick={() => w.setStation(Math.max(0, w.station - project.settings.stationInterval))}
            >
              ‹
            </button>
            <label className="flex items-center gap-1 text-xs">
              Station{' '}
              <input
                aria-label="Selected station metres"
                type="number"
                min={0}
                max={displayedAnalysis.length}
                step={project.settings.stationInterval}
                className="w-20 rounded border bg-background px-1 py-1 font-mono"
                value={Number(w.station.toFixed(1))}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  if (Number.isFinite(n)) w.setStation(Math.max(0, Math.min(displayedAnalysis.length, n)))
                }}
              />
            </label>
            <button
              className="rounded border px-2 py-1 text-xs"
              aria-label="Next road station"
              onClick={() =>
                w.setStation(Math.min(displayedAnalysis.length, w.station + project.settings.stationInterval))
              }
            >
              ›
            </button>
            <input
              aria-label="Linked road station"
              type="range"
              min={0}
              max={Math.max(1, displayedAnalysis.length)}
              step={1}
              value={w.station}
              className="min-w-24 flex-1 accent-rose-600"
              onChange={(e) => w.setStation(Number(e.target.value))}
            />
            <output className="font-mono text-xs" data-testid="road-selected-station">
              {formatRoadStation(at?.chainage ?? 0)} · Z {number(at?.groundElevation)} m · {number(at?.gradePercent)}%
            </output>
          </div>
        </main>
      </div>
      <footer className="shrink-0 text-[10px] text-muted-foreground">
        Concept planning · {project.terrain.verticalReference} ·{' '}
        {project.terrain.kind === 'demo'
          ? 'Synthetic ground, not survey data'
          : 'Native DEM sampling; missing ground stays missing'}{' '}
        · earthworks use average end areas; field and engineering review required for construction.
      </footer>
    </div>
  )
}
