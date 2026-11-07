import { InfoTip } from '@/components/ui/info-tip'
import { Field, OptionalNumberField, roadFieldClass, RoadSelect } from './Controls'
import { MAX_HAUL_GRADE_PERCENT, MIN_HAUL_GRADE_PERCENT, type HaulGradeLimits } from './routing'

const OFF = 'off'

/**
 * Grade limits by direction of haul for route searches. Loaded trucks set one limit going up and
 * another coming down; the empty truck climbs back up what the loaded one came down.
 */
export function HaulGradeFields({
  value,
  onChange,
}: {
  value: HaulGradeLimits | null
  onChange: (value: HaulGradeLimits | null) => void
}) {
  const set = (patch: Partial<HaulGradeLimits>) => value && onChange({ ...value, ...patch })
  return (
    <div className="space-y-2" data-testid="road-haul-grades">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium">Grades by haul direction</p>
        <InfoTip label="About grades by haul direction">
          Direction runs along the searched route, from its start to its end: the road's start for a terrain-cost
          search, the endpoint for an FSR connection, the block landing for block access. Loaded uphill is the adverse
          grade; loaded downhill the favourable one. The empty truck climbs the loaded downhill on its way back, so that
          direction is held to the stricter of the two. Each limit only tightens the maximum grade above.
        </InfoTip>
      </div>
      <Field label="Loaded trucks travel">
        <RoadSelect
          className={roadFieldClass}
          ariaLabel="Loaded haul direction"
          value={value?.loadedDirection ?? OFF}
          onValueChange={(picked) => {
            const next = picked
            if (next === OFF) onChange(null)
            else
              onChange({
                maxLoadedUphillPercent: null,
                maxLoadedDownhillPercent: null,
                maxEmptyUphillPercent: null,
                ...value,
                loadedDirection: next as HaulGradeLimits['loadedDirection'],
              })
          }}
        >
          <option value={OFF}>Either way · maximum grade only</option>
          <option value="start-to-end">Start to end</option>
          <option value="end-to-start">End to start</option>
        </RoadSelect>
      </Field>
      {value && (
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ['maxLoadedUphillPercent', 'Loaded uphill %'],
              ['maxLoadedDownhillPercent', 'Loaded downhill %'],
              ['maxEmptyUphillPercent', 'Empty uphill %'],
            ] as const
          ).map(([key, label]) => (
            <OptionalNumberField
              key={key}
              label={label}
              value={value[key]}
              min={MIN_HAUL_GRADE_PERCENT}
              max={MAX_HAUL_GRADE_PERCENT}
              step={0.5}
              placeholder="max"
              onChange={(limit) => set({ [key]: limit })}
            />
          ))}
        </div>
      )}
    </div>
  )
}
