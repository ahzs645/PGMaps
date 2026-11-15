import { useState } from 'react'
import { Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FileButton } from '@/components/ui/file-button'
import { InfoTip } from '@/components/ui/info-tip'
import { insetBox } from '@/components/ui/inset-box'
import { SheetSymbolSwatch } from '@/components/ui/sheet-symbol-swatch'
import { loadSqlJs } from '@/lib/browserSqlite'
import type { SheetSymbol } from '@/lib/mapSheet/symbols'
import type { ExchangeDiagnostic, ExchangeFormat } from '@/lib/styleExchange/model'
import { STYLE_FILE_ACCEPT } from '@/lib/styleExchange/fileTypes'
import type { StyleFileRead } from '@/lib/styleExchange/readStyleFile'
import { cn } from '@/lib/utils'
import { RoadSelect } from './Controls'
import {
  addStyles,
  assignRole,
  defaultRoleSymbol,
  emptyRoadStyleLibrary,
  parseRoadStyleLibrary,
  removeStyle,
  STYLE_ROLES,
  type RoadStyleLibrary,
  type StyleRole,
} from './styleLibrary'

export const STYLE_LIBRARY_STORAGE_KEY = 'pgmaps.forestryRoads.styleLibrary'

type LibraryStorage = Pick<Storage, 'getItem' | 'setItem'>
const browserStorage = (): LibraryStorage | null => {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** The style library saved in this browser; an empty one when there is none or it cannot be read. */
export function readStoredStyleLibrary(storage: LibraryStorage | null = browserStorage()): RoadStyleLibrary {
  try {
    const text = storage?.getItem(STYLE_LIBRARY_STORAGE_KEY)
    return text ? parseRoadStyleLibrary(JSON.parse(text)) : emptyRoadStyleLibrary()
  } catch {
    return emptyRoadStyleLibrary()
  }
}

/** One symbol found in an imported file, offered for saving. */
interface Candidate {
  key: string
  name: string
  fileName: string
  format: ExchangeFormat
  symbol: SheetSymbol
  notes: string[]
}

const noteText = (d: ExchangeDiagnostic) => `${d.subject ? `${d.subject}: ` : ''}${d.message}`

/** Every symbol a read found, from its styled layers' rules and its library, with the notes about it. */
export function importCandidates(reads: readonly StyleFileRead[]): Candidate[] {
  const out: Candidate[] = []
  for (const read of reads) {
    const result = read.result
    if (!result) continue
    const fileName = read.fileName.split('/').pop() ?? read.fileName
    const notesFor = (...subjects: string[]) =>
      result.diagnostics
        .filter((d) => d.severity !== 'info' && (!d.subject || subjects.includes(d.subject)))
        .map(noteText)
    for (const layer of result.layers)
      for (const rule of layer.rules)
        out.push({
          key: `${read.fileName}#${layer.id}#${out.length}`,
          name: layer.rules.length > 1 ? `${layer.name}: ${rule.label}` : layer.name,
          fileName,
          format: result.format,
          symbol: rule.symbol,
          notes: notesFor(layer.name, layer.id, rule.label),
        })
    for (const entry of result.symbols)
      out.push({
        key: `${read.fileName}#${entry.id}#${out.length}`,
        name: entry.name,
        fileName,
        format: result.format,
        symbol: entry.symbol,
        notes: notesFor(entry.name, entry.id),
      })
  }
  return out
}

const heading = 'text-3xs font-semibold uppercase tracking-wide text-muted-foreground'
const KIND_LABEL: Record<SheetSymbol['kind'], string> = { line: 'line', area: 'area', point: 'point', class: 'class' }

/**
 * Map styles in this browser for the styled GIS exports: which symbol each exported feature draws
 * with, styles read from other programs' files, and the saved list. A style only changes the files
 * written from Save & export; the plan keeps PGMaps' own symbols.
 */
export function StyleLibraryPanel({
  storage = browserStorage(),
  onChange,
}: {
  storage?: LibraryStorage | null
  /** After the library changes, so the export preview can rebuild. */
  onChange?: () => void
}) {
  const [library, setLibrary] = useState(() => readStoredStyleLibrary(storage))
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [problems, setProblems] = useState<string[]>([])
  const [reading, setReading] = useState(false)
  const [message, setMessage] = useState<{ text: string; error?: boolean; undo?: () => void } | null>(null)

  const keep = (next: RoadStyleLibrary) => {
    try {
      storage?.setItem(STYLE_LIBRARY_STORAGE_KEY, JSON.stringify(next))
    } catch {
      setMessage({
        text: 'This browser would not store the library. Free some site storage and try again.',
        error: true,
      })
      return false
    }
    setLibrary(next)
    onChange?.()
    return true
  }
  const attempt = (action: () => void) => {
    try {
      action()
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : 'Check the style.', error: true })
    }
  }

  const importFile = async (file: File) => {
    setReading(true)
    setMessage(null)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const lower = file.name.toLowerCase()
      const SQL =
        lower.endsWith('.stylx') || lower.endsWith('.zip') ? await loadSqlJs().catch(() => undefined) : undefined
      const { readStyleFile } = await import('@/lib/styleExchange/readStyleFile')
      const reads = readStyleFile(file.name, bytes, { SQL })
      const found = importCandidates(reads)
      const fileProblems = reads.flatMap((read) => {
        if (read.error) return [`${read.fileName}: ${read.error}`]
        const unreadable = (read.result?.diagnostics ?? []).filter((d) => d.severity === 'error')
        return unreadable.map((d) => `${read.fileName.split('/').pop()}: ${noteText(d)}`)
      })
      setCandidates(found)
      setChosen(new Set(found.map((candidate) => candidate.key)))
      setProblems(fileProblems)
      if (!found.length)
        setMessage({ text: `No symbol in “${file.name}” could be read. The list below says why.`, error: true })
    } catch (error) {
      setMessage({
        text: `“${file.name}” was not read: ${error instanceof Error ? error.message : 'unknown error'}`,
        error: true,
      })
    } finally {
      setReading(false)
    }
  }

  const save = () =>
    attempt(() => {
      const picked = candidates.filter((candidate) => chosen.has(candidate.key))
      const savedOn = new Date().toISOString()
      const next = addStyles(
        library,
        picked.map((candidate) => ({
          name: candidate.name,
          fileName: candidate.fileName,
          format: candidate.format,
          savedOn,
          symbol: candidate.symbol,
          notes: candidate.notes,
        })),
      )
      if (!keep(next)) return
      setCandidates([])
      setProblems([])
      setMessage({ text: `Saved ${picked.length} style${picked.length === 1 ? '' : 's'} in this browser.` })
    })

  const remove = (id: string) => {
    const before = library
    const style = library.styles.find((s) => s.id === id)
    if (!style || !keep(removeStyle(library, id))) return
    setMessage({
      text: `Deleted “${style.name}” from this browser.`,
      undo: () => keep(before) && setMessage({ text: `Restored “${style.name}”.` }),
    })
  }

  const assign = (role: StyleRole, value: string) =>
    attempt(() => {
      keep(assignRole(library, role, value === 'pgmaps' ? null : value))
    })

  return (
    <section className={cn(insetBox({ tone: 'muted' }), 'space-y-3 text-xs')} data-testid="road-style-library">
      <div className="flex items-center gap-2">
        <h4 className={heading}>Map styles</h4>
        <InfoTip label="About map styles">
          Styles read from QGIS (.qml, .qgz, style library .xml), ArcGIS Pro (.lyrx, .mapx, .stylx), SLD, MapLibre or
          GeoLibre files, kept in this browser. Choose one for a feature and the styled GIS exports draw that feature
          with it instead of PGMaps&apos; own symbol; the plan, its legend and the block sheets keep PGMaps&apos;
          symbols. Symbols drawn from a font or a picture are not read: choose a PGMaps icon instead.
        </InfoTip>
      </div>

      <div className="space-y-1">
        <h5 className={heading}>Exported features draw with</h5>
        <ul className="divide-y divide-border" aria-label="Exported features and their styles">
          {STYLE_ROLES.map(({ role, label, kind }) => {
            const id = library.roles[role]
            const style = library.styles.find((s) => s.id === id)
            const options = [
              { value: 'pgmaps', label: 'PGMaps symbol' },
              ...library.styles.filter((s) => s.symbol.kind === kind).map((s) => ({ value: s.id, label: s.name })),
            ]
            return (
              <li key={role} className="grid grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,1.2fr)] items-center gap-2 py-1">
                <SheetSymbolSwatch symbol={style?.symbol ?? defaultRoleSymbol(role)} widthPt={22} heightPt={11} />
                <span>{label}</span>
                <RoadSelect
                  value={style ? style.id : 'pgmaps'}
                  onValueChange={(value) => assign(role, value)}
                  options={options}
                  ariaLabel={`Style for ${label}`}
                  disabled={options.length === 1}
                  title={options.length === 1 ? `Import a ${KIND_LABEL[kind]} style first.` : undefined}
                />
              </li>
            )
          })}
        </ul>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <h5 className={heading}>Import a style file</h5>
          <FileButton
            label="Import a style file"
            accept={STYLE_FILE_ACCEPT}
            className="h-8"
            disabled={reading}
            onFiles={(files) => files[0] && void importFile(files[0])}
          >
            <Upload className="size-3.5" />
            {reading ? 'Reading…' : 'Import'}
          </FileButton>
        </div>
        {candidates.length > 0 && (
          <>
            <ul className="max-h-64 divide-y divide-border overflow-y-auto" aria-label="Symbols found in the file">
              {candidates.map((candidate) => (
                <li key={candidate.key} className="flex items-start gap-2 py-1">
                  <input
                    type="checkbox"
                    className="mt-1"
                    aria-label={`Save ${candidate.name}`}
                    checked={chosen.has(candidate.key)}
                    onChange={(event) =>
                      setChosen((current) => {
                        const next = new Set(current)
                        if (event.target.checked) next.add(candidate.key)
                        else next.delete(candidate.key)
                        return next
                      })
                    }
                  />
                  <SheetSymbolSwatch symbol={candidate.symbol} widthPt={22} heightPt={11} className="mt-0.5" />
                  <div className="min-w-0">
                    <div className="truncate">{candidate.name}</div>
                    <div className="text-muted-foreground">
                      {candidate.fileName} · {KIND_LABEL[candidate.symbol.kind]}
                    </div>
                    {candidate.notes.length > 0 && (
                      <ul className="text-warning">
                        {candidate.notes.slice(0, 4).map((note) => (
                          <li key={note}>Approximated: {note}</li>
                        ))}
                        {candidate.notes.length > 4 && <li>…and {candidate.notes.length - 4} more.</li>}
                      </ul>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-1">
              <Button size="field" variant="ghost" onClick={() => setCandidates([])}>
                Discard
              </Button>
              <Button size="field" variant="outline" disabled={!chosen.size} onClick={save}>
                Save {chosen.size} to library
              </Button>
            </div>
          </>
        )}
        {problems.length > 0 && (
          <details className="text-muted-foreground">
            <summary>
              {problems.length} part{problems.length === 1 ? '' : 's'} not read
            </summary>
            <ul className="mt-1 list-disc pl-4">
              {problems.slice(0, 40).map((problem, i) => (
                <li key={i}>{problem}</li>
              ))}
              {problems.length > 40 && <li>…and {problems.length - 40} more.</li>}
            </ul>
          </details>
        )}
      </div>

      <div className="space-y-1">
        <h5 className={heading}>Saved in this browser</h5>
        {library.styles.length ? (
          <ul className="max-h-56 divide-y divide-border overflow-y-auto" aria-label="Saved styles">
            {library.styles.map((style) => (
              <li key={style.id} className="flex items-center gap-2 py-1">
                <SheetSymbolSwatch symbol={style.symbol} widthPt={22} heightPt={11} />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{style.name}</div>
                  <div className="truncate text-muted-foreground" title={style.notes.join('\n') || undefined}>
                    {style.fileName}
                    {style.notes.length ? ` · ${style.notes.length} approximated` : ''}
                  </div>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  aria-label={`Delete ${style.name}`}
                  title="Delete from this browser"
                  onClick={() => remove(style.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">No styles saved yet.</p>
        )}
      </div>

      {message && (
        <p
          role={message.error ? 'alert' : 'status'}
          className={message.error ? 'text-warning' : 'text-muted-foreground'}
        >
          {message.text}
          {message.undo && (
            <>
              {' '}
              <button type="button" className="underline underline-offset-2" onClick={message.undo}>
                Undo
              </button>
            </>
          )}
        </p>
      )}
    </section>
  )
}
