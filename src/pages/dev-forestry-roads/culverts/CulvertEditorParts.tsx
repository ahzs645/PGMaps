import { Field, OptionalNumberField, roadFieldClass, RoadSelect } from '../Controls'
import type { Culvert } from '../engineeringTypes'
import { CULVERT_OPTION_LIMITS, withCulvertOption, type CulvertOptions } from './culvertOptions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DisclosureRow } from '@/components/ui/disclosure'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert, KeyValueRows } from '@/components/ui/map-panels'
import type { culvertScreeningCapacity } from '../culvertGrade'
import type { CulvertCostDefaultStatus } from '../culvertCostDefaults'
import type { CulvertAnalysis } from '../engineeringTypes'
import type { CulvertCheckResult } from './culvertChecks'
import { culvertHydraulicsText, type CulvertScheduleRow } from './culvertSchedule'
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
    <div className="grid grid-cols-2 items-end gap-x-2 gap-y-1.5" data-testid="road-culvert-options">
      <Field label="Shape">
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
      <Field label="Barrels">
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
          label="Span (m)"
          ariaLabel={`${label} span (m)`}
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
          label="End area (m²)"
          ariaLabel={`${label} end area (m²)`}
          placeholder="ellipse"
          value={c.openingAreaM2 ?? null}
          min={CULVERT_OPTION_LIMITS.openingAreaM2[0]}
          max={CULVERT_OPTION_LIMITS.openingAreaM2[1]}
          error={error?.('openingAreaM2')}
          onChange={(value) => set('openingAreaM2', value ?? undefined)}
        />
      )}
      <Field label="Material">
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
      <Field label="Inlet">
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
          label="Embedment (m)"
          ariaLabel={`${label} embedment (m)`}
          placeholder="none"
          value={c.embedmentM || null}
          min={0.05}
          max={CULVERT_OPTION_LIMITS.embedmentM[1]}
          error={error?.('embedmentM')}
          onChange={(value) => set('embedmentM', value ?? undefined)}
        />
      )}
      <Field label="Time on site">
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

/** The caveats of a provisional price, behind an (i) beside its one line. */
export function ProvisionalPriceTip({ status }: { status: CulvertCostDefaultStatus }) {
  return (
    <InfoTip label="About the provisional price">
      <span className="block space-y-1">
        {status.notes.map((note) => (
          <span key={note} className="block">
            {note}
          </span>
        ))}
        <span className="block">
          Confirm or replace it with Review culvert rates in the covered estimate. Until then it stays marked
          provisional, even after an edit.
        </span>
      </span>
    </InfoTip>
  )
}

const figure = (value: number | null | undefined, digits: number, unit: string) =>
  value === null || value === undefined ? '—' : `${value.toFixed(digits)} ${unit}`

/** Several checks unassessed for the same reason print it once, as the fold's summary. */
function sharedResult(checks: readonly CulvertCheckResult[]) {
  const first = checks[0]?.result
  return first && checks.every((check) => check.result === first) ? first : null
}

function CheckLines({ checks, reason }: { checks: readonly CulvertCheckResult[]; reason?: string | null }) {
  return (
    <ul className="space-y-1">
      {reason && <li className="text-muted-foreground">{reason}</li>}
      {checks.map((check) => (
        <li key={check.id} data-check={check.id} data-state={check.state} className="flex items-start gap-1.5">
          <span className="min-w-0 flex-1">
            <span className="text-foreground">{check.label}</span>
            {!reason && <span className="block text-muted-foreground">{check.result}</span>}
          </span>
          <InfoTip label={`How ${check.label.toLowerCase()} is judged`}>
            {check.judgedOn} ({check.locator})
          </InfoTip>
        </li>
      ))}
    </ul>
  )
}

/**
 * One culvert's Review tab: the figures a designer reads first, then anything that needs attention,
 * then the checks folded by state, with the appraisal, class and hydraulic detail folded last. Every
 * figure is the engine's or the schedule's; nothing is judged here.
 */
export function CulvertReview({
  culvert,
  result,
  row,
  capacity,
  provisional,
  appraisalBasis,
  onShowDrainage,
}: {
  culvert: Culvert
  result: CulvertAnalysis | undefined
  row: CulvertScheduleRow | undefined
  capacity: ReturnType<typeof culvertScreeningCapacity>
  provisional: CulvertCostDefaultStatus | null
  appraisalBasis?: string
  onShowDrainage?: () => void
}) {
  const checks = row?.checks ?? []
  // A short barrel is already one of the engine's warnings.
  const notMet = checks.filter((check) => check.state === 'not-met' && check.id !== 'length')
  const met = checks.filter((check) => check.state === 'met' && check.id !== 'length')
  const open = checks.filter((check) => check.state === 'not-assessed')
  const notes = checks.filter((check) => check.state === 'note')
  const openReason = sharedResult(open)
  const warnings = result?.warnings ?? []
  const hydraulics = row ? culvertHydraulicsText(row) : ''
  const cost = !row
    ? 'Not calculated'
    : row.cost.replacedByCrossingRecord
      ? 'In the crossing estimate'
      : row.cost.installedCad === null
        ? 'Not calculated'
        : row.cost.installedCad === 0
          ? 'No price entered'
          : `$${WHOLE.format(row.cost.installedCad)}`
  return (
    <div className="space-y-3 text-xs" data-testid="road-culvert-standards">
      <KeyValueRows
        variant="divided"
        valueMaxWidth={null}
        rows={[
          { key: 'grade', label: 'Pipe grade', value: figure(result?.gradePercent, 2, '%') },
          {
            key: 'cover',
            label: 'Least cover',
            value: `${figure(result?.coverM, 2, 'm')} · needs ${culvert.minCoverM.toFixed(2)} m`,
          },
          {
            key: 'span',
            label: 'Span',
            value: `${culvert.lengthM.toFixed(1)} m · needs ${figure(result?.requiredLengthM, 1, 'm')}`,
          },
          { key: 'barrel', label: 'Inclined barrel', value: figure(result?.barrelLengthM, 2, 'm') },
          {
            key: 'capacity',
            label: 'Full-pipe capacity',
            value: (
              <span className="inline-flex items-center gap-1" data-testid="road-culvert-capacity">
                {capacity.capacityM3s.toFixed(3)} m³/s
                <InfoTip label="About the full-pipe capacity">
                  At {(capacity.slope * 100).toFixed(2)} %
                  {capacity.slopeAssumed ? ', assumed until the outlet is below the inlet' : ''}, Manning n{' '}
                  {capacity.manningN}
                  {capacity.approximate ? '; an arch is read as the round pipe of the same end area' : ''}. The peak
                  flow it must carry needs a drainage run.
                </InfoTip>
              </span>
            ),
          },
          {
            key: 'cost',
            label: 'Construction cost',
            value: (
              <span className="inline-flex flex-wrap items-center justify-end gap-1" data-testid="road-culvert-cost">
                {cost}
                {provisional && (
                  <Badge tone="warning" pill>
                    Provisional
                  </Badge>
                )}
              </span>
            ),
          },
        ]}
      />

      {(warnings.length > 0 || notMet.length > 0) && (
        <InlineAlert tone="warning" title="Needs attention">
          <ul className="mt-0.5 space-y-1">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
            {notMet.map((check) => (
              <li key={check.id} data-check={check.id} data-state={check.state}>
                {check.result}{' '}
                <InfoTip label={`How ${check.label.toLowerCase()} is judged`}>
                  Checks that {check.label.charAt(0).toLowerCase() + check.label.slice(1)}. {check.judgedOn} (
                  {check.locator})
                </InfoTip>
              </li>
            ))}
          </ul>
        </InlineAlert>
      )}

      <div data-testid="road-culvert-checks" className="space-y-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium text-foreground">Design checks</span>
          {met.length > 0 && <Badge tone="success">{met.length} met</Badge>}
          {notMet.length > 0 && <Badge tone="warning">{notMet.length} not met</Badge>}
          {/* Outlined: a plain muted chip all but disappears on a themed dark panel. */}
          {open.length > 0 && <Badge variant="outline">{open.length} not assessed</Badge>}
          {!checks.length && <span className="text-muted-foreground">Not calculated yet</span>}
        </div>
        {met.length > 0 && (
          <DisclosureRow title={`Met (${met.length})`}>
            <CheckLines checks={met} />
          </DisclosureRow>
        )}
        {open.length > 0 && (
          <DisclosureRow
            title={`Not assessed (${open.length})`}
            summary={openReason ? <span className="truncate">{openReason}</span> : undefined}
          >
            <CheckLines checks={open} reason={openReason} />
          </DisclosureRow>
        )}
        {notes.length > 0 && (
          <DisclosureRow title={`Notes (${notes.length})`}>
            <ul className="space-y-1 text-muted-foreground">
              {notes.map((check) => (
                <li key={check.id} data-check={check.id} data-state={check.state}>
                  {check.result} ({check.locator})
                </li>
              ))}
            </ul>
          </DisclosureRow>
        )}
      </div>

      {row && (
        <DisclosureRow
          title="Appraisal, class and hydraulics"
          summary={<span className="truncate">{row.appraisal?.summary ?? row.class.summary}</span>}
        >
          <dl className="space-y-2 leading-4">
            <div data-testid="road-culvert-appraisal" data-treatment={row.appraisal?.kind ?? 'none'}>
              <dt className="font-medium text-foreground">Appraisal treatment</dt>
              <dd className="text-muted-foreground">
                {row.appraisal ? (
                  <>
                    {row.appraisal.summary}. Not part of the estimate.{' '}
                    <InfoTip label="Why this appraisal treatment">
                      {row.appraisal.reasons.join(' ')} {row.appraisal.locator}.
                      {appraisalBasis ? ` ${appraisalBasis}` : ''}
                    </InfoTip>
                  </>
                ) : (
                  'The project’s cost location has no appraisal rules here.'
                )}
              </dd>
            </div>
            <div data-testid="road-culvert-class" data-major={String(row.class.major)}>
              <dt className="font-medium text-foreground">Class</dt>
              <dd className={row.class.major ? 'text-warning' : 'text-muted-foreground'}>
                {row.class.summary}
                {row.class.major ? '. Needs a professional engineer’s design.' : '.'}
              </dd>
            </div>
            {hydraulics && (
              <div
                data-testid="road-culvert-hydraulics"
                data-control={row.headwater.governing?.control ?? 'not-determined'}
              >
                <dt className="font-medium text-foreground">Hydraulics</dt>
                <dd className="text-muted-foreground">
                  {hydraulics}.{' '}
                  <InfoTip label="What the hydraulics leave out">
                    Tailwater, debris and the road’s low point away from the barrel are not modelled.
                  </InfoTip>
                </dd>
              </div>
            )}
          </dl>
        </DisclosureRow>
      )}

      {onShowDrainage && (
        <Button size="xs" variant="outline" onClick={onShowDrainage}>
          Open drainage check
        </Button>
      )}
    </div>
  )
}
