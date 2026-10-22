import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { TabBar } from '@/components/ui/tab-bar'
import { NumberField } from './Controls'
import { formatRoadStation } from './Charts'
import { horizontalCurveSummary, nearestStation, verticalCurveSummary } from './engine'
import type { Alignment, RoadAnalysis, VerticalPoint } from './types'

const fmt = (value: number | null | undefined) => (value == null ? '—' : value.toFixed(2))
export function DesignSchedules({
  alignment,
  analysis,
  station,
  onStation,
  onVerticalChange,
  children,
  terrainOnly = false,
}: {
  alignment: Alignment
  analysis: RoadAnalysis
  station: number
  onStation: (s: number) => void
  onVerticalChange?: (points: VerticalPoint[]) => void
  children: ReactNode
  terrainOnly?: boolean
}) {
  const [tab, setTab] = useState<'sampled' | 'horizontal' | 'vertical'>('sampled')
  let horizontal: ReturnType<typeof horizontalCurveSummary> = [],
    vertical: ReturnType<typeof verticalCurveSummary> = []
  try {
    horizontal = horizontalCurveSummary(alignment)
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
        value={terrainOnly ? 'sampled' : tab}
        onChange={setTab}
        options={[
          { value: 'sampled', label: 'Samples' },
          { value: 'horizontal', label: 'Horizontal curves', disabled: terrainOnly },
          { value: 'vertical', label: 'Vertical controls', disabled: terrainOnly },
        ]}
      />
      <div className="min-h-0 flex-1">
        {(tab === 'sampled' || terrainOnly) && children}
        {tab === 'horizontal' && !terrainOnly && (
          <div className="h-full overflow-auto">
            <table className="w-full whitespace-nowrap text-right text-xs" data-testid="road-horizontal-curve-table">
              <thead>
                <tr>
                  {['Curve', 'Start', 'End', 'Radius m', 'Arc length m'].map((h) => (
                    <th key={h} className="border-b p-2">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {horizontal.map((c, index) => (
                  <tr key={c.start}>
                    <td className="border-b p-2">
                      <button className="underline" onClick={() => onStation((c.start + c.end) / 2)}>
                        H{index + 1}
                      </button>
                    </td>
                    <td className="border-b p-2">
                      <button className="underline" onClick={() => onStation(c.start)}>
                        {formatRoadStation(c.start)}
                      </button>
                    </td>
                    <td className="border-b p-2">
                      <button className="underline" onClick={() => onStation(c.end)}>
                        {formatRoadStation(c.end)}
                      </button>
                    </td>
                    <td className="border-b p-2">{fmt(c.radius)}</td>
                    <td className="border-b p-2">{fmt(c.length)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!horizontal.length && (
              <p className="p-3 text-xs text-muted-foreground">
                No fitted horizontal curves. Add an interior PI radius in Design; the requested radius must fit its
                neighboring tangents.
              </p>
            )}
            {analysis.warnings
              .filter((w) => /curve|radius|horizontal PI/i.test(w))
              .map((w) => (
                <p key={w} className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                  {w}
                </p>
              ))}
          </div>
        )}
        {tab === 'vertical' && !terrainOnly && (
          <div className="flex h-full min-h-0 flex-col gap-2">
            <Button
              size="sm"
              variant="outline"
              className="w-fit"
              disabled={!onVerticalChange || at?.designElevation == null || alignment.vertical.length >= 500}
              onClick={() => {
                if (at?.designElevation == null) return
                onVerticalChange?.(
                  [
                    ...alignment.vertical.filter((v) => Math.abs(v.chainage - at.chainage) > 0.001),
                    { id: crypto.randomUUID(), chainage: at.chainage, elevation: at.designElevation, curveLength: 0 },
                  ].sort((a, b) => a.chainage - b.chainage),
                )
              }}
            >
              Add control at selected station
            </Button>
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full whitespace-nowrap text-right text-xs" data-testid="road-vertical-control-table">
                <thead>
                  <tr>
                    {[
                      'PVI',
                      'Station m',
                      'Elevation m',
                      'Curve length m',
                      'Incoming %',
                      'Outgoing %',
                      'K m/%',
                      'Status',
                      '',
                    ].map((h, i) => (
                      <th key={i} className="border-b p-2">
                        {h}
                      </th>
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
                    return (
                      <tr key={v.id} className="border-b">
                        <td className="p-2">
                          <button className="underline" onClick={() => onStation(v.chainage)}>
                            V{index + 1}
                          </button>
                        </td>
                        {(['chainage', 'elevation', 'curveLength'] as const).map((key) => (
                          <td key={key} className="min-w-28 p-1">
                            <NumberField
                              label={`Schedule PVI ${index + 1} ${key}`}
                              value={v[key]}
                              min={key === 'elevation' ? -12000 : 0}
                              max={key === 'elevation' ? 12000 : key === 'curveLength' ? 10000 : 100000}
                              disabled={!onVerticalChange}
                              onChange={(value) => update(v.id, { [key]: value })}
                            />
                          </td>
                        ))}
                        <td className="p-2">{fmt(incoming)}</td>
                        <td className="p-2">{fmt(outgoing)}</td>
                        <td className="p-2">{fmt(curve?.k)}</td>
                        <td className="p-2">
                          {curve?.valid ? 'Fitted' : v.curveLength > 0 ? 'Unfitted' : 'Tangent break'}
                        </td>
                        <td className="p-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={!onVerticalChange}
                            aria-label={`Remove schedule PVI ${index + 1}`}
                            onClick={() => onVerticalChange?.(alignment.vertical.filter((p) => p.id !== v.id))}
                          >
                            Remove
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
