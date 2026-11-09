import { Plus, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import {
  ColumnHeader,
  EngineeringTable,
  engineeringCellInputClass,
  engineeringPinnedColumnClass,
} from '@/components/ui/engineering-table'
import { TabBar } from '@/components/ui/tab-bar'
import { NumberField } from './Controls'
import { nearestStation, verticalCurveSummary } from './engine'
import { verticalFitNote } from './curveFit'
import { CurveReviewPanel } from './CurveReviewPanel'
import { SweptPathPanel } from './SweptPathPanel'
import type { SweptManeuver, SweptPathResult } from './sweptPath'
import type { Alignment, RoadAnalysis, TerrainMetadata, VehicleCheck, VerticalPoint } from './types'

export interface SweptPathProps {
  result: SweptPathResult | null
  error: string
  onChange?: (check: VehicleCheck | undefined) => void
  showOnPlan: boolean
  onShowOnPlan: (show: boolean) => void
  /** Frame a turn on the plan and select its governing station. */
  onFocus?: (turn: SweptManeuver) => void
}

const fmt = (value: number | null | undefined) => (value == null ? '—' : value.toFixed(2))
/** A schedule cell's input reads as table text until it is hovered or focused, like a spreadsheet cell. */
const cellInput = engineeringCellInputClass
/** Only this column stays put when the table scrolls sideways, so a row can always be identified. */
const pinned = engineeringPinnedColumnClass
export function DesignSchedules({
  alignment,
  analysis,
  station,
  onStation,
  onVerticalChange,
  children,
  terrainOnly = false,
  terrain,
  swept,
}: {
  alignment: Alignment
  analysis: RoadAnalysis
  station: number
  onStation: (s: number) => void
  onVerticalChange?: (points: VerticalPoint[]) => void
  children: ReactNode
  terrainOnly?: boolean
  terrain?: TerrainMetadata
  swept?: SweptPathProps
}) {
  const [tab, setTab] = useState<'sampled' | 'horizontal' | 'vertical' | 'swept'>('sampled')
  const failingTurns = new Set(swept?.result?.maneuvers.filter((t) => !t.fits).map((t) => t.id)).size
  let vertical: ReturnType<typeof verticalCurveSummary> = []
  try {
    vertical = verticalCurveSummary(alignment)
  } catch {
    /* Invalid intermediate geometry is reported by the workspace. */
  }
  const at = nearestStation(analysis.stations, station)
  const update = (id: string, patch: Partial<VerticalPoint>) =>
    onVerticalChange?.(
      alignment.vertical.map((v) => (v.id === id ? { ...v, ...patch } : v)).sort((a, b) => a.chainage - b.chainage),
    )
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <TabBar
        label="Road data schedule"
        stretch
        value={terrainOnly ? 'sampled' : tab}
        onChange={setTab}
        // Short labels keep all four tabs on one row at phone widths; names stay descriptive.
        options={[
          { value: 'sampled', label: 'Samples' },
          { value: 'horizontal', label: 'Curves', ariaLabel: 'Horizontal curves', disabled: terrainOnly },
          { value: 'vertical', label: 'Vertical', ariaLabel: 'Vertical controls', disabled: terrainOnly },
          ...(swept
            ? [
                {
                  value: 'swept' as const,
                  label: 'Swept path',
                  ariaLabel: failingTurns
                    ? `Swept path, ${failingTurns} turn${failingTurns === 1 ? ' needs' : 's need'} widening`
                    : 'Swept path',
                  badge: failingTurns ? (
                    <span className="rounded-full bg-red-600 px-1.5 text-3xs text-white">{failingTurns}</span>
                  ) : undefined,
                  disabled: terrainOnly,
                },
              ]
            : []),
        ]}
      />
      <div className="min-h-0 flex-1">
        {(tab === 'sampled' || terrainOnly) && children}
        {tab === 'horizontal' && !terrainOnly && (
          <CurveReviewPanel
            alignment={alignment}
            analysis={analysis}
            station={station}
            onStation={onStation}
            terrain={terrain}
            swept={swept?.result ?? null}
            onOpenSwept={swept ? () => setTab('swept') : undefined}
          />
        )}
        {tab === 'swept' && swept && !terrainOnly && (
          <div className="h-full overflow-auto overscroll-contain">
            <SweptPathPanel
              check={alignment.vehicleCheck}
              result={swept.result}
              error={swept.error}
              onChange={swept.onChange}
              onStation={onStation}
              showOnPlan={swept.showOnPlan}
              onShowOnPlan={swept.onShowOnPlan}
              onFocus={swept.onFocus}
            />
          </div>
        )}
        {tab === 'vertical' && !terrainOnly && (
          <div className="flex h-full min-h-0 flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 w-fit px-2"
                disabled={!onVerticalChange || at?.designElevation == null || alignment.vertical.length >= 500}
                onClick={() => {
                  if (at?.designElevation == null) return
                  onVerticalChange?.(
                    [
                      ...alignment.vertical.filter((v) => Math.abs(v.chainage - at.chainage) > 0.001),
                      {
                        id: crypto.randomUUID(),
                        chainage: at.chainage,
                        elevation: at.designElevation,
                        curveLength: 0,
                      },
                    ].sort((a, b) => a.chainage - b.chainage),
                  )
                }}
              >
                <Plus aria-hidden="true" />
                Add control at selected station
              </Button>
              <span className="shrink-0 text-2xs text-muted-foreground">
                {alignment.vertical.length} control{alignment.vertical.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <EngineeringTable data-testid="road-vertical-control-table">
                <thead className="sticky top-0 z-10">
                  <tr>
                    {[
                      ['PVI', ''],
                      ['L-Stn', 'm'],
                      ['Elevation', 'm'],
                      ['VC length', 'm'],
                      ['Grade in', '%'],
                      ['Grade out', '%'],
                      ['K', 'm/%'],
                      ['Status', ''],
                      ['', ''],
                    ].map(([label, unit], i) => (
                      <ColumnHeader
                        key={i}
                        label={label}
                        unit={unit}
                        className={i === 0 ? `${pinned} z-20 text-left` : undefined}
                      />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {alignment.vertical.map((v, index) => {
                    const curve = vertical.find((c) => c.pviId === v.id)
                    const previous = alignment.vertical[index - 1],
                      next = alignment.vertical[index + 1]
                    const incoming = previous
                      ? (100 * (v.elevation - previous.elevation)) / (v.chainage - previous.chainage)
                      : null
                    const outgoing = next ? (100 * (next.elevation - v.elevation)) / (next.chainage - v.chainage) : null
                    const status = curve?.valid ? 'Fitted' : v.curveLength > 0 ? 'Unfitted' : 'Tangent'
                    return (
                      <tr key={v.id} className="group" aria-selected={Math.abs(v.chainage - station) < 0.001}>
                        <td
                          className={`${pinned} bg-background text-left group-aria-selected:bg-rose-100 dark:group-aria-selected:bg-rose-950`}
                        >
                          <button
                            className="font-mono underline decoration-dotted"
                            onClick={() => onStation(v.chainage)}
                          >
                            V{index + 1}
                          </button>
                        </td>
                        {(['chainage', 'elevation', 'curveLength'] as const).map((key) => (
                          <td key={key} className="min-w-20 !p-0.5">
                            <NumberField
                              label={`Schedule PVI ${index + 1} ${key}`}
                              hideLabel
                              value={v[key]}
                              min={key === 'elevation' ? -12000 : 0}
                              max={key === 'elevation' ? 12000 : key === 'curveLength' ? 10000 : 100000}
                              precision={2}
                              fixedDecimals
                              inputClassName={cellInput}
                              disabled={!onVerticalChange}
                              onChange={(value) => update(v.id, { [key]: value })}
                            />
                          </td>
                        ))}
                        <td>{fmt(incoming)}</td>
                        <td>{fmt(outgoing)}</td>
                        <td>{fmt(curve?.k)}</td>
                        <td
                          className={`text-left ${status === 'Unfitted' ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`}
                          title={
                            status === 'Tangent'
                              ? 'Tangent break: no vertical curve'
                              : (verticalFitNote(curve) ?? undefined)
                          }
                        >
                          {status}
                        </td>
                        <td className="!p-0.5 text-center">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-6 text-muted-foreground hover:text-destructive [&_svg]:size-3.5"
                            disabled={!onVerticalChange}
                            aria-label={`Remove schedule PVI ${index + 1}`}
                            title={`Remove V${index + 1}`}
                            onClick={() => onVerticalChange?.(alignment.vertical.filter((p) => p.id !== v.id))}
                          >
                            <X aria-hidden="true" />
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </EngineeringTable>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
