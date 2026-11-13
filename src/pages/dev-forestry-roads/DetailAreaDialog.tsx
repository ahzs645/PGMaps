import { useEffect, useMemo, useRef, useState } from 'react'
import { formatBytes } from '../dev-lidar/lidarbc/bcLidarIndex'
import { Button } from '@/components/ui/button'
import { PanelDialog } from '@/components/ui/dialog-shell'
import { InlineAlert } from '@/components/ui/map-panels'
import { StyledSelect } from '@/components/ui/styled-select'
import {
  detailWindow,
  makeDemBoxes,
  projectDetailAreas,
  HRDEM_MAX_DOWNLOAD_BOXES,
  HRDEM_MAX_DOWNLOAD_CELLS,
  type DetailArea,
  type DemBox,
} from './hrdem'
import { cdedTilesFor } from './cdedDem'
import { findLidarBcDem, type LidarBcDemTile, type LidarBcStatus } from './lidarBcDem'
import { cellFactorFor, LOCAL_DEM_MAX_CELL_FACTOR } from './localDemWindow'
import { localMetricGrid, MAX_ROAD_RASTER_CELLS } from './terrain'
import type { Coordinate, RoadProject } from './types'

/** Where the 1 m terrain comes from: NRCan streams into the page; LidarBC is downloaded, then read back. */
export type DetailSource = 'hrdem' | 'lidarbc' | 'cded'

export type DetailWindow = ReturnType<typeof detailWindow>

export function DetailAreaDialog({
  project,
  view,
  importedAreas,
  portalContainer,
  onClose,
  onPreview,
  onLoad,
  onDownload,
  onDownloadBoxes,
  onLoadFiles,
  onLoadCded,
  initialSource = 'hrdem',
  initialAreaId,
}: {
  project: RoadProject
  view: Coordinate[]
  importedAreas?: DetailArea[] | null
  portalContainer: HTMLElement | null
  onClose: () => void
  onPreview: (boxes: DemBox[]) => void
  onLoad: (window: DetailWindow, nearbyFsr: boolean) => void
  onDownload: (boxes: DemBox[], nearbyFsr: boolean) => void
  onDownloadBoxes: (boxes: DemBox[]) => void
  /** LidarBC: read `window` out of the DEM files the reader downloaded. */
  /** LidarBC: read `area` (lon/lat, widened by its buffer) out of the downloaded files at `cellFactor` × their cell. */
  onLoadFiles: (area: { coordinates: Coordinate[]; bufferM: number }, files: File[], cellFactor: number) => void
  /** BC CDED: read `area` out of the `.dem.zip` files the reader downloaded. */
  onLoadCded: (area: { coordinates: Coordinate[]; bufferM: number }, files: File[]) => void
  initialSource?: DetailSource
  /** An area to start on, e.g. `road:<id>` for the road whose sections asked for better terrain. */
  initialAreaId?: string
}) {
  const features = useMemo(() => importedAreas ?? projectDetailAreas(project), [project, importedAreas])
  const areas = useMemo<DetailArea[]>(
    () => [...(view.length ? [{ id: 'view', name: 'Current map view', coordinates: view }] : []), ...features],
    [features, view],
  )
  const [areaId, setAreaId] = useState(
    initialAreaId && areas.some((a) => a.id === initialAreaId)
      ? initialAreaId
      : importedAreas?.length
        ? 'batch'
        : (areas[0]?.id ?? ''),
  )
  const [source, setSource] = useState<DetailSource>(initialSource)
  const filePicker = useRef<HTMLInputElement>(null)
  const cdedPicker = useRef<HTMLInputElement>(null)
  const [bufferM, setBufferM] = useState(100)
  const [nearbyFsr, setNearbyFsr] = useState(false)
  const [omitted, setOmitted] = useState<string[]>([])
  const selection = useMemo(() => {
    const areasToBox = areaId === 'batch' ? features : areas.filter((a) => a.id === areaId)
    try {
      return {
        boxes: makeDemBoxes(areasToBox, bufferM),
        error: areasToBox.length ? null : 'Choose an area.',
      }
    } catch (error) {
      return { boxes: [], error: error instanceof Error ? error.message : 'Choose an area.' }
    }
  }, [features, areas, areaId, bufferM])
  const boxes = selection.boxes.filter((box) => !omitted.includes(box.id))
  const cells = boxes.reduce((n, b) => n + b.window.width * b.window.height, 0)
  const problem =
    selection.error ??
    boxes.find((b) => b.window.problem)?.window.problem ??
    (boxes.length > HRDEM_MAX_DOWNLOAD_BOXES || cells > HRDEM_MAX_DOWNLOAD_CELLS
      ? `Select at most ${HRDEM_MAX_DOWNLOAD_BOXES} boxes and ${HRDEM_MAX_DOWNLOAD_CELLS / 1e6} million cells per download.`
      : null)
  // LidarBC reads one area back into the project, sized in UTM, the projection its files use: the
  // NRCan box above is drawn in Canada-wide LCC and comes out turned, and up to 2.7× larger, in UTM.
  const [cellFactor, setCellFactor] = useState(1)
  const lidarArea = useMemo(() => {
    const area = areaId === 'batch' ? null : areas.find((a) => a.id === areaId)
    if (!area?.coordinates.length) return null
    const grid = localMetricGrid(area.coordinates[0])
    const points = area.coordinates.map(grid.toGrid)
    const west = Math.min(...points.map((p) => p[0])) - bufferM,
      east = Math.max(...points.map((p) => p[0])) + bufferM,
      south = Math.min(...points.map((p) => p[1])) - bufferM,
      north = Math.max(...points.map((p) => p[1])) + bufferM
    const ring = (
      [
        [west, north],
        [east, north],
        [east, south],
        [west, south],
      ] as [number, number][]
    ).map(grid.toLonLat)
    return { coordinates: area.coordinates, ring, nativeCells: Math.ceil(east - west) * Math.ceil(north - south) }
  }, [areaId, areas, bufferM])
  const lidarCells = lidarArea ? lidarArea.nativeCells / cellFactor ** 2 : 0
  const neededFactor = lidarArea ? cellFactorFor(lidarArea.nativeCells) : 1
  const lidarProblem =
    source !== 'lidarbc'
      ? null
      : !lidarArea
        ? 'Choose one block, road or the map view: LidarBC loads one area at a time.'
        : lidarCells > MAX_ROAD_RASTER_CELLS
          ? `This area needs about ${(lidarCells / 1e6).toFixed(1)} million ${cellFactor} m cells (limit ${(MAX_ROAD_RASTER_CELLS / 1e6).toFixed(2)} million). ${neededFactor <= LOCAL_DEM_MAX_CELL_FACTOR ? `Choose ${neededFactor} m cells, or pick` : 'Pick'} one road or a smaller buffer.`
          : null
  const lidar = useLidarBcTiles(source === 'lidarbc' && lidarArea ? lidarArea.ring : null)
  return (
    <PanelDialog
      title="Load 1 m DEM"
      subtitle={
        source === 'hrdem'
          ? 'NRCan CanElevation · separate download boxes · CGVD2013'
          : source === 'cded'
            ? 'BC CDED (TRIM) · about 14 × 23 m posts · download, then load · CGVD28'
            : 'LidarBC · download the tiles, then load them back · CGVD2013'
      }
      size="md"
      portalContainer={portalContainer}
      onClose={onClose}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
          {source === 'cded' ? (
            <>
              <input
                ref={cdedPicker}
                type="file"
                multiple
                accept=".zip,.dem"
                className="hidden"
                aria-label="Downloaded CDED files"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? [])
                  e.target.value = ''
                  if (files.length && lidarArea) onLoadCded({ coordinates: lidarArea.coordinates, bufferM }, files)
                }}
              />
              <Button size="sm" disabled={!lidarArea} onClick={() => cdedPicker.current?.click()}>
                Load downloaded files…
              </Button>
            </>
          ) : source === 'lidarbc' ? (
            <>
              <input
                ref={filePicker}
                type="file"
                multiple
                accept=".tif,.tiff"
                className="hidden"
                aria-label="Downloaded LidarBC DEM files"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? [])
                  e.target.value = ''
                  if (files.length && lidarArea)
                    onLoadFiles({ coordinates: lidarArea.coordinates, bufferM }, files, cellFactor)
                }}
              />
              <Button size="sm" disabled={!lidarArea || !!lidarProblem} onClick={() => filePicker.current?.click()}>
                Load downloaded files…
              </Button>
            </>
          ) : (
            <>
              {boxes.length === 1 && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!!problem}
                  onClick={() => onLoad(boxes[0].window, nearbyFsr)}
                >
                  Load this area
                </Button>
              )}
              <Button size="sm" disabled={!boxes.length || !!problem} onClick={() => onDownload(boxes, nearbyFsr)}>
                Download 1 m DEMs
              </Button>
            </>
          )}
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        <label className="grid gap-1">
          Source
          <StyledSelect
            aria-label="Detailed DEM source"
            value={source}
            onChange={(e) => setSource(e.target.value as DetailSource)}
          >
            <option value="hrdem">NRCan HRDEM · loads directly</option>
            <option value="lidarbc">LidarBC · download, then load</option>
            <option value="cded">BC CDED (about 14 × 23 m) · download, then load</option>
          </StyledSelect>
        </label>
        <label className="grid gap-1">
          Area
          <StyledSelect
            aria-label="Detailed DEM area"
            value={areaId}
            onChange={(e) => {
              setAreaId(e.target.value)
              setOmitted([])
            }}
          >
            {features.length > 0 && (
              <option value="batch">Separate boxes for {features.length} blocks and roads</option>
            )}
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </StyledSelect>
        </label>
        <label className="grid gap-1">
          Buffer (m)
          <StyledSelect
            aria-label="Detailed DEM buffer metres"
            value={String(bufferM)}
            onChange={(e) => setBufferM(Number(e.target.value))}
          >
            {[0, 50, 100, 200, 400, 1000].map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </StyledSelect>
        </label>
        {areaId === 'batch' && (
          <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2" aria-label="DEM download boxes">
            {selection.boxes.map((box) => (
              <label key={box.id} className="flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={!omitted.includes(box.id)}
                  onChange={(e) =>
                    setOmitted((previous) =>
                      e.target.checked ? previous.filter((id) => id !== box.id) : [...previous, box.id],
                    )
                  }
                />
                <span>
                  {box.name} · {box.window.width} × {box.window.height} m{box.window.problem ? ' · box too large' : ''}
                </span>
              </label>
            ))}
          </div>
        )}
        {source === 'lidarbc' ? (
          <label className="grid gap-1">
            Cell size
            <StyledSelect
              aria-label="LidarBC cell size"
              value={String(cellFactor)}
              onChange={(e) => setCellFactor(Number(e.target.value))}
            >
              {Array.from({ length: LOCAL_DEM_MAX_CELL_FACTOR }, (_, i) => i + 1).map((f) => (
                <option key={f} value={f}>
                  {f === 1 ? '1 m · native cells' : `${f} m · mean of ${f} × ${f} cells`}
                </option>
              ))}
            </StyledSelect>
          </label>
        ) : null}
        <p>
          {source === 'cded'
            ? lidarArea
              ? 'Posts every 0.75 arc-seconds, as surveyed'
              : 'One area at a time'
            : source === 'lidarbc'
              ? lidarArea
                ? `About ${(lidarCells / 1e6).toFixed(2)} million ${cellFactor} m cells in UTM`
                : 'One area at a time'
              : `${boxes.length} boxes · ${(cells / 1e6).toFixed(2)} million native 1 m cells`}
        </p>
        {source === 'cded' ? (
          <CdedTileList ring={lidarArea?.ring ?? null} />
        ) : source === 'lidarbc' ? (
          <LidarBcTileList state={lidar} problem={lidarProblem} />
        ) : (
          problem && <InlineAlert tone="warning">{problem}</InlineAlert>
        )}
        <label className={`flex items-center gap-2 ${source !== 'hrdem' ? 'hidden' : ''}`}>
          <input type="checkbox" checked={nearbyFsr} onChange={(e) => setNearbyFsr(e.target.checked)} />
          Show nearby active FSR records (1 km)
        </label>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={!boxes.length} onClick={() => onPreview(boxes)}>
            Show boxes on map
          </Button>
          <Button size="sm" variant="outline" disabled={!boxes.length} onClick={() => onDownloadBoxes(boxes)}>
            Download boxes GeoJSON
          </Button>
        </div>
        <p className={`text-xs text-muted-foreground ${source !== 'hrdem' ? 'hidden' : ''}`}>
          Downloads contain one native 1 m GeoTIFF per box, the boxes, and a coverage report. Uncovered areas stay
          missing. Load this area replaces the project&apos;s calculation terrain; Undo restores it. FSR records are
          optional mapped tenures for review.
        </p>
      </div>
    </PanelDialog>
  )
}

type LidarState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; tiles: LidarBcDemTile[]; truncated: boolean; acquisition: LidarBcStatus[] | null }

/** The LidarBC DEM tiles under `ring`, read live from the index whenever the area changes. */
function useLidarBcTiles(ring: Coordinate[] | null): LidarState {
  const key = ring ? JSON.stringify(ring) : ''
  const [answer, setAnswer] = useState<{ key: string; state: LidarState } | null>(null)
  useEffect(() => {
    if (!key) return
    const controller = new AbortController()
    findLidarBcDem(JSON.parse(key) as Coordinate[], fetch, controller.signal).then(
      (found) =>
        setAnswer({
          key,
          state: { status: 'ready', tiles: found.tiles, truncated: found.truncated, acquisition: found.status },
        }),
      (error: unknown) => {
        if (!controller.signal.aborted)
          setAnswer({
            key,
            state: { status: 'error', message: error instanceof Error ? error.message : 'The LidarBC index failed.' },
          })
      },
    )
    return () => controller.abort()
  }, [key])
  if (!key) return { status: 'idle' }
  return answer?.key === key ? answer.state : { status: 'loading' }
}

/**
 * The tiles to download, each a plain link (the object store sends no CORS headers, so the page can
 * link to a file but never read it), then the step that reads them back.
 */
function LidarBcTileList({ state, problem }: { state: LidarState; problem: string | null }) {
  // A cell-limit problem stops the load, not the lookup: the status and tiles still show under it.
  if (problem && state.status === 'idle') return <InlineAlert tone="warning">{problem}</InlineAlert>
  if (problem)
    return (
      <div className="space-y-2">
        <InlineAlert tone="warning">{problem}</InlineAlert>
        <LidarBcTileList state={state} problem={null} />
      </div>
    )
  if (state.status === 'loading' || state.status === 'idle')
    return <p className="text-xs text-muted-foreground">Reading the LidarBC tile index…</p>
  if (state.status === 'error') return <InlineAlert tone="warning">{state.message}</InlineAlert>
  if (!state.tiles.length)
    return (
      <div data-testid="lidarbc-none" className="space-y-2">
        <LidarBcStatusLine acquisition={state.acquisition} />
        <InlineAlert tone="info">
          LidarBC lists no bare-earth DEM under this area. Keep the current terrain and treat the design as preliminary,
          or load the licensee&apos;s own LiDAR with Terrain → Import.
        </InlineAlert>
      </div>
    )
  return (
    <div className="space-y-2" data-testid="lidarbc-tiles">
      <LidarBcStatusLine acquisition={state.acquisition} />
      <ol className="list-decimal space-y-1 pl-5 text-xs">
        <li>Download the tiles below. They open from the LidarBC object store in a new tab.</li>
        <li>Choose Load downloaded files… and pick them. Only this area&apos;s cells are read from them.</li>
      </ol>
      <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2 text-xs" aria-label="LidarBC DEM tiles">
        {state.tiles.map((tile) => (
          <li key={tile.url} className="flex flex-wrap items-baseline justify-between gap-x-2">
            <a
              href={tile.url}
              target="_blank"
              rel="noreferrer"
              download
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              {tile.filename}
            </a>
            <span className="text-muted-foreground">
              {tile.grid} · {tile.year} · {tile.project} · {tile.spacing}
              {tile.estimatedBytes ? ` · about ${formatBytes(tile.estimatedBytes)}` : ''}
            </span>
          </li>
        ))}
      </ul>
      {state.truncated && (
        <InlineAlert tone="warning">More tiles lie under this area than are listed. Choose a smaller area.</InlineAlert>
      )}
      <p className="text-xs text-muted-foreground">
        A listed tile is the tile&apos;s footprint, not its coverage: a 1:20,000 sheet from a floodplain flight can be
        empty under the road. Loading reports how much of the area has elevations, and refuses files with none. Sizes
        are typical for the product; the index has none. LidarBC states CGVD2013 heights for its DEMs.
      </p>
    </div>
  )
}

/**
 * What LidarBC's status layer says about the area: the only public sign of LiDAR that is flown but
 * not yet published. A lead to confirm with LidarBC, shown beside the tiles, never instead of them.
 */
function LidarBcStatusLine({ acquisition }: { acquisition: LidarBcStatus[] | null }) {
  const text =
    acquisition === null
      ? 'LidarBC acquisition status: not read.'
      : acquisition.length
        ? `LidarBC acquisition status here: ${acquisition.map((s) => `${s.status}${s.year ? ` (${s.year})` : ''}`).join(', ')}.`
        : 'LidarBC acquisition status: nothing planned, flown or available is recorded here.'
  const flown = acquisition?.some((s) => /actual/i.test(s.status))
  return (
    <p className="text-xs" data-testid="lidarbc-status">
      {text}
      {flown &&
        ' Flown data is published as tiles once approved, which then list here; ask lidar@gov.bc.ca for the release window. The status layer is a planning record, not a promise.'}
    </p>
  )
}

/** The CDED half-sheets under the area, named from the NTS grid, as download links. */
function CdedTileList({ ring }: { ring: Coordinate[] | null }) {
  if (!ring) return <InlineAlert tone="warning">Choose one block, road or the map view.</InlineAlert>
  const tiles = cdedTilesFor(ring)
  return (
    <div className="space-y-2" data-testid="cded-tiles">
      <ol className="list-decimal space-y-1 pl-5 text-xs">
        <li>Download the files below from the BC data catalogue (about 2 MB each).</li>
        <li>Choose Load downloaded files… and pick the zips as they are.</li>
      </ol>
      <ul className="space-y-1 rounded-md border p-2 text-xs" aria-label="BC CDED files">
        {tiles.map((tile) => (
          <li key={tile.name}>
            <a
              href={tile.url}
              target="_blank"
              rel="noreferrer"
              download
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              {tile.name}.dem.zip
            </a>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        CDED is BC&apos;s terrain from TRIM air photos: posts about 14 m apart east–west and 23 m north–south here. It
        is no finer than the regional terrain and does not resolve a road bench, but it is an independent survey, so it
        is a second opinion on a hillside where no LiDAR is published. File names follow from the map grid; a link is
        dead where BC publishes no file. Heights are CGVD28 by the product specification.
      </p>
    </div>
  )
}
