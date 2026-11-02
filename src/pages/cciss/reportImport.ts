import JSZip from 'jszip'

export const REPORT_IMPORT_LIMITS = {
  csvBytes: 5_000_000,
  zipBytes: 20_000_000,
  archiveEntries: 1_000,
  csvEntries: 100,
} as const

export interface ReportArchive {
  name: string
  entries: string[]
  preferred: string | null
  read: (entry: string) => Promise<string>
}

// JSZip documents internalStream as its bounded browser-stream API, but its bundled
// 3.1 declarations omit it. Keep the missing surface narrow and locally typed.
interface CsvZipStream {
  on(event: 'data', listener: (chunk: Uint8Array) => void): this
  on(event: 'error', listener: (error: Error) => void): this
  on(event: 'end', listener: () => void): this
  pause(): this
  resume(): this
}
interface StreamingZipObject extends JSZip.JSZipObject {
  internalStream(type: 'uint8array'): CsvZipStream
}

/** Inspect the central directory before JSZip can collapse duplicate names. No files are extracted. */
function archiveEntries(bytes: Uint8Array): Map<string, number> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = bytes.length - 22
  for (; end >= Math.max(0, bytes.length - 65_557); end--) {
    if (view.getUint32(end, true) === 0x06054b50 && end + 22 + view.getUint16(end + 20, true) === bytes.length) break
  }
  if (end < Math.max(0, bytes.length - 65_557)) throw new Error('The ZIP directory is missing or corrupt.')
  const count = view.getUint16(end + 10, true)
  const directorySize = view.getUint32(end + 12, true)
  const directoryOffset = view.getUint32(end + 16, true)
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 8, true) !== count)
    throw new Error('Split ZIP archives are not supported.')
  if (count > REPORT_IMPORT_LIMITS.archiveEntries || directoryOffset === 0xffffffff || directorySize === 0xffffffff)
    throw new Error('The ZIP contains too many files or uses an unsupported ZIP64 directory.')
  if (directoryOffset + directorySize !== end) throw new Error('The ZIP directory has invalid bounds.')
  const entries = new Map<string, number>()
  const decoder = new TextDecoder()
  let offset = directoryOffset
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50)
      throw new Error('The ZIP directory is corrupt.')
    const nameLength = view.getUint16(offset + 28, true)
    const recordLength = 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true)
    if (offset + recordLength > end) throw new Error('The ZIP directory is corrupt.')
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
    if (entries.has(name)) throw new Error('The ZIP contains duplicate file paths. Choose an unambiguous export.')
    if (name.includes('\\') || name.startsWith('/') || name.split('/').includes('..'))
      throw new Error('The ZIP contains an unsupported file path.')
    if (view.getUint16(offset + 8, true) & 1) throw new Error('Password-protected ZIP files are not supported.')
    entries.set(name, view.getUint32(offset + 24, true))
    offset += recordLength
  }
  if (offset !== end) throw new Error('The ZIP directory has invalid records.')
  return entries
}

function decodeCsv(bytes: Uint8Array) {
  if (bytes.length > REPORT_IMPORT_LIMITS.csvBytes) throw new Error('Please select a CSV smaller than 5 MB.')
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('The CSV must use UTF-8 text encoding.')
  }
}

/** Decompression stops at the selected CSV limit even when its declared ZIP size is false. */
function readEntry(entry: JSZip.JSZipObject): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []
    let size = 0
    let stopped = false
    const stream = (entry as StreamingZipObject).internalStream('uint8array')
    stream
      .on('data', (chunk: Uint8Array) => {
        if (stopped) return
        size += chunk.length
        if (size > REPORT_IMPORT_LIMITS.csvBytes) {
          stopped = true
          stream.pause()
          reject(new Error('The selected CSV expands beyond the 5 MB limit.'))
        } else chunks.push(chunk)
      })
      .on('error', (error: Error) => {
        stopped = true
        reject(error)
      })
      .on('end', () => {
        if (stopped) return
        const bytes = new Uint8Array(size)
        let offset = 0
        for (const chunk of chunks) {
          bytes.set(chunk, offset)
          offset += chunk.length
        }
        try {
          resolve(decodeCsv(bytes))
        } catch (error) {
          reject(error)
        }
      })
      .resume()
  })
}

export async function openReportArchive(name: string, bytes: Uint8Array): Promise<ReportArchive> {
  if (bytes.length > REPORT_IMPORT_LIMITS.zipBytes) throw new Error('Please select a ZIP smaller than 20 MB.')
  const directory = archiveEntries(bytes)
  const zip = await JSZip.loadAsync(bytes)
  const entries = Object.values(zip.files)
    .filter((entry) => !entry.dir && /\.csv$/i.test(entry.name) && !entry.name.startsWith('__MACOSX/'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))
  if (!entries.length) throw new Error('No CSV results were found in this ZIP. RDS files are not supported.')
  if (entries.length > REPORT_IMPORT_LIMITS.csvEntries) throw new Error('The ZIP contains too many CSV files.')
  const named = entries.filter((entry) => /(^|\/)cciss_export\.csv$/i.test(entry))
  return {
    name,
    entries,
    preferred: named.length === 1 ? named[0] : entries.length === 1 ? entries[0] : null,
    async read(selected) {
      if (!entries.includes(selected)) throw new Error('Choose a CSV from this archive.')
      const entry = zip.file(selected)
      if (!entry || !directory.has(selected)) throw new Error('The selected CSV is unavailable.')
      if (directory.get(selected)! > REPORT_IMPORT_LIMITS.csvBytes)
        throw new Error('The selected CSV expands beyond the 5 MB limit.')
      return readEntry(entry)
    },
  }
}

export function readReportCsv(bytes: Uint8Array): string {
  return decodeCsv(bytes)
}
