/**
 * Design → Extraction reach → Landings: the landings a run takes logs to. Points are picked on the
 * plan (one click each until Done or Escape), taken from the landing-site candidates, or placed at a
 * station of a road; stretches are a road between two stations. Each is existing or proposed and,
 * for the cable yarder, says where the yarder stands. Nothing here changes the project.
 */
import { useEffect, useState } from 'react'
import { Crosshair, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, NumberField, RoadSelect } from './Controls'
import { RoadSection } from './SidebarParts'
import type { SidebarProps } from './DesignSidebarBody'
import type { CablePosition } from './cableCoverageRule'
import type { ExtractionMachine } from './extractionReach'
import {
  LANDING_STATUS_LABELS,
  LANDING_YARDER_LABELS,
  MAX_LANDINGS,
  roadLengthM,
  roadStretch,
  type LandingInput,
  type LandingStatus,
} from './extractionLandings'
import type { LandingCandidate } from './landingSites'
import type { SkidRoad } from './skidReach'
import type { Coordinate } from './types'

type XY = [number, number]

const STATUS_OPTIONS = (Object.keys(LANDING_STATUS_LABELS) as LandingStatus[]).map((value) => ({
  value,
  label: LANDING_STATUS_LABELS[value],
}))
const YARDER_OPTIONS = (Object.keys(LANDING_YARDER_LABELS) as CablePosition[]).map((value) => ({
  value,
  label: LANDING_YARDER_LABELS[value],
}))
const metres = (m: number) => `${Math.round(m)} m`

/** The next free short name, L1, L2, … */
export function nextLandingName(landings: readonly LandingInput[]): string {
  let k = 1
  const taken = new Set(landings.map((l) => l.name))
  while (taken.has(`L${k}`)) k++
  return `L${k}`
}

/** Whether a key event comes from a field the person is typing in. */
const typing = (target: EventTarget | null) => {
  const el = target as HTMLElement | null
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName ?? ''))
}

export function LandingInputSection({
  landings,
  onLandings,
  machine,
  roads,
  candidates,
  projection,
  colorOf,
  onPickOnPlan,
}: {
  landings: LandingInput[]
  onLandings: (update: (current: LandingInput[]) => LandingInput[]) => void
  machine: ExtractionMachine
  /** Counted roads near the block, for stretches and stations. */
  roads: readonly SkidRoad[]
  /** Landing-site candidates of the last run, if any. */
  candidates: readonly LandingCandidate[]
  projection: { toGrid: (c: Coordinate) => XY; toLonLat: (xy: XY) => Coordinate } | null
  colorOf: (index: number) => string
  onPickOnPlan?: SidebarProps['onPickOnPlan']
}) {
  const [picking, setPicking] = useState(false)
  const [candidateId, setCandidateId] = useState('')
  const [roadId, setRoadId] = useState('')
  const [fromM, setFromM] = useState(0)
  const [toM, setToM] = useState(100)
  const [error, setError] = useState('')
  const full = landings.length >= MAX_LANDINGS
  const road = roads.find((r) => r.id === roadId) ?? roads[0]
  const roadLength = road && projection ? roadLengthM(road.coordinates, projection.toGrid) : 0
  const candidate = candidates.find((c) => c.id === candidateId) ?? candidates[0]

  const add = (make: (current: LandingInput[]) => Omit<LandingInput, 'id' | 'name'>) =>
    onLandings((current) =>
      current.length >= MAX_LANDINGS
        ? current
        : [...current, { ...make(current), id: crypto.randomUUID(), name: nextLandingName(current) }],
    )

  // Multi-pick: each click adds a landing and asks for the next, until Done or Escape.
  useEffect(() => {
    if (!picking || !onPickOnPlan) return
    if (full) {
      setPicking(false)
      onPickOnPlan(null)
      return
    }
    onPickOnPlan('Click each landing on the plan. Escape or Done ends.', (at) =>
      add(() => ({ status: 'existing', yarder: 'either', coordinates: [at], source: 'plan' })),
    )
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || typing(event.target)) return
      setPicking(false)
    }
    if (typeof window === 'undefined') return
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
    // `add` is rebuilt every render; the pick re-arms when the list changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picking, landings.length, onPickOnPlan, full])
  useEffect(() => {
    if (!picking) onPickOnPlan?.(null)
  }, [picking, onPickOnPlan])
  useEffect(() => () => onPickOnPlan?.(null), [onPickOnPlan])

  const addStretch = () => {
    setError('')
    if (!road || !projection) return
    try {
      const coordinates = roadStretch(road.coordinates, fromM, toM, projection.toGrid, projection.toLonLat)
      const a = Math.min(fromM, toM),
        b = Math.max(fromM, toM)
      add(() => ({
        status: 'existing',
        yarder: 'either',
        coordinates,
        source: coordinates.length === 1 ? 'station' : 'stretch',
        road: { id: road.id, name: road.name, fromM: a, toM: b },
      }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Check the stretch.')
    }
  }

  const update = (id: string, patch: Partial<LandingInput>) =>
    onLandings((current) => current.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  const existing = landings.filter((l) => l.status === 'existing').length

  return (
    <RoadSection
      title="Landings"
      summary={
        landings.length
          ? `${landings.length} · ${existing} existing, ${landings.length - existing} proposed`
          : 'Every road cell'
      }
      help="Where logs are decked. With none set, every counted truck-road cell takes logs (and the cable yarder starts a line every landing spacing). With landings set, logs go only to them: the counted roads carry machines to a landing as skid trails do, and cable lines start only from them. A point within 25 m of a counted road is joined to it."
    >
      <div className="space-y-2" data-testid="extraction-landings">
        {landings.length > 0 && (
          <ul className="space-y-1">
            {landings.map((landing, k) => (
              <li key={landing.id} className="space-y-1 rounded-md border px-2 py-1.5">
                <div className="flex items-center gap-1">
                  <span className="inline-block size-2.5 shrink-0 rounded-sm" style={{ background: colorOf(k) }} />
                  <span className="font-medium">{landing.name}</span>
                  <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
                    {landing.road
                      ? landing.coordinates.length > 1
                        ? `${metres(landing.road.fromM)}–${metres(landing.road.toM)} on ${landing.road.name}`
                        : `${metres(landing.road.fromM)} on ${landing.road.name}`
                      : landing.source === 'site'
                        ? 'landing site'
                        : 'point on plan'}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-6 shrink-0"
                    aria-label={`Remove landing ${landing.name}`}
                    onClick={() => onLandings((current) => current.filter((l) => l.id !== landing.id))}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
                <div className={`grid gap-1 ${machine === 'cable' ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  <RoadSelect
                    ariaLabel={`${landing.name} status`}
                    value={landing.status}
                    onValueChange={(value) => update(landing.id, { status: value as LandingStatus })}
                    options={STATUS_OPTIONS}
                  />
                  {machine === 'cable' && (
                    <RoadSelect
                      ariaLabel={`${landing.name} yarder side`}
                      value={landing.yarder}
                      onValueChange={(value) => update(landing.id, { yarder: value as CablePosition })}
                      options={YARDER_OPTIONS}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-1">
          <Button
            size="sm"
            variant={picking ? 'default' : 'outline'}
            className="h-7 gap-1 px-2 text-xs"
            disabled={!onPickOnPlan || (full && !picking)}
            aria-pressed={picking}
            onClick={() => setPicking((p) => !p)}
            data-testid="landing-pick"
          >
            <Crosshair className="size-3" />
            {picking ? 'Done' : 'Pick on plan'}
          </Button>
          {landings.length > 0 && (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onLandings(() => [])}>
              Clear landings
            </Button>
          )}
        </div>
        {candidates.length > 0 && (
          <div className="grid grid-cols-[1fr_auto] items-end gap-1">
            <Field label="Landing site">
              <RoadSelect
                ariaLabel="Landing site to use"
                value={candidate?.id ?? ''}
                onValueChange={setCandidateId}
                options={candidates.map((c) => ({
                  value: c.id,
                  label: `${c.rank}. ${c.meanSlopePercent.toFixed(1)} % · ${c.roadName}`,
                }))}
              />
            </Field>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              disabled={full || !candidate}
              onClick={() =>
                candidate &&
                add(() => ({ status: 'proposed', yarder: 'either', coordinates: [candidate.centre], source: 'site' }))
              }
            >
              Use
            </Button>
          </div>
        )}
        {roads.length > 0 && projection && (
          <div className="space-y-1">
            <Field label="Road stretch">
              <RoadSelect
                ariaLabel="Landing road"
                value={road?.id ?? ''}
                onValueChange={setRoadId}
                options={roads.map((r) => ({ value: r.id, label: r.name }))}
              />
            </Field>
            <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-1">
              <NumberField
                label="From (m)"
                value={fromM}
                min={0}
                max={Math.max(0, Math.floor(roadLength))}
                step={10}
                onChange={setFromM}
              />
              <NumberField
                label="To (m)"
                value={toM}
                min={0}
                max={Math.max(0, Math.floor(roadLength))}
                step={10}
                hint="Equal to From for one landing at that station."
                onChange={setToM}
              />
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                disabled={full}
                onClick={addStretch}
                data-testid="landing-add-stretch"
              >
                Add
              </Button>
            </div>
            <p className="text-2xs text-muted-foreground tabular-nums">
              {road?.name}: {metres(roadLength)} long.
            </p>
          </div>
        )}
        {error && <p className="text-2xs text-destructive">{error}</p>}
        {full && <p className="text-2xs text-muted-foreground">At most {MAX_LANDINGS} landings.</p>}
      </div>
    </RoadSection>
  )
}
