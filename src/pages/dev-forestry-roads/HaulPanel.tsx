import { useMemo, useState } from 'react'
import { insetBox } from '@/components/ui/inset-box'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert, KeyValueRows } from '@/components/ui/map-panels'
import { Field, NumberField, OptionalNumberField, roadFieldClass, RoadSelect } from './Controls'
import { RoadSection } from './SidebarParts'
import { RoadSettingsDialog } from './RoadSettingsDialog'
import { PlanningCoordinateField } from './PlanningCoordinateField'
import { DEFAULT_DESIGN_STANDARDS } from './designStandards'
import {
  HAUL_DESTINATION_PRESETS,
  HAUL_LIMITS,
  HAUL_ROAD_CLASS_LABELS,
  HAUL_ROAD_CLASSES,
  type HaulRoute,
} from './haulDestination'
import { createHaulSettings, reviewRoadHaul, type HaulDestinationSettings } from './haulReview'
import { JUNCTION_RULE_LIMITS } from './junctionOrientation'
import type { RoadWorkspace } from './useRoadWorkspace'

const km = (m: number) => `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`
const time = (min: number | null) =>
  min === null
    ? 'unknown'
    : min < 90
      ? `${Math.round(min)} min`
      : `${Math.floor(min / 60)} h ${Math.round(min % 60)} min`
const CUSTOM = 'custom'
const NONE = 'none'
const DIRECTION_TEXT = { 'start-to-end': 'start → end', 'end-to-start': 'end → start' } as const

/** One line: "62 km · 3 h 25 min cycle", or why it is unknown. */
export function haulSummary(route: HaulRoute | null) {
  if (!route) return 'No destination'
  if (route.status === 'unknown' || route.oneWayM === null) return 'Haul unknown'
  return `${km(route.oneWayM)} · ${route.cycleMin === null ? 'cycle unknown' : `${time(route.cycleMin)} cycle`}`
}

/**
 * Where the wood goes: the destination, the haul and cycle time from this road's junction, and the
 * loaded truck's turn there. Speeds, terminal times and the junction rule are in a dialog.
 */
export function HaulPanel({
  workspace,
  open,
  onOpenChange,
}: {
  workspace: RoadWorkspace
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const { project, alignment, analysis, update } = workspace
  const settings = project.haulDestination ?? createHaulSettings()
  const [editing, setEditing] = useState(false)
  const set = (change: (current: HaulDestinationSettings) => HaulDestinationSettings) =>
    update((x) => ({ ...x, haulDestination: change(x.haulDestination ?? createHaulSettings()) }))
  const review = useMemo(
    () =>
      reviewRoadHaul(
        project,
        alignment,
        analysis.stations.map((s) => s.coordinate),
      ),
    [project, alignment, analysis.stations],
  )
  const destination = settings.destination
  const preset = destination && HAUL_DESTINATION_PRESETS.find((p) => p.id === destination.id)
  const choice = !destination ? NONE : preset ? preset.id : CUSTOM
  const route = review.status === 'assessed' ? review.junction.route : null
  const measure = review.status === 'assessed' ? review.junction.measure : null
  const standardsDirection = project.standards?.loadedDirection ?? null

  return (
    <RoadSection
      title="Haul"
      open={open}
      onOpenChange={onOpenChange}
      summary={destination ? `${destination.name} · ${haulSummary(route)}` : 'No destination'}
      data-testid="road-haul-section"
      help={
        <>
          Where this road&apos;s wood goes. The haul runs from the road&apos;s junction over the roads loaded in this
          project, taking the fastest round trip at the entered speeds, and past the edge of the loaded roads as the
          straight line times a detour factor, shown as estimated. Cycle time is the loaded and empty drive plus the
          entered loading, unloading and delay. Destinations are town centres, not mills. The speeds start as
          placeholders: enter your operation&apos;s own.
        </>
      }
    >
      <Field label="Destination">
        <RoadSelect
          ariaLabel="Haul destination"
          value={choice}
          onValueChange={(value) =>
            set((current) => ({
              ...current,
              destination:
                value === NONE
                  ? null
                  : value === CUSTOM
                    ? {
                        id: CUSTOM,
                        name: current.destination?.name ?? 'Custom destination',
                        coordinate: current.destination?.coordinate ?? alignment.points[0].coordinate,
                      }
                    : (HAUL_DESTINATION_PRESETS.find((p) => p.id === value) ?? null),
            }))
          }
          options={[
            { value: NONE, label: 'None' },
            ...HAUL_DESTINATION_PRESETS.map((p) => ({ value: p.id, label: p.name })),
            { value: CUSTOM, label: 'Custom point' },
          ]}
        />
      </Field>
      {choice === CUSTOM && destination && (
        <div className="space-y-2">
          <Field label="Destination name">
            <input
              className={roadFieldClass}
              value={destination.name}
              maxLength={200}
              onChange={(event) =>
                set((current) =>
                  current.destination
                    ? { ...current, destination: { ...current.destination, name: event.target.value } }
                    : current,
                )
              }
            />
          </Field>
          <PlanningCoordinateField
            label="Destination"
            value={destination.coordinate}
            onChange={(coordinate) =>
              coordinate &&
              set((current) =>
                current.destination ? { ...current, destination: { ...current.destination, coordinate } } : current,
              )
            }
          />
        </div>
      )}

      {review.status === 'no-junction' && (
        <InlineAlert tone="info">{review.reason} The haul is measured from a junction.</InlineAlert>
      )}
      {review.status === 'unavailable' && <InlineAlert tone="warning">{review.reason}</InlineAlert>}
      {route && route.status === 'unknown' && <InlineAlert tone="warning">{route.reason}</InlineAlert>}
      {route && route.status === 'network' && route.oneWayM !== null && (
        <div className="space-y-2" data-testid="road-haul-result">
          <KeyValueRows
            variant="divided"
            rows={[
              {
                label: 'One way',
                value: `${km(route.oneWayM)}${route.estimatedM > 0 ? ` (${km(route.estimatedM)} estimated)` : ''}`,
              },
              { label: 'Round trip', value: km(route.oneWayM * 2) },
              { label: 'Loaded / empty', value: `${time(route.loadedMin)} / ${time(route.emptyMin)}` },
              { label: 'Load, unload, delay', value: time(route.terminalMin) },
              { label: 'Cycle', value: time(route.cycleMin) },
            ]}
          />
          <details className="text-2xs">
            <summary className="cursor-pointer text-muted-foreground">By road class</summary>
            <KeyValueRows
              className="mt-1"
              valueMaxWidth={null}
              rows={route.legs.map((leg, i) => ({
                key: String(i),
                label: HAUL_ROAD_CLASS_LABELS[leg.roadClass],
                value: `${km(leg.lengthM)} · ${time(leg.loadedMin)} loaded`,
              }))}
            />
          </details>
          {route.reason && <p className="text-2xs text-muted-foreground">{route.reason}</p>}
        </div>
      )}
      {review.status === 'assessed' && (
        <div className={cn(insetBox(), 'space-y-1.5 text-xs')} data-testid="road-haul-junction">
          <div className="flex items-center gap-1">
            <span className="font-medium">
              Junction at the road {review.junction.end}
              {review.junction.route.joinedRoad ? ` · ${review.junction.route.joinedRoad}` : ''}
            </span>
            <InfoTip label="About the junction turn">
              The loaded truck&apos;s turn from the road&apos;s last 50 m onto the host, heading toward the destination:
              0° drives straight on, 90° is a right-angle tee, 180° a hairpin. The project limit is{' '}
              {review.rule.maxTurnDeg}°, preferably {review.rule.preferredTurnDeg}° or less. Access searches can place
              the junction along the host so the road arrives this way.
            </InfoTip>
          </div>
          {measure ? (
            <p className={measure.state === 'sharp' ? 'text-warning' : 'text-muted-foreground'}>
              Loaded turn {Math.round(measure.turnDeg)}° toward {review.destination.name} ·{' '}
              {measure.state === 'preferred'
                ? 'mild'
                : measure.state === 'within'
                  ? `within ${review.rule.maxTurnDeg}°`
                  : `over ${review.rule.maxTurnDeg}°`}
            </p>
          ) : (
            <p className="text-muted-foreground">The way to the destination from this junction is not known.</p>
          )}
          <p className="text-2xs text-muted-foreground">
            Loaded travel on this road runs {DIRECTION_TEXT[review.loadedDirection]}.
            {standardsDirection !== review.loadedDirection &&
              ` The grade checks ${standardsDirection ? `use ${DIRECTION_TEXT[standardsDirection]}` : 'have no loaded direction'}.`}
          </p>
          {standardsDirection !== review.loadedDirection && (
            <Button
              size="xs"
              variant="outline"
              className="w-full"
              title="The loaded direction in Design standards is shared by every road in this project"
              onClick={() =>
                update((x) => ({
                  ...x,
                  standards: { ...(x.standards ?? DEFAULT_DESIGN_STANDARDS), loadedDirection: review.loadedDirection },
                }))
              }
            >
              Use {DIRECTION_TEXT[review.loadedDirection]} for the grade checks
            </Button>
          )}
        </div>
      )}
      <Button size="xs" variant="outline" className="w-full" onClick={() => setEditing(true)}>
        Speeds, times and junction rule
      </Button>
      <RoadSettingsDialog title="Haul speeds and times" open={editing} onOpenChange={setEditing} busy={false}>
        <HaulSettingsFields value={settings} onChange={(next) => set(() => next)} />
      </RoadSettingsDialog>
    </RoadSection>
  )
}

function HaulSettingsFields({
  value,
  onChange,
}: {
  value: HaulDestinationSettings
  onChange: (next: HaulDestinationSettings) => void
}) {
  const [minSpeed, maxSpeed] = HAUL_LIMITS.speedKmh
  const [minTerminal, maxTerminal] = HAUL_LIMITS.terminalMin
  return (
    <div className="space-y-4 text-xs">
      <section className="space-y-2">
        <p className="font-medium">
          Speeds by road class (km/h){' '}
          <InfoTip label="About haul speeds">
            Average running speeds, loaded and empty. They start as placeholders, not sourced figures: enter your
            operation&apos;s own. A blank speed leaves that class&apos;s time unknown rather than zero.
          </InfoTip>
        </p>
        {HAUL_ROAD_CLASSES.map((roadClass) => (
          <div key={roadClass} className="grid grid-cols-[minmax(0,1fr)_5rem_5rem] items-end gap-2">
            <span className="pb-2">{HAUL_ROAD_CLASS_LABELS[roadClass]}</span>
            {(['loadedKmh', 'emptyKmh'] as const).map((key) => (
              <OptionalNumberField
                key={key}
                label={`${HAUL_ROAD_CLASS_LABELS[roadClass]} ${key === 'loadedKmh' ? 'loaded' : 'empty'}`}
                hideLabel
                placeholder={key === 'loadedKmh' ? 'loaded' : 'empty'}
                value={value.speeds[roadClass][key]}
                min={minSpeed}
                max={maxSpeed}
                step={1}
                onChange={(n) =>
                  onChange({
                    ...value,
                    speeds: { ...value.speeds, [roadClass]: { ...value.speeds[roadClass], [key]: n } },
                  })
                }
              />
            ))}
          </div>
        ))}
      </section>
      <section className="grid grid-cols-3 gap-2">
        {(
          [
            ['loadMin', 'Loading (min)'],
            ['unloadMin', 'Unloading (min)'],
            ['delayMin', 'Delay (min)'],
          ] as const
        ).map(([key, label]) => (
          <NumberField
            key={key}
            label={label}
            value={value.terminal[key]}
            min={minTerminal}
            max={maxTerminal}
            step={1}
            onChange={(n) => onChange({ ...value, terminal: { ...value.terminal, [key]: n } })}
          />
        ))}
      </section>
      <NumberField
        label="Detour factor past the loaded roads"
        hint="Road distance beyond the loaded roads, as a multiple of the straight line. A placeholder; the TFL 30 layout study measured 1.3–1.6 to Prince George."
        value={value.offNetworkFactor}
        min={HAUL_LIMITS.offNetworkFactor[0]}
        max={HAUL_LIMITS.offNetworkFactor[1]}
        step={0.05}
        onChange={(n) => onChange({ ...value, offNetworkFactor: n })}
      />
      <section className="grid grid-cols-3 gap-2">
        <NumberField
          label="Largest turn (°)"
          hint="The loaded turn a junction may take. Access searches hold the road's arrival to it; 90° is the most the search's ±45° heading window can hold while still allowing a straight-on arrival."
          value={value.junction.maxTurnDeg}
          min={JUNCTION_RULE_LIMITS.maxTurnDeg[0]}
          max={JUNCTION_RULE_LIMITS.maxTurnDeg[1]}
          step={5}
          onChange={(n) =>
            onChange({
              ...value,
              junction: {
                ...value.junction,
                maxTurnDeg: n,
                preferredTurnDeg: Math.min(value.junction.preferredTurnDeg, n),
              },
            })
          }
        />
        <NumberField
          label="Preferred turn (°)"
          value={value.junction.preferredTurnDeg}
          min={JUNCTION_RULE_LIMITS.preferredTurnDeg[0]}
          max={value.junction.maxTurnDeg}
          step={5}
          onChange={(n) => onChange({ ...value, junction: { ...value.junction, preferredTurnDeg: n } })}
        />
        <NumberField
          label="Window (m)"
          hint="How far along the host road either side of its nearest point an access search may move the junction."
          value={value.junction.windowM}
          min={JUNCTION_RULE_LIMITS.windowM[0]}
          max={JUNCTION_RULE_LIMITS.windowM[1]}
          step={20}
          onChange={(n) => onChange({ ...value, junction: { ...value.junction, windowM: n } })}
        />
      </section>
    </div>
  )
}
