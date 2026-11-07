import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { InfoTip } from '@/components/ui/info-tip'
import { CollapsibleSection, InlineAlert } from '@/components/ui/map-panels'
import { CableChart } from './Charts'
import { terrainDisplayName } from './terrainName'
import { NumberField } from './Controls'
import {
  analyzeRadialDeflection,
  DEFAULT_RADIAL_SETTINGS,
  MAX_RADIAL_RADIUS_M,
  MAX_RADIAL_SPOKES,
  RADIAL_COLORS,
  radialDeflectionGeoJson,
} from './radialDeflection'
import type { RadialDeflectionResult, RadialDeflectionSettings, RadialSpoke } from './radialDeflection'
import type { CableLine, Coordinate, TerrainSource } from './types'

/** Where the tailholds go, then the cable between them; the legend names each group, so labels stay short. */
const SETTING_GROUPS = [
  [
    'Tailhold fan',
    [
      ['radiusM', 'Tailhold radius (m)', 10, MAX_RADIAL_RADIUS_M, 10],
      ['startBearingDeg', 'Start bearing (°)', 0, 360, 5],
      ['sweepDeg', 'Clockwise sweep (°)', 0, 360, 5],
      ['bearingStepDeg', 'Bearing step (°)', 1, 180, 1],
    ],
  ],
  [
    'Cable',
    [
      ['yarderHeightM', 'Yarder height (m)', 0, 100, 0.5],
      ['tailholdHeightM', 'Tailhold height (m)', 0, 100, 0.5],
      ['deflectionPercent', 'Assumed sag (%)', 0, 30, 0.5],
      ['minimumClearanceM', 'Clearance (m)', 0, 100, 0.5],
    ],
  ],
] as const satisfies readonly (readonly [
  string,
  readonly (readonly [keyof RadialDeflectionSettings, string, number, number, number])[],
])[]
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
const number = (value: number | null, digits = 1) => (value === null ? 'Unknown' : value.toFixed(digits))
const statusText = (spoke: RadialSpoke) =>
  spoke.status === 'clear'
    ? 'Meets assumed clearance'
    : spoke.status === 'conflict'
      ? 'Below clearance threshold'
      : spoke.hasObservedConflict
        ? 'Incomplete terrain · observed conflict'
        : 'Incomplete terrain'

export interface RadialDeflectionPanelProps {
  source: TerrainSource
  center: Coordinate | null
  centerLabel?: string
  sourceLabel?: string
  onPreview: (features: GeoJSON.FeatureCollection) => void
  onAdopt: (line: CableLine) => void
  selectedSpokeId?: string | null
  onSelectSpoke?: (id: string) => void
}

export function RadialDeflectionPanel({
  source,
  center,
  centerLabel,
  sourceLabel,
  onPreview,
  onAdopt,
  selectedSpokeId,
  onSelectSpoke,
}: RadialDeflectionPanelProps) {
  const [settings, setSettings] = useState<RadialDeflectionSettings>({ ...DEFAULT_RADIAL_SETTINGS })
  const [record, setRecord] = useState<{
    result: RadialDeflectionResult
    source: TerrainSource
    key: string
  } | null>(null)
  const [localSelected, setLocalSelected] = useState<string | null>(null)
  const [cursor, setCursor] = useState<{ spokeId: string; distance: number } | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(true)
  const [error, setError] = useState('')
  const previewCallback = useRef(onPreview)
  useEffect(() => {
    previewCallback.current = onPreview
  }, [onPreview])

  const key = JSON.stringify({ center, settings })
  // A changed station, source or parameter immediately removes the old overlay.
  // Old results are never displayed under a new landing or terrain label.
  const result = record?.source === source && record.key === key ? record.result : null
  const selectedId = selectedSpokeId === undefined ? localSelected : selectedSpokeId
  const selected = result?.spokes.find((spoke) => spoke.id === selectedId) ?? result?.spokes[0]
  const cursorDistance = selected
    ? cursor?.spokeId === selected.id
      ? Math.max(0, Math.min(selected.analysis.length, cursor.distance))
      : selected.analysis.length / 2
    : 0
  const preview = useMemo(
    () => (result ? radialDeflectionGeoJson(result, selected?.id, cursorDistance) : EMPTY),
    [result, selected?.id, cursorDistance],
  )
  useEffect(() => {
    previewCallback.current(preview)
  }, [preview])
  useEffect(() => () => previewCallback.current(EMPTY), [])

  const choose = (id: string) => {
    setLocalSelected(id)
    setCursor(null)
    onSelectSpoke?.(id)
  }
  const run = () => {
    if (!center) return
    try {
      const next = analyzeRadialDeflection(center, source, settings)
      setRecord({ result: next, source, key })
      choose(next.spokes[0].id)
      setError('')
      setSettingsOpen(false)
    } catch (cause) {
      setRecord(null)
      setError(cause instanceof Error ? cause.message : 'Could not evaluate landing D-lines.')
    }
  }
  const change = (field: keyof RadialDeflectionSettings, value: number) => {
    setSettings((previous) => ({ ...previous, [field]: value }))
    setError('')
  }
  const adopt = () => {
    if (!selected) return
    onAdopt({
      ...selected.line,
      id: crypto.randomUUID(),
      start: [...selected.line.start],
      end: [...selected.line.end],
    })
  }

  return (
    <section
      className="h-full min-h-0 overflow-y-auto overscroll-contain p-1 [scrollbar-gutter:stable]"
      data-testid="radial-deflection-panel"
    >
      <div className="mb-2 flex items-start justify-between gap-2 text-xs">
        <div className="min-w-0">
          <p className="font-medium">{center ? `Landing${centerLabel ? ` at ${centerLabel}` : ''}` : 'No landing'}</p>
          <p className="truncate text-2xs text-muted-foreground" title={sourceLabel}>
            {center
              ? `${center[1].toFixed(5)}°, ${center[0].toFixed(5)}°`
              : 'Select a covered road station as the proposed landing.'}
            {sourceLabel && ` · ${terrainDisplayName(sourceLabel)}`}
          </p>
        </div>
        <InfoTip label="About the landing screen">
          Geometric screen using the active terrain and an assumed parabolic sag. Green means sampled clearance meets
          the entered threshold. It does not establish cable tension, payload, anchors or operating safety. Unknown
          terrain is never treated as clear. The fan is temporary until a D-line is adopted.
        </InfoTip>
      </div>
      <CollapsibleSection
        label="Settings"
        summary={`${settings.radiusM} m radius · ${settings.bearingStepDeg}° step · ${settings.deflectionPercent}% sag`}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        className="mb-2 rounded-md border"
        contentClassName="space-y-3 px-3 pb-3"
        actions={
          <InfoTip label="About the settings">
            Bearings run clockwise from north. Up to {MAX_RADIAL_SPOKES} candidate tailholds at the chosen radius;
            spacing increases if needed. Test another radius to explore nearer supports.
          </InfoTip>
        }
      >
        {SETTING_GROUPS.map(([group, fields]) => (
          <fieldset key={group} className="min-w-0">
            <legend className="mb-1 text-3xs font-medium uppercase tracking-wide text-muted-foreground">{group}</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {fields.map(([field, label, min, max, step]) => (
                <NumberField
                  key={field}
                  label={label}
                  value={settings[field]}
                  min={min}
                  max={max}
                  step={step}
                  onChange={(value) => change(field, value)}
                />
              ))}
            </div>
          </fieldset>
        ))}
      </CollapsibleSection>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={!center} onClick={run}>
          Run radial screen
        </Button>
        <Button variant="outline" size="sm" disabled={!selected} onClick={adopt}>
          Use selected D-line
        </Button>
        {result && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setRecord(null)
              setLocalSelected(null)
              setCursor(null)
            }}
          >
            Clear preview
          </Button>
        )}
      </div>
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      {!result && record && !error && (
        <p role="status" className="mb-2 text-xs text-amber-700 dark:text-amber-400">
          Landing, terrain or settings changed. Run again to replace the previous preview.
        </p>
      )}
      {result && (
        <>
          <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-2xs" role="status">
            {(['clear', 'conflict', 'unknown'] as const).map((status) => (
              <span key={status}>
                <span
                  className="mr-1 inline-block size-2 rounded-full"
                  style={{ backgroundColor: RADIAL_COLORS[status] }}
                />
                {result.spokes.filter((spoke) => spoke.status === status).length}{' '}
                {status === 'clear' ? 'meet threshold' : status === 'conflict' ? 'below threshold' : 'incomplete'}
              </span>
            ))}
          </div>
          {result.warnings.map((warning) => (
            <p key={warning} className="mb-2 text-3xs text-amber-700 dark:text-amber-400">
              {warning}
            </p>
          ))}
          <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(130px,0.65fr)_minmax(0,1fr)]">
            <div className="max-h-64 overflow-auto rounded border">
              <EngineeringTable className="whitespace-normal" data-testid="radial-spoke-table">
                <thead className="sticky top-0">
                  <tr>
                    <ColumnHeader label="Bearing" className="text-left" />
                    <ColumnHeader label="Min. clearance" />
                    <ColumnHeader label="Terrain" />
                  </tr>
                </thead>
                <tbody>
                  {result.spokes.map((spoke) => (
                    <tr key={spoke.id} aria-selected={selected?.id === spoke.id}>
                      <td className="text-left">
                        <button
                          className="underline decoration-dotted"
                          onClick={() => choose(spoke.id)}
                          aria-label={`Select landing spoke ${spoke.bearingDeg.toFixed(1)} degrees`}
                        >
                          <span
                            className="mr-1 inline-block size-2 rounded-full"
                            style={{ backgroundColor: RADIAL_COLORS[spoke.status] }}
                          />
                          {number(spoke.bearingDeg)}°
                        </button>
                      </td>
                      <td title={statusText(spoke)}>
                        {spoke.analysis.minClearance === null ? 'Unknown' : `${number(spoke.analysis.minClearance)} m`}
                      </td>
                      <td>{number(spoke.knownCoveragePercent, 0)}%</td>
                    </tr>
                  ))}
                </tbody>
              </EngineeringTable>
            </div>
            {selected && (
              <div className="min-w-0">
                <p className="mb-1 text-2xs font-medium">
                  {number(selected.bearingDeg)}° · {statusText(selected)}
                </p>
                <div className="h-60 min-w-0" data-testid="radial-selected-profile">
                  <CableChart
                    analysis={selected.analysis}
                    distance={cursorDistance}
                    onDistance={(distance) => setCursor({ spokeId: selected.id, distance })}
                  />
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}
