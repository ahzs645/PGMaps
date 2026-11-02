import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { InlineAlert, SidebarSection } from '@/components/ui/map-panels'
import { StatGroup } from '@/components/ui/stat-group'
import { downloadBlob } from '@/lib/download'
import { writeGeodatabase } from '../dev-avast/gdal'
import { buildWorkbook, geodatabaseLayers, resultGeoJson } from './exports'
import type { AnalysisResult } from './types'

export const hectares = (value: number | null) =>
  value === null
    ? 'Not assessed'
    : `${value.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ha`

export function ResultsPanel({
  result,
  stale,
  selected,
  onSelect,
}: {
  result: AnalysisResult
  stale: boolean
  selected: string | null
  onSelect: (id: string | null) => void
}) {
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const row = result.rows.find((item) => item.id === selected) ?? result.combined
  const download = async (kind: 'excel' | 'geojson' | 'gdb') => {
    setError(null)
    setExporting(true)
    try {
      const name = result.settings.demo ? 'SYNTHETIC_EXAMPLE_THLB' : 'THLB_Impact'
      if (kind === 'excel')
        downloadBlob(
          new Blob([await buildWorkbook(result)], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          }),
          `${name}.xlsx`,
        )
      else if (kind === 'geojson')
        downloadBlob(
          new Blob([JSON.stringify(resultGeoJson(result))], { type: 'application/geo+json' }),
          `${name}_pieces.geojson`,
        )
      else downloadBlob(await writeGeodatabase(name, geodatabaseLayers(result)), `${name}.gdb.zip`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setExporting(false)
    }
  }
  return (
    <>
      <SidebarSection title={selected ? selected : 'Combined footprint (union)'}>
        {selected && (
          <Button size="sm" variant="outline" className="mb-3" onClick={() => onSelect(null)}>
            Show combined total
          </Button>
        )}
        <StatGroup
          variant="tiles"
          size="sm"
          columns={2}
          items={[
            { label: 'Known affected THLB', value: hectares(row.thlbHa) },
            { label: 'Assessment area', value: hectares(row.areaHa) },
            { label: 'Official THLB', value: hectares(row.officialThlbHa), tone: 'success' },
            { label: 'Proxy THLB', value: hectares(row.proxyThlbHa) },
            {
              label: 'No source coverage',
              value: hectares(row.uncoveredHa),
              tone: row.uncoveredHa > 0 ? 'warning' : 'muted',
            },
            {
              label: 'Missing official factor',
              value: hectares(row.unknownFactorHa),
              tone: row.unknownFactorHa > 0 ? 'warning' : 'muted',
            },
          ]}
        />
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          Known THLB excludes unknown coverage and missing factors. Proxy hectares are estimates. Individual WHAs can
          overlap; this combined total counts each hectare once.
        </p>
      </SidebarSection>
      <SidebarSection title="Breakdown of known THLB">
        <StatGroup
          variant="tiles"
          size="sm"
          columns={2}
          items={[
            { label: `Mature (≥ ${result.settings.matureAge} years)`, value: hectares(row.matureThlbHa) },
            { label: 'Immature', value: hectares(row.immatureThlbHa) },
            { label: 'Unknown age', value: hectares(row.unknownAgeThlbHa) },
            { label: 'Inside deferral mask', value: hectares(row.deferralThlbHa) },
          ]}
        />
        {row.reductionHa !== null && (
          <InlineAlert className="mt-3" title={`Reduction scenario: ${result.settings.reductionPercent}%`}>
            {hectares(row.reductionHa)} of known THLB. This applies one assumed reduction rate across the assessment
            footprint.
          </InlineAlert>
        )}
      </SidebarSection>
      <SidebarSection title="By assessment area">
        <div className="overflow-x-auto">
          <EngineeringTable aria-label="THLB by assessment area" data-thlb-results>
            <thead>
              <tr>
                <ColumnHeader label="Area" />
                <ColumnHeader label="Official" unit="ha" />
                <ColumnHeader label="Proxy" unit="ha" />
                <ColumnHeader label="Known THLB" unit="ha" />
                <ColumnHeader label="No source" unit="ha" />
              </tr>
            </thead>
            <tbody>
              {result.rows.map((item) => (
                <tr key={item.id} aria-selected={item.id === selected}>
                  <td className="text-left">
                    <button className="py-2 text-primary underline" onClick={() => onSelect(item.id)}>
                      {item.id}
                    </button>
                  </td>
                  <td>{item.officialThlbHa.toFixed(2)}</td>
                  <td>{item.proxyThlbHa.toFixed(2)}</td>
                  <td>{item.thlbHa.toFixed(2)}</td>
                  <td>{item.uncoveredHa.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </EngineeringTable>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          The workbook includes age × deferral × administrative-area breakdowns and the union ledger.
        </p>
      </SidebarSection>
      <SidebarSection title="Review notes">
        <ul className="list-disc space-y-2 pl-4 text-xs leading-5 text-muted-foreground">
          {result.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
        {result.sources.filter((source) => source.role === 'official').length > 0 && (
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            Review the TSR years in the exported pieces. Different management units may use different inventory dates.
          </p>
        )}
      </SidebarSection>
      <SidebarSection title="Export results">
        <div className="flex flex-wrap gap-2">
          {(['excel', 'geojson', 'gdb'] as const).map((kind) => (
            <Button
              key={kind}
              size="sm"
              variant="outline"
              disabled={stale || exporting}
              onClick={() => void download(kind)}
              data-thlb-download={kind}
            >
              {kind === 'excel' ? 'Excel workbook' : kind === 'geojson' ? 'GeoJSON pieces' : 'File Geodatabase'}
            </Button>
          ))}
        </div>
        {exporting && (
          <InlineAlert loading className="mt-2">
            Preparing download…
          </InlineAlert>
        )}
        {error && (
          <InlineAlert tone="error" className="mt-2">
            {error}
          </InlineAlert>
        )}
      </SidebarSection>
    </>
  )
}
