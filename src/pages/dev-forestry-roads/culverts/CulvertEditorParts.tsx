import { Field, OptionalNumberField, roadFieldClass, RoadSelect } from '../Controls'
import type { Culvert } from '../engineeringTypes'
import { CULVERT_OPTION_LIMITS, withCulvertOption, type CulvertOptions } from './culvertOptions'
import type { CulvertScheduleRow } from './culvertSchedule'
import { CULVERT_SHAPES, culvertShapeOf, MAX_CULVERT_BARRELS, type CulvertShape } from './culvertShape'
import { CULVERT_INLET_EDGES, CULVERT_MATERIALS } from './engineeringManual'

const WHOLE = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 0 })

/**
 * The optional fields of one culvert: shape, span, end area, barrels, material, inlet, embedment and
 * time on site. Each choice's first option is the default, which clears the field, so a culvert left
 * at its defaults is stored exactly as one from before these fields existed.
 */
export function CulvertOptionFields({
  culvert: c,
  label,
  onChange,
  error,
}: {
  culvert: Culvert
  /** "Culvert 2", the prefix of each field's name. */
  label: string
  onChange: (next: Culvert) => void
  error?: (field: keyof CulvertOptions) => string | undefined
}) {
  const shape = culvertShapeOf(c)
  const set = <K extends keyof CulvertOptions>(key: K, value: CulvertOptions[K]) =>
    onChange(withCulvertOption(c, key, value))
  const setShape = (next: CulvertShape) => {
    // A round pipe keeps no span or end area; an arch keeps no embedment where it has no floor.
    let value = withCulvertOption(c, 'shape', next === 'round' ? undefined : next)
    if (next === 'round')
      value = withCulvertOption(withCulvertOption(value, 'spanM', undefined), 'openingAreaM2', undefined)
    if (next === 'box') value = withCulvertOption(value, 'openingAreaM2', undefined)
    if (next === 'open-bottom-arch') value = withCulvertOption(value, 'embedmentM', undefined)
    onChange(value)
  }
  return (
    <div className="grid grid-cols-2 gap-x-2 gap-y-1.5" data-testid="road-culvert-options">
      <Field label={`${label} shape`}>
        <RoadSelect
          ariaLabel={`${label} shape`}
          className={roadFieldClass}
          value={shape}
          onValueChange={(value) => setShape(value as CulvertShape)}
        >
          {CULVERT_SHAPES.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </RoadSelect>
      </Field>
      <Field label={`${label} barrels`}>
        <RoadSelect
          ariaLabel={`${label} barrels`}
          className={roadFieldClass}
          value={String(c.barrels ?? 1)}
          onValueChange={(value) => set('barrels', value === '1' ? undefined : Number(value))}
        >
          {Array.from({ length: MAX_CULVERT_BARRELS }, (_, index) => (
            <option key={index} value={String(index + 1)}>
              {index + 1}
            </option>
          ))}
        </RoadSelect>
      </Field>
      {shape !== 'round' && (
        <OptionalNumberField
          label={`${label} span (m)`}
          placeholder="as rise"
          value={c.spanM ?? null}
          min={CULVERT_OPTION_LIMITS.spanM[0]}
          max={CULVERT_OPTION_LIMITS.spanM[1]}
          error={error?.('spanM')}
          onChange={(value) => set('spanM', value ?? undefined)}
        />
      )}
      {(shape === 'pipe-arch' || shape === 'open-bottom-arch') && (
        <OptionalNumberField
          label={`${label} end area (m²)`}
          placeholder="ellipse"
          value={c.openingAreaM2 ?? null}
          min={CULVERT_OPTION_LIMITS.openingAreaM2[0]}
          max={CULVERT_OPTION_LIMITS.openingAreaM2[1]}
          error={error?.('openingAreaM2')}
          onChange={(value) => set('openingAreaM2', value ?? undefined)}
        />
      )}
      <Field label={`${label} material`}>
        <RoadSelect
          ariaLabel={`${label} material`}
          className={roadFieldClass}
          value={c.material ?? 'unset'}
          onValueChange={(value) => set('material', value === 'unset' ? undefined : (value as Culvert['material']))}
        >
          <option value="unset">Not set</option>
          {CULVERT_MATERIALS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </RoadSelect>
      </Field>
      <Field label={`${label} inlet`}>
        <RoadSelect
          ariaLabel={`${label} inlet`}
          className={roadFieldClass}
          value={c.inletEdge ?? 'projecting'}
          onValueChange={(value) =>
            set('inletEdge', value === 'projecting' ? undefined : (value as Culvert['inletEdge']))
          }
        >
          {CULVERT_INLET_EDGES.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </RoadSelect>
      </Field>
      {shape !== 'open-bottom-arch' && (
        <OptionalNumberField
          label={`${label} embedment (m)`}
          placeholder="none"
          value={c.embedmentM || null}
          min={0.05}
          max={CULVERT_OPTION_LIMITS.embedmentM[1]}
          error={error?.('embedmentM')}
          onChange={(value) => set('embedmentM', value ?? undefined)}
        />
      )}
      <Field label={`${label} time on site`}>
        <RoadSelect
          ariaLabel={`${label} time on site`}
          className={roadFieldClass}
          value={c.service ?? 'permanent'}
          onValueChange={(value) => set('service', value === 'permanent' ? undefined : 'temporary')}
        >
          <option value="permanent">Permanent</option>
          <option value="temporary">Temporary, 3 years or less</option>
        </RoadSelect>
      </Field>
    </div>
  )
}

/**
 * One culvert's schedule row in the editor: its construction cost, its appraisal treatment and its
 * design checks, each on its own line so none reads as another.
 */
export function CulvertStandards({ row, appraisalBasis }: { row: CulvertScheduleRow; appraisalBasis?: string }) {
  const met = row.checks.filter((check) => check.state === 'met' && check.id !== 'length')
  // A short barrel is already one of the engine's warnings printed above this block.
  const notMet = row.checks.filter((check) => check.state === 'not-met' && check.id !== 'length')
  const open = row.checks.filter((check) => check.state === 'not-assessed')
  const notes = row.checks.filter((check) => check.state === 'note')
  const cost = row.cost.replacedByCrossingRecord
    ? row.cost.basis
    : row.cost.installedCad === null
      ? 'Not calculated'
      : row.cost.installedCad === 0
        ? 'No price entered'
        : `$${WHOLE.format(row.cost.installedCad)}`
  return (
    <dl className="space-y-1 text-2xs leading-4" data-testid="road-culvert-standards">
      <div data-testid="road-culvert-cost">
        <dt className="inline font-medium text-foreground">Construction cost </dt>
        <dd className="inline text-muted-foreground">{cost}</dd>
      </div>
      <div data-testid="road-culvert-appraisal" data-treatment={row.appraisal?.kind ?? 'none'}>
        <dt className="inline font-medium text-foreground">Appraisal treatment </dt>
        <dd className="inline text-muted-foreground">
          {row.appraisal ? (
            <>
              {row.appraisal.summary}. {row.appraisal.reasons.join(' ')} {row.appraisal.locator}.
              {appraisalBasis ? ` ${appraisalBasis}` : ''} Not part of the estimate.
            </>
          ) : (
            'The project’s cost location has no appraisal rules here.'
          )}
        </dd>
      </div>
      <div data-testid="road-culvert-class" data-major={String(row.class.major)}>
        <dt className="inline font-medium text-foreground">Class </dt>
        <dd className={row.class.major ? 'inline text-warning' : 'inline text-muted-foreground'}>
          {row.class.summary}
          {row.class.major ? '. Needs a professional engineer’s design.' : '.'}
        </dd>
      </div>
      <div data-testid="road-culvert-checks">
        <dt className="font-medium text-foreground">Design checks</dt>
        {notMet.map((check) => (
          <dd key={check.id} className="text-warning" data-check={check.id} data-state={check.state}>
            {check.label}: {check.result}. {check.judgedOn} ({check.locator}).
          </dd>
        ))}
        {met.length > 0 && (
          <dd className="text-muted-foreground" data-state="met">
            Met: {met.map((check) => `${check.label.toLowerCase()} (${check.result.toLowerCase()})`).join('; ')}.
          </dd>
        )}
        {open.length > 0 && (
          <dd className="text-muted-foreground" data-state="not-assessed">
            Not assessed:{' '}
            {open.map((check) => `${check.label.toLowerCase()} (${check.result.toLowerCase()})`).join('; ')}.
          </dd>
        )}
        {notes.map((check) => (
          <dd key={check.id} className="text-muted-foreground" data-check={check.id} data-state={check.state}>
            {check.result} ({check.locator})
          </dd>
        ))}
      </div>
    </dl>
  )
}
