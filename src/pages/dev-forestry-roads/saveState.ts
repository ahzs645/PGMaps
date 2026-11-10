/**
 * What the header says about where the open project is kept. Pure: the times come in as arguments.
 * A project autosaves in this browser; a project file is the only copy that leaves it.
 */
export type BrowserSave =
  | { kind: 'pending' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: number }
  /** The training example keeps a session copy that a reload discards. */
  | { kind: 'training'; at: number }
  /** Storage refused the write. */
  | { kind: 'failed' }
  /** The current inputs do not make a valid project, so the last valid save stands. */
  | { kind: 'invalid'; reason: string }

export interface FileSave {
  /** When a project file was last written or opened in this session. */
  at: number
  /** False once the project has changed since. */
  current: boolean
}

export interface SaveStateText {
  text: string
  /** The same state in a few words, for a header too narrow for `text`. */
  short: string
  /** The full sentence, for a title and a screen reader. */
  detail: string
  tone: 'default' | 'warning' | 'danger'
}

const pad = (value: number) => String(value).padStart(2, '0')
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "14:02" today, "8 Nov 14:02" on another day. */
export function clockText(at: number, now: number): string {
  const time = new Date(at),
    today = new Date(now)
  const clock = `${pad(time.getHours())}:${pad(time.getMinutes())}`
  const sameDay =
    time.getFullYear() === today.getFullYear() &&
    time.getMonth() === today.getMonth() &&
    time.getDate() === today.getDate()
  return sameDay ? clock : `${time.getDate()} ${MONTHS[time.getMonth()]} ${clock}`
}

export function saveStateText(browser: BrowserSave, file: FileSave | null, now: number): SaveStateText {
  const fileText = !file
    ? 'not yet saved to a file'
    : file.current
      ? `file saved ${clockText(file.at, now)}`
      : `not saved to a file since ${clockText(file.at, now)}`
  const fileDetail = !file
    ? 'No project file has been saved in this session. Use Save to keep a copy outside this browser.'
    : file.current
      ? `The project file from ${clockText(file.at, now)} matches what is open.`
      : `The project has changed since the project file of ${clockText(file.at, now)}.`
  const fileShort = !file ? 'no file' : file.current ? 'file saved' : 'file out of date'
  switch (browser.kind) {
    case 'pending':
      return {
        text: `Not saved yet · ${fileText}`,
        short: `Not saved yet · ${fileShort}`,
        detail: `Nothing has been saved yet. ${fileDetail}`,
        tone: 'default',
      }
    case 'saving':
      return {
        text: `Saving in this browser… · ${fileText}`,
        short: `Saving… · ${fileShort}`,
        detail: `Saving in this browser. ${fileDetail}`,
        tone: 'default',
      }
    case 'saved':
      return {
        text: `Saved in this browser ${clockText(browser.at, now)} · ${fileText}`,
        short: `Saved ${clockText(browser.at, now)} · ${fileShort}`,
        detail: `Saved in this browser at ${clockText(browser.at, now)}. It stays on this device only. ${fileDetail}`,
        tone: 'default',
      }
    case 'training':
      return {
        text: `Training session · a reload starts fresh · ${fileText}`,
        short: `Training session · ${fileShort}`,
        detail: `Training session saved at ${clockText(browser.at, now)}. A reload starts the example again; save a project file to keep your edits. ${fileDetail}`,
        tone: 'warning',
      }
    case 'failed':
      return {
        text: `Not saved in this browser · ${fileText}`,
        short: `Not saved · ${fileShort}`,
        detail: `This browser refused the save. Use Save to download the project file. ${fileDetail}`,
        tone: 'danger',
      }
    case 'invalid':
      return {
        text: `Last valid version kept · ${fileText}`,
        short: 'Last valid version kept',
        detail: `The current inputs cannot be saved: ${browser.reason} The last valid version is kept in this browser. ${fileDetail}`,
        tone: 'danger',
      }
  }
}
