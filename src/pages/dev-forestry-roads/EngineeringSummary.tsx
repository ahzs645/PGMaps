import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { StatGroup } from '@/components/ui/stat-group'
import { TabBar } from '@/components/ui/tab-bar'
import { formatRoadStation } from './Charts'
import type { CulvertAnalysis, RoadAnalysis, RoadSettings } from './types'

const fmt = (value: number | null | undefined, digits = 1) =>
  value == null || !Number.isFinite(value) ? '—' : value.toLocaleString('en-CA', { maximumFractionDigits: digits })

function CulvertProfile({ culvert }: { culvert: CulvertAnalysis }) {
  const samples = culvert.profile
  const values = samples
    .flatMap((s) => [s.groundElevation, s.formationElevation, s.invertElevation, s.crownElevation])
    .filter((v): v is number => v !== null && Number.isFinite(v))
  if (!values.length || samples.length < 2)
    return <p className="text-xs text-muted-foreground">No sampled culvert profile.</p>
  const min = Math.min(...values) - 0.5,
    max = Math.max(...values) + 0.5,
    length = samples[samples.length - 1].distanceM
  const x = (distance: number) => 48 + (distance / Math.max(1, length)) * 580
  const y = (value: number) => 160 - ((value - min) / Math.max(1, max - min)) * 132
  const path = (field: 'groundElevation' | 'formationElevation' | 'invertElevation' | 'crownElevation') => {
    let pen = false
    return samples
      .map((s) => {
        const v = s[field]
        if (v === null || !Number.isFinite(v)) {
          pen = false
          return ''
        }
        const command = pen ? 'L' : 'M'
        pen = true
        return `${command}${x(s.distanceM)},${y(v)}`
      })
      .join(' ')
  }
  return (
    <div className="rounded border p-2" data-testid="culvert-profile">
      <p className="text-xs font-medium">{culvert.name} · along-barrel profile</p>
      <svg viewBox="0 0 650 195" className="w-full" role="img" aria-label={`Culvert profile for ${culvert.name}`}>
        <path d="M48 20V160H628" fill="none" stroke="#94a3b8" />
        {(['groundElevation', 'formationElevation', 'invertElevation', 'crownElevation'] as const).map(
          (field, index) => (
            <path
              key={field}
              d={path(field)}
              stroke={['#a07845', '#d97706', '#2563eb', '#2563eb'][index]}
              strokeWidth={index === 0 ? 2 : 3}
              strokeDasharray={index === 3 ? '4 3' : undefined}
              fill="none"
            />
          ),
        )}
        <g fontSize="11" fill="currentColor">
          <text x="2" y="30">
            {fmt(max)} m
          </text>
          <text x="2" y="160">
            {fmt(min)} m
          </text>
          <text x="48" y="180">
            Left inlet · 0 m
          </text>
          <text x="628" y="180" textAnchor="end">
            Right outlet · {fmt(length)} m
          </text>
        </g>
      </svg>
      <p className="text-[11px] text-muted-foreground">
        Brown: original ground · orange: sampled formation · blue: invert / crown. Pipe lengths and elevations follow
        the recorded structure geometry.
      </p>
    </div>
  )
}

export function EngineeringSummary({
  analysis,
  settings,
  station,
  onStation,
  onExport,
  selectedCulvertId,
  onSelectCulvert,
}: {
  analysis: RoadAnalysis
  settings: RoadSettings
  station: number
  onStation: (station: number) => void
  onExport: () => void
  selectedCulvertId?: string
  onSelectCulvert?: (id: string) => void
}) {
  const [tab, setTab] = useState<'cost' | 'materials' | 'haul' | 'structures'>('cost')
  const [page, setPage] = useState(0)
  const result = analysis.engineering
  const costs = result?.costs
  const rows: [string, number][] = costs
    ? [
        ['Classified / unclassified excavation', costs.cut],
        ['Excavated stripping', costs.stripping],
        ['Fill placement', costs.fill],
        ['Surfacing', costs.surfacing],
        ['Clearing', costs.clearing],
        ['Structures', costs.structures],
        ['Haul', costs.haul],
        ['Borrow supply', costs.borrow],
        ['Waste disposal', costs.waste],
        ['Site preparation', costs.sitePreparation],
        ['Mobilization', costs.mobilization],
        ['Subtotal', costs.subtotal],
        ['Contingency', costs.contingency],
        ['Total', costs.total],
      ]
    : [
        ['Excavation', analysis.cutVolumeM3 * settings.cutRate],
        ['Fill placement', analysis.fillVolumeM3 * settings.fillRate],
        ['Surfacing', analysis.surfaceVolumeM3 * settings.surfacingRate],
        ['Clearing', analysis.clearingAreaM2 * settings.clearingRate],
        ['Total', analysis.estimatedCost],
      ]
  const selectedCulvert =
    result?.culverts.find((c) => c.id === selectedCulvertId) ??
    result?.culverts.reduce<CulvertAnalysis | null>(
      (best, c) => (!best || Math.abs(c.chainage - station) < Math.abs(best.chainage - station) ? c : best),
      null,
    )
  const movements = result?.movements ?? []
  const pageCount = Math.ceil(movements.length / 100)
  const currentPage = Math.min(page, Math.max(0, pageCount - 1))
  if (!analysis.stations.length)
    return (
      <InlineAlert tone="error">
        Engineering quantities are unavailable. Resolve the model errors before reviewing or exporting results.
      </InlineAlert>
    )
  return (
    <div className="flex h-full min-h-0 flex-col gap-2" data-testid="road-engineering-summary">
      <div className="flex items-center justify-between gap-1">
        <TabBar
          label="Engineering results"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'cost', label: 'Cost' },
            { value: 'materials', label: 'Materials' },
            { value: 'haul', label: 'Haul' },
            { value: 'structures', label: 'Structures' },
          ]}
        />
        <Button size="sm" variant="outline" onClick={onExport}>
          CSV
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {result && !result.complete && analysis.coveragePercent >= 99.999 && (
          <InlineAlert tone="warning">
            Terrain sections are covered; engineering checks remain incomplete. Review structure inputs, station ranges
            and unallocated haul.
          </InlineAlert>
        )}
        {analysis.coveragePercent < 99.999 && (
          <InlineAlert tone="warning">
            Covered subtotals · {fmt(analysis.coveragePercent)}% complete. Unsupported intervals are excluded.
          </InlineAlert>
        )}
        {tab === 'cost' && (
          <>
            <table className="w-full text-xs" data-testid="road-cost-breakdown">
              <thead>
                <tr>
                  <th className="border-b p-2 text-left">Cost item</th>
                  <th className="border-b p-2 text-right">CAD</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([label, value]) => (
                  <tr key={label} className={label === 'Total' ? 'bg-emerald-600/10 font-semibold' : ''}>
                    <td className="border-b p-2">{label}</td>
                    <td className="border-b p-2 text-right font-mono">${fmt(value, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Entered rates and supported quantities define this estimate. Zero rates are unpriced work. Ground-material
              excavation replaces the default cut rate only where a horizon is assigned.
            </p>
          </>
        )}
        {tab === 'materials' && (
          <>
            <StatGroup
              variant="tiles"
              size="sm"
              items={[
                {
                  label: 'Usable compacted cut',
                  value: `${fmt(result?.usableCutM3 ?? analysis.cutVolumeM3 * settings.shrinkFactor)} m³`,
                },
                { label: 'Unusable bank cut', value: `${fmt(result?.unusableCutM3 ?? 0)} m³` },
                { label: 'Excavated stripping', value: `${fmt(result?.strippingCutM3 ?? 0)} m³` },
              ]}
            />
            <table className="mt-2 w-full whitespace-nowrap text-right text-xs">
              <thead>
                <tr>
                  {['Material', 'Bank cut m³', 'Usable compacted m³', 'Unusable bank m³', 'Excavation CAD'].map((h) => (
                    <th key={h} className="border-b p-2">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result?.materials.map((m) => (
                  <tr key={m.materialId}>
                    <td className="border-b p-2 text-left">
                      <span style={{ background: m.color }} className="mr-1 inline-block size-2 rounded-sm" />
                      {m.name}
                      {m.purpose === 'stripping' ? ' · stripping' : ''}
                    </td>
                    {[m.bankCutM3, m.usableCompactedM3, m.unusableBankM3, m.excavationCost].map((v, i) => (
                      <td key={i} className="border-b p-2">
                        {fmt(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {!result && (
              <p className="mt-3 text-xs text-muted-foreground">
                Define ground materials and station/depth horizons in Engineering → Ground to classify excavation.
              </p>
            )}
          </>
        )}
        {tab === 'haul' && (
          <>
            {!result?.haul.enabled ? (
              <p className="p-3 text-sm text-muted-foreground">
                Enable haul allocation in Engineering → Haul to assign material transfers, borrow and waste.
              </p>
            ) : (
              <>
                <StatGroup
                  variant="tiles"
                  size="sm"
                  items={[
                    { label: 'Borrow · compacted', value: `${fmt(result.haul.borrowCompactedM3)} m³` },
                    { label: 'Waste · bank', value: `${fmt(result.haul.wasteBankM3)} m³` },
                    { label: 'Cut/fill + borrow haul', value: `${fmt(result.haul.haulM3Km)} compacted m³·km` },
                    { label: 'Waste haul', value: `${fmt(result.haul.wasteHaulM3Km)} bank m³·km` },
                  ]}
                />
                {(result.haul.unallocatedBorrowM3 > 0 || result.haul.unallocatedWasteM3 > 0) && (
                  <p role="status" className="my-2 text-xs text-amber-700 dark:text-amber-400">
                    Unallocated: {fmt(result.haul.unallocatedBorrowM3)} compacted m³ borrow ·{' '}
                    {fmt(result.haul.unallocatedWasteM3)} bank m³ waste. Adjust site capacities or add sites.
                  </p>
                )}
                <div className="my-2 flex items-center justify-between text-xs">
                  <span>
                    {movements.length} transfers · page {currentPage + 1}/{Math.max(1, pageCount)}
                  </span>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={currentPage === 0}
                      onClick={() => setPage(currentPage - 1)}
                    >
                      Previous
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={currentPage + 1 >= pageCount}
                      onClick={() => setPage(currentPage + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
                <table className="w-full whitespace-nowrap text-right text-xs" data-testid="road-haul-transfers">
                  <thead>
                    <tr>
                      {['Type', 'From', 'To', 'Distance m', 'Volume m³', 'Basis', 'Haul class', 'Haul CAD'].map((h) => (
                        <th key={h} className="border-b p-2">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {movements.slice(currentPage * 100, (currentPage + 1) * 100).map((m) => (
                      <tr key={m.id}>
                        <td className="border-b p-2 text-left">{m.kind}</td>
                        <td className="border-b p-2">
                          <button className="underline" onClick={() => onStation(m.fromChainage)}>
                            {formatRoadStation(m.fromChainage)}
                          </button>
                        </td>
                        <td className="border-b p-2">
                          <button className="underline" onClick={() => onStation(m.toChainage)}>
                            {formatRoadStation(m.toChainage)}
                          </button>
                        </td>
                        {[
                          fmt(m.distanceM),
                          fmt(m.transportedVolumeM3),
                          m.volumeBasis,
                          m.category,
                          fmt(m.haulCost, 2),
                        ].map((v, i) => (
                          <td key={i} className="border-b p-2">
                            {v}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </>
        )}
        {tab === 'structures' && (
          <>
            {result?.culverts.length ? (
              <>
                <table className="w-full whitespace-nowrap text-right text-xs">
                  <thead>
                    <tr>
                      {[
                        'Structure',
                        'Station',
                        'Grade %',
                        'Cover m',
                        'Required span m',
                        'Inclined barrel m',
                        'Cost CAD',
                      ].map((h) => (
                        <th key={h} className="border-b p-2">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.culverts.map((c) => (
                      <tr key={c.id} className={c.id === selectedCulvert?.id ? 'bg-blue-600/10' : ''}>
                        <td className="border-b p-2 text-left">
                          <button
                            className="underline"
                            aria-pressed={selectedCulvert?.id === c.id}
                            onClick={() => {
                              onSelectCulvert?.(c.id)
                              onStation(c.chainage)
                            }}
                          >
                            {c.name}
                          </button>
                        </td>
                        <td className="border-b p-2">{formatRoadStation(c.chainage)}</td>
                        {[c.gradePercent, c.coverM, c.requiredLengthM, c.barrelLengthM, c.installedCost].map((v, i) => (
                          <td key={i} className="border-b p-2">
                            {fmt(v)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {selectedCulvert && (
                  <div className="mt-2 space-y-2">
                    <CulvertProfile culvert={selectedCulvert} />
                    {selectedCulvert.warnings.map((warning) => (
                      <p key={warning} className="text-xs text-amber-700 dark:text-amber-400">
                        {warning}
                      </p>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="p-3 text-sm text-muted-foreground">
                Add a culvert at a road station or stream crossing in Engineering → Drainage.
              </p>
            )}
          </>
        )}
        {result?.warnings.map((warning, index) => (
          <p key={index} className="mt-2 border-l-2 border-amber-500 pl-2 text-[11px]">
            {warning}
          </p>
        ))}
      </div>
    </div>
  )
}
