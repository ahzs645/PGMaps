import { useEffect, useMemo, useRef, useState } from 'react'
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent, MapTouchEvent } from 'maplibre-gl'
import { Eye, EyeOff, Hexagon, MapPin, MoveUpRight, PenLine, Trash2, X } from 'lucide-react'
import { MapMarker, MapPopup, MarkerContent, useMap } from '@/components/ui/map'
import { MapPopupCard } from '@/components/ui/map-popup-card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  MAP_NOTE_COLORS,
  MAX_MAP_NOTES,
  MAX_NOTE_POINTS,
  MAX_NOTE_TEXT,
  mapNotesGeoJson,
  noteAnchor,
  noteMeasure,
  simplifyPath,
  type MapNote,
  type MapNoteKind,
} from './mapNotes'
import type { Coordinate } from './types'

export type NoteTool = MapNoteKind | null

/** Layers a click on a note hits; the plan's own click handling stands aside for them. */
export const NOTE_LAYER_IDS = ['road-notes-fill', 'road-notes-line', 'road-notes-pin'] as const

const TOOLS: { tool: MapNoteKind; label: string; hint: string; icon: typeof PenLine }[] = [
  { tool: 'sketch', label: 'Pen', hint: 'Drag on the map to draw.', icon: PenLine },
  { tool: 'pin', label: 'Pin', hint: 'Click where the pin goes.', icon: MapPin },
  { tool: 'line', label: 'Line', hint: 'Click points; double-click or Enter to finish.', icon: MoveUpRight },
  { tool: 'area', label: 'Area', hint: 'Click corners; double-click or Enter to finish.', icon: Hexagon },
]
const KIND_LABELS: Record<MapNoteKind, string> = { sketch: 'Sketch', pin: 'Pin', line: 'Line', area: 'Area' }
const MIN_POINTS: Record<MapNoteKind, number> = { sketch: 2, pin: 1, line: 2, area: 3 }

const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features })
function setSource(map: MapLibreMap, id: string, data: GeoJSON.FeatureCollection) {
  const existing = map.getSource(id) as GeoJSONSource | undefined
  if (existing) existing.setData(data)
  else map.addSource(id, { type: 'geojson', data })
}

/**
 * Draws the project's map notes and handles the note tools. Notes live in their own project
 * collection, so this only ever calls `onChange` with the next list; nothing here touches the road.
 */
export function NotesLayer({
  notes,
  visible,
  tool,
  color,
  arrow,
  selectedId,
  onSelect,
  onChange,
  onToolDone,
}: {
  notes: MapNote[]
  visible: boolean
  tool: NoteTool
  color: string
  arrow: boolean
  selectedId: string | null
  onSelect: (id: string | null) => void
  onChange?: (notes: MapNote[]) => void
  /** A pin or a finished shape ends the tool, the way one stroke ends a pen. */
  onToolDone: () => void
}) {
  const { map, isLoaded } = useMap()
  const [draft, setDraft] = useState<Coordinate[]>([])
  const [hover, setHover] = useState<Coordinate | null>(null)
  const data = useMemo(() => mapNotesGeoJson(notes), [notes])
  const draftData = useMemo(() => {
    if (!tool || tool === 'pin') return fc([])
    const points = hover && tool !== 'sketch' ? [...draft, hover] : draft
    const features: GeoJSON.Feature[] = points.map((p) => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: p },
    }))
    if (points.length > 1)
      features.push({
        type: 'Feature',
        properties: {},
        geometry:
          tool === 'area' && points.length > 2
            ? { type: 'Polygon', coordinates: [[...points, points[0]]] }
            : { type: 'LineString', coordinates: points },
      })
    return fc(tool === 'sketch' ? features.filter((f) => f.geometry.type !== 'Point') : features)
  }, [tool, draft, hover])

  // A note just drawn opens with its text field focused. The card mounts in a popup portal, where
  // `autoFocus` does not fire, so the field focuses itself through its ref.
  const focusNote = useRef<string | null>(null)
  // Latest values for the map handlers, which are registered once per tool.
  const live = useRef({ notes, color, arrow, draft, onChange, onSelect, onToolDone })
  useEffect(() => {
    live.current = { notes, color, arrow, draft, onChange, onSelect, onToolDone }
  })

  useEffect(() => {
    if (!map || !isLoaded) return
    setSource(map, 'road-notes', data)
    // The draft source is created empty here; its own effect below keeps it current, so a stroke in
    // progress does not re-send every saved note.
    if (!map.getSource('road-notes-draft')) map.addSource('road-notes-draft', { type: 'geojson', data: fc([]) })
    const add = (layer: Parameters<typeof map.addLayer>[0]) => {
      if (!map.getLayer(layer.id)) map.addLayer(layer)
    }
    const color = ['get', 'color'] as const
    add({
      id: 'road-notes-fill',
      type: 'fill',
      source: 'road-notes',
      filter: ['==', ['get', 'kind'], 'area'],
      paint: { 'fill-color': color as never, 'fill-opacity': 0.14 },
    })
    add({
      id: 'road-notes-selected',
      type: 'line',
      source: 'road-notes',
      filter: ['==', ['get', 'id'], ''],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': 8, 'line-opacity': 0.9 },
    })
    add({
      id: 'road-notes-line',
      type: 'line',
      source: 'road-notes',
      filter: ['!=', ['geometry-type'], 'Point'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': color as never,
        'line-width': ['match', ['get', 'kind'], 'area', 2, 'sketch', 3, 3],
      },
    })
    add({
      id: 'road-notes-pin',
      type: 'circle',
      source: 'road-notes',
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': 7,
        'circle-color': color as never,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
      },
    })
    add({
      id: 'road-notes-draft-line',
      type: 'line',
      source: 'road-notes-draft',
      filter: ['!=', ['geometry-type'], 'Point'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#0f172a', 'line-width': 2, 'line-dasharray': [2, 1.5] },
    })
    add({
      id: 'road-notes-draft-point',
      type: 'circle',
      source: 'road-notes-draft',
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': 3.5,
        'circle-color': '#ffffff',
        'circle-stroke-color': '#0f172a',
        'circle-stroke-width': 1.5,
      },
    })
  }, [map, isLoaded, data])

  useEffect(() => {
    if (!map || !isLoaded) return
    setSource(map, 'road-notes-draft', draftData)
  }, [map, isLoaded, draftData])

  useEffect(() => {
    if (!map || !isLoaded) return
    for (const id of ['road-notes-fill', 'road-notes-selected', ...NOTE_LAYER_IDS.slice(1)])
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
    if (map.getLayer('road-notes-selected'))
      map.setFilter('road-notes-selected', [
        'all',
        ['!=', ['geometry-type'], 'Point'],
        ['==', ['get', 'id'], visible ? (selectedId ?? '') : ''],
      ])
  }, [map, isLoaded, visible, selectedId, data])

  // Selecting a note: a click on one while no tool is in hand.
  useEffect(() => {
    if (!map || !isLoaded || tool || !visible) return
    const click = (e: MapMouseEvent) => {
      const layers = NOTE_LAYER_IDS.filter((id) => map.getLayer(id))
      const hit = layers.length ? map.queryRenderedFeatures(e.point, { layers: [...layers] })[0] : undefined
      live.current.onSelect(hit ? String(hit.properties?.id) : null)
    }
    map.on('click', click)
    return () => {
      map.off('click', click)
    }
  }, [map, isLoaded, tool, visible])

  // The note tools. One finished note ends the tool; Escape drops the draft and the tool.
  useEffect(() => {
    if (!map || !isLoaded || !tool) return
    const canvas = map.getCanvas()
    canvas.style.cursor = 'crosshair'
    const add = (kind: MapNoteKind, points: Coordinate[]) => {
      const { notes, color, arrow, onChange, onSelect, onToolDone } = live.current
      setDraft([])
      setHover(null)
      // The browser follows a pen's release with a click. Ending the tool on the next tick keeps that
      // click with the notes, where it would otherwise deselect the new note and move the station.
      const done = () => window.setTimeout(onToolDone, 0)
      if (!onChange || points.length < MIN_POINTS[kind] || notes.length >= MAX_MAP_NOTES) return done()
      const note: MapNote = {
        id: crypto.randomUUID(),
        kind,
        points: points.slice(0, MAX_NOTE_POINTS),
        text: '',
        color,
        ...(kind === 'line' && arrow ? { arrow: true } : {}),
        createdAt: new Date().toISOString(),
      }
      onChange([...notes, note])
      focusNote.current = note.id
      onSelect(note.id)
      done()
    }
    const lngLat = (e: { lngLat: { lng: number; lat: number } }): Coordinate => [e.lngLat.lng, e.lngLat.lat]
    const finish = () => {
      const points = live.current.draft
      if (tool === 'line' || tool === 'area') add(tool, points)
    }
    const keydown = (e: KeyboardEvent) => {
      if ((e.target as Element | null)?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (e.key === 'Escape') {
        setDraft([])
        live.current.onToolDone()
      } else if (e.key === 'Enter') finish()
      else if (e.key === 'Backspace' || e.key === 'Delete') setDraft((points) => points.slice(0, -1))
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', keydown)
    if (tool === 'sketch') {
      // A stroke: press, drag, release. The map stops panning while the pen is in hand.
      map.dragPan.disable()
      map.touchZoomRotate.disableRotation()
      let stroke: Coordinate[] | null = null
      const down = (e: MapMouseEvent | MapTouchEvent) => {
        if ('points' in e && e.points.length > 1) return
        e.preventDefault()
        stroke = [lngLat(e)]
        setDraft(stroke)
      }
      const move = (e: MapMouseEvent | MapTouchEvent) => {
        if (!stroke) return
        stroke = [...stroke, lngLat(e)]
        setDraft(stroke)
      }
      const up = () => {
        if (!stroke) return
        // Keep detail down to about a pixel and a half at this zoom.
        const metresPerPixel =
          (40075016.7 * Math.cos((map.getCenter().lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom())
        const points = simplifyPath(stroke, metresPerPixel * 1.5)
        stroke = null
        add('sketch', points)
      }
      map.on('mousedown', down)
      map.on('touchstart', down)
      map.on('mousemove', move)
      map.on('touchmove', move)
      map.on('mouseup', up)
      map.on('touchend', up)
      return () => {
        map.off('mousedown', down)
        map.off('touchstart', down)
        map.off('mousemove', move)
        map.off('touchmove', move)
        map.off('mouseup', up)
        map.off('touchend', up)
        map.dragPan.enable()
        map.touchZoomRotate.enableRotation()
        window.removeEventListener('keydown', keydown)
        canvas.style.cursor = ''
        setDraft([])
      }
    }
    const click = (e: MapMouseEvent) => {
      const point = lngLat(e)
      if (tool === 'pin') return add('pin', [point])
      setDraft((points) => {
        const last = points.at(-1)
        // The second click of a double-click lands on the first; do not add it twice.
        if (last && map.project(last).dist(e.point) < 3) return points
        return points.length < MAX_NOTE_POINTS ? [...points, point] : points
      })
    }
    const dblclick = (e: MapMouseEvent) => {
      e.preventDefault()
      finish()
    }
    const move = (e: MapMouseEvent) => setHover(lngLat(e))
    map.on('click', click)
    map.on('dblclick', dblclick)
    map.on('mousemove', move)
    return () => {
      map.off('click', click)
      map.off('dblclick', dblclick)
      map.off('mousemove', move)
      window.removeEventListener('keydown', keydown)
      canvas.style.cursor = ''
      setDraft([])
      setHover(null)
    }
  }, [map, isLoaded, tool])

  const selected = visible ? notes.find((note) => note.id === selectedId) : undefined
  const update = (id: string, patch: Partial<MapNote>) =>
    onChange?.(notes.map((note) => (note.id === id ? { ...note, ...patch } : note)))
  return (
    <>
      {visible &&
        notes
          .filter((note) => note.text.trim() && note.id !== selectedId)
          .map((note) => {
            const [longitude, latitude] = noteAnchor(note)
            return (
              <MapMarker key={`note-${note.id}`} longitude={longitude} latitude={latitude}>
                <MarkerContent>
                  <button
                    type="button"
                    data-note-label={note.id}
                    className="max-w-48 -translate-y-5 truncate rounded border-l-4 bg-background/95 px-1.5 py-0.5 text-left text-3xs font-medium leading-4 text-foreground shadow-sm"
                    style={{ borderLeftColor: note.color }}
                    title={note.text}
                    onClick={() => onSelect(note.id)}
                  >
                    {note.text}
                  </button>
                </MarkerContent>
              </MapMarker>
            )
          })}
      {selected && (
        <MapPopup
          key={selected.id}
          longitude={noteAnchor(selected)[0]}
          latitude={noteAnchor(selected)[1]}
          onClose={() => onSelect(null)}
          className="w-64"
        >
          <MapPopupCard
            eyebrow="Map note"
            title={KIND_LABELS[selected.kind]}
            subtitle={noteMeasure(selected) || undefined}
            onClose={() => onSelect(null)}
            closeLabel="Close note"
          >
            <div className="space-y-2" data-testid="road-note-card">
              <textarea
                aria-label="Note text"
                className="min-h-16 w-full resize-y rounded-md border border-input bg-background px-2 py-1.5 text-base md:text-xs"
                placeholder="Write a note…"
                maxLength={MAX_NOTE_TEXT}
                ref={(field) => {
                  if (!field || focusNote.current !== selected.id) return
                  focusNote.current = null
                  requestAnimationFrame(() => field.focus({ preventScroll: true }))
                }}
                disabled={!onChange}
                value={selected.text}
                onChange={(event) => update(selected.id, { text: event.target.value })}
              />
              <div className="flex items-center justify-between gap-2">
                <NoteColors value={selected.color} onChange={(color) => update(selected.id, { color })} />
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  aria-label="Delete note"
                  title="Delete note"
                  disabled={!onChange}
                  onClick={() => {
                    onChange?.(notes.filter((note) => note.id !== selected.id))
                    onSelect(null)
                  }}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
              {selected.kind === 'line' && (
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={!!selected.arrow}
                    disabled={!onChange}
                    onChange={(event) =>
                      update(selected.id, event.target.checked ? { arrow: true } : { arrow: undefined })
                    }
                  />
                  Arrow at the end
                </label>
              )}
            </div>
          </MapPopupCard>
        </MapPopup>
      )}
    </>
  )
}

function NoteColors({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Note colour" className="flex items-center gap-1">
      {MAP_NOTE_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={`Colour ${color}`}
          className={cn(
            'size-5 rounded-full border-2 border-background shadow-[0_0_0_1px_rgb(0_0_0/0.2)]',
            value === color && 'ring-2 ring-ring ring-offset-1',
          )}
          style={{ backgroundColor: color }}
          onClick={() => onChange(color)}
        />
      ))}
    </div>
  )
}

/**
 * The notes bar under the plan's top-left controls: a tool, its colour, the arrow option for lines,
 * and showing or hiding every note.
 */
export function NotesToolbar({
  tool,
  onTool,
  color,
  onColor,
  arrow,
  onArrow,
  visible,
  onVisible,
  count,
  onClose,
  disabled,
}: {
  tool: NoteTool
  onTool: (tool: NoteTool) => void
  color: string
  onColor: (color: string) => void
  arrow: boolean
  onArrow: (arrow: boolean) => void
  visible: boolean
  onVisible: (visible: boolean) => void
  count: number
  onClose: () => void
  disabled?: boolean
}) {
  const active = TOOLS.find((entry) => entry.tool === tool)
  return (
    <div
      role="toolbar"
      aria-label="Map notes"
      className="pointer-events-auto flex max-w-full flex-wrap items-center gap-1 rounded-md border bg-background/95 p-1 text-xs shadow-sm backdrop-blur-sm"
      data-map-export-ignore
    >
      {TOOLS.map(({ tool: entry, label, icon: Icon }) => (
        <Button
          key={entry}
          size="sm"
          variant="ghost"
          className={cn('h-7 gap-1 px-2 text-xs', tool === entry && 'bg-accent text-accent-foreground')}
          aria-pressed={tool === entry}
          disabled={disabled}
          onClick={() => onTool(tool === entry ? null : entry)}
        >
          <Icon className="size-3.5" />
          {label}
        </Button>
      ))}
      <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />
      <NoteColors value={color} onChange={onColor} />
      {tool === 'line' && (
        <label className="ml-1 flex items-center gap-1">
          <input type="checkbox" checked={arrow} onChange={(event) => onArrow(event.target.checked)} />
          Arrow
        </label>
      )}
      <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />
      <Button
        size="icon"
        variant="ghost"
        className="size-7"
        aria-label={visible ? 'Hide map notes' : 'Show map notes'}
        title={`${visible ? 'Hide' : 'Show'} ${count} note${count === 1 ? '' : 's'}`}
        aria-pressed={!visible}
        onClick={() => onVisible(!visible)}
      >
        {visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
      </Button>
      <Button size="icon" variant="ghost" className="size-7" aria-label="Close notes bar" onClick={onClose}>
        <X className="size-3.5" />
      </Button>
      {active && <p className="basis-full px-1 pb-0.5 text-2xs text-muted-foreground">{active.hint} Esc to stop.</p>}
    </div>
  )
}
