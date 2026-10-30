import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { AppSelect } from '@/components/ui/select'
import { Field, NumberField, OptionalNumberField, roadFieldClass } from './Controls'
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
const SUBVIEW_LABELS = { plan: 'Plan', profile: 'Profile', mass: 'Mass haul', contours: 'Contours', legend: 'Legend' }

export function ReportSettingsEditor({
  value,
  onChange,
}: {
  value?: RoadReportSettings
  onChange: (settings: RoadReportSettings) => void
}) {
  const settings = value ?? createRoadReportSettings()
  const [selected, setSelected] = useState(settings.chapters[0].id)
  const [kind, setKind] = useState<ReportChapterKind>('schedule')
  const [error, setError] = useState<string | null>(null)
  const chapter = settings.chapters.find((c) => c.id === selected) ?? settings.chapters[0]
  const update = (next: RoadReportSettings) => {
    try {
      onChange(parseRoadReportSettings(next))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check report settings.')
    }
  }
  const patch = (changes: Partial<ReportChapter>) =>
    update({ ...settings, chapters: settings.chapters.map((c) => (c.id === chapter.id ? { ...c, ...changes } : c)) })
  const move = (direction: number) => {
    const index = settings.chapters.findIndex((c) => c.id === chapter.id)
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
  return (
    <div className="space-y-4 text-xs" data-testid="road-report-settings">
      <p className="text-muted-foreground">
        Drawing settings travel with this project. Report intervals select calculated stations and never change the road
        analysis.
      </p>
      <Field label="Paper size">
        <AppSelect
          value={settings.paper}
          onValueChange={(paper) => update({ ...settings, paper: paper as 'A3' | 'A4' })}
          options={[
            { value: 'A3', label: 'A3 landscape' },
            { value: 'A4', label: 'A4 landscape' },
          ]}
          triggerAriaLabel="Report paper size"
        />
      </Field>
      <Field label="Chapter to edit">
        <AppSelect
          value={chapter.id}
          onValueChange={setSelected}
          options={settings.chapters.map((c, i) => ({ value: c.id, label: `${i + 1}. ${c.title}` }))}
          triggerAriaLabel="Report chapter to edit"
        />
      </Field>
      <div className="rounded border p-3 space-y-3">
        <Field label="Chapter title">
          <input
            className={roadFieldClass}
            value={chapter.title}
            maxLength={100}
            onChange={(e) => patch({ title: e.target.value })}
          />
        </Field>
        <p className="text-muted-foreground">{KIND_LABELS[chapter.kind]}</p>
        <div className="grid grid-cols-2 gap-2">
          <OptionalNumberField
            label="From station (m)"
            value={chapter.startM}
            min={0}
            max={100000}
            placeholder="road start"
            onChange={(startM) => patch({ startM })}
          />
          <OptionalNumberField
            label="To station (m)"
            value={chapter.endM}
            min={0}
            max={100000}
            placeholder="road end"
            onChange={(endM) => patch({ endM })}
          />
        </div>
        {chapter.kind === 'materials' && (
          <p className="text-muted-foreground">
            Material totals use the selected range and supported section intervals, including site preparation.
          </p>
        )}
        {chapter.kind === 'plan-profile' && (
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Maximum metres per sheet"
              value={chapter.sheetLengthM}
              min={10}
              max={10000}
              step={10}
              onChange={(sheetLengthM) => patch({ sheetLengthM })}
            />
            <NumberField
              label="Profile vertical exaggeration"
              value={chapter.verticalExaggeration}
              min={0.1}
              max={20}
              step={0.5}
              onChange={(verticalExaggeration) => patch({ verticalExaggeration })}
            />
          </div>
        )}
        {['plan-profile', 'sections'].includes(chapter.kind) && (
          <OptionalNumberField
            label="Horizontal scale 1:N"
            value={chapter.horizontalScale}
            min={50}
            max={100000}
            step={50}
            placeholder="fit window"
            hint="A fixed print scale may clip the selected terrain extent. The plan/profile sheet length is reduced to fit the printed horizontal scale."
            onChange={(horizontalScale) => patch({ horizontalScale })}
          />
        )}
        {['sections', 'schedule'].includes(chapter.kind) && (
          <NumberField
            label="Report station interval (m)"
            value={chapter.sectionIntervalM}
            min={2}
            max={1000}
            step={5}
            onChange={(sectionIntervalM) => patch({ sectionIntervalM })}
          />
        )}
        {chapter.kind === 'schedule' && (
          <fieldset className="grid grid-cols-2 gap-2">
            <legend className="mb-2 font-medium">Schedule columns</legend>
            {REPORT_COLUMNS.map((column) => (
              <label key={column} className="flex min-h-9 items-center gap-2">
                <input
                  type="checkbox"
                  checked={chapter.columns.includes(column)}
                  disabled={chapter.columns.length === 1 && chapter.columns.includes(column)}
                  onChange={(e) =>
                    patch({
                      columns: e.target.checked
                        ? [...chapter.columns, column]
                        : chapter.columns.filter((c) => c !== column),
                    })
                  }
                />
                {COLUMN_LABELS[column]}
              </label>
            ))}
          </fieldset>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => move(-1)}
            disabled={settings.chapters[0].id === chapter.id}
          >
            Move chapter up
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => move(1)}
            disabled={settings.chapters[settings.chapters.length - 1].id === chapter.id}
          >
            Move chapter down
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={settings.chapters.length === 1}
            onClick={() => update({ ...settings, chapters: settings.chapters.filter((c) => c.id !== chapter.id) })}
          >
            Remove chapter
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 items-end">
        <Field label="New chapter type">
          <AppSelect
            value={kind}
            onValueChange={(next) => setKind(next as ReportChapterKind)}
            options={REPORT_CHAPTER_KINDS.map((value) => ({ value, label: KIND_LABELS[value] }))}
            triggerAriaLabel="New report chapter type"
          />
        </Field>
        <Button size="sm" variant="outline" onClick={add} disabled={settings.chapters.length >= MAX_REPORT_CHAPTERS}>
          Add chapter
        </Button>
      </div>
      <fieldset className="grid grid-cols-2 gap-2">
        <legend className="mb-2 font-medium">Plan/profile subviews</legend>
        {(Object.keys(settings.subviews) as (keyof RoadReportSettings['subviews'])[]).map((key) => (
          <label key={key} className="flex min-h-9 items-center gap-2">
            <input
              type="checkbox"
              checked={settings.subviews[key]}
              onChange={(e) => update({ ...settings, subviews: { ...settings.subviews, [key]: e.target.checked } })}
            />
            {SUBVIEW_LABELS[key]}
          </label>
        ))}
      </fieldset>
      <Field label="Curve table placement">
        <AppSelect
          value={settings.curveTablePosition}
          onValueChange={(position) =>
            update({ ...settings, curveTablePosition: position as RoadReportSettings['curveTablePosition'] })
          }
          options={[
            { value: 'none', label: 'Use chapter list only' },
            { value: 'chapter', label: 'Add a curve-table chapter' },
            { value: 'plan-sheet', label: 'Inset at top right of each plan' },
          ]}
          triggerAriaLabel="Curve table placement"
        />
      </Field>
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
      <p className="text-muted-foreground">
        Fields: {'{station}, {grade}, {ground}, {design}, {radius}, {road}, {project}'}. Use {'{grade:.1}'} for one
        decimal. Text is escaped in the drawing.
      </p>
      <div className="grid grid-cols-2 gap-2">
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
      {error && (
        <p role="alert" className="text-amber-700 dark:text-amber-400">
          {error}
        </p>
      )}
    </div>
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
      <Field label={label}>
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
