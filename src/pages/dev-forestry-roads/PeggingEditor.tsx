import { PegMeasurementHelp } from './PegMeasurementHelp'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ColumnHeader, EngineeringTable, engineeringPinnedColumnClass } from '@/components/ui/engineering-table'
import { InlineAlert } from '@/components/ui/map-panels'
import { CellNumberField, NumberField } from './Controls'
import { formatRoadStation } from './Charts'
import { distance, offsetCoordinate } from './engine'
import { findGradePeg, measurePeg, pegBearing } from './pegging'
import type { Alignment, Coordinate, RoadAnalysis, TerrainSource } from './types'

const fmt = (value: number | null, decimals = 1) =>
  value === null || !Number.isFinite(value) ? '—' : value.toFixed(decimals)

function buildPegRows(alignment: Alignment, source: TerrainSource) {
  let chainage = 0
  return alignment.points.map((point, index) => {
    const previous = alignment.points[index - 1]
    const horizontal = previous ? distance(previous.coordinate, point.coordinate) : 0
    chainage += horizontal
    const sampled = source.elevationAt(...point.coordinate)
    const ground = Number.isFinite(sampled) ? sampled : null
    const sampledBefore = previous ? source.elevationAt(...previous.coordinate) : Number.NaN
    const before = Number.isFinite(sampledBefore) ? sampledBefore : null
    return {
      point,
      index,
      horizontal,
      chainage,
      ground,
      bearing: previous ? pegBearing(previous.coordinate, point.coordinate) : 0,
      grade: ground !== null && before !== null && horizontal > 0 ? (100 * (ground - before)) / horizontal : null,
    }
  })
}

export function PeggingEditor({
  alignment,
  analysis,
  source,
  disabled,
  onChange,
  onStation,
  onPoint,
  onPreview,
  onPreviewAlignment,
}: {
  alignment: Alignment
  analysis: RoadAnalysis
  source: TerrainSource
  disabled?: boolean
  onChange: (alignment: Alignment) => boolean
  onStation: (station: number) => void
  onPoint: (id: string) => void
  onPreview?: (features: GeoJSON.FeatureCollection) => void
  onPreviewAlignment?: (alignment: Alignment | null) => void
}) {
  const [heading, setHeading] = useState(0)
  const [length, setLength] = useState(30)
  const [onGrade, setOnGrade] = useState(false)
  const [grade, setGrade] = useState(8)
  const [message, setMessage] = useState('')
  const [candidate, setCandidate] = useState<{
    coordinate: Coordinate
    origin: Coordinate
    source: TerrainSource
    alignment: Alignment
  } | null>(null)
  const end = alignment.points.at(-1)!.coordinate
  const currentCandidate =
    candidate &&
    candidate.alignment === alignment &&
    candidate.source === source &&
    distance(candidate.origin, end) < 0.001
      ? candidate
      : null
  const measured = currentCandidate ? measurePeg(end, currentCandidate.coordinate, source) : null
  const rows = useMemo(
    () =>
      buildPegRows(
        currentCandidate
          ? {
              ...alignment,
              points: [
                ...alignment.points,
                { id: 'numeric-peg-preview', coordinate: currentCandidate.coordinate, radiusM: 0 },
              ],
            }
          : alignment,
        source,
      ),
    [alignment, currentCandidate, source],
  )
  const previewCallback = useRef(onPreviewAlignment)
  useEffect(() => {
    previewCallback.current = onPreviewAlignment
  }, [onPreviewAlignment])
  useEffect(() => () => previewCallback.current?.(null), [])
  useEffect(() => {
    if (candidate && !currentCandidate) {
      onPreview?.({ type: 'FeatureCollection', features: [] })
      previewCallback.current?.(null)
    }
  }, [candidate, currentCandidate, onPreview])
  const clearPreview = () => {
    setCandidate(null)
    setMessage('')
    onPreview?.({ type: 'FeatureCollection', features: [] })
    onPreviewAlignment?.(null)
  }
  const select = (coordinate: Coordinate, id: string) => {
    onPoint(id)
    const nearest = analysis.stations.reduce<(typeof analysis.stations)[number] | null>(
      (best, station) =>
        !best || distance(coordinate, station.coordinate) < distance(coordinate, best.coordinate) ? station : best,
      null,
    )
    if (nearest) onStation(nearest.chainage)
  }
  const changeLeg = (index: number, distanceM: number, bearing: number) => {
    const coordinate = offsetCoordinate(alignment.points[index - 1].coordinate, bearing, distanceM)
    const point = alignment.points[index]
    if (
      onChange({ ...alignment, points: alignment.points.map((p) => (p.id === point.id ? { ...p, coordinate } : p)) })
    ) {
      setCandidate(null)
      onPreview?.({ type: 'FeatureCollection', features: [] })
      onPreviewAlignment?.(null)
      select(coordinate, point.id)
    }
  }
  const preview = () => {
    const coordinate = onGrade
      ? findGradePeg(end, heading, length, grade, source)?.coordinate
      : offsetCoordinate(end, heading, length)
    if (!coordinate) {
      setCandidate(null)
      onPreview?.({ type: 'FeatureCollection', features: [] })
      onPreviewAlignment?.(null)
      setMessage(
        'No covered ground-grade solution within ±90° of this bearing. Change the grade, bearing or leg length.',
      )
      return
    }
    setMessage('')
    setCandidate({ coordinate, origin: end, source, alignment })
    onPreviewAlignment?.({
      ...alignment,
      points: [...alignment.points, { id: 'numeric-peg-preview', coordinate, radiusM: 0 }],
    })
    onPreview?.({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [end, coordinate] },
          properties: { kind: 'peg-preview', color: '#e11d48', label: 'Proposed peg' },
        },
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: coordinate },
          properties: { kind: 'peg-preview', color: '#e11d48', label: 'Proposed peg' },
        },
      ],
    })
  }
  return (
    <fieldset
      disabled={disabled}
      className="flex h-full min-h-0 min-w-0 flex-col gap-2 overflow-hidden"
      data-testid="road-pegging-editor"
    >
      {/* The next leg: where it heads and how long it is, previewed on the map before it is added. */}
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2 border-b pb-2">
        <span className="pb-2 text-xs font-medium text-foreground">Next peg</span>
        <div className="w-28">
          <NumberField
            label="Peg bearing (°)"
            value={heading}
            max={360}
            step={1}
            precision={2}
            onChange={(value) => {
              setHeading(value)
              clearPreview()
            }}
          />
        </div>
        <div className="w-28">
          <NumberField
            label="Peg distance (m)"
            value={length}
            min={0.2}
            max={1000}
            step={1}
            precision={2}
            onChange={(value) => {
              setLength(value)
              clearPreview()
            }}
          />
        </div>
        <label className="flex h-8 items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={onGrade}
            onChange={(e) => {
              setOnGrade(e.target.checked)
              clearPreview()
            }}
          />
          Find ground grade
        </label>
        {onGrade && (
          <div className="w-28">
            <NumberField
              label="Target grade (%)"
              value={grade}
              min={-100}
              max={100}
              precision={2}
              onChange={(value) => {
                setGrade(value)
                clearPreview()
              }}
            />
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="outline" className="h-8" onClick={preview}>
            Preview next peg
          </Button>
          <Button
            size="sm"
            className="h-8"
            disabled={!currentCandidate}
            onClick={() => {
              if (!currentCandidate) return
              const point = { id: crypto.randomUUID(), coordinate: currentCandidate.coordinate, radiusM: 0 }
              if (onChange({ ...alignment, points: [...alignment.points, point] })) {
                select(point.coordinate, point.id)
                setCandidate(null)
                onPreview?.({ type: 'FeatureCollection', features: [] })
                onPreviewAlignment?.(null)
              }
            }}
          >
            Add peg
          </Button>
          {currentCandidate && (
            <Button size="sm" variant="ghost" className="h-8" onClick={clearPreview}>
              Cancel peg preview
            </Button>
          )}
        </div>
        <span className="ml-auto flex h-8 items-center">
          <PegMeasurementHelp showLabel={false} />
        </span>
      </div>
      {message && <InlineAlert tone="warning">{message}</InlineAlert>}
      {measured && (
        <p className="text-xs" role="status">
          Preview: {fmt(measured.length)} m · bearing {fmt(measured.bearing)}° · endpoint ground grade{' '}
          {fmt(measured.grade)}% · steepest sampled grade {fmt(measured.maxGroundGrade)}% · terrain coverage{' '}
          {fmt(measured.coveragePercent)}%
        </p>
      )}
      {/* Distance, bearing and radius edit in place, like spreadsheet cells; the rest are results. */}
      <div className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain rounded-md border">
        <EngineeringTable>
          <thead className="sticky top-0 z-10">
            <tr>
              {[
                ['Peg', ''],
                ['L-Stn', 'm'],
                ['HD', 'm'],
                ['Bearing', '°'],
                ['Ground', 'm'],
                ['Grade', '%'],
                ['Radius', 'm'],
              ].map(([label, unit]) => (
                <ColumnHeader key={label} label={label} unit={unit} />
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const previewRow = row.point.id === 'numeric-peg-preview'
              return (
                <tr key={row.point.id} data-testid={`peg-row-${row.index + 1}`}>
                  <td className={`${engineeringPinnedColumnClass} bg-background text-left`}>
                    <button
                      className="font-mono underline decoration-dotted"
                      title="Go to this peg"
                      onClick={() => select(row.point.coordinate, row.point.id)}
                    >
                      {previewRow ? 'Preview' : row.index + 1}
                    </button>
                  </td>
                  <td className="font-mono">{formatRoadStation(row.chainage)}</td>
                  <td className="min-w-20 !p-0.5">
                    {row.index > 0 ? (
                      <CellNumberField
                        label={`Peg ${row.index + 1} distance`}
                        value={row.horizontal}
                        min={0.2}
                        max={10000}
                        disabled={previewRow}
                        onChange={(value) => changeLeg(row.index, value, row.bearing)}
                      />
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="min-w-20 !p-0.5">
                    {row.index > 0 ? (
                      <CellNumberField
                        label={`Peg ${row.index + 1} bearing`}
                        value={row.bearing}
                        max={360}
                        disabled={previewRow}
                        onChange={(value) => changeLeg(row.index, row.horizontal, value)}
                      />
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{fmt(row.ground)}</td>
                  <td>{fmt(row.grade)}</td>
                  <td className="min-w-16 !p-0.5">
                    <CellNumberField
                      label={`Peg ${row.index + 1} radius`}
                      value={row.point.radiusM}
                      max={10000}
                      precision={1}
                      disabled={previewRow}
                      onChange={(radiusM) =>
                        onChange({
                          ...alignment,
                          points: alignment.points.map((p) => (p.id === row.point.id ? { ...p, radiusM } : p)),
                        })
                      }
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </EngineeringTable>
      </div>
    </fieldset>
  )
}
