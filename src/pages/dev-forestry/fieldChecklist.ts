/**
 * The VIA's stage and the layout crew's checklist, as the reviewer records them
 * on `viaReview`.
 *
 * A VIA done before block layout goes to the field crew with the block: they
 * place wildlife tree patches and leave trees, run the boundary along natural
 * features, confirm the neighbouring openings have greened up, and check the
 * viewpoints are real and reachable — so nobody has to go back for a second
 * trip. What they find comes back here, item by item, with who answered and
 * when.
 *
 * Like the rest of `viaReview` this is a record of review, never a run input:
 * it stays out of `sceneFingerprint`. No DOM: the panel and the field brief
 * both read it through these functions, and they are unit-tested.
 */

// ---------------------------------------------------------------------------
// Stage

export type LayoutStage = 'pre-layout' | 'post-layout'

/**
 * A desk run on drawn or imported proposals is a pre-layout VIA until the
 * reviewer says otherwise. Post-layout claims the boundary has been walked and
 * traversed, which only the reviewer can know; scenes saved before the stage
 * existed were all desk runs.
 */
export const DEFAULT_LAYOUT_STAGE: LayoutStage = 'pre-layout'

export const LAYOUT_STAGES: ReadonlyArray<{ id: LayoutStage; label: string; meaning: string }> = [
  {
    id: 'pre-layout',
    label: 'Pre-layout',
    meaning: 'Done on the proposed boundary before field layout, for the layout crew to act on.',
  },
  {
    id: 'post-layout',
    label: 'Post-layout',
    meaning: 'Done on the boundary as laid out (traversed) in the field.',
  },
]

export function parseLayoutStage(raw: unknown): LayoutStage | null {
  return raw === 'pre-layout' || raw === 'post-layout' ? raw : null
}

export function layoutStageOf(review: { layoutStage?: LayoutStage | null } | null | undefined): LayoutStage {
  return review?.layoutStage ?? DEFAULT_LAYOUT_STAGE
}

export function layoutStageLabel(stage: LayoutStage): string {
  return LAYOUT_STAGES.find((entry) => entry.id === stage)?.label ?? stage
}

// ---------------------------------------------------------------------------
// The crew checklist

export type FieldCheckAnswer = 'yes' | 'no'
export type FieldCheckGroup = 'viewpoints' | 'greenUp'

export type FieldCheckEntry = {
  answer: FieldCheckAnswer | null
  note: string
  /** Who recorded it: the checklist's *Checked by* when the entry last changed. */
  by: string
  /** `YYYY-MM-DD`, when the entry last changed. */
  on: string
}

export type FieldChecklist = {
  /** The name each new answer is stamped with. */
  checkedBy: string
  /** (a) Each viewpoint is real and reachable, keyed by `briefViewpoints`' keys. */
  viewpoints: Record<string, FieldCheckEntry>
  /** (b) Each existing opening nearby has visually greened up, keyed by its target id. */
  greenUp: Record<string, FieldCheckEntry>
  /** (c) Where the boundary can follow natural features. */
  boundary: { note: string; by: string; on: string }
}

/** Per-group answers kept; older keys beyond it are dropped, oldest first. */
export const FIELD_CHECK_LIMITS = { entries: 60, note: 1000, boundaryNote: 4000, name: 120, key: 160 } as const

/** What "yes" and "no" mean for each group, as the panel and the brief print them. */
export const FIELD_CHECK_LABELS: Record<FieldCheckGroup, { question: string; yes: string; no: string }> = {
  viewpoints: { question: 'Real and reachable', yes: 'Reachable', no: 'Not reachable' },
  greenUp: { question: 'Visually greened up', yes: 'Greened up', no: 'Not greened up' },
}

export const EMPTY_FIELD_CHECKLIST: FieldChecklist = {
  checkedBy: '',
  viewpoints: {},
  greenUp: {},
  boundary: { note: '', by: '', on: '' },
}

/** Today as `YYYY-MM-DD` in local time, which is the date a crew writes down. */
export function localIsoDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

function parseEntries(raw: unknown): Record<string, FieldCheckEntry> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, FieldCheckEntry> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>).slice(-FIELD_CHECK_LIMITS.entries)) {
    if (!key || key.length > FIELD_CHECK_LIMITS.key || !value || typeof value !== 'object') continue
    const entry = value as Record<string, unknown>
    const answer = entry.answer === 'yes' || entry.answer === 'no' ? entry.answer : null
    const note = text(entry.note, FIELD_CHECK_LIMITS.note)
    if (!answer && !note.trim()) continue
    out[key] = {
      answer,
      note,
      by: text(entry.by, FIELD_CHECK_LIMITS.name),
      on: typeof entry.on === 'string' && DATE_PATTERN.test(entry.on) ? entry.on : '',
    }
  }
  return out
}

/** A checklist read back from storage or an imported scene; anything unrecognised is dropped. */
export function parseFieldChecklist(raw: unknown): FieldChecklist | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const value = raw as Record<string, unknown>
  const boundary = (value.boundary && typeof value.boundary === 'object' ? value.boundary : {}) as Record<
    string,
    unknown
  >
  return {
    checkedBy: text(value.checkedBy, FIELD_CHECK_LIMITS.name),
    viewpoints: parseEntries(value.viewpoints),
    greenUp: parseEntries(value.greenUp),
    boundary: {
      note: text(boundary.note, FIELD_CHECK_LIMITS.boundaryNote),
      by: text(boundary.by, FIELD_CHECK_LIMITS.name),
      on: typeof boundary.on === 'string' && DATE_PATTERN.test(boundary.on) ? boundary.on : '',
    },
  }
}

/**
 * Records one answer or note. The entry is stamped with the checklist's
 * *Checked by* and `today`; an entry with neither an answer nor a note is
 * removed, so clearing an answer leaves no stamp behind.
 */
export function updateFieldCheck(
  checklist: FieldChecklist | null | undefined,
  group: FieldCheckGroup,
  key: string,
  patch: { answer?: FieldCheckAnswer | null; note?: string },
  today: string,
): FieldChecklist {
  const list = checklist ?? EMPTY_FIELD_CHECKLIST
  const previous = list[group][key]
  const answer = patch.answer !== undefined ? patch.answer : (previous?.answer ?? null)
  const note = (patch.note !== undefined ? patch.note : (previous?.note ?? '')).slice(0, FIELD_CHECK_LIMITS.note)
  const entries = { ...list[group] }
  delete entries[key]
  if (answer || note.trim()) {
    entries[key] = { answer, note, by: list.checkedBy.trim(), on: today }
    // Newest last, so the cap drops the oldest.
    const keys = Object.keys(entries)
    for (const stale of keys.slice(0, Math.max(0, keys.length - FIELD_CHECK_LIMITS.entries))) delete entries[stale]
  }
  return { ...list, [group]: entries }
}

export function updateBoundaryNote(
  checklist: FieldChecklist | null | undefined,
  note: string,
  today: string,
): FieldChecklist {
  const list = checklist ?? EMPTY_FIELD_CHECKLIST
  const trimmed = note.slice(0, FIELD_CHECK_LIMITS.boundaryNote)
  return {
    ...list,
    boundary: trimmed.trim() ? { note: trimmed, by: list.checkedBy.trim(), on: today } : { note: '', by: '', on: '' },
  }
}

export type FieldChecklistProgress = {
  /** Items with an answer (or, for the boundary, a note). */
  answered: number
  total: number
  /** Items answered "no": a viewpoint not reachable, an opening not greened up. */
  flagged: number
  /** Something has been recorded at all. */
  started: boolean
  /** Every item answered. */
  complete: boolean
}

/**
 * How far the crew has got, counting only the viewpoints and openings the brief
 * lists now (an answer for a viewpoint since removed is kept but not counted),
 * plus the boundary note.
 */
export function fieldChecklistProgress(
  checklist: FieldChecklist | null | undefined,
  items: { viewpoints: ReadonlyArray<string>; openings: ReadonlyArray<string> },
): FieldChecklistProgress {
  const list = checklist ?? EMPTY_FIELD_CHECKLIST
  const answers = [
    ...items.viewpoints.map((key) => list.viewpoints[key]?.answer ?? null),
    ...items.openings.map((key) => list.greenUp[key]?.answer ?? null),
  ]
  const boundary = !!list.boundary.note.trim()
  const answered = answers.filter((answer) => answer !== null).length + (boundary ? 1 : 0)
  const total = answers.length + 1
  return {
    answered,
    total,
    flagged: answers.filter((answer) => answer === 'no').length,
    started:
      answered > 0 ||
      Object.values(list.viewpoints).some((entry) => !!entry.note.trim()) ||
      Object.values(list.greenUp).some((entry) => !!entry.note.trim()),
    complete: answered === total,
  }
}

/** "Recorded by J. Smith, 2026-11-10", or whichever half is known; empty when neither is. */
export function stampText(entry: { by: string; on: string } | null | undefined): string {
  if (!entry) return ''
  const by = entry.by.trim()
  if (by && entry.on) return `${by}, ${entry.on}`
  return by || entry.on
}
