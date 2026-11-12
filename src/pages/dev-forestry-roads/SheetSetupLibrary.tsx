import { useState } from 'react'
import { Download, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FileButton } from '@/components/ui/file-button'
import { InfoTip } from '@/components/ui/info-tip'
import { downloadText } from '@/lib/download'
import { DEFAULT_BLOCK_SHEET, type BlockSheetSettings } from './blockSheet'
import { Field, roadFieldClass, RoadSelect } from './Controls'
import { createRoadReportSettings, type RoadReportSettings } from './reportSettings'
import {
  applySheetSetup,
  createSheetSetup,
  describeSheetSetup,
  emptySheetSetupLibrary,
  MAX_SHEET_SETUP_FILE_BYTES,
  MAX_SHEET_SETUP_NAME,
  parseSheetSetupLibrary,
  removeSheetSetup,
  saveSheetSetup,
  serializeSheetSetup,
  sheetSetupFilename,
  sheetSetupFromFile,
  type SheetSetupLibrary as Library,
} from './sheetSetups'

export const SHEET_SETUP_STORAGE_KEY = 'pgmaps.forestryRoads.sheetSetups'

type SetupStorage = Pick<Storage, 'getItem' | 'setItem'>
const browserStorage = (): SetupStorage | null => {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function readLibrary(storage: SetupStorage | null): Library {
  try {
    const text = storage?.getItem(SHEET_SETUP_STORAGE_KEY)
    return text ? parseSheetSetupLibrary(JSON.parse(text)) : emptySheetSetupLibrary()
  } catch {
    return emptySheetSetupLibrary()
  }
}

/**
 * Saved sheet setups in this browser: apply one to this project, save the current plot book and
 * block sheet settings under a name, download one as a file, or read one from a setup file or a
 * project file's plot-book settings.
 */
export function SheetSetupLibrary({
  plotBook,
  onPlotBook,
  blockSheet,
  storage = browserStorage(),
}: {
  plotBook?: RoadReportSettings
  onPlotBook?: (settings: RoadReportSettings) => void
  /** The block sheet's settings and how to apply new ones; omit where the tool has no block sheet. */
  blockSheet?: { value: BlockSheetSettings; onApply: (settings: BlockSheetSettings) => void }
  storage?: SetupStorage | null
}) {
  const [library, setLibrary] = useState(() => readLibrary(storage))
  const [chosen, setChosen] = useState(() => library.setups[0]?.name ?? '')
  const [name, setName] = useState('')
  const [message, setMessage] = useState<{ text: string; error?: boolean; undo?: () => void } | null>(null)
  const current = library.setups.find((setup) => setup.name === chosen) ?? library.setups[0]
  const keep = (next: Library) => {
    setLibrary(next)
    try {
      storage?.setItem(SHEET_SETUP_STORAGE_KEY, JSON.stringify(next))
      return true
    } catch {
      setMessage({ text: 'This browser would not store the setup; download it to keep it.', error: true })
      return false
    }
  }
  const attempt = (action: () => void) => {
    try {
      action()
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : 'Check the setup.', error: true })
    }
  }
  const save = () =>
    attempt(() => {
      const setup = createSheetSetup(name, {
        plotBook: onPlotBook ? (plotBook ?? createRoadReportSettings()) : undefined,
        blockSheet: blockSheet?.value,
      })
      const replacing = library.setups.some((entry) => entry.name.toLowerCase() === setup.name.toLowerCase())
      if (!keep(saveSheetSetup(library, setup))) return
      setChosen(setup.name)
      setName('')
      setMessage({ text: `${replacing ? 'Replaced' : 'Saved'} “${setup.name}” in this browser.` })
    })
  const apply = () =>
    attempt(() => {
      if (!current) return
      const applied = applySheetSetup(current, { blockSheet: blockSheet?.value ?? DEFAULT_BLOCK_SHEET })
      const parts: string[] = []
      if (applied.plotBook && onPlotBook) {
        onPlotBook(applied.plotBook)
        parts.push('plot book and report contents')
      }
      if (applied.blockSheet && blockSheet) {
        blockSheet.onApply(applied.blockSheet)
        parts.push('block sheet')
      }
      setMessage(
        parts.length
          ? { text: `Applied “${current.name}” to the ${parts.join(' and the ')}.` }
          : { text: `“${current.name}” holds no settings this tool uses.`, error: true },
      )
    })
  const remove = () => {
    if (!current) return
    const before = library,
      deleted = current
    const next = removeSheetSetup(library, deleted.name)
    if (!keep(next)) return
    setChosen(next.setups[0]?.name ?? '')
    // Delete sits beside Download; one press can be taken back until the next message.
    setMessage({
      text: `Deleted “${deleted.name}” from this browser.`,
      undo: () => {
        if (!keep(before)) return
        setChosen(deleted.name)
        setMessage({ text: `Restored “${deleted.name}”.` })
      },
    })
  }
  const importFile = (file: File) => {
    if (file.size > MAX_SHEET_SETUP_FILE_BYTES) {
      setMessage({ text: `“${file.name}” was not imported: it is too large to be a sheet setup.`, error: true })
      return
    }
    // A refused file is named, and said not to be imported, before the reason.
    const refused = (reason: string) => setMessage({ text: `“${file.name}” was not imported. ${reason}`, error: true })
    void file.text().then(
      (text) => {
        try {
          const setup = sheetSetupFromFile(text)
          if (!keep(saveSheetSetup(library, setup))) return
          setChosen(setup.name)
          setMessage({ text: `Added “${setup.name}”. Apply it to use it here.` })
        } catch (error) {
          refused(error instanceof Error ? error.message : 'Check the setup.')
        }
      },
      () => refused('The file could not be read.'),
    )
  }
  const heading = 'text-3xs font-semibold uppercase tracking-wide text-muted-foreground'
  return (
    <section className="space-y-2 rounded-md border bg-muted/20 p-2.5 text-xs" data-testid="sheet-setup-library">
      <div className="flex items-center gap-2">
        <h4 className={heading}>Saved setups</h4>
        <InfoTip label="About saved setups">
          A setup keeps the plot book&apos;s paper, chapters, scales, subviews, labels and report contents, and the
          block sheet&apos;s sheet, paper, scale and typed fields. It never keeps the block a sheet shows or its access
          comments. Setups are kept in this browser; download one to use it on another computer, or import a setup file
          or a project file&apos;s plot-book settings.
        </InfoTip>
      </div>
      {current ? (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-end gap-1">
            <RoadSelect
              value={current.name}
              onValueChange={setChosen}
              options={library.setups.map((setup) => ({ value: setup.name, label: setup.name }))}
              ariaLabel="Saved sheet setup"
            />
            <Button size="sm" variant="outline" className="h-8" onClick={apply}>
              Apply
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="size-8"
              aria-label={`Download ${current.name}`}
              title="Download as a file"
              onClick={() =>
                downloadText(serializeSheetSetup(current), sheetSetupFilename(current), 'application/json')
              }
            >
              <Download className="size-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="size-8"
              aria-label={`Delete ${current.name}`}
              title="Delete from this browser"
              onClick={remove}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
          <ul className="text-muted-foreground" aria-label={`What ${current.name} sets`}>
            {describeSheetSetup(current).map((line) => (
              <li key={line}>{line}</li>
            ))}
            {current.savedOn && <li>Saved {current.savedOn}</li>}
          </ul>
        </>
      ) : (
        <p className="text-muted-foreground">No setups saved in this browser.</p>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-end gap-1">
        <Field label="Save current setup as">
          <input
            className={roadFieldClass}
            value={name}
            maxLength={MAX_SHEET_SETUP_NAME}
            placeholder="e.g. Office 11 × 17"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && name.trim()) {
                event.preventDefault()
                save()
              }
            }}
          />
        </Field>
        <Button size="sm" variant="outline" className="h-8" disabled={!name.trim()} onClick={save}>
          Save
        </Button>
        <FileButton
          label="Import a sheet setup or project file"
          accept=".json,application/json"
          className="h-8"
          onFiles={(files) => files[0] && importFile(files[0])}
        >
          <Upload className="size-3.5" />
          Import
        </FileButton>
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
