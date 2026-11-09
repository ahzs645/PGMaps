import { useState } from 'react'
import { fetchGzipText } from '@/lib/fetchJson'
import { openReportArchive, readReportCsv, REPORT_IMPORT_LIMITS, type ReportArchive } from './reportImport'
import { parseShinyReport, type ShinyReport } from './shinyReport'
import { errorMessage, useLatestRequest } from './useLatestRequest'

const PUBLISHED_EXAMPLE = {
  url: '/data/cciss/report-examples/williams-lake-raw.csv.gz',
  name: 'Published Williams Lake example · historical periods',
}

/**
 * Loads a Shiny result from the published example, a CSV, or a CSV chosen inside a ZIP. The last
 * valid report stays loaded when another file fails. `onAccept` runs with each newly loaded report.
 */
export function useShinyReportImport(onAccept: (report: ShinyReport) => void) {
  const [report, setReport] = useState<ShinyReport | null>(null)
  const [source, setSource] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [archive, setArchive] = useState<ReportArchive | null>(null)
  const [archiveEntry, setArchiveEntry] = useState('')
  const request = useLatestRequest()

  const accept = (parsed: ShinyReport, name: string) => {
    setReport(parsed)
    setSource(name)
    onAccept(parsed)
  }
  async function run(task: (revision: number) => Promise<void>) {
    const revision = request.next()
    setLoading(true)
    setError('')
    try {
      await task(revision)
    } catch (cause) {
      if (request.isLatest(revision)) setError(errorMessage(cause))
    } finally {
      if (request.isLatest(revision)) setLoading(false)
    }
  }
  /** Parse text from `read`; an archive entry keeps its archive's entry list. */
  const load = (read: () => Promise<string>, name: string, keepArchive = false) =>
    run(async (revision) => {
      const parsed = parseShinyReport(await read())
      if (!request.isLatest(revision)) return
      accept(parsed, name)
      if (!keepArchive) {
        setArchive(null)
        setArchiveEntry('')
      }
    })

  return {
    report,
    source,
    error,
    loading,
    archive,
    archiveEntry,
    /** Report a failure from outside a load, such as a dropped folder that could not be read. */
    fail: (cause: unknown) => setError(errorMessage(cause)),
    loadExample: () => load(() => fetchGzipText(PUBLISHED_EXAMPLE.url), PUBLISHED_EXAMPLE.name),
    chooseArchiveEntry: (entry: string) => {
      setArchiveEntry(entry)
      if (entry && archive) void load(() => archive.read(entry), `${archive.name} / ${entry}`, true)
    },
    importFile: (file: File) =>
      run(async (revision) => {
        const zip = /\.zip$/i.test(file.name)
        if (file.size > (zip ? REPORT_IMPORT_LIMITS.zipBytes : REPORT_IMPORT_LIMITS.csvBytes))
          throw new Error(zip ? 'Please select a ZIP smaller than 20 MB.' : 'Please select a CSV smaller than 5 MB.')
        const bytes = new Uint8Array(await file.arrayBuffer())
        if (!request.isLatest(revision)) return
        if (!zip) {
          accept(parseShinyReport(readReportCsv(bytes)), file.name)
          setArchive(null)
          setArchiveEntry('')
          return
        }
        const next = await openReportArchive(file.name, bytes)
        if (!request.isLatest(revision)) return
        setArchive(next)
        setArchiveEntry(next.preferred ?? '')
        if (next.preferred) {
          const parsed = parseShinyReport(await next.read(next.preferred))
          if (request.isLatest(revision)) accept(parsed, `${file.name} / ${next.preferred}`)
        }
      }),
  }
}
