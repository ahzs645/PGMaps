import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { InlineAlert } from '@/components/ui/map-panels'
import { StatGroup } from '@/components/ui/stat-group'
import { TabBar } from '@/components/ui/tab-bar'
import { hasCompleteCoverage } from './analysisResult'
import { materialPlanMissing } from './engineeringTypes'
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
      <p className="text-2xs text-muted-foreground">
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
  const noPlan = result && materialPlanMissing(result.haul) ? 'Not calculated' : null
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
      <div className="min-h-0 flex-1 space-y-3 overflow-auto overscroll-none">
        {result && !result.complete && hasCompleteCoverage(analysis) && (
          <InlineAlert tone="warning">
            Terrain sections are covered; engineering checks remain incomplete. Review structure inputs, station ranges
            and unallocated haul.
          </InlineAlert>
        )}
        {!hasCompleteCoverage(analysis) && (
          <InlineAlert tone="warning">
            Covered subtotals · {fmt(analysis.coveragePercent)}% complete. Unsupported intervals are excluded.
          </InlineAlert>
        )}
        {tab === 'cost' && (
          <>
            <EngineeringTable data-testid="road-cost-breakdown">
              <thead>
                <tr>
                  <ColumnHeader label="Cost item" className="text-left" />
                  <ColumnHeader label="CAD" />
                </tr>
              </thead>
              <tbody>
                {rows.map(([label, value]) => (
                  <tr key={label} className={label === 'Total' ? '!bg-emerald-600/10 font-semibold' : ''}>
                    <td className="text-left">{label}</td>
                    <td className="font-mono">${fmt(value, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </EngineeringTable>
            <p className="mt-2 text-2xs text-muted-foreground">
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
                // Rock quantities appear once a ground material is marked rock.
                ...(result?.rock
                  ? [
                      { label: 'Rock cut', value: `${fmt(result.rock.cutM3)} m³` },
                      {
                        label: 'Shallow rock',
                        value: `${fmt(result.rock.shallowM3)} m³ · ${fmt(result.rock.shallowAreaM2)} m²`,
                      },
                      {
                        label: 'Overbreak',
                        value: `${fmt(result.rock.deepM3)} m³ · swell ${fmt(result.rock.swellM3)} m³`,
                      },
                      { label: 'Common excavation', value: `${fmt(result.rock.commonM3)} m³` },
                    ]
                  : []),
              ]}
            />
            <EngineeringTable className="mt-2">
              <thead>
                <tr>
                  <ColumnHeader label="Material" className="text-left" />
                  <ColumnHeader label="Bank cut" unit="m³" />
                  <ColumnHeader label="Usable compacted" unit="m³" />
                  <ColumnHeader label="Unusable bank" unit="m³" />
                  <ColumnHeader label="Excavation" unit="CAD" />
                </tr>
              </thead>
              <tbody>
                {result?.materials.map((m) => (
                  <tr key={m.materialId}>
                    <td className="text-left">
                      <span style={{ background: m.color }} className="mr-1 inline-block size-2 rounded-sm" />
                      {m.name}
                      {m.purpose === 'stripping' ? ' · stripping' : ''}
                    </td>
                    {[m.bankCutM3, m.usableCompactedM3, m.unusableBankM3, m.excavationCost].map((v, i) => (
                      <td key={i}>{fmt(v)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </EngineeringTable>
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
                <p className="my-2 text-xs" role="status" data-testid="road-haul-allocation-status">
                  {result.haul.optimizationStatus === 'unsolved'
                    ? 'Material plan not solved · no movement cost adopted'
                    : result.haul.allocationMethod === 'economic'
                      ? result.haul.optimizationStatus === 'optimal'
                        ? 'Economic material flow · optimal within the entered model'
                        : result.haul.optimizationStatus === 'infeasible'
                          ? 'Material prescription infeasible · no movement cost adopted'
                          : 'Internal or disabled material plan · external supply not resolved'
                      : 'Nearest-source material scenario'}
                  {(result.haul.sidecastBankM3 ?? 0) > 0 &&
                    ` · ${fmt(result.haul.sidecastBankM3)} bank m³ permitted sidecast`}
                </p>
                <StatGroup
                  variant="tiles"
                  size="sm"
                  items={[
                    // A plan that was not adopted has no quantities; a zero here would read as a result.
                    { label: 'Borrow · compacted', value: noPlan ?? `${fmt(result.haul.borrowCompactedM3)} m³` },
                    { label: 'Waste · bank', value: noPlan ?? `${fmt(result.haul.wasteBankM3)} m³` },
                    {
                      label: 'Cut/fill + borrow haul',
                      value: noPlan ?? `${fmt(result.haul.haulM3Km)} compacted m³·km`,
                    },
                    { label: 'Waste haul', value: noPlan ?? `${fmt(result.haul.wasteHaulM3Km)} bank m³·km` },
                  ]}
                />
                {(result.haul.unallocatedBorrowM3 > 0 || result.haul.unallocatedWasteM3 > 0) && (
                  <p role="status" className="my-2 text-xs text-warning">
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
                <EngineeringTable data-testid="road-haul-transfers">
                  <thead>
                    <tr>
                      <ColumnHeader label="Type" className="text-left" />
                      <ColumnHeader label="From" />
                      <ColumnHeader label="To" />
                      <ColumnHeader label="Distance" unit="m" />
                      <ColumnHeader label="Volume" unit="m³" />
                      <ColumnHeader label="Basis" />
                      <ColumnHeader label="Haul class" />
                      <ColumnHeader label="Haul" unit="CAD" />
                    </tr>
                  </thead>
                  <tbody>
                    {movements.slice(currentPage * 100, (currentPage + 1) * 100).map((m) => (
                      <tr key={m.id}>
                        <td className="text-left">
                          {m.externalUnresolved
                            ? 'unresolved external'
                            : m.disposalMethod === 'sidecast'
                              ? 'sidecast'
                              : m.kind}
                          {m.demandLayer ? ` · ${m.demandLayer}` : ''}
                        </td>
                        <td>
                          <button className="underline" onClick={() => onStation(m.fromChainage)}>
                            {formatRoadStation(m.fromChainage)}
                          </button>
                        </td>
                        <td>
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
                          <td key={i}>{v}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </EngineeringTable>
              </>
            )}
          </>
        )}
        {tab === 'structures' && (
          <>
            {result?.culverts.length ? (
              <>
                <EngineeringTable>
                  <thead>
                    <tr>
                      <ColumnHeader label="Structure" className="text-left" />
                      <ColumnHeader label="Station" />
                      <ColumnHeader label="Grade" unit="%" />
                      <ColumnHeader label="Cover" unit="m" />
                      <ColumnHeader label="Required span" unit="m" />
                      <ColumnHeader label="Inclined barrel" unit="m" />
                      <ColumnHeader label="Cost" unit="CAD" />
                    </tr>
                  </thead>
                  <tbody>
                    {result.culverts.map((c) => (
                      <tr key={c.id} aria-selected={c.id === selectedCulvert?.id}>
                        <td className="text-left">
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
                        <td>{formatRoadStation(c.chainage)}</td>
                        {[c.gradePercent, c.coverM, c.requiredLengthM, c.barrelLengthM, c.installedCost].map((v, i) => (
                          <td key={i}>{fmt(v)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </EngineeringTable>
                {selectedCulvert && (
                  <div className="mt-2 space-y-2">
                    <CulvertProfile culvert={selectedCulvert} />
                    {selectedCulvert.warnings.map((warning) => (
                      <p key={warning} className="text-xs text-warning">
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
          <p key={index} className="mt-2 border-l-2 border-amber-500 pl-2 text-2xs">
            {warning}
          </p>
        ))}
      </div>
    </div>
  )
}
