import { useState, type ReactNode } from 'react'
import { ClipboardCopy, Database, FileSpreadsheet, Play, Square } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { InlineAlert, KeyValueRows, SelectedItemCard, SidebarSection } from '@/components/ui/map-panels'
import { ListHeader, ResultRow } from '@/components/ui/result-list'
import { StatGroup } from '@/components/ui/stat-group'
import { VirtualResultList } from '@/components/ui/virtual-result-list'
import { COVERAGE_COLORS } from './AvastMap'
import { FIELD_CLASS } from './InputsPanel'
import { slopeClassLabel } from './slope'
import type { RunState } from './useAvastRun'
import type { AvastSettings, CandidateSummary, RunSummary } from './types'

const m3 = (value: number | null | undefined) => (value === null || value === undefined ? '—' : `${Math.round(value).toLocaleString('en-CA')} m³`)
const ha = (value: number | null | undefined, digits = 1) => (value === null || value === undefined ? '—' : `${value.toLocaleString('en-CA', { maximumFractionDigits: digits, minimumFractionDigits: digits })} ha`)
const pct = (value: number | null | undefined) => (value === null || value === undefined ? '—' : `${value.toFixed(1)}%`)

export const rowColor = (row: CandidateSummary) => (row.volumeSource === 'LiDAR' ? COVERAGE_COLORS.lidar : COVERAGE_COLORS[row.coverageClass])

export function ResultsPanel(props: {
  run: RunState
  summary: RunSummary | null
  settings: AvastSettings
  canRun: string | null
  stale: boolean
  onRun: () => void
  onCancel: () => void
  selectedKey: string | null
  onSelect: (key: string | null) => void
  onDownloadExcel: () => Promise<void>
  onDownloadGdb: () => Promise<void>
  onCopyRows: (options: { startRow: number; formulas: boolean }) => Promise<number>
  onDownloadTsv: (options: { startRow: number; formulas: boolean }) => Promise<void>
  onSettings: (patch: Partial<AvastSettings>) => void
  /** Exploratory sections shown after the totals; never part of the exports. */
  whatIf?: ReactNode
  /** Shown above the export buttons, e.g. that step 4's VRI fill is in column F. */
  exportNote?: ReactNode
}) {
  const { run, summary, settings } = props
  const [busy, setBusy] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [formulas, setFormulas] = useState(true)
  const running = run.status === 'reading' || run.status === 'running'
  const breaks = settings.slopeBreaks
  const selected = summary?.candidates.find((row) => row.key === props.selectedKey) ?? null
  const action = async (label: string, work: () => Promise<void>) => {
    setBusy(label)
    setExportError(null)
    try {
      await work()
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }
  const progress = run.total ? Math.round((100 * run.done) / run.total) : 0
  const class1 = summary?.candidates.reduce((sum, row) => sum + (row.duplicate || row.excluded ? 0 : row.classVolume?.[0] ?? 0), 0) ?? null

  return (
    <>
      <SidebarSection title="Run" className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={props.onRun} disabled={running || !!props.canRun} data-avast-run>
            <Play className="mr-1.5 h-4 w-4" />{running ? 'Running…' : run.status === 'idle' ? 'Run AVAST volume' : 'Run again'}
          </Button>
          {running && <Button type="button" variant="outline" onClick={props.onCancel}><Square className="mr-1.5 h-4 w-4" />Cancel</Button>}
        </div>
        {props.canRun && !running && <p className="text-xs text-muted-foreground">{props.canRun}</p>}
        {props.stale && !running && run.status !== 'idle' && <InlineAlert tone="warning">Inputs or slope settings changed since this run. Run again to update the geometry.</InlineAlert>}
        {running && (
          <div className="space-y-1.5" role="status">
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${run.status === 'reading' ? 4 : progress}%` }} />
            </div>
            <p className="text-xs text-muted-foreground">{run.status === 'running' ? `${run.done} of ${run.total} candidates · ` : ''}{run.message}</p>
          </div>
        )}
        {run.status === 'error' && <InlineAlert tone="error" title="The run stopped">{run.error}</InlineAlert>}
        {run.status === 'cancelled' && <InlineAlert>Run cancelled after {run.done} of {run.total} candidates.</InlineAlert>}
        {run.layers.length > 0 && (
          <p className="text-xs leading-5 text-muted-foreground">
            Read {run.layers.map((layer) => `${layer.featureCount.toLocaleString('en-CA')} ${layer.kind === 'avast' ? 'AVAST' : 'LiDAR'} polygons from ${layer.name}${layer.nullDensityCount ? ` (${layer.nullDensityCount} without a density)` : ''}`).join('; ')} around the candidates.
          </p>
        )}
      </SidebarSection>

      {summary && summary.candidates.length > 0 && (
        <>
          <SidebarSection title="Totals" subtitle={`Unique, non-excluded blocks${settings.volumeBasis === 'total' ? '' : ` · reported volume is ${settings.volumeBasis === 'class1' ? slopeClassLabel(1, breaks) : `≤${breaks[1]}%`} slope`}`} className="space-y-3">
            <StatGroup variant="tiles" size="sm" columns={2} items={[
              { label: 'Blocks', value: summary.totals.blocks.toLocaleString('en-CA') },
              { label: 'Reported volume', value: m3(summary.totals.volume) },
              { label: 'Raw AVAST volume', value: m3(summary.totals.avastRawVolume) },
              { label: 'AVAST coverage', value: pct(summary.totals.grossHa ? (100 * summary.totals.coveredHa) / summary.totals.grossHa : null), note: `${ha(summary.totals.coveredHa, 0)} of ${ha(summary.totals.grossHa, 0)}` },
              ...(class1 !== null && run.slopeAssessed ? [{ label: `Volume on ${slopeClassLabel(1, breaks)}`, value: m3(class1) }] : []),
              ...(summary.factor !== null ? [{ label: 'LiDAR factor', value: summary.factor.toFixed(4) }] : []),
            ]} />
            {summary.calibration && (
              summary.calibration.rows.length
                ? <KeyValueRows variant="divided" rows={[
                    { label: 'Calibration blocks', value: summary.calibration.rows.length },
                    { label: 'Common footprint', value: ha(summary.calibration.commonAreaHa, 2) },
                    { label: 'AVAST over it', value: `${m3(summary.calibration.avastVolume)} (${summary.calibration.avastWeighted?.toFixed(1)} m³/ha)` },
                    { label: 'LiDAR over it', value: `${m3(summary.calibration.lidarVolume)} (${summary.calibration.lidarWeighted?.toFixed(1)} m³/ha)` },
                    { label: 'Factor', value: summary.calibration.factor?.toFixed(4) ?? '—' },
                  ]} />
                : null
            )}
            {summary.byOperatingArea.length > 0 && (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="py-1 font-medium">Operating area</th>
                    <th className="py-1 text-right font-medium">Blocks</th>
                    <th className="py-1 text-right font-medium">Volume</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.byOperatingArea.map((entry) => (
                    <tr key={entry.operatingArea} className="border-b border-border/60">
                      <td className="py-1">{entry.operatingArea || '(blank)'}</td>
                      <td className="py-1 text-right tabular-nums">{entry.blocks}</td>
                      <td className="py-1 text-right tabular-nums">{m3(entry.volume)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {summary.qa.length > 0 && (
              <InlineAlert tone="warning" title="QA">
                <ul className="list-disc space-y-1 pl-4">{summary.qa.map((line) => <li key={line}>{line}</li>)}</ul>
              </InlineAlert>
            )}
          </SidebarSection>

          {props.whatIf}

          <SidebarSection title="Outputs" className="space-y-3">
            {props.exportNote}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" disabled={!!busy || running} onClick={() => action('excel', props.onDownloadExcel)} data-avast-download="excel">
                <FileSpreadsheet className="mr-1.5 h-4 w-4" />{busy === 'excel' ? 'Building…' : 'Excel workbook'}
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={!!busy || running} onClick={() => action('gdb', props.onDownloadGdb)} data-avast-download="gdb">
                <Database className="mr-1.5 h-4 w-4" />{busy === 'gdb' ? 'Writing…' : 'File Geodatabase'}
              </Button>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">The workbook keeps the Dunkley layout (Management Summary, Block Volume Inputs, Method & QA) and adds the procedure's AVAST, slope and calibration tables. The geodatabase downloads as a .zip — unzip it and add the .gdb in ArcGIS Pro or QGIS.</p>
            <div className="rounded-md border border-border p-3">
              <p className="text-sm font-medium">Paste into an existing workbook</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Copies columns A–K of Block Volume Inputs. Click cell A of the first empty row and paste; formulas in G and K are written for the rows they land on.</p>
              <div className="mt-2 grid grid-cols-2 items-end gap-2">
                <label className="block text-xs font-medium text-muted-foreground">
                  First empty row
                  <input type="number" min={6} className={FIELD_CLASS} value={settings.pasteStartRow}
                    onChange={(event) => props.onSettings({ pasteStartRow: Math.max(1, Math.round(Number(event.target.value) || 6)) })} />
                </label>
                <label className="flex items-center gap-2 pb-2 text-xs">
                  <input type="checkbox" checked={formulas} onChange={(event) => setFormulas(event.target.checked)} />
                  G and K as formulas
                </label>
              </div>
              <Button type="button" size="sm" className="mt-2" disabled={!!busy || running} data-avast-copy
                onClick={() => action('copy', async () => {
                  const count = await props.onCopyRows({ startRow: settings.pasteStartRow, formulas })
                  setCopied(`Copied ${count} row${count === 1 ? '' : 's'} for sheet rows ${settings.pasteStartRow}–${settings.pasteStartRow + count - 1}.`)
                })}>
                <ClipboardCopy className="mr-1.5 h-4 w-4" />Copy rows
              </Button>
              <Button type="button" variant="ghost" size="sm" className="ml-1 mt-2" disabled={!!busy || running}
                onClick={() => action('tsv', () => props.onDownloadTsv({ startRow: settings.pasteStartRow, formulas }))}>
                Download .tsv
              </Button>
              {copied && <p className="mt-2 text-xs text-green-700 dark:text-green-400" role="status">{copied}</p>}
            </div>
            {exportError && <InlineAlert tone="error">{exportError}</InlineAlert>}
          </SidebarSection>

          {selected && (
            <div className="px-4 pb-3">
              <SelectedItemCard
                title={selected.id || '(no Block ID)'}
                eyebrow={selected.operatingArea}
                subtitle={selected.sourceName}
                onClear={() => props.onSelect(null)}
                badges={<>
                  <Badge tone={selected.coverageClass === 'good' ? 'success' : selected.coverageClass === 'moderate' ? 'warning' : 'danger'}>{selected.coverageClass === 'none' ? 'Little/no' : selected.coverageClass} AVAST coverage</Badge>
                  <Badge tone={selected.volumeSource === 'LiDAR' ? 'violet' : 'neutral'}>{selected.volumeSource}</Badge>
                  {selected.duplicate && <Badge tone="danger">Duplicate ID</Badge>}
                  {selected.excluded && <Badge>Excluded area</Badge>}
                </>}
                rows={[
                  { label: 'Merch area', value: `${ha(selected.grossHa, 2)}${selected.grossFromGeometry ? ' (polygon)' : ''}` },
                  { label: 'AVAST area', value: `${ha(selected.avastCoveredHa, 2)} · ${pct(selected.avastCoveragePct)}` },
                  { label: 'Raw AVAST volume', value: m3(selected.avastRawVolume) },
                  { label: 'Weighted m³/ha', value: selected.weightedAvastM3ha?.toFixed(1) ?? '—' },
                  selected.lidarVolume !== null && { label: 'LiDAR volume', value: `${m3(selected.lidarVolume)} · ${pct(selected.lidarCoveragePct)}` },
                  { label: 'Final planning volume', value: m3(selected.finalVolume) },
                  ...(selected.classVolume ? ([0, 1, 2] as const).map((index) => ({
                    label: `${slopeClassLabel((index + 1) as 1 | 2 | 3, breaks)} slope`,
                    value: `${m3(selected.classVolume![index])} · ${ha(selected.classAreaHa?.[index], 2)}`,
                  })) : []),
                  { label: 'Reported (F)', value: m3(selected.reportedVolume) },
                  { label: 'Preferred VPH (E)', value: selected.preferredVph ?? '—' },
                ]}
              >
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{selected.notes}</p>
                {selected.warnings.length > 0 && <InlineAlert tone="warning" className="mt-2"><ul className="list-disc pl-4">{selected.warnings.map((line) => <li key={line}>{line}</li>)}</ul></InlineAlert>}
              </SelectedItemCard>
            </div>
          )}

          <div className="px-2 pb-4">
            <ListHeader count={summary.candidates.length} noun={['block', 'blocks']} />
            <VirtualResultList items={summary.candidates} getKey={(row) => row.key} estimateSize={58} label="Candidate blocks">
              {(row) => (
                <ResultRow
                  title={row.id || '(no Block ID)'}
                  subtitle={`${row.operatingArea || '—'} · ${ha(row.grossHa)} · ${pct(row.avastCoveragePct)} AVAST`}
                  dotColor={rowColor(row)}
                  trailing={<span className="tabular-nums">{m3(row.reportedVolume)}</span>}
                  selected={row.key === props.selectedKey}
                  onClick={() => props.onSelect(row.key === props.selectedKey ? null : row.key)}
                  meta={row.duplicate || row.excluded || row.warnings.length
                    ? <span className="flex gap-1">{row.duplicate && <Badge tone="danger" size="xs">Duplicate</Badge>}{row.excluded && <Badge size="xs">Excluded</Badge>}{row.warnings.length > 0 && <Badge tone="warning" size="xs">Check</Badge>}</span>
                    : undefined}
                />
              )}
            </VirtualResultList>
          </div>
        </>
      )}
    </>
  )
}
