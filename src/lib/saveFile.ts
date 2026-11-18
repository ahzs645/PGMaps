/**
 * "Save as…": ask where to save a file with the browser's save dialog, and fall back to an
 * ordinary download where there is none.
 *
 * The user-gesture rule: call `saveFileAs` synchronously inside the click handler. Where the
 * browser has a save dialog (`window.showSaveFilePicker`, Chrome and Edge on desktop), the
 * dialog opens first, while the click still counts, and the file's content is built only after
 * the person has chosen where it goes; a slow build done first would lose the click and the
 * dialog would refuse to open. A cancelled dialog builds nothing. Without the dialog (Firefox,
 * Safari, phones) the content is built and downloaded through the toolkit's `downloadBlob`.
 *
 * This is offered beside a tool's Download button, never in place of it: the end-to-end suites
 * wait for the download event. `SaveAsButton` (`src/components/ui/save-as-button.tsx`) is the
 * button.
 *
 * Browser-only by default; the window and the download can be passed in, which is how it is
 * tested. Adapted from GeoLibre (MIT), `apps/geolibre-desktop/src/lib/file-io/file-dialogs.ts`
 * (`saveBinaryFileBrowser`, `BrowserFilePickerWindow`, `isAbortError`).
 */

import { downloadBlob } from '@/lib/download'

/** What the file is: shown as the dialog's file type and used to type the download. */
export type SaveFileType = {
  /** e.g. `application/pdf`. */
  mime: string
  /** e.g. `pdf` or `.pdf`. */
  extension: string
  /** e.g. `PDF document`. */
  description: string
}

export type SaveFileContent = Blob | string

export type SaveFileOptions = {
  /** The name offered; the extension is added when it is missing. */
  suggestedName: string
  type: SaveFileType
  /** Builds the file. Runs only after a place has been chosen (or at once, for the download fallback). */
  content: () => SaveFileContent | Promise<SaveFileContent>
  /** A name for the dialog to remember its folder by, per kind of file (e.g. `pgmaps-video`). */
  rememberFolderAs?: string
  environment?: SaveFileEnvironment
}

export type SaveFileResult =
  | { outcome: 'saved'; fileName: string }
  | { outcome: 'downloaded'; fileName: string }
  | { outcome: 'cancelled' }

/** The parts of the File System Access API used here. */
type WritableLike = {
  write(data: Blob): Promise<void>
  close(): Promise<void>
  abort?: (reason?: unknown) => Promise<void>
}
type SaveHandleLike = { name?: string; createWritable(): Promise<WritableLike> }
type SavePickerOptions = {
  suggestedName?: string
  types?: { description?: string; accept: Record<string, string[]> }[]
  excludeAcceptAllOption?: boolean
  id?: string
}
export type SaveFileEnvironment = {
  showSaveFilePicker?: ((options: SavePickerOptions) => Promise<SaveHandleLike>) | null
  download?: (blob: Blob, fileName: string) => void
}

export type SaveFileFailure = 'build-failed' | 'write-failed'

/** The file could not be built or written; `message` is written for the person saving. */
export class SaveFileError extends Error {
  /** What went wrong underneath, when anything did. */
  declare cause?: unknown
  readonly reason: SaveFileFailure
  constructor(reason: SaveFileFailure, message: string, options?: { cause?: unknown }) {
    super(message)
    // Set by hand: the ES2020 lib this project builds against has no `ErrorOptions`.
    if (options && 'cause' in options)
      Object.defineProperty(this, 'cause', { value: options.cause, configurable: true })
    this.name = 'SaveFileError'
    this.reason = reason
  }
}

function browserEnvironment(): SaveFileEnvironment {
  const picker =
    typeof window === 'undefined'
      ? null
      : (window as unknown as { showSaveFilePicker?: SaveFileEnvironment['showSaveFilePicker'] }).showSaveFilePicker
  return {
    showSaveFilePicker: typeof picker === 'function' ? picker.bind(window) : null,
    download: downloadBlob,
  }
}

/** Whether this browser has a real save dialog. Without one, "Save as…" is just a download. */
export function saveFilePickerSupported(environment: SaveFileEnvironment = browserEnvironment()): boolean {
  return typeof environment.showSaveFilePicker === 'function'
}

/** `.pdf` from `pdf` or `.PDF`; null when it is not an extension the dialog accepts (1–16 letters or digits). */
export function normalizeExtension(extension: string): string | null {
  const bare = extension.trim().replace(/^\.+/, '').toLowerCase()
  return /^[a-z0-9][a-z0-9.+_-]{0,15}$/.test(bare) && !bare.endsWith('.') ? `.${bare}` : null
}

const UNSAFE_IN_FILE_NAME = new Set('/\\:*?"<>|')

/** A file name with no path separators or control characters, ending in the extension. */
export function saveFileName(suggestedName: string, extension: string): string {
  const ext = normalizeExtension(extension)
  let name = Array.from(suggestedName, (char) => {
    const code = char.charCodeAt(0)
    return code < 32 || code === 127 || UNSAFE_IN_FILE_NAME.has(char) ? '-' : char
  })
    .join('')
    .trim()
    .replace(/^\.+/, '')
  if (!name) name = 'download'
  if (ext && !name.toLowerCase().endsWith(ext)) name += ext
  return name
}

function pickerTypes(type: SaveFileType, extension: string | null): SavePickerOptions['types'] {
  // The dialog throws a TypeError on a malformed type; offer no filter rather than no dialog.
  if (!extension || !/^[a-z]+\/[a-z0-9.+-]+$/i.test(type.mime.trim())) return undefined
  return [{ description: type.description, accept: { [type.mime.trim()]: [extension] } }]
}

const isAbort = (error: unknown) => (error as { name?: string } | null)?.name === 'AbortError'

async function build(options: SaveFileOptions): Promise<Blob> {
  let content: SaveFileContent
  try {
    content = await options.content()
  } catch (cause) {
    const detail = cause instanceof Error && cause.message ? ` ${cause.message}` : ''
    throw new SaveFileError('build-failed', `The file could not be made.${detail}`, { cause })
  }
  if (typeof content === 'string') return new Blob([content], { type: options.type.mime })
  return content
}

/**
 * Save a file where the person chooses, or download it where the browser has no save dialog.
 * Call it inside the click handler. Resolves with what happened: `saved` (with the name chosen),
 * `cancelled` (nothing was built) or `downloaded`. Rejects with a `SaveFileError` when the
 * content could not be built or written.
 */
export async function saveFileAs(options: SaveFileOptions): Promise<SaveFileResult> {
  const environment = options.environment ?? browserEnvironment()
  const extension = normalizeExtension(options.type.extension)
  const fileName = saveFileName(options.suggestedName, options.type.extension)
  const download = environment.download ?? downloadBlob

  if (typeof environment.showSaveFilePicker === 'function') {
    let handle: SaveHandleLike | null = null
    try {
      // First, before any await: the dialog needs the click's activation.
      handle = await environment.showSaveFilePicker({
        suggestedName: fileName,
        types: pickerTypes(options.type, extension),
        excludeAcceptAllOption: false,
        ...(options.rememberFolderAs
          ? { id: options.rememberFolderAs.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) }
          : {}),
      })
    } catch (error) {
      if (isAbort(error)) return { outcome: 'cancelled' }
      // The dialog could not open (a frame, a policy, a lost activation): download instead.
      handle = null
    }
    if (handle) {
      const blob = await build(options)
      let writable: WritableLike | null = null
      try {
        writable = await handle.createWritable()
        await writable.write(blob)
        await writable.close()
      } catch (cause) {
        await writable?.abort?.(cause).catch(() => {})
        const detail = cause instanceof Error && cause.message ? ` (${cause.message})` : ''
        throw new SaveFileError(
          'write-failed',
          `The file could not be written there${detail}. Choose another place, or use Download.`,
          { cause },
        )
      }
      return { outcome: 'saved', fileName: handle.name || fileName }
    }
  }

  const blob = await build(options)
  download(blob, fileName)
  return { outcome: 'downloaded', fileName }
}
