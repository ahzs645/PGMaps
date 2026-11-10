import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { NumberField, roadFieldClass, RoadSelect } from './Controls'
import type { DesignVehicle } from './types'
import { DRIVE_LIMITS, tracePresets, type TracePoint } from './vehiclePath'

/** The points traced on a vehicle: picked from its corners and load tips, or entered on a unit. */
export function TraceEditor({
  vehicle,
  traces,
  onChange,
}: {
  vehicle: DesignVehicle
  traces: TracePoint[]
  onChange: (traces: TracePoint[]) => void
}) {
  const presets = tracePresets(vehicle)
  const [unit, setUnit] = useState(0)
  const [aheadM, setAheadM] = useState(0)
  const [leftM, setLeftM] = useState(vehicle.widthM / 2)
  const full = traces.length >= DRIVE_LIMITS.traces
  const unitName = (i: number) => vehicle.units[i]?.name || `Unit ${i + 1}`
  return (
    <div className="space-y-2" data-testid="vehicle-trace-editor">
      <RoadSelect
        className={roadFieldClass}
        ariaLabel="Trace a point on the vehicle"
        disabled={full}
        value=""
        placeholder={full ? `At most ${DRIVE_LIMITS.traces} traces` : 'Trace a corner or load tip…'}
        onValueChange={(value) => {
          const preset = presets[Number(value)]
          if (preset) onChange([...traces, preset])
        }}
      >
        {presets.map((p, i) => (
          <option key={p.label} value={String(i)}>
            {p.label}
          </option>
        ))}
      </RoadSelect>
      <details>
        <summary className="cursor-pointer text-2xs font-medium">Trace another point (mirror, bunk, bumper)</summary>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <RoadSelect
            className={`${roadFieldClass} col-span-2`}
            ariaLabel="Unit of the traced point"
            value={String(Math.min(unit, vehicle.units.length - 1))}
            onValueChange={(value) => setUnit(Number(value))}
          >
            {vehicle.units.map((_, i) => (
              <option key={i} value={String(i)}>
                {unitName(i)}
              </option>
            ))}
          </RoadSelect>
          <NumberField
            label="Ahead of pivot (m)"
            value={aheadM}
            min={-60}
            max={30}
            step={0.1}
            onChange={setAheadM}
            hint="From the unit’s front pivot (steer axle or hitch); negative is behind it."
          />
          <NumberField
            label="Left of axis (m)"
            value={leftM}
            min={-10}
            max={10}
            step={0.05}
            onChange={setLeftM}
            hint="Negative is to the right."
          />
          <Button
            size="sm"
            variant="outline"
            className="col-span-2"
            disabled={full}
            onClick={() => {
              const u = Math.min(unit, vehicle.units.length - 1)
              onChange([
                ...traces,
                { label: `${unitName(u)} point ${aheadM} m ahead, ${leftM} m left`, unit: u, aheadM, leftM },
              ])
            }}
          >
            Add this point
          </Button>
        </div>
      </details>
      {!!traces.length && (
        <ul className="space-y-1">
          {traces.map((t, i) => (
            <li key={`${t.label}-${i}`} className="flex items-center justify-between gap-1 text-2xs">
              <span className="min-w-0 truncate">{t.label}</span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2"
                aria-label={`Stop tracing ${t.label}`}
                onClick={() => onChange(traces.filter((_, j) => j !== i))}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Keeps only traces that still exist on an edited vehicle. */
export const tracesFor = (vehicle: DesignVehicle, traces: TracePoint[]) =>
  traces.filter((t) => ('unit' in t ? t.unit < vehicle.units.length : t.load < (vehicle.loads?.length ?? 0)))
