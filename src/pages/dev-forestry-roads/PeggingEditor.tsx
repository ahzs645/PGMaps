import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { NumberField } from './Controls'
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
      <div className="flex flex-wrap items-end gap-2 rounded border bg-muted/20 p-2">
        <div className="w-24">
          <NumberField
            label="Peg bearing (°)"
            value={heading}
            max={360}
            step={1}
            onChange={(value) => {
              setHeading(value)
              clearPreview()
            }}
          />
        </div>
        <div className="w-24">
          <NumberField
            label="Peg distance (m)"
            value={length}
            min={0.2}
            max={1000}
            step={1}
            onChange={(value) => {
              setLength(value)
              clearPreview()
            }}
          />
        </div>
        <label className="flex items-center gap-1 py-2 text-xs">
          <input
            type="checkbox"
            checked={onGrade}
            onChange={(e) => {
              setOnGrade(e.target.checked)
              clearPreview()
            }}
          />{' '}
          Find ground grade
        </label>
        {onGrade && (
          <div className="w-24">
            <NumberField
              label="Target grade (%)"
              value={grade}
              min={-100}
              max={100}
              onChange={(value) => {
                setGrade(value)
                clearPreview()
              }}
            />
          </div>
        )}
        <Button size="sm" variant="outline" onClick={preview}>
          Preview next peg
        </Button>
        <Button
          size="sm"
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
          <Button size="sm" variant="ghost" onClick={clearPreview}>
            Cancel peg preview
          </Button>
        )}
      </div>
      {message && <InlineAlert tone="warning">{message}</InlineAlert>}
      {measured && (
        <p className="text-xs" role="status">
          Preview: {fmt(measured.length)} m · bearing {fmt(measured.bearing)}° · endpoint ground grade{' '}
          {fmt(measured.grade)}% · steepest sampled grade {fmt(measured.maxGroundGrade)}% · terrain coverage{' '}
          {fmt(measured.coveragePercent)}%
        </p>
      )}
      <p className="text-[11px] text-muted-foreground">
        HD and grade describe straight peg-to-peg legs. Editing a distance or bearing moves that peg; adjacent legs and
        the fitted road recalculate. Ground-grade search changes the bearing, preserving leg length. Design PVIs remain
        separate.
      </p>
      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        <table className="w-full whitespace-nowrap text-right text-xs">
          <thead className="sticky top-0 bg-card">
            <tr>
              {['Peg', 'Peg chainage', 'HD m', 'Bearing °', 'Ground m', 'Ground %', 'Radius m'].map((label) => (
                <th key={label} className="border-b p-2 font-medium">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.point.id} data-testid={`peg-row-${row.index + 1}`} className="border-b hover:bg-muted/40">
                <td className="p-2">
                  <button className="underline" onClick={() => select(row.point.coordinate, row.point.id)}>
                    {row.point.id === 'numeric-peg-preview' ? 'Preview' : row.index + 1}
                  </button>
                </td>
                <td className="p-2 font-mono">{formatRoadStation(row.chainage)}</td>
                <td className="min-w-28 p-1">
                  {row.index > 0 ? (
                    <NumberField
                      label={`Peg ${row.index + 1} distance`}
                      value={row.horizontal}
                      min={0.2}
                      max={10000}
                      disabled={row.point.id === 'numeric-peg-preview'}
                      onChange={(value) => changeLeg(row.index, value, row.bearing)}
                    />
                  ) : (
                    '—'
                  )}
                </td>
                <td className="min-w-28 p-1">
                  {row.index > 0 ? (
                    <NumberField
                      label={`Peg ${row.index + 1} bearing`}
                      value={row.bearing}
                      max={360}
                      disabled={row.point.id === 'numeric-peg-preview'}
                      onChange={(value) => changeLeg(row.index, row.horizontal, value)}
                    />
                  ) : (
                    '—'
                  )}
                </td>
                <td className="p-2">{fmt(row.ground)}</td>
                <td className="p-2">{fmt(row.grade)}</td>
                <td className="min-w-24 p-1">
                  <NumberField
                    label={`Peg ${row.index + 1} radius`}
                    value={row.point.radiusM}
                    max={10000}
                    disabled={row.point.id === 'numeric-peg-preview'}
                    onChange={(radiusM) =>
                      onChange({
                        ...alignment,
                        points: alignment.points.map((p) => (p.id === row.point.id ? { ...p, radiusM } : p)),
                      })
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </fieldset>
  )
}
