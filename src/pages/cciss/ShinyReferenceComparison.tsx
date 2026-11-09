import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { SelectField } from '@/components/ui/form-field'
import { InlineAlert, SidebarSection } from '@/components/ui/map-panels'
import type { CurrentAssessment, CurrentSettings } from './currentAnalysis'
import { FileImportField } from './FileImportField'
import { openReportArchive, readReportCsv, REPORT_IMPORT_LIMITS, type ReportArchive } from './reportImport'
import { parseShinyReport } from './shinyReport'
import { ShinyReferenceResults, type ReferenceFile } from './ShinyReferenceResults'
import { errorMessage, useLatestRequest } from './useLatestRequest'

/** Imports an original Shiny export and compares it field by field with the live browser assessment. */
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
  const request = useLatestRequest()

  function accept(text: string, name: string, revision: number) {
    const report = parseShinyReport(text)
    if (!request.isLatest(revision)) return
    setLoaded({ report, name, revision })
    setArchive(null)
    setArchiveEntry('')
  }
  async function run(task: (revision: number) => Promise<void>) {
    const revision = request.next()
    setBusy(true)
    setError('')
    try {
      await task(revision)
    } catch (cause) {
      if (request.isLatest(revision)) setError(errorMessage(cause))
    } finally {
      if (request.isLatest(revision)) setBusy(false)
    }
  }
  const importFile = (file: File) =>
    run(async (revision) => {
      const zip = /\.zip$/i.test(file.name)
      if (file.size > (zip ? REPORT_IMPORT_LIMITS.zipBytes : REPORT_IMPORT_LIMITS.csvBytes))
        throw new Error('Choose a CSV smaller than 5 MB or ZIP smaller than 20 MB.')
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (!zip) return accept(readReportCsv(bytes), file.name, revision)
      const next = await openReportArchive(file.name, bytes)
      if (!request.isLatest(revision)) return
      if (next.preferred) accept(await next.read(next.preferred), `${file.name} → ${next.preferred}`, revision)
      else {
        setArchive(next)
        setArchiveEntry('')
      }
    })
  const readArchive = () =>
    run(async (revision) => {
      if (archive && archiveEntry)
        accept(await archive.read(archiveEntry), `${archive.name} → ${archiveEntry}`, revision)
    })

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
      <FileImportField
        label="Import Shiny reference CSV or ZIP"
        description="Use the original Shiny Export CSV or its ZIP archive. Files remain local to this browser."
        accept=".csv,.zip,text/csv,application/zip"
        buttonLabel="Import CSV or ZIP"
        disabled={busy}
        onFile={(file) => void importFile(file)}
        onError={(cause) => setError(errorMessage(cause))}
      />
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
        <ShinyReferenceResults
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
