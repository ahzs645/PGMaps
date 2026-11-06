import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { FORM_INPUT_CLASS, FormField, NumberField, SelectField } from '@/components/ui/form-field'
import { InlineAlert, SidebarSection } from '@/components/ui/map-panels'
import { PaginationControls } from '@/components/ui/pagination-controls'
import { downloadText } from '@/lib/download'
import type { CurrentAssessment, CurrentSettings } from './currentAnalysis'
import { openReportArchive, readReportCsv, REPORT_IMPORT_LIMITS, type ReportArchive } from './reportImport'
import { compareShinyReference, DEFAULT_REFERENCE_TOLERANCE, MAX_REFERENCE_TOLERANCE } from './referenceComparison'
import {
  referenceComparisonCsv,
  referenceComparisonHtml,
  referenceComparisonJson,
  referenceDelta,
  referenceValue,
  type ReferenceComparisonReport,
} from './referenceComparisonExport'
import { parseShinyReport, type ShinyReport } from './shinyReport'

interface ReferenceFile {
  name: string
  report: ShinyReport
  revision: number
}
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function ShinyReferenceComparison({
  assessment,
  settings,
  sourceFile,
}: {
  assessment: CurrentAssessment
  settings: CurrentSettings
  sourceFile?: string
}) {
  const [loaded, setLoaded] = useState<ReferenceFile | null>(null)
  const [archive, setArchive] = useState<ReportArchive | null>(null)
  const [archiveEntry, setArchiveEntry] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef(0)
  useEffect(
    () => () => {
      request.current++
    },
    [],
  )
  function accept(text: string, name: string, revision: number) {
    const report = parseShinyReport(text)
    if (revision !== request.current) return
    setLoaded({ report, name, revision })
    setArchive(null)
    setArchiveEntry('')
  }
  async function importFile(file: File) {
    const revision = ++request.current
    setBusy(true)
    setError('')
    try {
      if (file.size > (/\.zip$/i.test(file.name) ? REPORT_IMPORT_LIMITS.zipBytes : REPORT_IMPORT_LIMITS.csvBytes))
        throw new Error('Choose a CSV smaller than 5 MB or ZIP smaller than 20 MB.')
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (/\.zip$/i.test(file.name)) {
        const next = await openReportArchive(file.name, bytes)
        if (revision !== request.current) return
        if (next.preferred) accept(await next.read(next.preferred), `${file.name} → ${next.preferred}`, revision)
        else {
          setArchive(next)
          setArchiveEntry('')
        }
      } else accept(readReportCsv(bytes), file.name, revision)
    } catch (error) {
      if (revision === request.current) setError(message(error))
    } finally {
      if (revision === request.current) setBusy(false)
    }
  }
  async function readArchive() {
    if (!archive || !archiveEntry) return
    const revision = ++request.current
    setError('')
    setBusy(true)
    try {
      accept(await archive.read(archiveEntry), `${archive.name} → ${archiveEntry}`, revision)
    } catch (error) {
      if (revision === request.current) setError(message(error))
    } finally {
      if (revision === request.current) setBusy(false)
    }
  }
  return (
    <div className="space-y-4">
      <InlineAlert tone="info">
        Compare this live browser assessment with an original Shiny result. Choose the exact reference site and site
        series. The comparison reports numerical differences and missing fields; it does not establish global scientific
        parity.
      </InlineAlert>
      <p className="text-sm">
        Browser site: <strong>{assessment.siteId}</strong> · Site series:{' '}
        <strong>{assessment.series ?? 'Unavailable'}</strong> · Source: {sourceFile ?? assessment.provenance.source}.
      </p>
      {assessment.provenance.synthetic && (
        <InlineAlert tone="warning">
          The browser assessment uses synthetic verification data. It cannot validate ecological predictions.
        </InlineAlert>
      )}
      <FormField
        label="Import Shiny reference CSV or ZIP"
        description="Use the original Shiny Export CSV or its ZIP archive. Files remain local to this browser."
      >
        <input
          type="file"
          accept=".csv,.zip,text/csv,application/zip"
          className="block w-full text-sm"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void importFile(file)
            event.target.value = ''
          }}
        />
      </FormField>
      {busy && <InlineAlert loading>Reading Shiny reference…</InlineAlert>}
      {error && (
        <InlineAlert tone="error">
          <p>{error}</p>
          {loaded && <p>The previous valid reference remains loaded: {loaded.name}.</p>}
        </InlineAlert>
      )}
      {archive && (
        <SidebarSection title={`Choose a CSV in ${archive.name}`}>
          <div className="space-y-3">
            <SelectField
              label="Shiny reference CSV in ZIP"
              value={archiveEntry}
              onChange={(event) => setArchiveEntry(event.target.value)}
            >
              <option value="">Choose a CSV</option>
              {archive.entries.map((entry) => (
                <option key={entry}>{entry}</option>
              ))}
            </SelectField>
            <Button disabled={!archiveEntry || busy} onClick={() => void readArchive()}>
              Load selected Shiny reference
            </Button>
          </div>
        </SidebarSection>
      )}
      {loaded && (
        <ReferenceResults
          key={loaded.revision}
          loaded={loaded}
          assessment={assessment}
          settings={settings}
          sourceFile={sourceFile}
        />
      )}
    </div>
  )
}

function ReferenceResults({
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
      return { comparison: null, error: message(error) }
    }
  }, [assessment, settings, report, site, series, siteMappingConfirmed, tolerancePoints, referenceMetadata])
  const comparison = result.comparison
  const [query, setQuery] = useState('')
  const search = useDeferredValue(query.trim().toLowerCase())
  const [status, setStatus] = useState('all')
  const [measure, setMeasure] = useState('')
  const [pageState, setPageState] = useState({ key: '', index: 0 })
  const filtersKey = JSON.stringify([site, series, search, status, measure])
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
  const pageCount = Math.max(1, Math.ceil(filtered.length / 40))
  const page = Math.min(pageState.key === filtersKey ? pageState.index : 0, pageCount - 1)
  const visible = filtered.slice(page * 40, (page + 1) * 40)
  function exportReport(): ReferenceComparisonReport | null {
    return comparison
      ? {
          schema: 'cciss-shiny-reference-report-v1',
          generatedAt: new Date().toISOString(),
          browserSource: sourceFile ?? assessment.provenance.source,
          referenceSource: name,
          browserProvenance: assessment.provenance,
          browserSettings: settings,
          referenceMetadata,
          comparison,
        }
      : null
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
      <details className="rounded-md border border-border p-3">
        <summary className="cursor-pointer text-sm font-medium">Reference version information (optional)</summary>
        <div className="mt-3 space-y-3">
          <p className="text-xs text-muted-foreground">
            Record information supplied with the original export. These entries do not verify its calculation
            parameters.
          </p>
          {(['datasetVersion', 'ccissrCommit', 'shinyCommit'] as const).map((key) => (
            <FormField
              key={key}
              label={
                key === 'datasetVersion'
                  ? 'Reference dataset version'
                  : key === 'ccissrCommit'
                    ? 'Reference ccissr commit'
                    : 'Reference Shiny commit'
              }
            >
              <input
                className={FORM_INPUT_CLASS}
                maxLength={500}
                value={metadata[key]}
                onChange={(event) => setMetadata({ ...metadata, [key]: event.target.value })}
              />
            </FormField>
          ))}
        </div>
      </details>
      {result.error && <InlineAlert tone="error">{result.error}</InlineAlert>}
      {!site || !series ? (
        <InlineAlert tone="info">Choose the imported site and site series to align reference fields.</InlineAlert>
      ) : null}
      {comparison && (
        <>
          <InlineAlert tone="warning">
            <ul className="list-disc space-y-1 pl-4">
              {comparison.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          </InlineAlert>
          <SidebarSection title="Reference field agreement">
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              {[
                ['Fields with both values', comparison.counts.matched],
                ['Within tolerance', comparison.counts.withinTolerance],
                ['Different', comparison.counts.different],
                ['Browser missing', comparison.counts.missingBrowser],
                ['Reference missing', comparison.counts.missingReference],
                ['Both missing', comparison.counts.bothMissing],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="font-semibold tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
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
              browser category transitions. Showing {filtered.length ? page * 40 + 1 : 0}–
              {Math.min((page + 1) * 40, filtered.length)} of {filtered.length} filtered rows.
            </p>
            {visible.length ? (
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
                    {visible.map((row) => (
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
            {pageCount > 1 && (
              <PaginationControls
                page={page}
                pageCount={pageCount}
                onPageChange={(index) => setPageState({ key: filtersKey, index })}
                label="Reference comparison pages"
                className="mt-3 px-0"
              />
            )}
          </SidebarSection>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                const report = exportReport()
                if (report)
                  downloadText(referenceComparisonJson(report), 'cciss-shiny-reference.json', 'application/json')
              }}
            >
              Download reference comparison JSON
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const report = exportReport()
                if (report) downloadText(referenceComparisonCsv(report), 'cciss-shiny-reference.csv', 'text/csv')
              }}
            >
              Download reference comparison CSV
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const report = exportReport()
                if (report) downloadText(referenceComparisonHtml(report), 'cciss-shiny-reference.html', 'text/html')
              }}
            >
              Download printable reference comparison
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
