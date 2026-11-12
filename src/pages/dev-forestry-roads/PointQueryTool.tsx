/**
 * Point query on the plan (`pointQuery.ts`). A click reports the nearest road's station and offset
 * at that point, the ground and design levels there and the cut or fill depth; **Go to** locates a
 * typed station and offset on the active road, evaluated where it was typed. A query on the active
 * road also selects its station, so the section and profile show the same place.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import type { MapMouseEvent } from 'maplibre-gl'
import { ScanSearch } from 'lucide-react'
import { MapMarker, MarkerContent, useMap } from '@/components/ui/map'
import { Button } from '@/components/ui/button'
import { MapToolPanel } from '@/components/ui/map-tool-panel'
import { ReadoutGrid } from '@/components/ui/readout-grid'
import { formatRoadStation } from './Charts'
import { NumberField } from './Controls'
import { CURSOR_LABEL_GAP_PX, cursorLabelSide } from './pegCursor'
import { isPlanToolKey, usePlanToolOverlay } from './PlanTools'
import {
  DESIGN_UNKNOWN_TEXT,
  depthLabel,
  MAX_QUERY_OFFSET_M,
  queryPoint,
  queryStationOffset,
  roadSectionLookup,
  type PointQueryResult,
} from './pointQuery'
import type { Alignment, Coordinate, RoadProject, TerrainSource } from './types'

const QUERY_COLOR = '#7c3aed'

export function PointQueryTool({
  project,
  alignment,
  source,
  onStation,
  onTypeStation,
  onClose,
  panelHost,
}: {
  project: RoadProject
  /** The active road as the plan shows it. */
  alignment: Alignment
  source: TerrainSource
  onStation: (station: number) => void
  onTypeStation?: (station: number) => number
  onClose: () => void
  panelHost: HTMLElement | null
}) {
  const { map, isLoaded } = useMap()
  const roads = useMemo(
    () => project.alignments.map((road) => (road.id === alignment.id ? alignment : road)),
    [project.alignments, alignment],
  )
  const sectionAt = useMemo(
    () =>
      roadSectionLookup(source, project.settings, {
        context: project.context,
        verticalReference: project.terrain.verticalReference,
      }),
    [source, project.settings, project.context, project.terrain.verticalReference],
  )
  const [result, setResult] = useState<PointQueryResult | null>(null)
  const [note, setNote] = useState('')
  const select = (found: PointQueryResult) => {
    if (found.roadId !== alignment.id) return
    if (onTypeStation) onTypeStation(found.chainage)
    else onStation(found.chainage)
  }
  const queryAt = (point: Coordinate) => {
    const found = queryPoint(roads, point, source, sectionAt)
    setResult(found)
    setNote(found ? '' : 'No road to measure from: add or load a road first.')
    if (found) select(found)
  }
  const goTo = (station: number, offset: number) => {
    const found = queryStationOffset(alignment, station, offset, source, sectionAt)
    if (!found) {
      setNote(`Enter an offset of at most ${MAX_QUERY_OFFSET_M.toLocaleString('en-CA')} m either side of the road.`)
      return
    }
    setResult(found)
    setNote(
      Math.abs(found.chainage - station) > 0.0005
        ? `Station ${station} is ${station < 0 ? 'before the road’s start' : 'past the road’s end'}; showing ${formatRoadStation(found.chainage)}.`
        : '',
    )
    select(found)
    map?.easeTo({ center: found.coordinate, duration: 300 })
  }

  const live = useRef({ queryAt, onClose })
  useEffect(() => {
    live.current = { queryAt, onClose }
  })
  useEffect(() => {
    if (!map || !isLoaded) return
    const container = map.getContainer()
    container.classList.add('road-plan-tool-active')
    const click = (e: MapMouseEvent) => live.current.queryAt([e.lngLat.lng, e.lngLat.lat])
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !isPlanToolKey(event)) return
      event.preventDefault()
      event.stopPropagation()
      live.current.onClose()
    }
    map.on('click', click)
    window.addEventListener('keydown', keydown, true)
    return () => {
      container.classList.remove('road-plan-tool-active')
      map.off('click', click)
      window.removeEventListener('keydown', keydown, true)
    }
  }, [map, isLoaded])

  const features = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: result
        ? [
            {
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: [result.centre, result.coordinate] },
              properties: { role: 'query-offset', color: QUERY_COLOR },
            },
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: result.centre },
              properties: { role: 'query-centre', color: '#ffffff' },
            },
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: result.coordinate },
              properties: { role: 'query-point', color: QUERY_COLOR },
            },
          ]
        : [],
    }),
    [result],
  )
  usePlanToolOverlay(features)
  // Near the plan's right edge the label turns to the left of the point, as the peg cursor's does.
  const labelSide =
    map && result ? cursorLabelSide(map.project(result.coordinate).x, map.getContainer().clientWidth) : 'right'

  return (
    <>
      {result && (
        <MapMarker
          longitude={result.coordinate[0]}
          latitude={result.coordinate[1]}
          anchor={labelSide === 'right' ? 'left' : 'right'}
          offset={[labelSide === 'right' ? CURSOR_LABEL_GAP_PX : -CURSOR_LABEL_GAP_PX, 0]}
        >
          <MarkerContent>
            <div
              className="pointer-events-none whitespace-nowrap rounded-sm border border-violet-300 bg-background/95 px-1.5 py-0.5 text-3xs font-medium tabular-nums shadow"
              data-testid="road-point-query-label"
            >
              {formatRoadStation(result.chainage)} · {formatOffset(result.offset)}
              {depthLabel(result.depth) ? ` · ${depthLabel(result.depth)}` : ''}
            </div>
          </MarkerContent>
        </MapMarker>
      )}
      {panelHost &&
        createPortal(
          <PointQueryPanel result={result} note={note} activeRoadName={alignment.name} onGo={goTo} onClose={onClose} />,
          panelHost,
        )}
    </>
  )
}

/** Signed, negative to the left looking up-station, with the side named. */
export function formatOffset(offset: number) {
  if (Math.abs(offset) < 0.005) return 'on centreline'
  return `${offset < 0 ? '−' : '+'}${Math.abs(offset).toFixed(2)} m ${offset < 0 ? 'left' : 'right'}`
}
const level = (value: number | null) => (value === null ? 'Unknown' : `${value.toFixed(2)} m`)

export function PointQueryPanel({
  result,
  note,
  activeRoadName,
  onGo,
  onClose,
}: {
  result: PointQueryResult | null
  note: string
  activeRoadName: string
  onGo: (station: number, offset: number) => void
  onClose: () => void
}) {
  const [station, setStation] = useState(0)
  const [offset, setOffset] = useState(0)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onGo(station, offset)
  }
  const notes = result
    ? [
        result.beyond === 'start' && 'The point lies before the road’s start; the offset is measured from the start.',
        result.beyond === 'end' && 'The point lies past the road’s end; the offset is measured from the end.',
        result.ground === null && 'No ground under the point: off the terrain or a gap.',
        result.designUnknown && `${DESIGN_UNKNOWN_TEXT[result.designUnknown]}.`,
      ].filter((text): text is string => !!text)
    : []
  return (
    <MapToolPanel
      title="Point query"
      icon={ScanSearch}
      aria-label="Point query"
      data-testid="road-point-query"
      helpLabel="About point query"
      help={
        <>
          Click the plan to measure that point against the nearest road: its station and offset (negative to the left
          looking up-station), the ground there, the design surface at that station and offset (formation, ditch or
          batter) and the cut or fill depth between them. Beyond the catch points there is no design, so no depth. Go to
          locates a station and offset on the active road, evaluated where you typed it, and selects that station in the
          profile and section.
        </>
      }
      onClose={onClose}
      closeLabel="Close point query"
      hint={result ? undefined : 'Click the plan to measure a point.'}
    >
      {result && (
        <ReadoutGrid
          data-testid="road-point-query-result"
          items={[
            { label: 'Road', value: result.roadName },
            { label: 'Station', value: formatRoadStation(result.chainage) },
            { label: 'Offset', value: formatOffset(result.offset), title: 'Negative to the left looking up-station' },
            { label: 'Ground', value: level(result.ground), tone: result.ground === null ? 'warning' : 'default' },
            { label: 'Design', value: level(result.design), tone: result.design === null ? 'warning' : 'default' },
            {
              label: 'Cut/fill',
              value: depthLabel(result.depth) ?? 'Unknown',
              tone: result.depth === null ? 'warning' : 'default',
            },
          ]}
        />
      )}
      {(note || notes.length > 0) && (
        <p role="status" className="text-warning" data-testid="road-point-query-note">
          {[note, ...notes].filter(Boolean).join(' ')}
        </p>
      )}
      {/* noValidate: the fields' step is for the arrow keys; a typed station or offset is used as typed. */}
      <form
        className="grid grid-cols-[1fr_1fr_auto] items-end gap-2 border-t pt-2"
        onSubmit={submit}
        aria-label="Go to station"
        noValidate
      >
        <NumberField label="Station (m)" value={station} max={100000} step={1} precision={3} onChange={setStation} />
        <NumberField
          label="Offset (m)"
          value={offset}
          min={-MAX_QUERY_OFFSET_M}
          max={MAX_QUERY_OFFSET_M}
          step={0.5}
          precision={3}
          onChange={setOffset}
        />
        <Button size="field" variant="outline" type="submit" title={`Locate on ${activeRoadName}`}>
          Go to
        </Button>
      </form>
    </MapToolPanel>
  )
}
