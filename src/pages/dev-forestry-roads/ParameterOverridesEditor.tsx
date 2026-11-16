import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { insetBox } from '@/components/ui/inset-box'
import { cn } from '@/lib/utils'
import { Field, OptionalNumberField, RoadSelect, roadFieldClass } from './Controls'
import { RoadSection } from './SidebarParts'
import { inputMessage, type InvalidInput } from './inputErrors'
import { roadEngOverrideSides } from './roadEngDesignSettings'
import {
  describeOverride,
  MAX_OVERRIDE_POINTS,
  MAX_PARAMETER_OVERRIDES,
  OVERRIDE_FIELD_NAMES,
  OVERRIDE_FIELDS,
  overrideFieldValue,
  type OverrideField,
  type TemplateParameterOverride,
} from './templateParameterOverrides'
import type { RoadTemplate } from './types'
import { stationEntry, type StationEntry } from './stationEntry'
import { StationField } from './StationFields'

/**
 * Values by station (`templateParameterOverrides.ts`, RoadEng's parameter overrides): one side value
 * of whichever template is in force, entered at stations and interpolated between them. A blank
 * value is the template's own there.
 */
export function ParameterOverridesEditor({
  overrides,
  onChange,
  lengthM,
  readStation,
  templateAt,
  problem,
  newId,
  stations = stationEntry(undefined, lengthM),
}: {
  overrides: readonly TemplateParameterOverride[]
  onChange: (overrides: TemplateParameterOverride[]) => void
  lengthM: number
  /** How the stations show and are typed: the road's station names when it has them. */
  stations?: StationEntry
  /** The selected station, read when a button is pressed. */
  readStation: () => number
  /** The template in force at a chainage, before overrides. */
  templateAt: (chainage: number) => RoadTemplate
  problem?: InvalidInput
  newId: () => string
}) {
  const set = (id: string, change: (o: TemplateParameterOverride) => TemplateParameterOverride) =>
    onChange(overrides.map((o) => (o.id === id ? change(o) : o)))
  const round = (v: number) => Math.round(v * 1000) / 1000
  const add = () => {
    const station = round(Math.max(0, Math.min(lengthM, readStation())))
    const value = overrideFieldValue(templateAt(station), 'right', 'Width')
    onChange([
      ...overrides,
      {
        id: newId(),
        name: 'Right width',
        side: 'right',
        field: 'Width',
        points: [{ station, value: round(value) }],
      },
    ])
  }
  return (
    <RoadSection
      title="Values by station"
      summary={overrides.length ? `${overrides.length} value${overrides.length === 1 ? '' : 's'}` : 'None'}
      help="One value of the section in force (a width, crossfall, batter, ditch or surfacing depth on one side), entered at stations. Between two stations the value runs straight from one to the other; before the first and after the last the nearest one holds. A blank value is the template's own there, so between two blanks the template ranges apply as they are. A RoadEng design's parameter overrides open here."
    >
      <Button
        variant="outline"
        size="sm"
        disabled={overrides.length >= MAX_PARAMETER_OVERRIDES}
        onClick={add}
        data-testid="road-add-parameter-override"
      >
        <Plus className="size-3" /> Add value at this station
      </Button>
      {overrides.map((o, index) => {
        const label = `Value ${index + 1}`
        const error = (field: string) => inputMessage(problem, 'parameterOverrides', o.id, field)
        const { min, max } = OVERRIDE_FIELDS[o.field]
        return (
          <div
            key={o.id}
            className={cn(insetBox(), 'mt-2 space-y-2')}
            data-testid="road-parameter-override"
            data-override-id={o.id}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="min-w-0 truncate text-xs font-medium" title={describeOverride(o)}>
                {o.name}
              </p>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                aria-label={`Remove ${label.toLowerCase()}`}
                onClick={() => onChange(overrides.filter((x) => x.id !== o.id))}
              >
                <Trash2 className="size-3" />
              </Button>
            </div>
            {o.roadEng && <RoadEngSourceLine source={o.roadEng} />}
            <div className="grid grid-cols-2 gap-2">
              <Field label={`${label} side`}>
                <RoadSelect
                  ariaLabel={`${label} side`}
                  className={roadFieldClass}
                  value={o.side}
                  options={[
                    { value: 'left', label: 'Left' },
                    { value: 'right', label: 'Right' },
                  ]}
                  onValueChange={(side) =>
                    set(o.id, (x) => ({
                      ...x,
                      side: side as 'left' | 'right',
                      name: x.roadEng ? x.name : nameOf(side as 'left' | 'right', x.field),
                    }))
                  }
                />
              </Field>
              <Field label={`${label} changes`}>
                <RoadSelect
                  ariaLabel={`${label} changes`}
                  className={roadFieldClass}
                  value={o.field}
                  options={OVERRIDE_FIELD_NAMES.map((f) => ({ value: f, label: OVERRIDE_FIELDS[f].label }))}
                  onValueChange={(f) =>
                    set(o.id, (x) => {
                      const field = f as OverrideField
                      const range = OVERRIDE_FIELDS[field]
                      // Values of another field start at the template's own, never out of range.
                      return {
                        ...x,
                        field,
                        name: x.roadEng ? x.name : nameOf(x.side, field),
                        points: x.points.map((p) => ({
                          ...p,
                          value:
                            p.value === null
                              ? null
                              : round(
                                  Math.max(
                                    range.min,
                                    Math.min(range.max, overrideFieldValue(templateAt(p.station), x.side, field)),
                                  ),
                                ),
                        })),
                      }
                    })
                  }
                />
              </Field>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_1.5rem] gap-2 text-2xs text-muted-foreground">
              <span>{stations.named ? 'Station' : 'Station (m)'}</span>
              <span>{OVERRIDE_FIELDS[o.field].label}</span>
              <span />
            </div>
            {o.points.map((p, k) => (
              <div key={k} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_1.5rem] items-start gap-2">
                <StationField
                  entry={stations}
                  label={`${label} station ${k + 1}`}
                  hideLabel
                  precision={3}
                  value={p.station}
                  min={0}
                  max={Math.max(0, lengthM)}
                  step={1}
                  updateOn="commit"
                  error={k === 0 ? error('points') : undefined}
                  onChange={(station) =>
                    set(o.id, (x) => ({
                      ...x,
                      points: x.points
                        .map((q, j) => (j === k ? { ...q, station } : q))
                        .sort((a, b) => a.station - b.station),
                    }))
                  }
                />
                <OptionalNumberField
                  label={`${label} at station ${k + 1}`}
                  hideLabel
                  value={p.value}
                  min={min}
                  max={max}
                  step={o.field.endsWith('Slope') ? 0.25 : 0.1}
                  placeholder="template"
                  updateOn="commit"
                  onChange={(value) =>
                    set(o.id, (x) => ({ ...x, points: x.points.map((q, j) => (j === k ? { ...q, value } : q)) }))
                  }
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  aria-label={`Remove ${label.toLowerCase()} station ${k + 1}`}
                  disabled={o.points.length <= 1}
                  onClick={() => set(o.id, (x) => ({ ...x, points: x.points.filter((_, j) => j !== k) }))}
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              disabled={o.points.length >= MAX_OVERRIDE_POINTS}
              onClick={() => {
                const station = round(Math.max(0, Math.min(lengthM, readStation())))
                set(o.id, (x) => {
                  // A station already entered moves on a metre, so stations stay distinct.
                  let at = station
                  while (x.points.some((q) => Math.abs(q.station - at) < 1e-6) && at < lengthM) at = round(at + 1)
                  if (x.points.some((q) => Math.abs(q.station - at) < 1e-6)) return x
                  return {
                    ...x,
                    points: [...x.points, { station: at, value: null }].sort((a, b) => a.station - b.station),
                  }
                })
              }}
            >
              <Plus className="size-3" /> Station at the selected station
            </Button>
            <p className="text-2xs text-muted-foreground">{describeOverride(o)}</p>
          </div>
        )
      })}
    </RoadSection>
  )
}

/** Where an override read from RoadEng came from: its parameter, side, rows and their descriptions. */
function RoadEngSourceLine({ source }: { source: NonNullable<TemplateParameterOverride['roadEng']> }) {
  const sides = roadEngOverrideSides(source.code)
  const rows = source.entries.length
  const said = [...new Set(source.entries.map((e) => (e.split('|')[4] ?? '').trim()).filter(Boolean))]
  return (
    <p className="text-2xs text-muted-foreground" data-testid="road-parameter-override-source">
      RoadEng parameter {source.parameter}
      {sides.length === 1 ? ` (${sides[0]})` : ''}, {rows} row{rows === 1 ? '' : 's'}
      {said.length ? `: ${said.join(', ')}` : ''}.
    </p>
  )
}

const nameOf = (side: 'left' | 'right', field: OverrideField) =>
  `${side === 'left' ? 'Left' : 'Right'} ${OVERRIDE_FIELDS[field].label.replace(/ \(.*\)$/, '').toLowerCase()}`
