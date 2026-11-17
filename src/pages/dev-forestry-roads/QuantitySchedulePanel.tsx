import { Download, Plus, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ColumnHeader, EngineeringTable, engineeringCellInputClass } from '@/components/ui/engineering-table'
import { RoadSelect } from './Controls'
import { formatRoadStation } from './Charts'
import { downloadText } from '@/lib/download'
import { END_HAUL_MIN_SECTION_M, endHaulCsv, endHaulSections, equipmentHoursCsv } from './endHaul'
import { roadSidehill } from './sectionSideSlope'
import {
  EQUIPMENT_TASKS,
  MAX_ASSUMED_EQUIPMENT,
  quantitySchedule,
  taskQuantity,
  type AssumedEquipment,
  type EquipmentTask,
} from './quantitySchedule'
import type { Alignment, RoadAnalysis, RoadSettings } from './types'

const formats = new Map<number, Intl.NumberFormat>()
const fmt = (v: number | null | undefined, digits: number) => {
  if (v == null || !Number.isFinite(v)) return '—'
  let f = formats.get(digits)
  if (!f) formats.set(digits, (f = new Intl.NumberFormat('en-CA', { maximumFractionDigits: digits })))
  return f.format(v)
}
const digitsFor = (unit: string) => (unit === 'ha' ? 2 : unit === 'compacted per bank' ? 2 : 0)

/** A text cell that writes on blur or Enter, so typing a name is one undo step, not one per key. */
function TextCell({
  value,
  label,
  disabled,
  onCommit,
}: {
  value: string
  label: string
  disabled: boolean
  onCommit: (value: string) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft !== null && draft !== value) onCommit(draft.trim())
    setDraft(null)
  }
  return (
    <input
      aria-label={label}
      className={`${engineeringCellInputClass} text-left`}
      value={draft ?? value}
      maxLength={200}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit()
        if (event.key === 'Escape') setDraft(null)
      }}
    />
  )
}

/**
 * The schedule of quantities (Engineering Manual §3.5.3) and the construction equipment the design
 * assumes for each task, with the quantity that task works on beside it.
 */
export function QuantitySchedulePanel({
  analysis,
  settings,
  equipment,
  onEquipmentChange,
  alignment,
}: {
  /** The road, for its end haul (site names) and the equipment-hours sheet. */
  alignment?: Alignment
  analysis: RoadAnalysis
  settings: RoadSettings
  equipment: AssumedEquipment[]
  onEquipmentChange?: (next: AssumedEquipment[]) => void
}) {
  const lines = useMemo(() => quantitySchedule(analysis, settings), [analysis, settings])
  const endHaul = useMemo(
    () => (alignment ? endHaulSections(analysis, alignment, roadSidehill(analysis.stations)) : []),
    [alignment, analysis],
  )
  const fileStem =
    (alignment?.name ?? '')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 70) || 'road'
  const readOnly = !onEquipmentChange
  const update = (id: string, patch: Partial<AssumedEquipment>) =>
    onEquipmentChange?.(equipment.map((e) => (e.id === id ? { ...e, ...patch } : e)))
  const used = new Set(equipment.map((e) => e.task))
  const nextTask = EQUIPMENT_TASKS.find((t) => !used.has(t)) ?? EQUIPMENT_TASKS[0]
  return (
    <div className="grid gap-3" data-testid="road-quantity-schedule">
      <EngineeringTable>
        <thead>
          <tr>
            <ColumnHeader label="Item" className="text-left" />
            <ColumnHeader label="Quantity" />
            <ColumnHeader label="Unit" className="text-left" />
            <ColumnHeader label="Measured on" className="text-left" />
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id}>
              <td className="text-left">{l.item}</td>
              <td className="font-mono">{fmt(l.quantity, digitsFor(l.unit))}</td>
              <td className="text-left">{l.unit}</td>
              <td className="whitespace-normal text-left text-muted-foreground">{l.basis}</td>
            </tr>
          ))}
        </tbody>
      </EngineeringTable>
      <div className="grid gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium">Equipment assumed for moving material</p>
          <Button
            size="sm"
            variant="outline"
            disabled={readOnly || equipment.length >= MAX_ASSUMED_EQUIPMENT}
            onClick={() =>
              onEquipmentChange?.([...equipment, { id: crypto.randomUUID(), task: nextTask, equipment: '' }])
            }
          >
            <Plus aria-hidden="true" /> Add
          </Button>
        </div>
        {equipment.length ? (
          <EngineeringTable data-testid="road-equipment-table">
            <thead>
              <tr>
                <ColumnHeader label="Task" className="text-left" />
                <ColumnHeader label="Equipment" className="text-left" />
                <ColumnHeader label="Works on" />
                <ColumnHeader label="Notes" className="text-left" />
                <ColumnHeader label="" />
              </tr>
            </thead>
            <tbody>
              {equipment.map((e, index) => {
                const q = taskQuantity(e.task, lines)
                return (
                  <tr key={e.id}>
                    <td className="min-w-44 !p-0.5 text-left">
                      <RoadSelect
                        ariaLabel={`Equipment ${index + 1} task`}
                        className="h-7 w-full text-2xs"
                        disabled={readOnly}
                        value={e.task}
                        onValueChange={(task) => update(e.id, { task: task as EquipmentTask })}
                      >
                        {EQUIPMENT_TASKS.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </RoadSelect>
                    </td>
                    <td className="min-w-40 !p-0.5">
                      <TextCell
                        label={`Equipment ${index + 1} machine`}
                        value={e.equipment}
                        disabled={readOnly}
                        onCommit={(equipment) => update(e.id, { equipment })}
                      />
                    </td>
                    <td className="font-mono">{q ? `${fmt(q.quantity, digitsFor(q.unit))} ${q.unit}` : '—'}</td>
                    <td className="min-w-40 !p-0.5">
                      <TextCell
                        label={`Equipment ${index + 1} notes`}
                        value={e.notes ?? ''}
                        disabled={readOnly}
                        onCommit={(notes) => update(e.id, { notes: notes || undefined })}
                      />
                    </td>
                    <td className="!p-0.5 text-center">
                      <Button
                        size="icon-2xs"
                        variant="ghost"
                        className="text-muted-foreground hover:text-destructive [&_svg]:size-3.5"
                        disabled={readOnly}
                        aria-label={`Remove equipment ${index + 1}`}
                        onClick={() => onEquipmentChange?.(equipment.filter((x) => x.id !== e.id))}
                      >
                        <X aria-hidden="true" />
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </EngineeringTable>
        ) : (
          <p className="text-2xs text-muted-foreground">
            None entered. The Engineering Manual (§3.5.3) expects a geometric design to state the equipment assumed for
            moving material; add a machine for each task the design relies on.
          </p>
        )}
        <Button
          size="sm"
          variant="outline"
          className="justify-self-start"
          disabled={!alignment}
          title="The ECE Project Equipment Hours Summary laid out as CSV: road, stations and these machines filled in, dates and operating/standby hours left for the time cards"
          onClick={() =>
            alignment &&
            downloadText(
              equipmentHoursCsv({ roadName: alignment.name, analysis, station: formatRoadStation, equipment }),
              `${fileStem}-equipment-hours.csv`,
              'text/csv;charset=utf-8',
            )
          }
        >
          <Download aria-hidden="true" /> Equipment hours sheet
        </Button>
      </div>
      <div className="grid gap-1.5" data-testid="road-end-haul">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium">End haul</p>
          <Button
            size="sm"
            variant="outline"
            disabled={!endHaul.length}
            onClick={() =>
              downloadText(endHaulCsv(endHaul, formatRoadStation), `${fileStem}-end-haul.csv`, 'text/csv;charset=utf-8')
            }
          >
            <Download aria-hidden="true" /> CSV
          </Button>
        </div>
        {!analysis.engineering?.haul.enabled ? (
          <p className="text-2xs text-muted-foreground">
            Turn haul allocation on and enter spoil sites to set out end haul.
          </p>
        ) : endHaul.length ? (
          <EngineeringTable>
            <thead>
              <tr>
                <ColumnHeader label="From" className="text-left" />
                <ColumnHeader label="To" className="text-left" />
                <ColumnHeader label="Length" unit="m" />
                <ColumnHeader label="Bank" unit="m³" />
                <ColumnHeader label="Mean haul" unit="m" />
                <ColumnHeader label="To" className="text-left" />
                <ColumnHeader label="Steepest sidehill" unit="%" />
              </tr>
            </thead>
            <tbody>
              {endHaul.map((s) => (
                <tr key={s.start}>
                  <td className="text-left font-mono">{formatRoadStation(s.start)}</td>
                  <td className="text-left font-mono">{formatRoadStation(s.end)}</td>
                  <td
                    className={s.short ? 'text-warning' : undefined}
                    title={s.short ? `Shorter than ${END_HAUL_MIN_SECTION_M} m, or trucked under 10 m` : undefined}
                  >
                    {fmt(s.lengthM, 1)}
                  </td>
                  <td>{fmt(s.bankM3, 0)}</td>
                  <td>{fmt(s.meanHaulM, 0)}</td>
                  <td className="text-left">{s.destinations.join(', ')}</td>
                  <td>{fmt(s.steepestSidehillPercent, 0)}</td>
                </tr>
              ))}
            </tbody>
          </EngineeringTable>
        ) : (
          <p className="text-2xs text-muted-foreground">The haul plan trucks no cut off the road.</p>
        )}
        <p className="text-2xs text-muted-foreground">
          Cut trucked to a waste site (never side-cast) or moved in the end-haul class. The Coast ECE procedures (Type
          6, 2025) count end haul where material is trucked at least 10 m because it cannot be side-cast: downslope over
          55%, a sensitive site, or unstable terrain (Interior: 60% or a sensitive site). The reason is yours to state;
          the report lists the evidence they ask for.
        </p>
      </div>
    </div>
  )
}
