import { NativeSelect } from '@/components/ui/form-field'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, NumberField, roadFieldClass } from './Controls'
import { RoadSection } from './SidebarParts'
import { burnRoad } from './designSurface'
import {
  exportGrid,
  loadLas,
  loadRaster,
  parseTerrainReferenceSurfaces,
  preparedTerrain,
  type PointCloudImport,
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
  parseTraverseLegs,
  reduceTraverse,
  traverseCsv,
  type TraverseInput,
  type TraverseResult,
} from './surveyInterchange'
import type { RoadWorkspace } from './useRoadWorkspace'
import type { TerrainMetadata } from './types'

const sourceRecord = (m: TerrainMetadata) => {
  if (!m.raster) throw Error('Import a local terrain grid first.')
  return { name: m.name, sha256: m.raster.sha256, epsg: m.raster.epsg, verticalReference: m.verticalReference }
}
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
}: {
  workspace: RoadWorkspace
  verticalReference: string
  pointCloud?: Pick<PointCloudImport, 'classify' | 'surface' | 'preserveCorridorM' | 'retainTin'>
}) {
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
  const [tinVertex, setTinVertex] = useState(0),
    [tinElevation, setTinElevation] = useState(0)
  const file = useRef<HTMLInputElement>(null)
  const cloudFiles = useRef<HTMLInputElement>(null)
  const backgroundFile = useRef<HTMLInputElement>(null),
    [backgroundKind, setBackgroundKind] = useState<TerrainBackgroundLayer['kind']>('canopy')
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
    const at = w.analysis?.stations.reduce(
      (best, s) => (Math.abs(s.chainage - w.station) < Math.abs(best.chainage - w.station) ? s : best),
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
    return {
      start: [start.easting, start.northing, start.elevation],
      target: adjust ? [target.easting, target.northing, target.elevation] : undefined,
      adjustment: adjust ? 'bowditch' : 'none',
      legs: parseTraverseLegs(notes),
      sideShots,
    }
  }
  const reduce = () => reduceTraverse(surveyInput())
  return (
    <>
      <RoadSection
        title="Prepare and combine terrain"
        help="Combine checked grids in the same CRS/datum; preserve source spacing and no-data. Derived terrain becomes the original ground for subsequent designs. Download the project to retain the source evidence."
      >
        <fieldset disabled={working || !!w.busy} className="min-w-0 space-y-2" data-testid="road-terrain-preparation">
          <Field label="Overlapping ground grids">
            <NativeSelect
              className={roadFieldClass}
              value={overlap}
              onChange={(e) => setOverlap(e.target.value as typeof overlap)}
            >
              <option value="last">New files take precedence</option>
              <option value="first">Current ground takes precedence</option>
            </NativeSelect>
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
                const loaded = await Promise.all(
                  files.map((f) => loadRaster(f, verticalReference || metadata.verticalReference)),
                )
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
                const loaded = await loadLas(files[0], verticalReference || metadata.verticalReference, {
                  classify: 'auto',
                  surface: 'tin',
                  ...pointCloud,
                  additionalFiles: files.slice(1),
                  preservePath: alignment.points.map((p) => p.coordinate),
                })
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
            <p className="break-words text-[11px] text-muted-foreground">
              {metadata.preparation.method} · {metadata.preparation.sources.length} source records
            </p>
          )}
          {raster && metadata.preparation?.tin && (
            <details className="rounded border p-2">
              <summary className="cursor-pointer text-xs font-medium">Edit retained source TIN</summary>
              <p className="mt-2 text-[11px] text-muted-foreground">
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
            <details className="rounded border p-2">
              <summary className="cursor-pointer text-xs font-medium">Named analytical reference surfaces</summary>
              <p className="mt-2 text-[11px] text-muted-foreground">
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
          <details className="rounded border p-2">
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
          <p className="text-[11px] text-muted-foreground">
            Pad and road-surface actions change analytical ground. Undo restores the previous terrain; use a separate
            road for the connecting design.
          </p>
        </fieldset>
      </RoadSection>
      <RoadSection
        title="Canopy and image backgrounds"
        help="Independent display layers with their own CRS, opacity and visibility. A canopy height image or orthophoto never replaces bare-earth analytical ground."
      >
        <fieldset disabled={working || !!w.busy} className="space-y-2" data-testid="road-terrain-backgrounds">
          <Field label="Background GeoTIFF type">
            <NativeSelect
              className={roadFieldClass}
              value={backgroundKind}
              onChange={(e) => setBackgroundKind(e.target.value as typeof backgroundKind)}
            >
              <option value="canopy">Canopy height (0–40 m ramp)</option>
              <option value="ortho">RGB orthophoto</option>
            </NativeSelect>
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
                  const layer = await loadTerrainBackground(f, backgroundKind)
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
                  w.setNotice(`${layer.name} added as display background. Analytical ground is unchanged.`)
                })
            }}
          />
          <Button variant="outline" size="sm" className="w-full" onClick={() => backgroundFile.current?.click()}>
            Import canopy / orthophoto GeoTIFF
          </Button>
          {(metadata.backgrounds ?? []).map((layer) => (
            <div key={layer.id} className="space-y-1 rounded border p-2">
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
        help="Projected grid metres and grid bearings. A closed traverse can use Bowditch corrections proportional to horizontal leg length, including vertical closure. Signed side-shot offsets are negative left. This reduces entered observations; it does not establish survey accuracy."
      >
        <fieldset disabled={working || !!w.busy} className="min-w-0 space-y-2" data-testid="road-survey-field-book">
          <p className="text-[11px] text-muted-foreground">
            EPSG:{exportGrid(metadata, alignment.points[0].coordinate).epsg} · {metadata.verticalReference}
          </p>
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
            variant="ghost"
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
            Start at selected station ground
          </Button>
          <Field label="Traverse CSV (station, bearing°, horizontal m, grade %)">
            <textarea
              className={`${roadFieldClass} min-h-28 font-mono text-[11px]`}
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
              className={`${roadFieldClass} min-h-16 font-mono text-[11px]`}
              value={shotNotes}
              onChange={(e) => {
                setShotNotes(e.target.value)
                setSurvey(null)
              }}
            />
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
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            disabled={(project.surveyBooks?.length ?? 0) >= 20}
            onClick={() => {
              try {
                const input = surveyInput()
                reduceTraverse(input)
                const grid = exportGrid(metadata, alignment.points[0].coordinate)
                w.commit({
                  ...project,
                  surveyBooks: [
                    ...(project.surveyBooks ?? []),
                    {
                      id: crypto.randomUUID(),
                      name: `Survey ${1 + (project.surveyBooks?.length ?? 0)}`,
                      epsg: grid.epsg,
                      verticalReference: metadata.verticalReference,
                      input,
                    },
                  ],
                })
                w.setNotice('Survey observations and reduction settings saved in this project.')
              } catch (error) {
                w.setError(String(error))
              }
            }}
          >
            Save field book to project
          </Button>
          {!!project.surveyBooks?.length && (
            <Field label="Saved survey field books">
              <NativeSelect
                className={roadFieldClass}
                value=""
                onChange={(e) => {
                  const book = project.surveyBooks?.find((b) => b.id === e.target.value)
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
                  setNotes(
                    'station,bearing_deg,horizontal_m,grade_pct\n' +
                      input.legs
                        .map((l) => [l.id, l.bearingDegrees, l.horizontalDistanceM, l.gradePercent].join(','))
                        .join('\n'),
                  )
                  setShotNotes(
                    (input.sideShots ?? [])
                      .map((s) => [s.id, s.station, s.offsetM, s.heightDifferenceM].join(','))
                      .join('\n'),
                  )
                  setSurvey(reduceTraverse(input))
                }}
              >
                <option value="">Open a saved field book…</option>
                {project.surveyBooks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          {survey && (
            <>
              <p className="text-xs">
                {survey.stations.length} stations · {survey.lengthM.toFixed(2)} m
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
                      traverseCsv(survey, grid.epsg, metadata.verticalReference),
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
            </>
          )}
        </fieldset>
      </RoadSection>
    </>
  )
}
