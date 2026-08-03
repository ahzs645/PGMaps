export interface ParseCsvOptions {
  /** Field separator. Defaults to a comma. */
  delimiter?: string
  /** Drop rows whose cells are all empty. Defaults to true. */
  skipEmptyRows?: boolean
}

/**
 * Parse delimited text into rows of cells, honouring quoted fields that contain
 * the delimiter, newlines, or escaped `""` quotes. Prefer this over
 * `text.split(',')`, which corrupts any quoted field.
 */
export function parseCsvRows(text: string, options: ParseCsvOptions = {}): string[][] {
  const { delimiter = ',', skipEmptyRows = true } = options
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  const pushRow = () => {
    row.push(cell)
    cell = ''
    if (!skipEmptyRows || row.some((value) => value !== '')) rows.push(row)
    row = []
  }

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]

    if (inQuotes) {
      if (char === '"') {
        // A doubled quote inside a quoted field is a literal quote.
        if (text[index + 1] === '"') {
          cell += '"'
          index += 1
        } else {
          inQuotes = false
        }
      } else {
        cell += char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
    } else if (char === delimiter) {
      row.push(cell)
      cell = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1
      pushRow()
    } else {
      cell += char
    }
  }

  pushRow()
  return rows
}

export interface ParseCsvRecordsOptions extends ParseCsvOptions {
  /** Trim surrounding whitespace from header names. Defaults to true. */
  trimHeaders?: boolean
}

/**
 * Parse delimited text into header-keyed records. Missing trailing cells read
 * back as empty strings rather than undefined.
 */
export function parseCsvRecords(
  text: string,
  options: ParseCsvRecordsOptions = {},
): Record<string, string>[] {
  const { trimHeaders = true, ...rowOptions } = options
  const [header, ...records] = parseCsvRows(text, rowOptions)
  if (!header) return []

  const keys = trimHeaders ? header.map((column) => column.trim()) : header

  return records.map((record) => {
    const entry: Record<string, string> = {}
    keys.forEach((key, index) => {
      entry[key] = record[index] ?? ''
    })
    return entry
  })
}

/** Split a single delimited line into cells. For whole documents use `parseCsvRows`. */
export function splitCsvLine(line: string, delimiter = ','): string[] {
  return parseCsvRows(line, { delimiter, skipEmptyRows: false })[0] ?? []
}
