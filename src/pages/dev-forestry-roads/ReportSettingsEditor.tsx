import { useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, NumberField, OptionalNumberField, roadFieldClass, RoadSelect } from './Controls'
import {
  createReportChapter,
  createRoadReportSettings,
  formatDrawingLabel,
  MAX_REPORT_CHAPTERS,
  parseRoadReportSettings,
  REPORT_CHAPTER_KINDS,
  REPORT_COLUMNS,
  validateLabelTemplate,
  type ReportChapter,
  type ReportChapterKind,
  type RoadReportSettings,
} from './reportSettings'

const KIND_LABELS: Record<ReportChapterKind, string> = {
  'plan-profile': 'Plan & profile',
  sections: 'Cross-sections',
  schedule: 'Station schedule',
  curves: 'Horizontal curves',
  structures: 'Culvert inventory',
  materials: 'Material quantities',
}
const COLUMN_LABELS = {
  station: 'Station',
  ground: 'Ground level',
  design: 'Formation level',
  grade: 'Grade',
  cutArea: 'Cut area',
  fillArea: 'Fill area',
  cutVolume: 'Interval cut volume',
  fillVolume: 'Interval fill volume',
  mass: 'Mass balance',
  flags: 'Review flags',
}
const SUBVIEW_LABELS: Record<keyof RoadReportSettings['subviews'], string> = {
  plan: 'Plan',
  profile: 'Profile',
  mass: 'Mass haul',
  contours: 'Contours',
  legend: 'Legend',
  bands: 'Value bands',
  profileLabels: 'Curve labels',
}

export function ReportSettingsEditor({
  value,
  onChange,
}: {
  value?: RoadReportSettings
  onChange: (settings: RoadReportSettings) => void
}) {
  const settings = value ?? createRoadReportSettings()
  // The chapter open for editing; null when every chapter is folded.
  const [selected, setSelected] = useState<string | null>(settings.chapters[0].id)
  const [kind, setKind] = useState<ReportChapterKind>('schedule')
  const [error, setError] = useState<string | null>(null)
  const update = (next: RoadReportSettings) => {
    try {
      onChange(parseRoadReportSettings(next))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check report settings.')
    }
  }
  const patch = (id: string, changes: Partial<ReportChapter>) =>
    update({ ...settings, chapters: settings.chapters.map((c) => (c.id === id ? { ...c, ...changes } : c)) })
  const move = (index: number, direction: number) => {
    const next = index + direction
    if (next < 0 || next >= settings.chapters.length) return
    const chapters = [...settings.chapters]
    ;[chapters[index], chapters[next]] = [chapters[next], chapters[index]]
    update({ ...settings, chapters })
  }
  const add = () => {
    const next = createReportChapter(kind, crypto.randomUUID())
    update({ ...settings, chapters: [...settings.chapters, next] })
    setSelected(next.id)
  }
  const heading = 'text-3xs font-semibold uppercase tracking-wide text-muted-foreground'
  return (
    <div className="space-y-5 text-xs" data-testid="road-report-settings">
      <p className="text-muted-foreground">
        Saved with the project. Station intervals pick calculated stations; they never change the road analysis.
      </p>
      <section className="space-y-2">
        <h4 className={heading}>Sheets</h4>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Paper size">
            <RoadSelect
              value={settings.paper}
              onValueChange={(paper) => update({ ...settings, paper: paper as 'A3' | 'A4' })}
              options={[
                { value: 'A3', label: 'A3 landscape' },
                { value: 'A4', label: 'A4 landscape' },
              ]}
              ariaLabel="Report paper size"
            />
          </Field>
          <Field label="Curve table">
            <RoadSelect
              value={settings.curveTablePosition}
              onValueChange={(position) =>
                update({ ...settings, curveTablePosition: position as RoadReportSettings['curveTablePosition'] })
              }
              options={[
                { value: 'none', label: 'Only as a chapter, if listed' },
                { value: 'chapter', label: 'Add a curve-table chapter' },
                { value: 'plan-sheet', label: 'Inset at top right of each plan' },
              ]}
              ariaLabel="Curve table placement"
            />
          </Field>
        </div>
      </section>
      <section className="space-y-2">
        <h4 className={heading}>Chapters</h4>
        <ol className="divide-y overflow-hidden rounded-md border bg-background">
          {settings.chapters.map((chapter, index) => {
            const open = selected === chapter.id
            return (
              <li key={chapter.id}>
                <div className="flex items-center gap-0.5 pr-1">
                  <button
                    type="button"
                    aria-expanded={open}
                    className="flex min-w-0 flex-1 items-baseline gap-2 px-2.5 py-2 text-left hover:bg-muted/50"
                    onClick={() => setSelected(open ? null : chapter.id)}
                  >
                    <span className="w-4 shrink-0 tabular-nums text-muted-foreground">{index + 1}</span>
                    <span className="min-w-0 truncate font-medium text-foreground">{chapter.title}</span>
                    {chapter.title !== KIND_LABELS[chapter.kind] && (
                      <span className="min-w-0 truncate text-muted-foreground">{KIND_LABELS[chapter.kind]}</span>
                    )}
                    <ChevronDown
                      aria-hidden
                      className={`ml-auto size-3.5 shrink-0 self-center text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
                    />
                  </button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    aria-label={`Move ${chapter.title} up`}
                    title="Move up"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp className="size-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    aria-label={`Move ${chapter.title} down`}
                    title="Move down"
                    disabled={index === settings.chapters.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown className="size-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    aria-label={`Remove ${chapter.title}`}
                    title="Remove chapter"
                    disabled={settings.chapters.length === 1}
                    onClick={() =>
                      update({ ...settings, chapters: settings.chapters.filter((c) => c.id !== chapter.id) })
                    }
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                {open && (
                  <ChapterFields
                    chapter={chapter}
                    settings={settings}
                    onPatch={(changes) => patch(chapter.id, changes)}
                    onSubviews={(subviews) => update({ ...settings, subviews })}
                  />
                )}
              </li>
            )
          })}
        </ol>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
          <Field label="New chapter type">
            <RoadSelect
              value={kind}
              onValueChange={(next) => setKind(next as ReportChapterKind)}
              options={REPORT_CHAPTER_KINDS.map((value) => ({ value, label: KIND_LABELS[value] }))}
              ariaLabel="New report chapter type"
            />
          </Field>
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            onClick={add}
            disabled={settings.chapters.length >= MAX_REPORT_CHAPTERS}
          >
            <Plus className="size-3.5" />
            Add chapter
          </Button>
        </div>
      </section>
      <section className="space-y-2">
        <h4 className={heading}>Labels</h4>
        <div className="grid gap-2 sm:grid-cols-2">
          <DrawingLabelField
            label="Station label expression"
            value={settings.stationLabel}
            onChange={(stationLabel) => update({ ...settings, stationLabel })}
          />
          <DrawingLabelField
            label="Grade label expression"
            value={settings.gradeLabel}
            onChange={(gradeLabel) => update({ ...settings, gradeLabel })}
          />
          <NumberField
            label="Label X offset (drawing px)"
            value={settings.labelOffsetX}
            min={-100}
            max={100}
            step={1}
            onChange={(labelOffsetX) => update({ ...settings, labelOffsetX })}
          />
          <NumberField
            label="Label Y offset (drawing px)"
            value={settings.labelOffsetY}
            min={-100}
            max={100}
            step={1}
            onChange={(labelOffsetY) => update({ ...settings, labelOffsetY })}
          />
        </div>
      </section>
      {error && (
        <p role="alert" className="text-amber-700 dark:text-amber-400">
          {error}
        </p>
      )}
    </div>
  )
}

/** The open chapter's own settings, under its row in the chapter list. */
function ChapterFields({
  chapter,
  settings,
  onPatch,
  onSubviews,
}: {
  chapter: ReportChapter
  settings: RoadReportSettings
  onPatch: (changes: Partial<ReportChapter>) => void
  onSubviews: (subviews: RoadReportSettings['subviews']) => void
}) {
  return (
    <div className="space-y-3 border-t bg-muted/30 p-3">
      <Field label="Chapter title">
        <input
          className={roadFieldClass}
          value={chapter.title}
          maxLength={100}
          onChange={(e) => onPatch({ title: e.target.value })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <OptionalNumberField
          label="From station (m)"
          value={chapter.startM}
          min={0}
          max={100000}
          placeholder="road start"
          onChange={(startM) => onPatch({ startM })}
        />
        <OptionalNumberField
          label="To station (m)"
          value={chapter.endM}
          min={0}
          max={100000}
          placeholder="road end"
          onChange={(endM) => onPatch({ endM })}
        />
        {chapter.kind === 'plan-profile' && (
          <>
            <NumberField
              label="Maximum metres per sheet"
              value={chapter.sheetLengthM}
              min={10}
              max={10000}
              step={10}
              onChange={(sheetLengthM) => onPatch({ sheetLengthM })}
            />
            <NumberField
              label="Profile vertical exaggeration"
              value={chapter.verticalExaggeration}
              min={0.1}
              max={20}
              step={0.5}
              onChange={(verticalExaggeration) => onPatch({ verticalExaggeration })}
            />
          </>
        )}
        {(chapter.kind === 'plan-profile' || chapter.kind === 'sections') && (
          <OptionalNumberField
            label="Horizontal scale 1:N"
            value={chapter.horizontalScale}
            min={50}
            max={100000}
            step={50}
            placeholder="fit window"
            hint="A fixed print scale may clip the selected terrain extent. The plan/profile sheet length is reduced to fit the printed horizontal scale."
            onChange={(horizontalScale) => onPatch({ horizontalScale })}
          />
        )}
        {(chapter.kind === 'sections' || chapter.kind === 'schedule') && (
          <NumberField
            label="Report station interval (m)"
            value={chapter.sectionIntervalM}
            min={2}
            max={1000}
            step={5}
            onChange={(sectionIntervalM) => onPatch({ sectionIntervalM })}
          />
        )}
      </div>
      {chapter.kind === 'materials' && (
        <p className="text-muted-foreground">
          Material totals use the selected range and supported section intervals, including site preparation.
        </p>
      )}
      {chapter.kind === 'plan-profile' && (
        <CheckboxGrid
          legend="Show on plan & profile sheets"
          note="Shared by every plan & profile chapter."
          items={(Object.keys(SUBVIEW_LABELS) as (keyof RoadReportSettings['subviews'])[]).map((key) => ({
            key,
            label: SUBVIEW_LABELS[key],
            checked: settings.subviews[key] ?? false,
            onChange: (checked: boolean) => onSubviews({ ...settings.subviews, [key]: checked }),
          }))}
        />
      )}
      {chapter.kind === 'schedule' && (
        <CheckboxGrid
          legend="Schedule columns"
          items={REPORT_COLUMNS.map((column) => ({
            key: column,
            label: COLUMN_LABELS[column],
            checked: chapter.columns.includes(column),
            disabled: chapter.columns.length === 1 && chapter.columns.includes(column),
            onChange: (checked: boolean) =>
              onPatch({
                columns: checked ? [...chapter.columns, column] : chapter.columns.filter((c) => c !== column),
              }),
          }))}
        />
      )}
    </div>
  )
}

function CheckboxGrid({
  legend,
  note,
  items,
}: {
  legend: string
  note?: string
  items: { key: string; label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }[]
}) {
  return (
    <fieldset>
      <legend className="mb-1 font-medium text-foreground">{legend}</legend>
      {note && <p className="mb-1 text-muted-foreground">{note}</p>}
      <div className="grid grid-cols-2 gap-x-3 sm:grid-cols-3">
        {items.map((item) => (
          <label key={item.key} className="flex min-h-8 items-center gap-2">
            <input
              type="checkbox"
              checked={item.checked}
              disabled={item.disabled}
              onChange={(e) => item.onChange(e.target.checked)}
            />
            {item.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function DrawingLabelField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  const [draft, setDraft] = useState({ value, text: value })
  const text = draft.value === value ? draft.text : value
  let error: string | null = null
  let preview = ''
  try {
    preview = formatDrawingLabel(text, {
      station: '0+120.0',
      grade: 6.25,
      ground: 800.25,
      design: 801.5,
      radius: 75,
      road: 'Spur A',
      project: 'Access design',
    })
  } catch (e) {
    error = e instanceof Error ? e.message : 'Invalid label expression.'
  }
  return (
    <div>
      <Field
        label={label}
        hint={
          <>
            Fields: {'{station}, {grade}, {ground}, {design}, {radius}, {road}, {project}'}. Use {'{grade:.1}'} for one
            decimal. Text is escaped in the drawing.
          </>
        }
      >
        <input
          className={roadFieldClass}
          value={text}
          maxLength={200}
          onChange={(e) => {
            const next = e.target.value
            setDraft({ value, text: next })
            try {
              onChange(validateLabelTemplate(next))
            } catch {
              /* Keep an incomplete expression local until valid. */
            }
          }}
        />
      </Field>
      <p className={`mt-1 ${error ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`}>
        {error ?? `Preview: ${preview}`}
      </p>
    </div>
  )
}
