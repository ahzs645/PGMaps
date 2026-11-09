import { useDeferredValue, useMemo, useState } from 'react'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { FORM_INPUT_CLASS, FormField, NumberField, SelectField } from '@/components/ui/form-field'
import { CollapsibleSection, InlineAlert, SidebarSection } from '@/components/ui/map-panels'
import { PaginationControls } from '@/components/ui/pagination-controls'
import { StatGroup } from '@/components/ui/stat-group'
import { downloadText } from '@/lib/download'
import { AlertList } from './AlertList'
import type { CurrentAssessment, CurrentSettings } from './currentAnalysis'
import { DownloadActions } from './DownloadActions'
import { compareShinyReference, DEFAULT_REFERENCE_TOLERANCE, MAX_REFERENCE_TOLERANCE } from './referenceComparison'
import {
  referenceComparisonCsv,
  referenceComparisonHtml,
  referenceComparisonJson,
  referenceDelta,
  referenceValue,
  type ReferenceComparisonReport,
} from './referenceComparisonExport'
import type { ShinyReport } from './shinyReport'
import { errorMessage } from './useLatestRequest'
import { usePagedRows } from './usePagedRows'

const PAGE_SIZE = 40
const METADATA_FIELDS = [
  ['datasetVersion', 'Reference dataset version'],
  ['ccissrCommit', 'Reference ccissr commit'],
  ['shinyCommit', 'Reference Shiny commit'],
] as const

export interface ReferenceFile {
  name: string
  report: ShinyReport
  revision: number
}

/** Aligns one imported Shiny site and series with the browser assessment and lists every field's difference. */
export function ShinyReferenceResults({
  loaded,
  assessment,
  settings,
  sourceFile,
}: {
  loaded: ReferenceFile
  assessment: CurrentAssessment
  settings: CurrentSettings
  sourceFile?: string
}) {
  const { report, name } = loaded
  const sites = [...new Set(report.rows.map((row) => row.site))].sort()
  const [site, setSite] = useState('')
  const availableSeries = [...new Set(report.rows.filter((row) => row.site === site).map((row) => row.series))].sort()
  const [seriesChoice, setSeriesChoice] = useState('')
  const series = availableSeries.includes(seriesChoice) ? seriesChoice : ''
  const [confirmedFor, setConfirmedFor] = useState('')
  // A confirmed site mapping holds only for the exact pair, dataset and file it was confirmed for.
  const aliasKey = JSON.stringify([
    assessment.siteId,
    assessment.series,
    assessment.provenance.datasetVersion,
    sourceFile,
    site,
    series,
  ])
  const siteMappingConfirmed = Boolean(site && series && confirmedFor === aliasKey)
  const [tolerancePoints, setTolerancePoints] = useState(DEFAULT_REFERENCE_TOLERANCE * 100)
  const [metadata, setMetadata] = useState({ datasetVersion: '', ccissrCommit: '', shinyCommit: '' })
  const referenceMetadata = useMemo(
    () => ({
      datasetVersion: metadata.datasetVersion || undefined,
      ccissrCommit: metadata.ccissrCommit || undefined,
      shinyCommit: metadata.shinyCommit || undefined,
      parametersVerified: false as const,
    }),
    [metadata],
  )
  const result = useMemo(() => {
    if (!site || !series) return { comparison: null, error: '' }
    try {
      return {
        comparison: compareShinyReference(assessment, report, {
          settings,
          referenceSite: site,
          referenceSeries: series,
          siteMappingConfirmed,
          tolerance: tolerancePoints / 100,
          referenceMetadata,
        }),
        error: '',
      }
    } catch (error) {
      return { comparison: null, error: errorMessage(error) }
    }
  }, [assessment, settings, report, site, series, siteMappingConfirmed, tolerancePoints, referenceMetadata])
  const comparison = result.comparison
  const [query, setQuery] = useState('')
  const search = useDeferredValue(query.trim().toLowerCase())
  const [status, setStatus] = useState('all')
  const [measure, setMeasure] = useState('')
  const filtered = useMemo(
    () =>
      comparison?.rows.filter(
        (row) =>
          (!measure || row.measure === measure) &&
          (!search ||
            `${row.species} ${row.period ?? ''} ${row.class ?? ''} ${row.series}`.toLowerCase().includes(search)) &&
          (status === 'all' || (status === 'missing' ? row.status.endsWith('missing') : row.status === status)),
      ) ?? [],
    [comparison, measure, search, status],
  )
  const paged = usePagedRows(filtered, PAGE_SIZE, JSON.stringify([site, series, search, status, measure]))

  function download(format: 'json' | 'csv' | 'html') {
    if (!comparison) return
    const exported: ReferenceComparisonReport = {
      schema: 'cciss-shiny-reference-report-v1',
      generatedAt: new Date().toISOString(),
      browserSource: sourceFile ?? assessment.provenance.source,
      referenceSource: name,
      browserProvenance: assessment.provenance,
      browserSettings: settings,
      referenceMetadata,
      comparison,
    }
    if (format === 'json')
      downloadText(referenceComparisonJson(exported), 'cciss-shiny-reference.json', 'application/json')
    else if (format === 'csv') downloadText(referenceComparisonCsv(exported), 'cciss-shiny-reference.csv', 'text/csv')
    else downloadText(referenceComparisonHtml(exported), 'cciss-shiny-reference.html', 'text/html')
  }

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium">Shiny reference: {name}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label="Shiny reference site"
          value={site}
          onChange={(event) => {
            setSite(event.target.value)
            setSeriesChoice('')
          }}
        >
          <option value="">Choose an exact SiteRef</option>
          {sites.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </SelectField>
        <SelectField
          label="Shiny reference site series"
          value={series}
          disabled={!site}
          onChange={(event) => setSeriesChoice(event.target.value)}
        >
          <option value="">Choose an exact site series</option>
          {availableSeries.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </SelectField>
      </div>
      {site && site !== String(assessment.siteId) && (
        <div className="space-y-2">
          <InlineAlert tone="warning">
            Imported SiteRef {site} differs from browser SiteNo {assessment.siteId}. These remain different sites unless
            you explicitly confirm their relationship. Site-series identifiers must still match exactly.
          </InlineAlert>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              disabled={!series}
              checked={siteMappingConfirmed}
              onChange={(event) => setConfirmedFor(event.target.checked ? aliasKey : '')}
            />
            I confirm that this imported SiteRef represents this browser assessment site
          </label>
        </div>
      )}
      <NumberField
        label="Probability tolerance (percentage points)"
        value={tolerancePoints}
        onValueChange={setTolerancePoints}
        min={0}
        max={MAX_REFERENCE_TOLERANCE * 100}
        step={0.000001}
        description="Applies to probabilities only. Suitability classes must match exactly. A tolerance of 0.1 pp equals 0.001 in source proportions."
      />
      <CollapsibleSection
        label="Reference version information (optional)"
        collapseOn="always"
        className="rounded-md border"
        contentClassName="space-y-3 px-3 pb-3"
      >
        <p className="text-xs text-muted-foreground">
          Record information supplied with the original export. These entries do not verify its calculation parameters.
        </p>
        {METADATA_FIELDS.map(([key, label]) => (
          <FormField key={key} label={label}>
            <input
              className={FORM_INPUT_CLASS}
              maxLength={500}
              value={metadata[key]}
              onChange={(event) => setMetadata({ ...metadata, [key]: event.target.value })}
            />
          </FormField>
        ))}
      </CollapsibleSection>
      {result.error && <InlineAlert tone="error">{result.error}</InlineAlert>}
      {(!site || !series) && (
        <InlineAlert tone="info">Choose the imported site and site series to align reference fields.</InlineAlert>
      )}
      {comparison && (
        <>
          <AlertList items={comparison.warnings} />
          <SidebarSection title="Reference field agreement">
            <StatGroup
              variant="tiles"
              size="sm"
              align="start"
              columns={3}
              items={[
                { label: 'Fields with both values', value: comparison.counts.matched },
                { label: 'Within tolerance', value: comparison.counts.withinTolerance },
                { label: 'Different', value: comparison.counts.different },
                { label: 'Browser missing', value: comparison.counts.missingBrowser },
                { label: 'Reference missing', value: comparison.counts.missingReference },
                { label: 'Both missing', value: comparison.counts.bothMissing },
              ]}
            />
            <p className="mt-3 text-xs text-muted-foreground">
              Scientific parity verified: <strong>false</strong>. Scope: browser {comparison.alignment.browserSite}/
              {comparison.alignment.browserSeries ?? 'No series'} versus imported {comparison.alignment.referenceSite}/
              {comparison.alignment.referenceSeries ?? 'No series'}
              {comparison.alignment.aliasApplied ? ' · User-asserted site mapping applied.' : '.'}
            </p>
          </SidebarSection>
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField label="Search reference comparison">
              <input
                className={FORM_INPUT_CLASS}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Species, period or class…"
              />
            </FormField>
            <SelectField
              label="Reference comparison measure"
              value={measure}
              onChange={(event) => setMeasure(event.target.value)}
            >
              <option value="">All measures</option>
              {[...new Set(comparison.rows.map((row) => row.measure))].sort().map((value) => (
                <option key={value}>{value}</option>
              ))}
            </SelectField>
            <SelectField
              label="Reference row status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="all">All rows</option>
              <option value="different">Different</option>
              <option value="within-tolerance">Within tolerance</option>
              <option value="missing">Missing values</option>
            </SelectField>
          </div>
          <SidebarSection title="Exact-field reference differences">
            <p className="mb-3 text-xs text-muted-foreground">
              Differences are browser minus reference. Probabilities use percentage points; classes show reference →
              browser category transitions. Showing {paged.first}–{paged.last} of {filtered.length} filtered rows.
            </p>
            {paged.visible.length ? (
              <div className="overflow-x-auto">
                <EngineeringTable rowHeaders className="whitespace-normal text-xs [&_td]:py-2 [&_tbody_th]:py-2">
                  <caption className="sr-only">Shiny reference field differences</caption>
                  <thead>
                    <tr>
                      <ColumnHeader label="Species / key" className="text-left" />
                      <ColumnHeader label="Period" className="text-left" />
                      <ColumnHeader label="Measure" className="text-left" />
                      <ColumnHeader label="Browser" />
                      <ColumnHeader label="Shiny reference" />
                      <ColumnHeader label="Difference" />
                      <ColumnHeader label="Status" className="text-left" />
                    </tr>
                  </thead>
                  <tbody>
                    {paged.visible.map((row) => (
                      <tr key={row.key}>
                        <th scope="row">
                          <span className="block">{row.species}</span>
                          <small className="block text-muted-foreground">
                            {row.site} · {row.series}
                            {row.referenceSite && row.referenceSite !== row.site
                              ? ` · Original SiteRef: ${row.referenceSite}`
                              : ''}
                          </small>
                        </th>
                        <td className="text-left">{row.period ?? 'Summary'}</td>
                        <td className="text-left">
                          {row.measure}
                          {row.class ? ` · ${row.class}` : ''}
                        </td>
                        <td>{referenceValue(row.browser, row)}</td>
                        <td>{referenceValue(row.reference, row)}</td>
                        <td>{referenceDelta(row)}</td>
                        <td className="text-left">{row.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </EngineeringTable>
              </div>
            ) : (
              <p role="status" className="text-sm">
                No reference rows match these filters.
              </p>
            )}
            {paged.pageCount > 1 && (
              <PaginationControls
                page={paged.page}
                pageCount={paged.pageCount}
                onPageChange={paged.setPage}
                label="Reference comparison pages"
                className="mt-3 px-0"
              />
            )}
          </SidebarSection>
          <DownloadActions
            actions={[
              { label: 'Download reference comparison JSON', onClick: () => download('json') },
              { label: 'Download reference comparison CSV', onClick: () => download('csv') },
              { label: 'Download printable reference comparison', onClick: () => download('html') },
            ]}
          />
        </>
      )}
    </div>
  )
}
