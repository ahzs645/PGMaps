import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { InfoTip } from '@/components/ui/info-tip'
import { CollapsibleSection, InlineAlert } from '@/components/ui/map-panels'
import { downloadText } from '@/lib/download'
import { CableChart } from './Charts'
import { CableRiggingFields } from './CableRiggingFields'
import { NumberField } from './Controls'
import {
  DEFAULT_REACH_SETTINGS,
  maxReachCsv,
  maxReachGeoJson,
  maxReachSteps,
  REACH_COLORS,
  REACH_LIMIT_TEXT,
} from './cableReach'
import type { ReachResult, ReachSettings, ReachSpoke } from './cableReach'
import { runCooperatively } from './cooperative'
import { analyzeCable } from './engine'
import { MAX_RADIAL_RADIUS_M, MAX_RADIAL_SPOKES } from './radialDeflection'
import type { CableLine, Coordinate, TerrainSource } from './types'

const SETTING_GROUPS = [
  [
    'Tailhold search',
    [
      ['minLengthM', 'Shortest line (m)', 10, MAX_RADIAL_RADIUS_M, 10],
      ['maxLengthM', 'Farthest tailhold (m)', 10, MAX_RADIAL_RADIUS_M, 10],
      ['candidateStepM', 'Tailhold step (m)', 2, 100, 1],
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
      ['minimumClearanceM', 'Clearance (m)', 0, 100, 0.5],
    ],
  ],
] as const satisfies readonly (readonly [
  string,
  readonly (readonly [keyof ReachSettings, string, number, number, number])[],
])[]
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
const metres = (value: number | null) => (value === null ? '—' : `${value.toFixed(0)} m`)
const reachText = (spoke: ReachSpoke) =>
  spoke.status === 'unknown'
    ? spoke.knownFeasibleM === null
      ? 'Unknown'
      : `≥ ${metres(spoke.knownFeasibleM)}`
    : spoke.reachM === null
      ? 'None'
      : metres(spoke.reachM)

/** A sag-model holder for `CableRiggingFields`; only `sagModel`, `rigging` and the sag % are read. */
const SAG_HOLDER: CableLine = {
  id: 'reach-sag',
  name: 'Reach search',
  start: [0, 0],
  end: [0, 0],
  startHeight: 0,
  endHeight: 0,
  deflectionPercent: DEFAULT_REACH_SETTINGS.deflectionPercent,
}

export interface MaxReachPanelProps {
  source: TerrainSource
  center: Coordinate | null
  onPreview: (features: GeoJSON.FeatureCollection) => void
  onAdopt: (line: CableLine) => void
  selectedSpokeId?: string | null
  onSelectSpoke?: (id: string) => void
}

/**
 * Per bearing, the farthest tailhold whose single-span line clears the ground (`cableReach.ts`).
 * Runs in cooperative slices with Cancel; the envelope and spokes are a temporary overlay until a
 * line is adopted as a D-line.
 */
export function MaxReachPanel({
  source,
  center,
  onPreview,
  onAdopt,
  selectedSpokeId,
  onSelectSpoke,
}: MaxReachPanelProps) {
  const [settings, setSettings] = useState<ReachSettings>({ ...DEFAULT_REACH_SETTINGS })
  const [sag, setSag] = useState<CableLine>(SAG_HOLDER)
  const [record, setRecord] = useState<{ result: ReachResult; source: TerrainSource; key: string } | null>(null)
  const [localSelected, setLocalSelected] = useState<string | null>(null)
  const [cursor, setCursor] = useState<{ spokeId: string; distance: number } | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(true)
  const [error, setError] = useState('')
  const abort = useRef<AbortController | null>(null)
  const previewCallback = useRef(onPreview)
  useEffect(() => {
    previewCallback.current = onPreview
  }, [onPreview])
  useEffect(() => () => abort.current?.abort(), [])

  const rigging = sag.sagModel === 'mechanics' ? (sag.rigging ?? null) : null
  const effective = { ...settings, deflectionPercent: sag.deflectionPercent }
  const key = JSON.stringify({ center, effective, rigging })
  const result = record?.source === source && record.key === key ? record.result : null
  const selectedId = selectedSpokeId === undefined ? localSelected : selectedSpokeId
  const selected = result?.spokes.find((spoke) => spoke.id === selectedId && spoke.line) ?? null
  const analysis = useMemo(() => {
    if (!selected?.line) return null
    try {
      return analyzeCable(selected.line, source)
    } catch {
      return null
    }
  }, [selected?.line, source])
  const cursorDistance = !analysis
    ? 0
    : cursor && cursor.spokeId === selected?.id
      ? Math.max(0, Math.min(analysis.length, cursor.distance))
      : analysis.length / 2
  const preview = useMemo(() => (result ? maxReachGeoJson(result, selected?.id) : EMPTY), [result, selected?.id])
  useEffect(() => {
    previewCallback.current(preview)
  }, [preview])
  useEffect(() => () => previewCallback.current(EMPTY), [])

  const choose = (id: string) => {
    setLocalSelected(id)
    setCursor(null)
    onSelectSpoke?.(id)
  }
  const run = async () => {
    if (!center) return
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    setError('')
    try {
      const steps = maxReachSteps(center, source, effective, rigging)
      setProgress({ done: 0, total: 1 })
      const next = await runCooperatively(steps, { signal: controller.signal, onProgress: setProgress })
      setRecord({ result: next, source, key })
      const first = next.spokes.find((spoke) => spoke.line)
      if (first) choose(first.id)
      setSettingsOpen(false)
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
        setRecord(null)
        setError(cause instanceof Error ? cause.message : 'Could not search the landing reach.')
      }
    } finally {
      if (abort.current === controller) abort.current = null
      setProgress(null)
    }
  }
  const change = (field: keyof ReachSettings, value: number) => {
    setSettings((previous) => ({ ...previous, [field]: value }))
    setError('')
  }
  const adopt = () => {
    if (!selected?.line) return
    onAdopt({
      ...selected.line,
      id: crypto.randomUUID(),
      start: [...selected.line.start],
      end: [...selected.line.end],
    })
  }
  const counts = (status: ReachSpoke['status']) => result?.spokes.filter((spoke) => spoke.status === status).length ?? 0

  return (
    <div data-testid="radial-reach-panel">
      <CollapsibleSection
        label="Settings"
        summary={`${settings.minLengthM}–${settings.maxLengthM} m · ${settings.bearingStepDeg}° step · ${rigging ? 'rope and load' : `${sag.deflectionPercent}% sag`}`}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        className="mb-2 rounded-md border"
        contentClassName="space-y-3 px-3 pb-3"
        actions={
          <InfoTip label="About the reach search">
            Along each bearing (up to {MAX_RADIAL_SPOKES}), tailholds are tried from the farthest inward at the tailhold
            step; the first whose single-span line clears every ground sample is the reach. Unknown ground stops a
            bearing: its reach is unknown and only a lower bound is shown.
          </InfoTip>
        }
      >
        {SETTING_GROUPS.map(([group, fields]) => (
          <fieldset key={group} className="min-w-0">
            <legend className="mb-1 text-3xs font-medium uppercase tracking-wide text-muted-foreground">{group}</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
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
              {group === 'Cable' && sag.sagModel !== 'mechanics' && (
                <NumberField
                  label="Assumed sag (%)"
                  value={sag.deflectionPercent}
                  min={0}
                  max={30}
                  step={0.5}
                  onChange={(value) => setSag((line) => ({ ...line, deflectionPercent: value }))}
                />
              )}
            </div>
          </fieldset>
        ))}
        <CableRiggingFields line={sag} onChange={setSag} />
      </CollapsibleSection>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {progress ? (
          <>
            <Button size="sm" variant="outline" onClick={() => abort.current?.abort()}>
              Cancel
            </Button>
            <span role="status" className="text-2xs text-muted-foreground">
              Searching bearing {Math.min(progress.total, progress.done + 1)} of {progress.total}…
            </span>
          </>
        ) : (
          <Button size="sm" disabled={!center} onClick={run}>
            Find maximum reach
          </Button>
        )}
        <Button variant="outline" size="sm" disabled={!selected?.line || !!progress} onClick={adopt}>
          Use selected D-line
        </Button>
        {result && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => downloadText(maxReachCsv(result), 'landing-reach.csv', 'text/csv;charset=utf-8')}
          >
            Reach CSV
          </Button>
        )}
      </div>
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      {!result && record && !error && !progress && (
        <p role="status" className="mb-2 text-xs text-amber-700 dark:text-amber-400">
          Landing, terrain or settings changed. Run again to replace the previous preview.
        </p>
      )}
      {result && (
        <>
          <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-2xs" role="status">
            <span>
              <span className="mr-1 inline-block size-2 rounded-full" style={{ backgroundColor: REACH_COLORS.clear }} />
              {counts('clear')} reach found
            </span>
            <span>
              <span
                className="mr-1 inline-block size-2 rounded-full"
                style={{ backgroundColor: REACH_COLORS.conflict }}
              />
              {counts('conflict')} no line clears
            </span>
            <span>
              <span
                className="mr-1 inline-block size-2 rounded-full"
                style={{ backgroundColor: REACH_COLORS.unknown }}
              />
              {counts('unknown')} unknown terrain
            </span>
          </div>
          {result.warnings.map((warning) => (
            <p key={warning} className="mb-2 text-3xs text-amber-700 dark:text-amber-400">
              {warning}
            </p>
          ))}
          <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(170px,0.75fr)_minmax(0,1fr)]">
            <div className="max-h-64 overflow-auto rounded border">
              <EngineeringTable className="whitespace-normal" data-testid="radial-reach-table">
                <thead className="sticky top-0">
                  <tr>
                    <ColumnHeader label="Bearing" className="text-left" />
                    <ColumnHeader label="Reach" />
                    <ColumnHeader label="Limited by" />
                  </tr>
                </thead>
                <tbody>
                  {result.spokes.map((spoke) => (
                    <tr key={spoke.id} aria-selected={selected?.id === spoke.id}>
                      <td className="text-left">
                        <button
                          className="underline decoration-dotted disabled:no-underline"
                          disabled={!spoke.line}
                          onClick={() => choose(spoke.id)}
                          aria-label={`Select reach spoke ${spoke.bearingDeg.toFixed(1)} degrees`}
                        >
                          <span
                            className="mr-1 inline-block size-2 rounded-full"
                            style={{ backgroundColor: REACH_COLORS[spoke.status] }}
                          />
                          {spoke.bearingDeg.toFixed(1)}°
                        </button>
                      </td>
                      <td>{reachText(spoke)}</td>
                      <td
                        title={
                          spoke.unknownFromM === null ? undefined : `Ground unknown from ${metres(spoke.unknownFromM)}`
                        }
                      >
                        {REACH_LIMIT_TEXT[spoke.limitedBy]}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </EngineeringTable>
            </div>
            {selected && analysis && (
              <div className="min-w-0">
                <p className="mb-1 text-2xs font-medium">
                  {selected.bearingDeg.toFixed(1)}° · {reachText(selected)}
                  {selected.status === 'unknown' ? ' (lower bound before unknown ground)' : ''}
                </p>
                <div className="h-60 min-w-0" data-testid="radial-reach-profile">
                  <CableChart
                    analysis={analysis}
                    distance={cursorDistance}
                    onDistance={(distance) => setCursor({ spokeId: selected.id, distance })}
                  />
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
