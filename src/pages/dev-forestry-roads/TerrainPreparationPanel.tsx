import { StationValue, useStationReader } from './roadStation'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { insetBox } from '@/components/ui/inset-box'
import { cn } from '@/lib/utils'
import { formatRoadStation } from './Charts'
import { Field, NumberField, roadFieldClass, RoadSelect } from './Controls'
import { RoadSection } from './SidebarParts'
import { burnRoad } from './designSurface'
import {
  exportGrid,
  importTerrainWithAnswers,
  loadLas,
  loadRaster,
  parseTerrainReferenceSurfaces,
  preparedTerrain,
  TerrainImportQuestion,
  type PointCloudImport,
  type TerrainImportAnswers,
  type TerrainImportNeeds,
} from './terrain'
import {
  gradePad,
  editTinElevation,
  mosaicRasters,
  parseTerrainBackgrounds,
  type TerrainPreparationRecord,
  type TerrainBackgroundLayer,
} from './terrainPreparation'
import { loadTerrainBackground } from './terrainBackgroundImport'
import {
  checkSurveyStations,
  parseTraverseLegs,
  reduceTraverse,
  surveyFieldStation,
  traverseCsv,
  type SurveyBookSoftree,
  type TraverseInput,
  type TraverseLeg,
  type TraverseResult,
} from './surveyInterchange'
import { fieldStation, type StationEquation } from './stationEquations'
import { SurveyFieldNotes, type FieldNoteStation } from './SurveyFieldNotes'
import type { TraverseFileFormat, WritableTraverseFormat } from './traverseFiles'
import type { UnitSurveyDistance, UnitSurveyVertical } from './softreeTraverse'
import { combinedScaleFactor, scaleFactorText } from './scaleFactor'
import type { RoadWorkspace } from './useRoadWorkspace'
import type { TerrainMetadata } from './types'

const sourceRecord = (m: TerrainMetadata) => {
  if (!m.raster) throw Error('Import a local terrain grid first.')
  return { name: m.name, sha256: m.raster.sha256, epsg: m.raster.epsg, verticalReference: m.verticalReference }
}
/** How a resampled background is shown, as a notice and the layer's own line say it. */
const backgroundResolution = (layer: TerrainBackgroundLayer) =>
  `resampled for display from ${layer.sourceSize![0].toLocaleString('en-CA')} × ${layer.sourceSize![1].toLocaleString('en-CA')} to ${layer.width.toLocaleString('en-CA')} × ${layer.height.toLocaleString('en-CA')} pixels${layer.epsg === 4326 ? '' : ` (${layer.pixelSize[0].toFixed(2)} m)`}`
/** The units a traverse file is offered in: no traverse format states its own. */
const TRAVERSE_UNITS = [
  { value: '1', label: 'Metres' },
  { value: '0.3048', label: 'International feet' },
  { value: String(1200 / 3937), label: 'US survey feet' },
]
/** The formats a field book is written in, as the export list names them. */
const TRAVERSE_EXPORTS: { value: WritableTraverseFormat; label: string }[] = [
  { value: 'asc', label: 'Softree ASCII traverse (.asc)' },
  { value: 'ipd', label: 'Softree IPD traverse (.ipd)' },
  { value: 'polycorder', label: 'Polycorder Roads traverse (.txt)' },
  { value: 'unit-survey', label: 'Unit survey (.pol)' },
]
/** The vertical and distance kinds of a unit survey, which the file does not hold. */
const UNIT_SURVEY_VERTICALS: { value: UnitSurveyVertical; label: string }[] = [
  { value: 'inclination', label: 'Inclination (° from level)' },
  { value: 'zenith', label: 'Zenith angle (° from straight up)' },
  { value: 'slope-percent', label: 'Slope (%)' },
  { value: 'elevation-difference', label: 'Elevation difference' },
  { value: 'elevation', label: 'Elevation' },
]
const UNIT_SURVEY_DISTANCES: { value: UnitSurveyDistance; label: string }[] = [
  { value: 'slope', label: 'Slope distances' },
  { value: 'horizontal', label: 'Horizontal distances' },
]
const stationText = (value: number) => value.toFixed(2)
/** The traverse CSV of a field book's legs, as the panel's text box reads it. */
const legsText = (legs: readonly TraverseLeg[]) =>
  'station,bearing_deg,horizontal_m,grade_pct\n' +
  legs.map((l) => [l.id, l.bearingDegrees, l.horizontalDistanceM, l.gradePercent].join(',')).join('\n')
const download = (text: string, name: string, type = 'text/plain') => {
  const url = URL.createObjectURL(new Blob([text], { type })),
    a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function TerrainPreparationPanel({
  workspace: w,
  verticalReference,
  pointCloud,
  onAskTerrain,
}: {
  workspace: RoadWorkspace
  verticalReference: string
  pointCloud?: Pick<PointCloudImport, 'classify' | 'surface' | 'preserveCorridorM' | 'retainTin'>
  /** Asks for a CRS or vertical datum the chosen files do not state; null when cancelled. */
  onAskTerrain?: (needs: TerrainImportNeeds) => Promise<TerrainImportAnswers | null>
}) {
  // The sidebar is memoized: a click reads the station as it is now (see roadStation.tsx).
  const readStation = useStationReader(w)
  const { project, alignment } = w,
    metadata = project.terrain,
    raster = metadata.raster
  const latest = useRef(w)
  latest.current = w
  const sourceStamp = (m: TerrainMetadata) =>
    JSON.stringify([m.kind, m.name, m.epsg, m.sha256, m.resolutionM, m.bounds])
  const ensureCurrentSource = () => {
    if (
      latest.current.projectId !== w.projectId ||
      sourceStamp(latest.current.project.terrain) !== sourceStamp(metadata)
    )
      throw Error(
        'The project or terrain changed while processing. Run terrain preparation again on the current source.',
      )
  }
  const [working, setWorking] = useState(false),
    [overlap, setOverlap] = useState<'first' | 'last'>('last')
  const [pad, setPad] = useState({
    widthM: 20,
    lengthM: 40,
    bearingDegrees: 0,
    elevationM: 0,
    crossfallPercent: 2,
    gradePercent: 0,
    batterHV: 1.5,
  })
  const [start, setStart] = useState({ easting: 0, northing: 0, elevation: 0 }),
    [target, setTarget] = useState({ easting: 0, northing: 0, elevation: 0 }),
    [adjust, setAdjust] = useState(false)
  const [notes, setNotes] = useState('station,bearing_deg,horizontal_m,grade_pct\nA,0,50,0\nB,90,50,0'),
    [shotNotes, setShotNotes] = useState(''),
    [survey, setSurvey] = useState<TraverseResult | null>(null)
  // Stations as the field names them: the first station, and back/ahead equations along the chain.
  const [startStation, setStartStation] = useState(0),
    [equations, setEquations] = useState<StationEquation[]>([])
  // What a traverse file held that the field book has no field for, kept with the book when saved.
  const [softree, setSoftree] = useState<SurveyBookSoftree | null>(null)
  // The saved field book open in the panel: saving writes it in place, as one undo step.
  const [openBook, setOpenBook] = useState<string | null>(null)
  // Counts the field books loaded into the panel, so a new one starts with its notes folded.
  const [loads, setLoads] = useState(0)
  // A traverse file waiting for its units (always asked), its shot kinds (.pol) or its start.
  const traverseFile = useRef<HTMLInputElement>(null)
  const [pendingTraverse, setPendingTraverse] = useState<{
    name: string
    text: string
    format: TraverseFileFormat
    unit: string
    vertical: UnitSurveyVertical | ''
    distance: UnitSurveyDistance | ''
    /** Set when the file gives no start: it is read from the survey start fields. */
    startQuestion: string | null
  } | null>(null)
  const [traverseExport, setTraverseExport] = useState<WritableTraverseFormat>('asc'),
    [traverseExportUnit, setTraverseExportUnit] = useState(String(metadata.localPlane?.unitM ?? 1))
  const changeStations = (next: { start?: number; equations?: StationEquation[] }) => {
    if (next.start !== undefined) setStartStation(next.start)
    if (next.equations) setEquations(next.equations)
    setSurvey(null)
  }
  // Ground distances are reduced to the grid by the combined scale factor at the survey start.
  const [groundDistances, setGroundDistances] = useState(false),
    [geoidM, setGeoidM] = useState(-17)
  const [tinVertex, setTinVertex] = useState(0),
    [tinElevation, setTinElevation] = useState(0)
  const file = useRef<HTMLInputElement>(null)
  const cloudFiles = useRef<HTMLInputElement>(null)
  const backgroundFile = useRef<HTMLInputElement>(null),
    [backgroundKind, setBackgroundKind] = useState<TerrainBackgroundLayer['kind']>('canopy')
  // The vertical datum is the entered one or the one asked for now. The open terrain's is never
  // taken silently: it is offered in the question, where choosing it is a statement.
  const ask = (needs: TerrainImportNeeds) => {
    if (!onAskTerrain) throw new TerrainImportQuestion('Enter the vertical datum under Import options first.', needs)
    return onAskTerrain(needs)
  }
  const run = async (action: () => Promise<void>) => {
    setWorking(true)
    w.setError('')
    try {
      await action()
    } catch (error) {
      w.setError(error instanceof Error ? error.message : String(error))
    } finally {
      setWorking(false)
    }
  }
  const apply = async (
    raw: Parameters<typeof preparedTerrain>[0],
    record: TerrainPreparationRecord,
    retainCurrent = true,
  ) => {
    const loaded = await preparedTerrain(raw, record)
    ensureCurrentSource()
    const references = [
      ...(metadata.referenceSurfaces ?? []),
      ...(raster && retainCurrent ? [{ id: `surface:${raster.id}`, name: raster.name, raster }] : []),
    ]
    const referenceSurfaces = parseTerrainReferenceSurfaces(
      references.filter((s, i) => references.findIndex((t) => t.id === s.id) === i),
      loaded.metadata.verticalReference,
    )
    w.setSource(loaded.source)
    w.update((p) => ({
      ...p,
      terrain: {
        ...loaded.metadata,
        referenceSurfaces,
        ...(p.terrain.backgrounds ? { backgrounds: p.terrain.backgrounds } : {}),
      },
      scenario: undefined,
    }))
    w.enablePersistence()
    w.setNotice(`Using ${loaded.metadata.name}. The preparation and source evidence are saved in this project.`)
  }
  const center = () => {
    const station = readStation()
    const at = w.analysis?.stations.reduce(
      (best, s) => (Math.abs(s.chainage - station) < Math.abs(best.chainage - station) ? s : best),
      w.analysis.stations[0],
    )
    if (!at) throw Error('Select a road station to locate the grading pad.')
    return { at, grid: exportGrid(metadata, at.coordinate) }
  }
  const surveyInput = (): TraverseInput => {
    const sideShots = shotNotes.trim()
      ? shotNotes
          .trim()
          .split(/\r?\n/)
          .map((line, i) => {
            const p = line.split(',').map((v) => v.trim())
            if (p.length !== 4)
              throw Error(`Side-shot row ${i + 1} needs id,station_index,signed_offset_m,height_difference_m.`)
            return { id: p[0], station: Number(p[1]), offsetM: Number(p[2]), heightDifferenceM: Number(p[3]) }
          })
      : []
    const scale = surveyScale()
    if (groundDistances && !scale.ok) throw Error(scale.reason)
    return {
      start: [start.easting, start.northing, start.elevation],
      target: adjust ? [target.easting, target.northing, target.elevation] : undefined,
      adjustment: adjust ? 'bowditch' : 'none',
      legs: parseTraverseLegs(notes),
      sideShots,
      ...(groundDistances && scale.ok ? { distanceScale: scale.combined } : {}),
    }
  }
  /** The combined scale factor at the survey start, at its elevation plus the geoid height. */
  const surveyScale = () => {
    const grid = exportGrid(metadata, alignment.points[0].coordinate)
    const [longitudeDeg, latitudeDeg] = grid.toLonLat([start.easting, start.northing])
    return combinedScaleFactor(grid.epsg, { latitudeDeg, longitudeDeg }, start.elevation + geoidM)
  }
  const reduce = () => {
    const input = surveyInput()
    const result = reduceTraverse(input)
    checkSurveyStations(input, startStation, equations)
    return result
  }
  /** The field station of a reduced station. */
  const fieldAt = (chainageM: number) => {
    let input: Partial<TraverseInput> = {}
    try {
      input = surveyInput()
    } catch {
      // A shown reduction was made from valid notes; grid distances stand in if they changed since.
    }
    return surveyFieldStation(chainageM, { input, startStation, stationEquations: equations })
  }
  /** Reads the pending traverse file into the field book, or asks for its start. */
  const readTraverse = async () => {
    if (!pendingTraverse) return
    const { readTraverseFile, traverseFileDetails, traverseLegsText, sideShotsText } = await import('./traverseFiles')
    const { SoftreeTraverseStartQuestion } = await import('./softreeTraverse')
    const p = pendingTraverse
    try {
      const read = readTraverseFile(p.text, p.format, {
        unitM: Number(p.unit),
        ...(p.startQuestion ? { start: [start.easting, start.northing, start.elevation] } : {}),
        ...(p.vertical ? { vertical: p.vertical } : {}),
        ...(p.distance ? { distance: p.distance } : {}),
      })
      const input = read.input
      setStart({ easting: input.start[0], northing: input.start[1], elevation: input.start[2] })
      setAdjust(false)
      setNotes(traverseLegsText(input))
      setShotNotes(sideShotsText(input))
      setStartStation(read.startStation)
      setEquations(read.equations)
      const kept = traverseFileDetails(read, Number(p.unit))
      setSoftree(kept.details)
      setLoads((n) => n + 1)
      setOpenBook(null)
      // Written back in its own format and unit, an unchanged file is the same file.
      if (p.format !== 'laser-raw') setTraverseExport(p.format)
      setTraverseExportUnit(p.unit)
      setPendingTraverse(null)
      setSurvey(reduceTraverse(input))
      w.setNotice(
        [
          `Read ${p.name}: ${input.legs.length} legs, ${input.sideShots?.length ?? 0} side shots${read.equations.length ? `, ${read.equations.length} station equation${read.equations.length === 1 ? '' : 's'}` : ''}.`,
          read.fileCheck
            ? `The file's own coordinates lie within ${read.fileCheck.maxDifferenceM.toFixed(3)} m of the reduction at ${read.fileCheck.compared} stations.`
            : '',
          ...read.notes,
          ...kept.notes,
          'Save the field book to keep it in the project.',
        ]
          .filter(Boolean)
          .join(' '),
      )
    } catch (error) {
      if (error instanceof SoftreeTraverseStartQuestion) {
        setPendingTraverse({ ...p, startQuestion: error.message })
        return
      }
      w.setError(error instanceof Error ? error.message : String(error))
    }
  }
  /** The field book's stations as the field names them, from the traverse CSV as it stands. */
  const noteStations = (): FieldNoteStation[] => {
    let legs: TraverseLeg[] = []
    try {
      legs = parseTraverseLegs(notes)
    } catch {
      // Notes being typed: the stations already noted are still listed by number.
    }
    let calc = startStation
    return [
      { index: 0, name: '', fieldStation: fieldStation(calc, equations) },
      ...legs.map((l, i) => {
        calc += Number.isFinite(l.horizontalDistanceM) ? l.horizontalDistanceM : 0
        return { index: i + 1, name: l.id, fieldStation: fieldStation(calc, equations) }
      }),
    ]
  }
  /** HI/HT corrected at a station: the leg from it rises by the change, so its slope reading stays as taken. */
  const changeHeights = (station: number, hi: number | null, ht: number | null) => {
    if (!softree) return
    const before = softree.extras.find((e) => e.station === station)
    const shift = ((hi ?? 0) - (ht ?? 0) - ((before?.hi ?? 0) - (before?.ht ?? 0))) * softree.unitM
    if (shift) {
      let legs: TraverseLeg[]
      try {
        legs = parseTraverseLegs(notes)
      } catch (error) {
        w.setError(
          `Correct the traverse CSV before changing HI or HT: ${error instanceof Error ? error.message : String(error)}`,
        )
        return
      }
      const leg = legs[station]
      if (leg && leg.horizontalDistanceM > 0) {
        legs[station] = { ...leg, gradePercent: leg.gradePercent + (shift / leg.horizontalDistanceM) * 100 }
        setNotes(legsText(legs))
        setSurvey(null)
      }
    }
    const next = { ...(before ?? { station }) }
    if (hi === null) delete next.hi
    else next.hi = hi
    if (ht === null) delete next.ht
    else next.ht = ht
    setSoftree({
      ...softree,
      extras: [...softree.extras.filter((e) => e.station !== station), next].sort((a, b) => a.station - b.station),
    })
  }
  /** Saves the field book: in place when it was opened or saved before, else as a new book. */
  const saveBook = (asNew: boolean) => {
    try {
      const input = surveyInput()
      reduceTraverse(input)
      checkSurveyStations(input, startStation, equations)
      const grid = exportGrid(metadata, alignment.points[0].coordinate)
      const books = project.surveyBooks ?? []
      const current = asNew ? undefined : books.find((b) => b.id === openBook)
      if (!current && books.length >= 20) throw Error('A project supports at most 20 survey field books.')
      const record = {
        id: current?.id ?? crypto.randomUUID(),
        name: current?.name ?? `Survey ${1 + books.length}`,
        epsg: grid.epsg,
        verticalReference: metadata.verticalReference,
        input,
        ...(startStation ? { startStation } : {}),
        ...(equations.length ? { stationEquations: equations } : {}),
        ...(softree ? { softree } : {}),
      }
      w.commit(
        {
          ...project,
          surveyBooks: current ? books.map((b) => (b.id === current.id ? record : b)) : [...books, record],
        },
        true,
        current ? `Saved ${record.name}` : `Added ${record.name}`,
        true,
      )
      setOpenBook(record.id)
      w.setNotice(
        current
          ? `${record.name} saved with its observations, field notes and reduction settings.`
          : 'Survey observations and reduction settings saved in this project.',
      )
    } catch (error) {
      w.setError(error instanceof Error ? error.message : String(error))
    }
  }
  const openBookRecord = project.surveyBooks?.find((b) => b.id === openBook)
  return (
    <>
      <RoadSection
        title="Prepare and combine terrain"
        summary={metadata.preparation ? `${metadata.preparation.sources.length} sources` : ''}
        help="Combine checked grids in the same CRS/datum; preserve source spacing and no-data. Derived terrain becomes the original ground for subsequent designs. Pad and road-surface actions change analytical ground; Undo restores it. Download the project to retain the source evidence."
      >
        <fieldset disabled={working || !!w.busy} className="min-w-0 space-y-2" data-testid="road-terrain-preparation">
          <Field label="Overlapping ground grids">
            <RoadSelect
              ariaLabel="Overlapping ground grids"
              className={roadFieldClass}
              value={overlap}
              onValueChange={(value) => setOverlap(value as typeof overlap)}
            >
              <option value="last">New files take precedence</option>
              <option value="first">Current ground takes precedence</option>
            </RoadSelect>
          </Field>
          <input
            ref={file}
            type="file"
            multiple
            accept=".tif,.tiff"
            className="hidden"
            aria-label="Terrain mosaic files"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? [])
              e.target.value = ''
              if (!files.length) return
              void run(async () => {
                const loaded = await importTerrainWithAnswers(
                  (answers) => Promise.all(files.map((f) => loadRaster(f, answers.verticalReference ?? ''))),
                  ask,
                  { verticalReference },
                )
                if (!loaded) return
                const all = [...(raster ? [metadata] : []), ...loaded.map((l) => l.metadata)],
                  grids = all.map((m) => m.raster!)
                const raw = mosaicRasters(grids, overlap)
                await apply(raw, {
                  operation: 'mosaic',
                  sources: all.map(sourceRecord),
                  method: 'Bilinear at finest source spacing; first known source wins',
                  parameters: { overlap, sourceCount: all.length },
                })
              })
            }}
          />
          <Button size="sm" variant="outline" className="w-full" onClick={() => file.current?.click()}>
            Add GeoTIFFs to ground mosaic
          </Button>
          <input
            ref={cloudFiles}
            type="file"
            multiple
            accept=".las,.laz"
            className="hidden"
            aria-label="Point-cloud mosaic files"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? [])
              e.target.value = ''
              if (!files.length) return
              void run(async () => {
                const loaded = await importTerrainWithAnswers(
                  (answers) =>
                    loadLas(files[0], answers.verticalReference ?? '', {
                      classify: 'auto',
                      surface: 'tin',
                      ...pointCloud,
                      additionalFiles: files.slice(1),
                      assumedEpsg: answers.epsg,
                      preservePath: alignment.points.map((p) => p.coordinate),
                    }),
                  ask,
                  { verticalReference },
                )
                if (!loaded) return
                ensureCurrentSource()
                w.setSource(loaded.source)
                w.update((p) => ({
                  ...p,
                  terrain: {
                    ...loaded.metadata,
                    ...(p.terrain.backgrounds ? { backgrounds: p.terrain.backgrounds } : {}),
                  },
                  scenario: undefined,
                }))
                w.setNotice(loaded.summary)
                w.enablePersistence()
              })
            }}
          />
          <Button size="sm" variant="outline" className="w-full" onClick={() => cloudFiles.current?.click()}>
            Combine LAS / LAZ sources
          </Button>
          {metadata.preparation && (
            <p className="break-words text-2xs text-muted-foreground">
              {metadata.preparation.method} · {metadata.preparation.sources.length} source records
            </p>
          )}
          {raster && metadata.preparation?.tin && (
            <details className={insetBox()}>
              <summary className="cursor-pointer text-xs font-medium">Edit retained source TIN</summary>
              <p className="mt-2 text-2xs text-muted-foreground">
                Edit a vertex elevation while retaining breakline topology. The grid is rebuilt from the edited
                triangles; source holes stay unknown.
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <NumberField
                  label="TIN vertex index"
                  value={tinVertex}
                  min={0}
                  max={metadata.preparation.tin.elevations.length - 1}
                  step={1}
                  onChange={setTinVertex}
                />
                <NumberField
                  label="TIN vertex elevation (m)"
                  value={tinElevation}
                  min={-12000}
                  max={12000}
                  onChange={setTinElevation}
                />
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="mt-2 w-full"
                onClick={() => {
                  try {
                    const { at, grid } = center(),
                      xy = grid.toGrid(at.coordinate),
                      tin = metadata.preparation!.tin!
                    let best = 0,
                      distance = Infinity
                    for (let i = 0; i < tin.elevations.length; i++) {
                      const d = (tin.coordinates[i * 2] - xy[0]) ** 2 + (tin.coordinates[i * 2 + 1] - xy[1]) ** 2
                      if (d < distance) {
                        best = i
                        distance = d
                      }
                    }
                    setTinVertex(best)
                    setTinElevation(tin.elevations[best])
                  } catch (error) {
                    w.setError(String(error))
                  }
                }}
              >
                Nearest vertex to selected station
              </Button>
              <Button
                size="sm"
                className="mt-2 w-full"
                onClick={() =>
                  void run(async () => {
                    const current = metadata.preparation!
                    const edited = editTinElevation(raster, current.tin!, tinVertex, tinElevation)
                    await apply(
                      edited.raster,
                      {
                        ...current,
                        method: 'Edited retained TIN; constrained topology retained',
                        parameters: { ...current.parameters, editedVertex: tinVertex, editedElevationM: tinElevation },
                        tin: edited.tin,
                      },
                      false,
                    )
                  })
                }
              >
                Apply TIN vertex elevation
              </Button>
            </details>
          )}
          {!!metadata.referenceSurfaces?.length && (
            <details className={insetBox()}>
              <summary className="cursor-pointer text-xs font-medium">Named analytical reference surfaces</summary>
              <p className="mt-2 text-2xs text-muted-foreground">
                Section components can target these earlier ground surfaces. Remove a snapshot only after changing
                components that reference it.
              </p>
              {metadata.referenceSurfaces.map((surface) => (
                <div key={surface.id} className="mt-2 flex min-w-0 items-center gap-2">
                  <span className="min-w-0 flex-1 break-words text-xs">{surface.name}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      w.update((p) => ({
                        ...p,
                        terrain: {
                          ...p.terrain,
                          referenceSurfaces: p.terrain.referenceSurfaces?.filter((s) => s.id !== surface.id),
                        },
                      }))
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </details>
          )}
          <details className={insetBox()}>
            <summary className="cursor-pointer text-xs font-medium">Grade a pad at the selected station</summary>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(
                [
                  ['widthM', 'Pad width (m)', 0.1, 500],
                  ['lengthM', 'Pad length (m)', 0.1, 1000],
                  ['bearingDegrees', 'Pad bearing (°)', 0, 360],
                  ['elevationM', 'Pad elevation (m)', -12000, 12000],
                  ['crossfallPercent', 'Pad crossfall (%)', -30, 30],
                  ['gradePercent', 'Pad grade (%)', -30, 30],
                  ['batterHV', 'Pad batter H:V', 0.1, 10],
                ] as const
              ).map(([key, label, min, max]) => (
                <NumberField
                  key={key}
                  label={label}
                  value={pad[key]}
                  min={min}
                  max={max}
                  onChange={(v) => setPad({ ...pad, [key]: v })}
                />
              ))}
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="mt-2 w-full"
              onClick={() => {
                try {
                  const { at } = center()
                  setPad({
                    ...pad,
                    elevationM: at.designElevation ?? at.groundElevation ?? 0,
                    bearingDegrees: at.bearing,
                  })
                } catch (error) {
                  w.setError(String(error))
                }
              }}
            >
              Use selected station level and bearing
            </Button>
            <Button
              size="sm"
              className="mt-2 w-full"
              disabled={!raster}
              onClick={() =>
                void run(async () => {
                  if (!raster) throw Error('Import terrain before grading a pad.')
                  const { at, grid } = center(),
                    raw = gradePad(raster, { ...pad, name: 'Graded landing pad', center: grid.toGrid(at.coordinate) })
                  await apply(raw, {
                    operation: 'graded-pad',
                    sources: [sourceRecord(metadata)],
                    method: 'Planar pad with daylight batters',
                    parameters: { ...pad, stationM: at.chainage },
                  })
                })
              }
            >
              Apply graded pad as terrain
            </Button>
          </details>
          <Button
            size="sm"
            variant="outline"
            className="w-full whitespace-normal"
            disabled={!raster || !w.analysis}
            onClick={() =>
              void run(async () => {
                if (!raster || !w.analysis) throw Error('Import a grid and calculate a road first.')
                if (raster.epsg === 4326)
                  throw Error(
                    'Design-surface merging needs a projected metre grid; reproject geographic terrain explicitly first.',
                  )
                if (Math.abs(raster.pixelSize[0] + raster.pixelSize[1]) > 1e-8)
                  throw Error('Design-surface merge requires square ground cells.')
                const grid = exportGrid(metadata, alignment.points[0].coordinate)
                const burned = burnRoad(
                  {
                    origin: raster.origin,
                    cellM: raster.pixelSize[0],
                    width: raster.width,
                    height: raster.height,
                    values: Float64Array.from(raster.values, (v) => v ?? NaN),
                  },
                  w.analysis,
                  grid.toGrid,
                  { culverts: alignment.engineering?.culverts ?? [] },
                )
                await apply(
                  {
                    ...raster,
                    name: `${alignment.name} · composite ground`,
                    values: Array.from(burned.surface.values, (v) => (Number.isFinite(v) ? v : null)),
                  },
                  {
                    operation: 'design-surface',
                    sources: [sourceRecord(metadata)],
                    method: 'Designed road prism and culvert channels merged with existing ground',
                    parameters: { road: alignment.name, stationCount: w.analysis.stations.length },
                  },
                )
              })
            }
          >
            Merge this road into ground for a junction
          </Button>
        </fieldset>
      </RoadSection>
      <RoadSection
        title="Canopy and image backgrounds"
        summary={metadata.backgrounds?.length ? `${metadata.backgrounds.length}` : ''}
        help="Independent display layers with their own CRS, opacity and visibility. A canopy height image or orthophoto never replaces bare-earth analytical ground. An image larger than the display budget is resampled, and its line says so."
      >
        <fieldset disabled={working || !!w.busy} className="space-y-2" data-testid="road-terrain-backgrounds">
          <Field label="Background GeoTIFF type">
            <RoadSelect
              ariaLabel="Background GeoTIFF type"
              className={roadFieldClass}
              value={backgroundKind}
              onValueChange={(value) => setBackgroundKind(value as typeof backgroundKind)}
            >
              <option value="canopy">Canopy height (0–40 m ramp)</option>
              <option value="ortho">RGB orthophoto</option>
            </RoadSelect>
          </Field>
          <input
            type="file"
            ref={backgroundFile}
            className="hidden"
            accept=".tif,.tiff"
            aria-label="Import independent terrain background"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f)
                void run(async () => {
                  const layer = await loadTerrainBackground(f, backgroundKind, metadata.backgrounds)
                  if (latest.current.projectId !== w.projectId)
                    throw Error(
                      'The project changed while importing this background; import it again in the selected project.',
                    )
                  w.update((p) => ({
                    ...p,
                    terrain: {
                      ...p.terrain,
                      backgrounds: parseTerrainBackgrounds([
                        ...(p.terrain.backgrounds ?? []).filter((l) => l.id !== layer.id),
                        layer,
                      ]),
                    },
                  }))
                  w.setNotice(
                    `${layer.name} added as display background${layer.sourceSize ? `, ${backgroundResolution(layer)}` : ''}. Analytical ground is unchanged.`,
                  )
                })
            }}
          />
          <Button variant="outline" size="sm" className="w-full" onClick={() => backgroundFile.current?.click()}>
            Import canopy / orthophoto GeoTIFF
          </Button>
          {(metadata.backgrounds ?? []).map((layer) => (
            <div key={layer.id} className={cn(insetBox(), 'space-y-1')}>
              <label className="flex min-w-0 items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={layer.visible}
                  onChange={(e) =>
                    w.update((p) => ({
                      ...p,
                      terrain: {
                        ...p.terrain,
                        backgrounds: p.terrain.backgrounds?.map((l) =>
                          l.id === layer.id ? { ...l, visible: e.target.checked } : l,
                        ),
                      },
                    }))
                  }
                />
                <span className="min-w-0 break-words">{layer.name}</span>
              </label>
              {layer.sourceSize && (
                <p className="text-2xs text-muted-foreground" data-background-resampled={layer.id}>
                  {backgroundResolution(layer)[0].toUpperCase() + backgroundResolution(layer).slice(1)}
                </p>
              )}
              <NumberField
                label={`${layer.name} opacity (%)`}
                value={layer.opacity * 100}
                min={0}
                max={100}
                onChange={(v) =>
                  w.update((p) => ({
                    ...p,
                    terrain: {
                      ...p.terrain,
                      backgrounds: p.terrain.backgrounds?.map((l) =>
                        l.id === layer.id ? { ...l, opacity: v / 100 } : l,
                      ),
                    },
                  }))
                }
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  w.update((p) => ({
                    ...p,
                    terrain: { ...p.terrain, backgrounds: p.terrain.backgrounds?.filter((l) => l.id !== layer.id) },
                  }))
                }
              >
                Remove background
              </Button>
            </div>
          ))}
        </fieldset>
      </RoadSection>
      <RoadSection
        title="Survey field book"
        summary=""
        help="Projected grid metres and grid bearings. A closed traverse can use Bowditch corrections proportional to horizontal leg length, including vertical closure. Signed side-shot offsets are negative left. This reduces entered observations; it does not establish survey accuracy."
      >
        <fieldset disabled={working || !!w.busy} className="min-w-0 space-y-2" data-testid="road-survey-field-book">
          <p className="text-2xs text-muted-foreground">
            EPSG:{exportGrid(metadata, alignment.points[0].coordinate).epsg} · {metadata.verticalReference}
          </p>
          <input
            ref={traverseFile}
            type="file"
            accept=".asc,.ipd,.pol,.txt,.raw,.csv,text/plain"
            className="hidden"
            aria-label="Traverse file"
            onChange={(e) => {
              const picked = e.target.files?.[0]
              e.target.value = ''
              if (!picked) return
              void run(async () => {
                const { detectTraverseFile, MAX_TRAVERSE_FILE_BYTES } = await import('./traverseFiles')
                if (picked.size > MAX_TRAVERSE_FILE_BYTES)
                  throw Error(`${picked.name} is over ${MAX_TRAVERSE_FILE_BYTES / 1e6} MB.`)
                const text = await picked.text()
                const format = detectTraverseFile(text)
                if (!format)
                  throw Error(
                    `${picked.name} is not a traverse this reads: a Softree ASCII or IPD traverse, a Polycorder Roads traverse, a unit survey (.pol) or a Laser Technology raw survey.`,
                  )
                setPendingTraverse({
                  name: picked.name,
                  text,
                  format,
                  unit: '',
                  vertical: '',
                  distance: '',
                  startQuestion: null,
                })
              })
            }}
          />
          <Button size="sm" variant="outline" className="w-full" onClick={() => traverseFile.current?.click()}>
            Load traverse file
          </Button>
          {pendingTraverse && (
            <div className={cn(insetBox(), 'space-y-2')} data-testid="road-survey-traverse-file">
              <p className="text-xs">
                {pendingTraverse.name}:{' '}
                {
                  {
                    asc: 'Softree ASCII traverse',
                    ipd: 'Softree IPD traverse',
                    polycorder: 'Polycorder Roads traverse',
                    'unit-survey': 'unit survey',
                    'laser-raw': 'Laser Technology raw survey',
                  }[pendingTraverse.format]
                }
              </p>
              <Field
                label="Measured in"
                hint="Traverse files do not state their units, so they are asked for every file."
              >
                <RoadSelect
                  ariaLabel="Traverse measured in"
                  className={roadFieldClass}
                  value={pendingTraverse.unit}
                  placeholder="Choose the unit"
                  onValueChange={(unit) => setPendingTraverse({ ...pendingTraverse, unit })}
                  options={TRAVERSE_UNITS}
                />
              </Field>
              {pendingTraverse.format === 'unit-survey' && (
                <>
                  <Field label="Vertical readings are">
                    <RoadSelect
                      ariaLabel="Vertical readings are"
                      className={roadFieldClass}
                      value={pendingTraverse.vertical}
                      placeholder="Choose what they are"
                      onValueChange={(vertical) =>
                        setPendingTraverse({ ...pendingTraverse, vertical: vertical as UnitSurveyVertical })
                      }
                      options={UNIT_SURVEY_VERTICALS}
                    />
                  </Field>
                  <Field label="Distances are">
                    <RoadSelect
                      ariaLabel="Distances are"
                      className={roadFieldClass}
                      value={pendingTraverse.distance}
                      placeholder="Choose what they are"
                      onValueChange={(distance) =>
                        setPendingTraverse({ ...pendingTraverse, distance: distance as UnitSurveyDistance })
                      }
                      options={UNIT_SURVEY_DISTANCES}
                    />
                  </Field>
                </>
              )}
              {pendingTraverse.startQuestion && (
                <p role="status" className="text-xs text-warning-foreground">
                  {pendingTraverse.startQuestion} It is read from the survey start below.
                </p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" variant="ghost" onClick={() => setPendingTraverse(null)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={
                    !pendingTraverse.unit ||
                    (pendingTraverse.format === 'unit-survey' &&
                      (!pendingTraverse.vertical || !pendingTraverse.distance))
                  }
                  onClick={() => void run(readTraverse)}
                >
                  Read traverse
                </Button>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            {(['easting', 'northing', 'elevation'] as const).map((key) => (
              <NumberField
                key={key}
                label={`Survey start ${key} (m)`}
                value={start[key]}
                min={-100000000}
                max={100000000}
                onChange={(v) => {
                  setStart({ ...start, [key]: v })
                  setSurvey(null)
                }}
              />
            ))}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            onClick={() => {
              try {
                const { at, grid } = center(),
                  xy = grid.toGrid(at.coordinate)
                setStart({ easting: xy[0], northing: xy[1], elevation: at.groundElevation ?? 0 })
              } catch (error) {
                w.setError(String(error))
              }
            }}
          >
            Fill start from station <StationValue workspace={w}>{(station) => formatRoadStation(station)}</StationValue>
          </Button>
          <Field
            label="Horizontal distances are"
            hint="Distances taped or measured by EDM on the ground are longer than the same line on the UTM grid. Ground distances are multiplied by the combined scale factor (point scale × elevation factor) at the survey start before they are laid on the grid. BC Albers has no single factor and is refused."
          >
            <RoadSelect
              ariaLabel="Horizontal distances are"
              className={roadFieldClass}
              value={groundDistances ? 'ground' : 'grid'}
              onValueChange={(value) => {
                setGroundDistances(value === 'ground')
                setSurvey(null)
              }}
            >
              <option value="grid">Grid distances</option>
              <option value="ground">Ground distances</option>
            </RoadSelect>
          </Field>
          {groundDistances && (
            <>
              <NumberField
                label="Geoid height N (m)"
                value={geoidM}
                min={-200}
                max={200}
                step={0.1}
                hint="Ellipsoidal height = elevation + N. About −17 m around Prince George (CGG2013a); 17 m of error moves the factor by under 3 parts per million."
                onChange={(value) => {
                  setGeoidM(value)
                  setSurvey(null)
                }}
              />
              <p className="text-2xs text-muted-foreground" data-testid="road-survey-scale-factor">
                {scaleFactorText(surveyScale())}
              </p>
            </>
          )}
          <Field label="Traverse CSV (station, bearing°, horizontal m, grade %)">
            <textarea
              className={`${roadFieldClass} min-h-28 font-mono text-2xs`}
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value)
                setSurvey(null)
              }}
            />
          </Field>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={adjust}
              onChange={(e) => {
                setAdjust(e.target.checked)
                setSurvey(null)
              }}
            />
            Close to a known coordinate using Bowditch
          </label>
          {adjust && (
            <div className="grid grid-cols-2 gap-2">
              {(['easting', 'northing', 'elevation'] as const).map((key) => (
                <NumberField
                  key={key}
                  label={`Survey target ${key} (m)`}
                  value={target[key]}
                  min={-100000000}
                  max={100000000}
                  onChange={(v) => {
                    setTarget({ ...target, [key]: v })
                    setSurvey(null)
                  }}
                />
              ))}
            </div>
          )}
          <Field label="Side shots (id, station index, signed offset m, height difference m)">
            <textarea
              className={`${roadFieldClass} min-h-16 font-mono text-2xs`}
              value={shotNotes}
              onChange={(e) => {
                setShotNotes(e.target.value)
                setSurvey(null)
              }}
            />
          </Field>
          {softree && (
            <SurveyFieldNotes
              key={loads}
              details={softree}
              stations={noteStations()}
              onChange={setSoftree}
              onHeights={changeHeights}
            />
          )}
          <NumberField
            label="Start station (m)"
            value={startStation}
            min={-10_000_000}
            max={10_000_000}
            step={0.001}
            hint="The field station of the survey start. Stations run on by horizontal distance, renamed at each station equation."
            onChange={(value) => changeStations({ start: value })}
          />
          <Field
            label="Station equations"
            hint="From each back station on the measured chain, the field names stations from the ahead station. Back stations rise along the traverse."
          >
            <div className="space-y-1" data-testid="road-survey-station-equations">
              {equations.map((equation, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                  {(['back', 'ahead'] as const).map((key) => (
                    <NumberField
                      key={key}
                      label={`${key === 'back' ? 'Back' : 'Ahead'} station (m)`}
                      ariaLabel={`Equation ${i + 1} ${key} station (m)`}
                      hideLabel={i > 0}
                      value={equation[key]}
                      min={-10_000_000}
                      max={10_000_000}
                      step={0.001}
                      onChange={(value) =>
                        changeStations({
                          equations: equations.map((e, k) => (k === i ? { ...e, [key]: value } : e)),
                        })
                      }
                    />
                  ))}
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove equation ${i + 1}`}
                    onClick={() => changeStations({ equations: equations.filter((_, k) => k !== i) })}
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => {
                  const last = equations.at(-1)
                  const back = last ? last.back + 10 : startStation
                  changeStations({ equations: [...equations, { back, ahead: back }] })
                }}
              >
                Add station equation
              </Button>
            </div>
          </Field>
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            onClick={() => {
              try {
                setSurvey(reduce())
              } catch (error) {
                w.setError(error instanceof Error ? error.message : String(error))
              }
            }}
          >
            Reduce survey observations
          </Button>
          {openBookRecord ? (
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" variant="outline" onClick={() => saveBook(false)}>
                Save {openBookRecord.name}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={(project.surveyBooks?.length ?? 0) >= 20}
                onClick={() => saveBook(true)}
              >
                Save as new
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              disabled={(project.surveyBooks?.length ?? 0) >= 20}
              onClick={() => saveBook(true)}
            >
              Save field book to project
            </Button>
          )}
          {!!project.surveyBooks?.length && (
            <Field label="Saved survey field books">
              <RoadSelect
                ariaLabel="Saved survey field books"
                className={roadFieldClass}
                value=""
                onValueChange={(value) => {
                  const book = project.surveyBooks?.find((b) => b.id === value)
                  if (!book) return
                  const grid = exportGrid(metadata, alignment.points[0].coordinate)
                  if (book.epsg !== grid.epsg || book.verticalReference !== metadata.verticalReference) {
                    w.setError(
                      'This field book uses a different CRS or vertical datum. Open it with its original terrain before reducing it.',
                    )
                    return
                  }
                  const input = book.input
                  setStart({ easting: input.start[0], northing: input.start[1], elevation: input.start[2] })
                  setAdjust(input.adjustment === 'bowditch')
                  if (input.target)
                    setTarget({ easting: input.target[0], northing: input.target[1], elevation: input.target[2] })
                  setNotes(legsText(input.legs))
                  setShotNotes(
                    (input.sideShots ?? [])
                      .map((s) => [s.id, s.station, s.offsetM, s.heightDifferenceM].join(','))
                      .join('\n'),
                  )
                  setStartStation(book.startStation ?? 0)
                  setEquations(book.stationEquations ?? [])
                  setSoftree(book.softree ?? null)
                  setLoads((n) => n + 1)
                  setOpenBook(book.id)
                  if (book.softree) {
                    if (book.softree.sourceFormat !== 'laser-raw') setTraverseExport(book.softree.sourceFormat)
                    const unit = TRAVERSE_UNITS.find((u) => Math.abs(Number(u.value) - book.softree!.unitM) < 1e-12)
                    if (unit) setTraverseExportUnit(unit.value)
                  }
                  setSurvey(reduceTraverse(input))
                }}
              >
                <option value="">Open a saved field book…</option>
                {project.surveyBooks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </RoadSelect>
            </Field>
          )}
          {survey && (
            <>
              <p className="text-xs">
                {survey.stations.length} stations · {survey.lengthM.toFixed(2)} m · field stations{' '}
                {stationText(fieldAt(0))} to {stationText(fieldAt(survey.lengthM))}
                {survey.closure
                  ? ` · raw closure ${survey.closure.horizontalM.toFixed(3)} m${survey.closure.ratio ? ` (1:${survey.closure.ratio.toFixed(0)})` : ''}`
                  : ''}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const grid = exportGrid(metadata, alignment.points[0].coordinate)
                    download(
                      traverseCsv(survey, grid.epsg, metadata.verticalReference, {
                        input: surveyInput(),
                        startStation,
                        stationEquations: equations,
                      }),
                      'survey-reduction.csv',
                      'text/csv',
                    )
                  }}
                >
                  Export survey CSV
                </Button>
                <Button
                  size="sm"
                  disabled={project.alignments.length >= 20}
                  onClick={() => {
                    try {
                      const current = reduce(),
                        grid = exportGrid(metadata, alignment.points[0].coordinate),
                        id = crypto.randomUUID()
                      const points = current.stations.map((s, i) => ({
                        id: `${id}-${i}`,
                        coordinate: grid.toLonLat([s.adjusted[0], s.adjusted[1]]),
                        radiusM: 0,
                      }))
                      w.commit({
                        ...project,
                        activeAlignmentId: id,
                        alignments: [
                          ...project.alignments,
                          {
                            ...alignment,
                            id,
                            name: 'Reduced survey traverse',
                            points,
                            vertical: [],
                            overrides: [],
                            engineering: undefined,
                          },
                        ],
                      })
                      w.setNotice(
                        'Added survey linework. Grid levels remain in the survey CSV; design a formation separately.',
                      )
                    } catch (error) {
                      w.setError(String(error))
                    }
                  }}
                >
                  Add survey line
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Traverse file format">
                  <RoadSelect
                    ariaLabel="Traverse file format"
                    className={roadFieldClass}
                    value={traverseExport}
                    onValueChange={(format) => setTraverseExport(format as WritableTraverseFormat)}
                    options={TRAVERSE_EXPORTS}
                  />
                </Field>
                <Field label="Traverse file units">
                  <RoadSelect
                    ariaLabel="Traverse file units"
                    className={roadFieldClass}
                    value={traverseExportUnit}
                    onValueChange={setTraverseExportUnit}
                    options={TRAVERSE_UNITS}
                  />
                </Field>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() =>
                  void run(async () => {
                    const { writeTraverseFile } = await import('./traverseFiles')
                    const input = surveyInput()
                    checkSurveyStations(input, startStation, equations)
                    const written = writeTraverseFile(input, traverseExport, {
                      unitM: Number(traverseExportUnit),
                      startStation,
                      equations,
                      name: 'PGMAPS',
                      ...(softree ? { details: softree } : {}),
                    })
                    download(written.text, `survey-traverse${written.extension}`)
                    w.setNotice(['Traverse file downloaded.', ...written.notes].join(' '))
                  })
                }
              >
                Export traverse file
              </Button>
            </>
          )}
        </fieldset>
      </RoadSection>
    </>
  )
}
