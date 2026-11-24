import { useState } from 'react'
import { DownloadCloud, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CalculationTable } from '@/components/ui/calculation-results'
import { FileButton } from '@/components/ui/file-button'
import {
  CheckboxField,
  FORM_INPUT_CLASS,
  FormField,
  NullableNumberField,
  SelectField,
} from '@/components/ui/form-field'
import { InlineAlert } from '@/components/ui/map-panels'
import { TextButton } from '@/components/ui/text-button'
import { ToolDisclosure, ToolSection } from '@/components/ui/tool-section'
import { setCheck, setOldForest } from './edits'
import { importRetentionAreas } from './imports'
import { calculateOldForest, OldForestStopped, stopOldForest } from './oldForest/oldForestClient'
import { RepresentationSummary } from './RepresentationSummary'
import {
  BOARD_2019_SOURCE,
  gisDisagrees,
  OLD_FOREST_UNITS,
  oldForestUnit,
  unitsOf,
  type OldForestUnit,
} from './oldForest/units'
import { YOUNGER_STANDS_MAX_SHARE, youngerStandsProblem } from './oldForest/youngerStands'
import { corridorSentence, excludedSentence } from './oldForest/recordText'
import { nduParts } from './orderUnits'
import {
  oldForestCurrent,
  oldForestKey,
  shortfallText,
  type OldForestChoices,
  type OldForestPoolUnit,
  type OldForestYear,
} from './records'
import type { StepProps } from './steps/types'

const ha = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })
const pct = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })
const signedPct = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0, signDisplay: 'exceptZero' })

type RunState = { status: 'idle' } | { status: 'running'; progress: string } | { status: 'failed'; error: string }

/** The unit most likely meant: the first of the district whose NDU names the plan's sub-unit. */
function suggestedUnit(district: string, ndu: string) {
  const units = unitsOf(district)
  const { name, sub } = nduParts(ndu)
  const want = `${name}${sub ? ` - ${sub}` : ''}`.toLowerCase()
  return units.find((u) => u.ndu.toLowerCase().includes(want)) ?? units[0]
}

/** Held / required; with D.4 on, what younger stands add is shown beside what is held. */
function Shortfall({ have, need, d4 }: { have: number | null; need: number | null; d4?: number | null }) {
  if (have === null || need === null) return <span className="text-muted-foreground">—</span>
  const short = have + (d4 ?? 0) < need
  return (
    <span className={short ? 'font-medium text-warning' : undefined}>
      {ha.format(have)}
      {d4 ? ` + ${ha.format(d4)} D.4` : ''} / {ha.format(need)}
    </span>
  )
}

/** The units a calculation assesses: the chosen unit, then any pooled with it (D.2). */
function poolUnits(choices: OldForestChoices): OldForestUnit[] {
  return [
    { district: choices.district, unit: choices.unit },
    ...(choices.pooledWith ?? []).map((u) => ({ district: u.district, unit: u.unit })),
  ].flatMap((u) => oldForestUnit(u.district, u.unit) ?? [])
}

/** The baseline alone in 2019 beside the Board's row for one unit (the Board's table is per unit). */
function BoardComparison({ unit, calibration }: { unit: OldForestUnit; calibration: OldForestYear }) {
  const board = unit.board2019
  if (!board) return null
  return (
    <>
      <CalculationTable
        caption={`${unit.unit}, 2019, baseline only: modelled / Board (difference)`}
        rows={[
          { label: 'CFLB', mine: calibration.cflbHa, theirs: board.cflbHa },
          { label: 'Old forest', mine: calibration.oldHa, theirs: board.oldHa },
          { label: 'Old interior', mine: calibration.interiorHa, theirs: board.interiorHa },
        ]}
        rowKey={(r) => r.label}
        columns={[
          { label: '', render: (r) => r.label },
          {
            label: 'Hectares',
            render: (r) =>
              r.mine === null
                ? '—'
                : `${ha.format(r.mine)} / ${ha.format(r.theirs)} (${signedPct.format(((r.mine - r.theirs) / r.theirs) * 100)}%)`,
          },
        ]}
      />
      <p className="text-2xs text-muted-foreground">
        {calibration.unknownAgeHa > 0
          ? `${ha.format(calibration.unknownAgeHa)} ha of CFLB was harvested between 2019 and the VRI projection; its 2019 age is not kept, and it is not counted as old. `
          : ''}
        The Board’s figures are the 2019 LLOWG analysis, from licensees’ own records and the inventory of the day.{' '}
        <a className="underline" href={BOARD_2019_SOURCE.url} target="_blank" rel="noreferrer">
          {BOARD_2019_SOURCE.label}
        </a>
        . {pct.format(((calibration.oldHa - board.oldHa) / board.oldHa) * 100)}% on old forest.
      </p>
    </>
  )
}

/**
 * Objectives A and B for one of the order's old forest units: read from DataBC on request, kept with
 * the plan as a record of the inputs it was calculated from. The figures are VRI age-based and not
 * field-verified, and nothing here decides D.5(a): the determination stays the reviewer's.
 */
export function OldForestSection({
  plan,
  edit,
  shown,
  oldForestMapOn,
  setOldForestMapOn,
}: Pick<StepProps, 'plan' | 'edit' | 'shown' | 'oldForestMapOn' | 'setOldForestMapOn'>) {
  const choices = plan.oldForest
  const units = unitsOf(choices?.district ?? plan.area.district)
  const unit = choices ? oldForestUnit(choices.district, choices.unit) : null
  const record = plan.checks?.oldForest
  const current = oldForestCurrent(plan)
  const younger = choices?.younger
  const youngerProblem = choices && younger ? youngerStandsProblem(younger, poolUnits(choices)) : null
  const keyOf = (x: { district: string; unit: string }) => `${x.district}|${x.unit}`
  const pooledKeys = new Set(choices ? [keyOf(choices), ...(choices.pooledWith ?? []).map(keyOf)] : [])
  const [run, setRun] = useState<RunState>({ status: 'idle' })

  function calculate() {
    setRun({ status: 'running', progress: 'Starting…' })
    // The page's one worker: the map layer draws from the same session reads.
    calculateOldForest(
      {
        plan: { ...plan, reviews: {}, landscape: {}, packs: [], zones: undefined, checks: undefined },
        key: oldForestKey(plan),
        ranOn: new Date().toISOString().slice(0, 10),
      },
      (progress) => setRun({ status: 'running', progress }),
    )
      .then((result) => {
        edit((p) => setCheck(p, 'oldForest', result))
        setRun({ status: 'idle' })
      })
      .catch((e: unknown) => {
        if (e instanceof OldForestStopped && e.message === 'Stopped.') return
        setRun({ status: 'failed', error: e instanceof Error ? e.message : 'The calculation failed.' })
      })
  }
  function cancel() {
    // Stopping the worker loses this session's reads; the next calculation reads again.
    stopOldForest()
    setRun({ status: 'idle' })
  }

  const shownRun = record?.schedules.find((s) => s.schedule === shown.schedule) ?? record?.schedules[0]
  const names = Object.fromEntries(plan.schedules.map((s) => [s.id, s.name]))
  const firstYear = shownRun?.years[0]
  const lastYear = shownRun?.years.at(-1)
  // The Board comparison is per unit: each pooled unit with a Board row is set beside its own.
  const calibrations = record
    ? (record.pool ?? [{ district: record.district, unit: record.unit, calibration2019: record.calibration2019 }])
        .map((u) => ({ unit: oldForestUnit(u.district, u.unit), calibration: u.calibration2019 }))
        .filter((c): c is { unit: OldForestUnit; calibration: OldForestYear } => !!c.unit?.board2019 && !!c.calibration)
    : []
  const summary = !choices
    ? 'Not assessed'
    : !record
      ? `${choices.unit} · not calculated`
      : `${record.unit}${record.pool ? ` pooled with ${record.pool.length - 1}` : ''}${current ? '' : ' · out of date'}`

  return (
    <ToolSection
      title="Old and old interior forest"
      help="Objectives A and B of the 2004 order for one of its Map 2 units: old forest against its share of the Crown forest land base, old non-pine-leading forest, and old interior forest. Read from DataBC's VRI, OGMAs, parks, corridors, ownership and tenures on request; private land, woodlots, community forests and TFLs are left out. The assumptions are listed in the guide."
      summary={summary}
    >
      <InlineAlert tone="info">
        VRI age-based and not field-verified. Nothing here decides whether D.5(a) applies; that determination stays
        yours.
      </InlineAlert>
      {!plan.area.district ? (
        <p className="text-xs text-muted-foreground">Choose the historic forest district in step 1.</p>
      ) : (
        <>
          <SelectField
            label="Old forest unit (Map 2)"
            value={choices?.unit ?? ''}
            onValueChange={(code) =>
              edit((p) => setOldForest(p, { district: p.oldForest?.district ?? p.area.district, unit: code }))
            }
          >
            {!choices && <option value="">Choose…</option>}
            {units.map((u) => (
              <option key={u.unit} value={u.unit}>
                {`${u.unit} · ${u.ndu} · ${u.becAsPrinted.replace(/,\s*$/, '')}`}
              </option>
            ))}
          </SelectField>
          {!choices && (
            <TextButton
              onClick={() => {
                const u = suggestedUnit(plan.area.district, plan.area.ndu)
                if (u) edit((p) => setOldForest(p, { district: p.area.district, unit: u.unit }))
              }}
            >
              Use the unit that matches the sub-unit
            </TextButton>
          )}
        </>
      )}
      {choices && unit && (
        <>
          <p className="text-2xs text-muted-foreground" data-testid="block-planning-old-unit">
            {unit.oldPercent}% of the CFLB old (Table{' '}
            {unit.district === 'Vanderhoof' ? 1 : unit.district === 'Fort St. James' ? 2 : 3}), {unit.interiorPercent}%
            of that interior
            {unit.nonPinePercent !== null ? `, ${unit.nonPinePercent}% of the CFLB old non-pine-leading` : ''}.{' '}
            {unit.ageBasis}
          </p>
          <ToolDisclosure label="Assumptions you can change">
            <div className="space-y-2">
              <CheckboxField
                label="Count non-legal OGMAs whole (D.1)"
                checked={choices.countNonLegalOgmas}
                onCheckedChange={(on) => edit((p) => setOldForest(p, { countNonLegalOgmas: on }))}
              />
              <CheckboxField
                label="Count parks and protected areas (D.1 says they may)"
                checked={choices.countParks}
                onCheckedChange={(on) => edit((p) => setOldForest(p, { countParks: on }))}
              />
              <SelectField
                label="Interior method"
                value={choices.interiorMethod}
                onValueChange={(v) => edit((p) => setOldForest(p, { interiorMethod: v === '2004' ? '2004' : '2005' }))}
              >
                <option value="2005">2005 revision: 200 m from young stands and primary corridors</option>
                <option value="2004">2004 original: 200 m from anything younger than old</option>
              </SelectField>
              <NullableNumberField
                label="CFLB you state (ha)"
                description="Leave blank to use the VRI proxy: treed and on the forest management land base, on the Crown land the order applies to. A stated CFLB takes the proxy’s shares of old and interior forest."
                value={choices.cflbEnteredHa ?? null}
                min={1}
                step={1}
                updateOn="commit"
                onValueChange={(v) => edit((p) => setOldForest(p, { cflbEnteredHa: v ?? undefined }))}
              />
              {choices.cflbEnteredHa !== undefined && (
                <FormField label="Where that CFLB comes from">
                  <input
                    className={FORM_INPUT_CLASS}
                    value={choices.cflbSource ?? ''}
                    placeholder="e.g. LLOWG 2025 analysis"
                    onChange={(e) => edit((p) => setOldForest(p, { cflbSource: e.target.value }))}
                  />
                </FormField>
              )}
              <div className="space-y-1">
                <p className="text-xs font-medium">Retention and recruitment areas</p>
                {choices.retentionAreas.length ? (
                  <ul className="space-y-0.5 text-xs">
                    {choices.retentionAreas.map((r) => (
                      <li key={r.id} className="flex items-center justify-between gap-2">
                        <span className="min-w-0">
                          {r.name}
                          <span className="text-muted-foreground"> · {r.reference || 'no approval reference'}</span>
                        </span>
                        <TextButton
                          onClick={() =>
                            edit((p) =>
                              setOldForest(p, {
                                retentionAreas: (p.oldForest?.retentionAreas ?? []).filter((x) => x.id !== r.id),
                              }),
                            )
                          }
                        >
                          Remove
                        </TextButton>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-2xs text-muted-foreground">
                    None. Spatial areas established after the order count whole (D.1); give each its approval reference.
                  </p>
                )}
                <FileButton
                  size="sm"
                  variant="outline"
                  label="Add retention or recruitment areas"
                  accept=".geojson,.json,application/json"
                  onFiles={(files) => onImport(files)}
                >
                  <Upload className="size-3.5" />
                  Add areas
                </FileButton>
              </div>
              <CheckboxField
                label={`Count younger stands toward up to ${YOUNGER_STANDS_MAX_SHARE * 100}% of each objective (D.4)`}
                description="Only where equal or better conservation benefits are demonstrated. Off unless you state the age and the benefit."
                checked={younger !== undefined}
                onCheckedChange={(on) => edit((p) => setOldForest(p, { younger: on ? { benefit: '' } : undefined }))}
              />
              {younger && (
                <>
                  <NullableNumberField
                    label="Younger stands count from (years)"
                    description={`Stands this age and older, up to the old age (${poolUnits(choices)
                      .map((u) => `${u.unit} from ${u.oldFromAge}`)
                      .join(', ')}), count under D.4. No default: state it.`}
                    value={younger.fromAge ?? null}
                    min={1}
                    step={1}
                    updateOn="commit"
                    onValueChange={(v) =>
                      edit((p) =>
                        setOldForest(p, {
                          younger: {
                            benefit: p.oldForest?.younger?.benefit ?? '',
                            ...(v === null ? {} : { fromAge: Math.round(v) }),
                          },
                        }),
                      )
                    }
                  />
                  <FormField
                    label="Conservation benefit (D.4)"
                    description="Why counting these younger stands gives equal or better conservation benefits. Printed with the result."
                  >
                    <textarea
                      className={FORM_INPUT_CLASS}
                      rows={3}
                      value={younger.benefit}
                      onChange={(e) =>
                        edit((p) =>
                          setOldForest(p, {
                            younger: { ...(p.oldForest?.younger ?? {}), benefit: e.target.value },
                          }),
                        )
                      }
                    />
                  </FormField>
                  {youngerProblem && <InlineAlert tone="warning">{youngerProblem}</InlineAlert>}
                </>
              )}
            </div>
          </ToolDisclosure>
          <ToolDisclosure label="Pool with other units (D.2)">
            <div className="space-y-2" data-testid="block-planning-old-pool">
              <p className="text-2xs text-muted-foreground">
                D.2 lets a licensee meet the combined requirement of similar mBECs over their combined area. Not pooled
                unless you choose units; whether they are similar is yours to judge. Each unit is read and calculated as
                it is alone, and the requirement is each unit’s CFLB × its own percentage, summed.
              </p>
              {choices.pooledWith?.length ? (
                <ul className="space-y-2 text-xs">
                  {choices.pooledWith.map((u) => {
                    const pooledUnit = oldForestUnit(u.district, u.unit)
                    const change = (next: Partial<NonNullable<OldForestChoices['pooledWith']>[number]>) =>
                      edit((p) =>
                        setOldForest(p, {
                          pooledWith: (p.oldForest?.pooledWith ?? []).map((x) => {
                            if (keyOf(x) !== keyOf(u)) return x
                            const merged = { ...x, ...next }
                            if (merged.cflbEnteredHa === undefined) delete merged.cflbEnteredHa
                            if (!merged.cflbSource) delete merged.cflbSource
                            return merged
                          }),
                        }),
                      )
                    return (
                      <li key={keyOf(u)} className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="min-w-0">
                            {u.unit} · {u.district}
                            {pooledUnit && (
                              <span className="text-muted-foreground">
                                {' '}
                                · {pooledUnit.ndu} · {pooledUnit.becAsPrinted.replace(/,\s*$/, '')} ·{' '}
                                {pooledUnit.oldPercent}% old from {pooledUnit.oldFromAge}
                                {unit.becAsPrinted !== pooledUnit.becAsPrinted
                                  ? ` · BEC differs from ${unit.unit}`
                                  : ''}
                              </span>
                            )}
                          </span>
                          <TextButton
                            onClick={() =>
                              edit((p) =>
                                setOldForest(p, {
                                  pooledWith: (p.oldForest?.pooledWith ?? []).filter((x) => keyOf(x) !== keyOf(u)),
                                }),
                              )
                            }
                          >
                            Remove
                          </TextButton>
                        </div>
                        <NullableNumberField
                          label={`CFLB you state for ${u.unit} (ha)`}
                          description="Blank: the VRI proxy for this unit, as for the chosen one."
                          value={u.cflbEnteredHa ?? null}
                          min={1}
                          step={1}
                          updateOn="commit"
                          onValueChange={(v) => change({ cflbEnteredHa: v ?? undefined })}
                        />
                        {u.cflbEnteredHa !== undefined && (
                          <FormField label={`Where ${u.unit}’s CFLB comes from`}>
                            <input
                              className={FORM_INPUT_CLASS}
                              value={u.cflbSource ?? ''}
                              onChange={(e) => change({ cflbSource: e.target.value })}
                            />
                          </FormField>
                        )}
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="text-2xs text-muted-foreground">{choices.unit} is assessed alone.</p>
              )}
              <SelectField
                label="Add a unit to the pool"
                value=""
                onValueChange={(key) => {
                  const [district, code] = key.split('|')
                  if (!district || !code) return
                  edit((p) =>
                    setOldForest(p, { pooledWith: [...(p.oldForest?.pooledWith ?? []), { district, unit: code }] }),
                  )
                }}
              >
                <option value="">Choose…</option>
                {OLD_FOREST_UNITS.filter((u) => !pooledKeys.has(keyOf(u))).map((u) => (
                  <option key={keyOf(u)} value={keyOf(u)}>
                    {`${u.unit} · ${u.district} · ${u.ndu} · ${u.becAsPrinted.replace(/,\s*$/, '')}`}
                  </option>
                ))}
              </SelectField>
            </div>
          </ToolDisclosure>
          {run.status === 'running' ? (
            <div className="flex items-center gap-2">
              <InlineAlert loading>{run.progress}</InlineAlert>
              <Button size="sm" variant="outline" onClick={cancel}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button size="sm" onClick={calculate} disabled={youngerProblem !== null}>
              <DownloadCloud className="size-3.5" />
              {record ? 'Calculate again' : 'Read and calculate'}
            </Button>
          )}
          {run.status === 'failed' && <InlineAlert tone="error">{run.error}</InlineAlert>}
        </>
      )}
      {record && (
        <div className="space-y-2" data-testid="block-planning-old-forest">
          {!current && (
            <InlineAlert tone="warning">
              The plan, these choices or the calculation changed since {record.ranOn}. Calculate again before relying on
              these figures.
            </InlineAlert>
          )}
          {unit && gisDisagrees(unit, record.gisFraction) && (
            <InlineAlert tone="info">{gisDisagrees(unit, record.gisFraction)}</InlineAlert>
          )}
          <ul className="space-y-0.5 text-xs">
            {record.schedules.map((s) => (
              <li key={s.schedule}>
                <span className="font-medium">{names[s.schedule] ?? s.schedule}:</span> {shortfallText(s.years)}
              </li>
            ))}
          </ul>
          {shownRun && (
            <CalculationTable
              caption={`${names[shownRun.schedule] ?? shownRun.schedule}: hectares held / required`}
              rows={shownRun.years}
              rowKey={(y: OldForestYear) => String(y.year)}
              columns={[
                { label: 'Year', render: (y: OldForestYear) => y.year },
                {
                  label: 'Old',
                  render: (y: OldForestYear) => <Shortfall have={y.oldHa} need={y.requiredOldHa} d4={y.d4OldHa} />,
                },
                {
                  label: 'Old non-pine',
                  render: (y: OldForestYear) => <Shortfall have={y.nonPineOldHa} need={y.requiredNonPineHa} />,
                },
                {
                  label: 'Old interior',
                  render: (y: OldForestYear) => (
                    <Shortfall have={y.interiorHa} need={y.requiredInteriorHa} d4={y.d4InteriorHa} />
                  ),
                },
              ]}
            />
          )}
          {record.younger && firstYear && (
            <p className="text-2xs text-muted-foreground" data-testid="block-planning-old-d4">
              D.4: stands from {record.younger.fromAge} years up to the old age count toward up to{' '}
              {YOUNGER_STANDS_MAX_SHARE * 100}% of the old and old interior requirements, never the non-pine one. In{' '}
              {firstYear.year} they supplied {ha.format(firstYear.d4OldHa ?? 0)} ha toward old forest of{' '}
              {ha.format(firstYear.d4OldSupplyHa ?? 0)} ha available
              {firstYear.d4InteriorHa !== null && firstYear.d4InteriorHa !== undefined
                ? `, and ${ha.format(firstYear.d4InteriorHa)} ha toward interior of ${ha.format(firstYear.d4InteriorSupplyHa ?? 0)} ha they add`
                : ''}
              . Conservation benefit stated: “{record.younger.benefit}”
            </p>
          )}
          {record.pool ? (
            <>
              <CalculationTable
                caption={`Pooled under D.2 (${names[shownRun?.schedule ?? ''] ?? ''}): each unit’s hectares held / required`}
                rows={record.pool}
                rowKey={(u) => `${u.district}|${u.unit}`}
                columns={[
                  { label: 'Unit', render: (u) => `${u.unit} · ${u.district}` },
                  {
                    label: 'CFLB',
                    render: (u) =>
                      `${ha.format(u.cflbEnteredHa ?? u.cflbProxyHa)} ha${u.cflbEnteredHa === undefined ? '' : ' stated'}`,
                  },
                  ...[firstYear, lastYear].flatMap((at) => {
                    if (!at) return []
                    const of = (u: OldForestPoolUnit) =>
                      u.schedules.find((s) => s.schedule === shownRun?.schedule)?.years.find((y) => y.year === at.year)
                    return [
                      {
                        label: `Old ${at.year}`,
                        render: (u: OldForestPoolUnit) => {
                          const y = of(u)
                          return y ? <Shortfall have={y.oldHa} need={y.requiredOldHa} d4={y.d4OldHa} /> : '—'
                        },
                      },
                      {
                        label: `Interior ${at.year}`,
                        render: (u: OldForestPoolUnit) => {
                          const y = of(u)
                          return y ? (
                            <Shortfall have={y.interiorHa} need={y.requiredInteriorHa} d4={y.d4InteriorHa} />
                          ) : (
                            '—'
                          )
                        },
                      },
                    ]
                  }),
                ]}
              />
              <p className="text-2xs text-muted-foreground">
                The schedules above are the pool’s: CFLB {ha.format(firstYear?.cflbHa ?? 0)} ha over{' '}
                {record.pool.length} units, each unit’s requirement at its own percentage and old age, summed. Each unit
                is read, clipped and calculated alone, so an interior patch across a boundary between pooled units is
                judged for its width in each unit separately. {record.pool.map((u) => u.source).join('. ')}.
              </p>
            </>
          ) : (
            <p className="text-2xs text-muted-foreground">
              CFLB {ha.format(shownRun?.years[0].cflbHa ?? record.cflbProxyHa)} ha
              {choices?.cflbEnteredHa !== undefined
                ? ` as you stated${choices.cflbSource ? ` (${choices.cflbSource})` : ''}; every area is the VRI proxy’s share of its ${ha.format(record.cflbProxyHa)} ha applied to it`
                : ' by the VRI proxy'}
              . {ha.format(shownRun?.years[0].countedNotOldHa ?? 0)} ha counted whole under D.1 is not old by age.
              Interior is calculated for every period of the schedule under review and the first and last of the others.
              VRI projected to {record.projectedYear}; {record.counts.stands.toLocaleString()} stands,{' '}
              {record.counts.ogmas} OGMAs, {record.counts.parks} parks, {corridorSentence(record)} {record.source}.
            </p>
          )}
          <p className="text-2xs text-muted-foreground" data-testid="block-planning-old-excluded">
            {excludedSentence(record)}
          </p>
          <CheckboxField
            label="Draw on the map"
            description="Old forest, old interior, the 200 m edges and the ground left out, for the schedule and year on the map. Drawn by the same calculation for that year; kept for this session only."
            checked={oldForestMapOn}
            onCheckedChange={setOldForestMapOn}
          />
          <ToolDisclosure label="Representative stands (D.3)">
            <RepresentationSummary record={record} year={shown.year} scheduleNames={names} />
          </ToolDisclosure>
          {calibrations.length > 0 && (
            <ToolDisclosure label="Check against the Board’s 2019 figures">
              {calibrations.map((c) => (
                <BoardComparison key={`${c.unit.district}|${c.unit.unit}`} unit={c.unit} calibration={c.calibration} />
              ))}
            </ToolDisclosure>
          )}
        </div>
      )}
    </ToolSection>
  )

  function onImport(files: File[]) {
    void importRetention(files)
  }
  async function importRetention(files: File[]) {
    const file = files[0]
    if (!file) return
    try {
      const data: unknown = JSON.parse(await file.text())
      edit((p) => {
        const existing = p.oldForest?.retentionAreas ?? []
        return setOldForest(p, { retentionAreas: [...existing, ...importRetentionAreas(existing, data, file.name)] })
      })
    } catch (e) {
      setRun({ status: 'failed', error: e instanceof Error ? e.message : 'The file could not be read.' })
    }
  }
}
