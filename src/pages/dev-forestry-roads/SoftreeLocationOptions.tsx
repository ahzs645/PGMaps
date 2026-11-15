import { Field, NumberField, roadFieldClass, RoadSelect } from './Controls'
import type { LocationAsciiOptions } from './softreeExports'

/** The international foot, m (as `softreeHaulCsv.ts`; not imported, so the page loads no writer). */
const SOFTREE_FT_M = 0.3048

/**
 * The Softree location ASCII file's options in Save & export: its unit (the project's by default),
 * the road's start station, the delimiter and RoadEng's single line per station.
 */
export function SoftreeLocationOptions({
  value,
  onChange,
  projectUnitM,
}: {
  value: LocationAsciiOptions
  onChange: (value: LocationAsciiOptions) => void
  /** Metres per unit of the project (a RoadEng design in feet keeps feet). */
  projectUnitM: number
}) {
  const feet = Math.abs(value.unitM - SOFTREE_FT_M) < 1e-9
  const projectFeet = Math.abs(projectUnitM - SOFTREE_FT_M) < 1e-9
  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid="road-softree-location-options">
      <Field
        label="File units"
        hint="No location ASCII file states its units: RoadEng reads it in the units of the design it is imported into."
      >
        <RoadSelect
          ariaLabel="File units"
          className={roadFieldClass}
          value={feet ? 'feet' : 'metres'}
          onValueChange={(unit) => onChange({ ...value, unitM: unit === 'feet' ? SOFTREE_FT_M : 1 })}
          options={[
            { value: 'metres', label: projectFeet ? 'Metres' : 'Metres (the project’s)' },
            { value: 'feet', label: projectFeet ? 'International feet (the project’s)' : 'International feet' },
          ]}
        />
      </Field>
      <NumberField
        label="Start station (m)"
        value={value.startStationM}
        min={-10_000_000}
        max={10_000_000}
        step={0.001}
        hint="Added to every station: the road's own chainage starts at 0."
        onChange={(startStationM) => onChange({ ...value, startStationM })}
      />
      <Field label="Delimiter">
        <RoadSelect
          ariaLabel="Delimiter"
          className={roadFieldClass}
          value={value.delimiter === '\t' ? 'tab' : value.delimiter === ';' ? 'semicolon' : 'comma'}
          onValueChange={(d) => onChange({ ...value, delimiter: d === 'tab' ? '\t' : d === 'semicolon' ? ';' : ',' })}
          options={[
            { value: 'comma', label: 'Comma' },
            { value: 'tab', label: 'Tab' },
            { value: 'semicolon', label: 'Semicolon' },
          ]}
        />
      </Field>
      <Field label="Lines">
        <RoadSelect
          ariaLabel="Lines"
          className={roadFieldClass}
          value={value.singleLine ? 'station' : 'point'}
          onValueChange={(lines) => onChange({ ...value, singleLine: lines === 'station' })}
          options={[
            { value: 'point', label: 'One line per point' },
            { value: 'station', label: 'One line per station' },
          ]}
        />
      </Field>
    </div>
  )
}
