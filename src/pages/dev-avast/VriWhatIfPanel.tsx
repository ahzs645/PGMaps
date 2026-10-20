import { useMemo, useState } from 'react'
import { Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InlineAlert, KeyValueRows, SidebarSection } from '@/components/ui/map-panels'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { StatGroup } from '@/components/ui/stat-group'
import { ToggleRow } from '@/components/ui/toggle-row'
import { FIELD_CLASS } from './InputsPanel'
import { coverageClass } from './report'
import type { VriFillState } from './useVriFill'
import type { DeadRule, UtilizationRule, VriFillTotals, VriRules } from './vriFill'
import type { AvastSettings, RunSummary } from './types'

const m3 = (value: number) => `${Math.round(value).toLocaleString('en-CA')} m³`
const ha = (value: number) => `${value.toLocaleString('en-CA', { maximumFractionDigits: 0 })} ha`

export type WhatIfRow = {
  key: string
  id: string
  operatingArea: string
  grossHa: number
  avastVolume: number
  avastCoveredHa: number
  fill: VriFillTotals | null
  withVri: number
  /** AVAST plus VRI fill scaled by the PG TSA audit's species ratios. */
  withVriAudit: number
  /** Volume per hectare of merch area with VRI fill. */
  m3haWithVri: number
  belowMinimum: boolean
  coverageWithVri: number
}

/** Per-block AVAST volume plus the VRI fill, leaving direct-LiDAR blocks alone. */
export function whatIfRows(summary: RunSummary, totals: Map<string, VriFillTotals>, minimumM3ha: number): WhatIfRow[] {
  return summary.candidates.filter((row) => !row.duplicate && !row.excluded).map((row) => {
    const fill = row.volumeSource === 'LiDAR' ? null : totals.get(row.key) ?? null
    const added = fill ? fill.uncoveredFillVolume + fill.zeroFillVolume : 0
    const m3haWithVri = row.grossHa > 0 ? (row.finalVolume + added) / row.grossHa : 0
    return {
      key: row.key,
      id: row.id,
      operatingArea: row.operatingArea,
      grossHa: row.grossHa,
      avastVolume: row.finalVolume,
      avastCoveredHa: row.avastCoveredHa,
      fill,
      withVri: row.finalVolume + added,
      withVriAudit: row.finalVolume + (fill?.auditFillVolume ?? 0),
      m3haWithVri,
      belowMinimum: m3haWithVri < minimumM3ha,
      coverageWithVri: row.grossHa > 0 ? (100 * (row.avastCoveredHa + (fill?.uncoveredFillHa ?? 0))) / row.grossHa : 0,
    }
  })
}

export function VriWhatIfPanel({
  state, summary, rows, rules, onRules, onRun, settings, stale, selectedKey, canRun, highlight, onHighlight, onSelect,
  excelIncludeVri, onExcelIncludeVri, onDownloadExcel,
}: {
  state: VriFillState
  summary: RunSummary
  rows: WhatIfRow[]
  rules: VriRules
  onRules: (patch: Partial<VriRules>) => void
  onRun: () => void
  settings: AvastSettings
  stale: boolean
  selectedKey: string | null
  canRun: boolean
  /** Yellow outline on the blocks below the minimum. */
  highlight: boolean
  onHighlight: () => void
  onSelect: (key: string) => void
  excelIncludeVri: boolean
  onExcelIncludeVri: (include: boolean) => void
  onDownloadExcel: () => Promise<void>
}) {
  const busy = state.status === 'fetching' || state.status === 'intersecting'
  const [exporting, setExporting] = useState(false)
  const totals = useMemo(() => {
    const sum = (pick: (row: WhatIfRow) => number) => rows.reduce((total, row) => total + pick(row), 0)
    const before = sum((row) => row.avastVolume)
    const uncovered = sum((row) => row.fill?.uncoveredFillVolume ?? 0)
    const zero = sum((row) => row.fill?.zeroFillVolume ?? 0)
    const gross = sum((row) => row.grossHa)
    const coveredBefore = sum((row) => row.avastCoveredHa)
    const coveredAfter = coveredBefore + sum((row) => row.fill?.uncoveredFillHa ?? 0)
    const promoted = rows.filter((row) => coverageClass(row.grossHa ? (100 * row.avastCoveredHa) / row.grossHa : 0, settings) !== 'good'
      && coverageClass(row.coverageWithVri, settings) === 'good').length
    const audit = sum((row) => row.withVriAudit)
    const below = rows.filter((row) => row.belowMinimum)
    return { before, uncovered, zero, after: before + uncovered + zero, audit, below, gross, coveredBefore, coveredAfter, promoted }
  }, [rows, settings])
  const byArea = useMemo(() => {
    const map = new Map<string, { before: number; after: number }>()
    for (const row of rows) {
      const entry = map.get(row.operatingArea) ?? { before: 0, after: 0 }
      entry.before += row.avastVolume
      entry.after += row.withVri
      map.set(row.operatingArea, entry)
    }
    return [...map.entries()]
  }, [rows])
  const selected = rows.find((row) => row.key === selectedKey)
  const hasResult = state.status === 'done' || (state.status === 'intersecting' && state.done > 0)

  return (
    <SidebarSection title="Step 4 (optional): fill AVAST gaps with VRI" icon={Layers} className="space-y-3" data-avast-vri>
      <p className="text-xs leading-5 text-muted-foreground">
        AVAST's CMM_m3ha is VRI volume at 17.5 cm utilization (live + dead) on stands 60 years and older. This fills the parts of each block AVAST leaves empty with VRI rank-1 from DataBC. The defaults follow the Prince George TSA instead: pine at 12.5 cm and dead volume on the shelf-life curve.
      </p>
      <InlineAlert tone="info">Kept out of the reported volume, totals, paste rows and geodatabase unless you turn on "Add VRI volume to the export" below.</InlineAlert>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onRun} disabled={busy || !canRun} data-avast-vri-run>
          {busy ? 'Working…' : state.status === 'idle' ? 'Estimate with VRI' : 'Fetch VRI again'}
        </Button>
        {state.projectedDate && <span className="text-xs text-muted-foreground">VRI projected to {state.projectedDate} · {state.featureCount.toLocaleString('en-CA')} polygons</span>}
      </div>
      {busy && <p className="text-xs text-muted-foreground" role="status">{state.message} {state.total ? `(${state.done}/${state.total})` : ''}</p>}
      {state.status === 'error' && <InlineAlert tone="error" title="VRI fill failed">{state.error}</InlineAlert>}
      {stale && state.status === 'done' && <InlineAlert tone="warning">The AVAST run changed since this fill. Fetch VRI again to match it.</InlineAlert>}

      <div className="space-y-2">
        <SegmentedControl label="VRI utilization" value={String(rules.utilization) as `${UtilizationRule}`}
          onChange={(value) => onRules({ utilization: (value === 'species' ? 'species' : Number(value)) as UtilizationRule })}
          options={[
            { value: '125', label: '12.5' }, { value: '175', label: '17.5' }, { value: '225', label: '22.5' },
            { value: 'species', label: 'Pine 12.5', title: 'Pine-leading stands at 12.5 cm, others at 17.5 cm — the Prince George TSA rule' },
          ]} />
        <p className="text-xs leading-5 text-muted-foreground">
          {rules.utilization === 'species'
            ? 'Pine-leading stands at 12.5 cm, others at 17.5 cm, as the Prince George TSA merchantability rule does.'
            : `${rules.utilization / 10} cm minimum diameter for every stand. AVAST itself uses 17.5 cm.`}
        </p>
        <SegmentedControl label="Dead volume" value={rules.dead} onChange={(dead: DeadRule) => onRules({ dead })}
          options={[{ value: 'none', label: 'No dead' }, { value: 'full', label: 'All dead' }, { value: 'shelf', label: 'Shelf life' }]} />
        {rules.dead === 'shelf' && (
          <div className="grid grid-cols-2 gap-2">
            <label className="block min-w-0 text-xs font-medium text-muted-foreground">
              Years dead if unrecorded
              <input type="number" min={0} className={FIELD_CLASS} value={rules.unknownDeathYears}
                onChange={(event) => onRules({ unknownDeathYears: Math.max(0, Number(event.target.value) || 0) })} />
            </label>
            <p className="self-end pb-1 text-xs leading-4 text-muted-foreground">TSR curve to {rules.asOfYear}: 100% year 1, 80% year 2, falling to 40% by year 15. Year of death from VRI's disturbance date (mostly beetle, IBM).</p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <label className="block min-w-0 text-xs font-medium text-muted-foreground">
            Minimum stand age
            <input type="number" min={0} className={FIELD_CLASS} value={rules.minAge}
              onChange={(event) => onRules({ minAge: Math.max(0, Number(event.target.value) || 0) })} />
          </label>
          <label className="block min-w-0 text-xs font-medium text-muted-foreground">
            Flag below (m³/ha)
            <input type="number" min={0} className={FIELD_CLASS} value={rules.minimumM3ha}
              onChange={(event) => onRules({ minimumM3ha: Math.max(0, Number(event.target.value) || 0) })} />
          </label>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button type="button" size="sm" variant={rules.minimumM3ha === 182 ? 'secondary' : 'ghost'} onClick={() => onRules({ minimumM3ha: 182 })}>182 · PG TSR minimum</Button>
          <Button type="button" size="sm" variant={rules.minimumM3ha === 140 ? 'secondary' : 'ghost'} onClick={() => onRules({ minimumM3ha: 140 })}>140 · beetle salvage</Button>
        </div>
        <ToggleRow active={rules.fillZeroAvast} onClick={() => onRules({ fillZeroAvast: !rules.fillZeroAvast })} label="Also refill 0 m³/ha AVAST" description="AVAST zeroes some mature treed polygons; use VRI there too."
          title="Also refill 0 m³/ha AVAST — AVAST zeroes some mature treed polygons; use VRI there too." />
        <ToggleRow active={rules.treedOnly} onClick={() => onRules({ treedOnly: !rules.treedOnly })} label="Treed polygons only" description="Shrub, herb, wetland and bare polygons add nothing."
          title="Treed polygons only — VRI volume counts only where the BC Land Cover Classification (BCLCS level 2) says treed (T); shrub, herb, wetland and non-vegetated polygons add 0 m³/ha." />
        {summary.factor !== null && (
          <ToggleRow active={rules.applyFactor} onClick={() => onRules({ applyFactor: !rules.applyFactor })} label={`Apply LiDAR factor ${summary.factor.toFixed(4)}`} description="Scale VRI fill the same way as AVAST volume."
            title={`Apply LiDAR factor ${summary.factor.toFixed(4)} — scale VRI fill the same way as AVAST volume.`} />
        )}
      </div>

      {hasResult && (
        <>
          <StatGroup variant="tiles" size="sm" columns={2} items={[
            { label: 'AVAST only', value: m3(totals.before) },
            { label: 'With VRI fill', value: m3(totals.after), tone: 'primary' },
            { label: 'VRI on uncovered ground', value: m3(totals.uncovered) },
            { label: 'VRI on 0 m³/ha AVAST', value: m3(totals.zero) },
            { label: 'Volume coverage', value: `${totals.gross ? ((100 * totals.coveredBefore) / totals.gross).toFixed(1) : '0'}% → ${totals.gross ? ((100 * totals.coveredAfter) / totals.gross).toFixed(1) : '0'}%`, note: `${ha(totals.coveredBefore)} → ${ha(totals.coveredAfter)} of ${ha(totals.gross)}` },
            { label: 'Blocks reaching Good', value: totals.promoted.toLocaleString('en-CA'), note: `≥ ${settings.coverageGoodPct}% with VRI` },
            { label: 'With VRI, audit-adjusted', value: m3(totals.audit), note: 'VRI fill × PG TSA audit ratio by leading species' },
            {
              label: `Below ${rules.minimumM3ha} m³/ha`, value: `${totals.below.length} of ${rows.length}`, tone: totals.below.length ? 'warning' : 'default',
              note: highlight ? 'highlighted on the map — click to clear' : 'click to highlight on the map',
              onToggle: totals.below.length ? onHighlight : undefined, pressed: highlight,
              toggleLabel: `Highlight the ${totals.below.length} blocks below ${rules.minimumM3ha} m³/ha on the map`,
              pressedClassName: 'border-yellow-400 bg-yellow-400/10 ring-1 ring-yellow-400',
            },
          ]} />
          {totals.below.length > 0 && (
            <div className="text-xs leading-5 text-muted-foreground" data-avast-vri-below>
              Below {rules.minimumM3ha} m³/ha with VRI:{' '}
              {totals.below.map((row, index) => (
                <span key={row.key}>
                  {index > 0 && ', '}
                  <button type="button" className="underline decoration-dotted underline-offset-2 hover:text-foreground" onClick={() => onSelect(row.key)}>
                    {row.id}
                  </button>{' '}({Math.round(row.m3haWithVri)})
                </span>
              ))}
            </div>
          )}
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-1 font-medium">Operating area</th>
                <th className="py-1 text-right font-medium">AVAST</th>
                <th className="py-1 text-right font-medium">+ VRI</th>
              </tr>
            </thead>
            <tbody>
              {byArea.map(([area, entry]) => (
                <tr key={area} className="border-b border-border/60">
                  <td className="py-1">{area || '(blank)'}</td>
                  <td className="py-1 text-right tabular-nums">{m3(entry.before)}</td>
                  <td className="py-1 text-right tabular-nums">{m3(entry.after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {selected && (
            <div className="rounded-md border border-border p-3">
              <p className="text-sm font-medium">{selected.id}</p>
              <KeyValueRows variant="divided" className="mt-1" rows={[
                { label: 'AVAST volume', value: m3(selected.avastVolume) },
                { label: 'VRI on uncovered', value: `${m3(selected.fill?.uncoveredFillVolume ?? 0)} · ${(selected.fill?.uncoveredFillHa ?? 0).toFixed(2)} ha` },
                { label: 'VRI on 0 m³/ha AVAST', value: `${m3(selected.fill?.zeroFillVolume ?? 0)} · ${(selected.fill?.zeroFillHa ?? 0).toFixed(2)} ha` },
                { label: 'VRI at 0 m³/ha (young / non-treed)', value: `${(selected.fill?.zeroDensityHa ?? 0).toFixed(2)} ha` },
                { label: 'With VRI fill', value: `${m3(selected.withVri)} · ${Math.round(selected.m3haWithVri)} m³/ha${selected.belowMinimum ? ` (below ${rules.minimumM3ha})` : ''}` },
                { label: 'Audit-adjusted', value: m3(selected.withVriAudit) },
                { label: 'Coverage with VRI', value: `${selected.coverageWithVri.toFixed(1)}%` },
              ]} />
            </div>
          )}
          <div className="space-y-2 rounded-md border border-border p-3" data-avast-vri-export>
            <ToggleRow active={excelIncludeVri} onClick={() => onExcelIncludeVri(!excelIncludeVri)} disabled={state.status !== 'done'}
              label="Add VRI volume to the export"
              description="Direct Est. Vol (F) becomes the audit-adjusted volume with VRI."
              title="Add VRI volume to the export — Direct Est. Vol (F), and so G, the Management Summary and Copy rows, become AVAST plus the VRI fill scaled by the Prince George TSA audit ratios. AVAST-only Ref. (J) keeps the AVAST volume alone. The geodatabase stays AVAST-only." />
            {excelIncludeVri && (
              <Button type="button" size="sm" variant="outline" disabled={exporting || state.status !== 'done'} data-avast-vri-excel
                onClick={async () => {
                  setExporting(true)
                  try { await onDownloadExcel() } finally { setExporting(false) }
                }}>
                {exporting ? 'Building…' : 'Download Excel with VRI volume'}
              </Button>
            )}
          </div>
          <p className="text-xs leading-5 text-muted-foreground">VRI volumes are modelled (VDYP projections of photo-interpreted attributes), not measured, and carry no slope split here. Treat the difference as a sign of where AVAST is silent, not as cruise-ready volume. The Prince George TSA audit found VRI unbiased overall (1.002) only because species strata offset each other (pine 0.84, spruce 0.95, balsam 1.25, other 1.16); a single block can be 30% or more off.</p>
        </>
      )}
    </SidebarSection>
  )
}
