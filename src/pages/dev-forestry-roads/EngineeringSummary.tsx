import { useState } from 'react'
import { ROAD_TOUR_ANCHORS } from './tours/roadTour'
import { Button } from '@/components/ui/button'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { InlineAlert } from '@/components/ui/map-panels'
import { StatGroup } from '@/components/ui/stat-group'
import { TabBar } from '@/components/ui/tab-bar'
import { hasCompleteCoverage } from './analysisResult'
import { materialPlanMissing } from './engineeringTypes'
import { formatRoadStation } from './Charts'
import type { Alignment, Culvert, CulvertAnalysis, RoadAnalysis, RoadSettings, RoadStation } from './types'
import { requiredCoverM } from './culverts/culvertChecks'
import { bandPath, culvertLongSection, fixed, runsPath } from './culvertLongSection'
import { insetBox } from '@/components/ui/inset-box'
import { QuantitySchedulePanel } from './QuantitySchedulePanel'
import { ReviewCharts } from './ReviewChartsPanel'
import type { AssumedEquipment } from './quantitySchedule'

const fmt = (value: number | null | undefined, digits = 1) =>
  value == null || !Number.isFinite(value) ? '—' : value.toLocaleString('en-CA', { maximumFractionDigits: digits })

const LONG_SECTION = { width: 650, height: 230, left: 56, right: 22, top: 22, bottom: 44 }
const LONG_SECTION_COLORS = {
  ground: '#a07845',
  surface: '#d97706',
  barrel: '#2563eb',
  minimumCover: '#e11d48',
  fill: '#d97706',
}

/**
 * The culvert's own long section along its barrel, left inlet to right outlet: ground, the road's
 * design surface and fill over the barrel, the barrel, the manual's minimum-cover line and the
 * least-cover point. Every figure is the engine's (`CulvertAnalysis`) or the manual's
 * (`requiredCoverM`); the geometry is `culvertLongSection.ts`.
 */
function CulvertProfile({
  culvert,
  design,
  stations,
}: {
  culvert: CulvertAnalysis
  design?: Culvert
  stations: readonly RoadStation[]
}) {
  // The analysed sections either side of the culvert's station.
  let before: RoadStation | undefined, after: RoadStation | undefined
  for (const s of stations) {
    if (s.chainage <= culvert.chainage && (!before || s.chainage > before.chainage)) before = s
    if (s.chainage >= culvert.chainage && (!after || s.chainage < after.chainage)) after = s
  }
  const bracket = [...new Set([before, after].filter((s): s is RoadStation => !!s))]
  const required = design ? requiredCoverM(design) : null
  const drawing = culvertLongSection(culvert, bracket, required ?? 0)
  if (!drawing) return <p className="text-xs text-muted-foreground">No sampled culvert profile.</p>
  const { width, height, left, right, top, bottom } = LONG_SECTION
  const plotWidth = width - left - right,
    plotHeight = height - top - bottom
  const x = (distance: number) => left + (distance / Math.max(1e-6, drawing.lengthM)) * plotWidth
  const y = (value: number) => top + plotHeight - ((value - drawing.minM) / (drawing.maxM - drawing.minM)) * plotHeight
  const exaggeration = plotHeight / (drawing.maxM - drawing.minM) / (plotWidth / Math.max(1e-6, drawing.lengthM))
  const barrel = drawing.invert.map((run, i) => bandPath(drawing.crown[i] ?? [], run, x, y)).join(' ')
  const fall = drawing.fall
  const fallText = !fall
    ? 'Fall not known: enter both inverts'
    : fall.oneIn === null
      ? 'Level barrel'
      : `${fall.falls ? 'Falls' : 'Rises'} ${fixed(Math.abs(fall.percent), 1)} % · 1 in ${fixed(fall.oneIn, 0)}`
  const ticks = [drawing.minM, (drawing.minM + drawing.maxM) / 2, drawing.maxM]
  const least = drawing.leastCover
  return (
    <div className={insetBox()} data-testid="culvert-profile">
      <p className="text-xs font-medium">
        {culvert.name} · along-barrel profile · {fallText}
      </p>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label={`Culvert profile for ${culvert.name}`}
      >
        <path
          d={`M${left} ${top}V${top + plotHeight}H${left + plotWidth}`}
          fill="none"
          stroke="hsl(var(--muted-foreground))"
          opacity={0.6}
        />
        {drawing.fill.map((run, i) => (
          <path
            key={`fill-${i}`}
            d={bandPath(run.top, run.bottom, x, y)}
            fill={LONG_SECTION_COLORS.fill}
            opacity={0.14}
          />
        ))}
        <path d={runsPath(drawing.ground, x, y)} stroke={LONG_SECTION_COLORS.ground} strokeWidth={2} fill="none" />
        <path d={runsPath(drawing.surface, x, y)} stroke={LONG_SECTION_COLORS.surface} strokeWidth={1.2} fill="none" />
        <path d={runsPath(drawing.formation, x, y)} stroke={LONG_SECTION_COLORS.surface} strokeWidth={3} fill="none" />
        {barrel && <path d={barrel} fill={LONG_SECTION_COLORS.barrel} opacity={0.22} />}
        <path d={runsPath(drawing.invert, x, y)} stroke={LONG_SECTION_COLORS.barrel} strokeWidth={2} fill="none" />
        <path d={runsPath(drawing.crown, x, y)} stroke={LONG_SECTION_COLORS.barrel} strokeWidth={1.4} fill="none" />
        {required !== null && (
          <path
            d={runsPath(drawing.minimumCover, x, y)}
            stroke={LONG_SECTION_COLORS.minimumCover}
            strokeWidth={1.2}
            strokeDasharray="5 3"
            fill="none"
          >
            <title>Crown plus the manual's minimum cover of {fixed(required, 2)} m (EM 3.5.5.2, 5.8.6)</title>
          </path>
        )}
        {least && (
          <g data-testid="culvert-least-cover">
            <line
              x1={x(least.distanceM)}
              x2={x(least.distanceM)}
              y1={y(least.crownM)}
              y2={y(least.formationM)}
              stroke="hsl(var(--foreground))"
              strokeWidth={1.2}
            />
            <circle cx={x(least.distanceM)} cy={y(least.formationM)} r={3} fill="hsl(var(--foreground))" />
            <text
              x={x(least.distanceM) + (x(least.distanceM) > left + plotWidth - 120 ? -5 : 5)}
              y={y(least.formationM) - 6}
              textAnchor={x(least.distanceM) > left + plotWidth - 120 ? 'end' : 'start'}
              fontSize="10.5"
              fill="currentColor"
              stroke="hsl(var(--background))"
              strokeWidth={3}
              paintOrder="stroke"
            >
              Least cover {fixed(least.coverM, 2)} m{required !== null ? ` · needs ${fixed(required, 2)} m` : ''}
            </text>
          </g>
        )}
        <g fontSize="10.5" fill="currentColor">
          {ticks.map((value) => (
            <text key={value} x={left - 4} y={y(value) + 3} textAnchor="end">
              {fixed(value, 1)}
            </text>
          ))}
          <text x={left} y={height - 26}>
            Left inlet · 0 m
          </text>
          <text x={left} y={height - 12}>
            Invert {drawing.inlet.invertM === null ? 'not entered' : `${fixed(drawing.inlet.invertM, 2)} m`}
          </text>
          <text x={left + plotWidth} y={height - 26} textAnchor="end">
            Right outlet · {fixed(drawing.lengthM, 1)} m
          </text>
          <text x={left + plotWidth} y={height - 12} textAnchor="end">
            Invert {drawing.outlet.invertM === null ? 'not entered' : `${fixed(drawing.outlet.invertM, 2)} m`}
          </text>
          <text x={left + plotWidth / 2} y={height - 12} textAnchor="middle" opacity={0.75}>
            Vertical ×{fixed(exaggeration, exaggeration < 10 ? 1 : 0)}
          </text>
        </g>
      </svg>
      <p className="text-2xs text-muted-foreground">
        Brown: ground (gaps where terrain is missing) · thin orange: the road's design surface at{' '}
        {formatRoadStation(culvert.chainage)}, read across the barrel · thick orange: the formation the cover is
        measured to · blue: the barrel, invert to crown · dashed red: crown plus the manual's minimum cover, over the
        formation. Elevations follow the recorded structure geometry.
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
  equipment,
  onEquipmentChange,
  alignment,
}: {
  /** The road, for the cumulative cost chart's attribution. */
  alignment?: Alignment
  /** The construction equipment the design assumes (`DesignStandards.equipment`). */
  equipment?: AssumedEquipment[]
  onEquipmentChange?: (next: AssumedEquipment[]) => void
  analysis: RoadAnalysis
  settings: RoadSettings
  station: number
  onStation: (station: number) => void
  onExport: () => void
  selectedCulvertId?: string
  onSelectCulvert?: (id: string) => void
}) {
  const [tab, setTab] = useState<'schedule' | 'charts' | 'cost' | 'materials' | 'haul' | 'structures'>('cost')
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
            { value: 'schedule', label: 'Schedule', ariaLabel: 'Schedule of quantities and equipment' },
            { value: 'materials', label: 'Materials' },
            { value: 'haul', label: 'Haul' },
            { value: 'structures', label: 'Structures' },
            { value: 'charts', label: 'Charts', ariaLabel: 'Review charts' },
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
            <EngineeringTable data-testid="road-cost-breakdown" data-tutorial-id={ROAD_TOUR_ANCHORS.costTable}>
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
        {tab === 'charts' && (
          <ReviewCharts analysis={analysis} alignment={alignment} settings={settings} onStation={onStation} />
        )}
        {tab === 'schedule' && (
          <QuantitySchedulePanel
            alignment={alignment}
            analysis={analysis}
            settings={settings}
            equipment={equipment ?? []}
            onEquipmentChange={onEquipmentChange}
          />
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
                    <CulvertProfile
                      culvert={selectedCulvert}
                      design={alignment?.engineering?.culverts.find((c) => c.id === selectedCulvert.id)}
                      stations={analysis.stations}
                    />
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
          <p key={index} className="mt-2 border-l-2 border-warning pl-2 text-2xs">
            {warning}
          </p>
        ))}
      </div>
    </div>
  )
}
