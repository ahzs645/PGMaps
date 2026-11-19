import { UseMyDetailsButton } from '@/branding/PreparerProfile'
import { blanksFilledFromProfile, designationText } from '@/branding/profile'
import { useBranding } from '@/branding/useBranding'

import { emptyFieldsMode, EMPTY_FIELDS_OPTIONS, type EmptyFields } from '@/lib/mapSheet/emptyFields'

import { Field, RoadSelect, roadFieldClass } from './Controls'
import { EMPTY_PROJECT_ISSUE, type ProjectIssue } from './projectIssue'
import { createRoadReportSettings, type RoadReportSettings } from './reportSettings'

/**
 * Who prepared the documents, for whom, which revision and when. Saved in the project file and
 * printed on the report, the map PDF and every plot-book title block.
 */
export function IssueStampEditor({
  value,
  onChange,
  today,
  reportSettings,
  onReportSettings,
}: {
  value: ProjectIssue | undefined
  onChange: (issue: ProjectIssue) => void
  /** YYYY-MM-DD printed while no date of issue is entered. */
  today: string
  /** The project's report settings, which hold what a field left empty prints (`emptyFields`). */
  reportSettings?: RoadReportSettings
  /** Writes the report settings; without it the empty-field choice is not offered. */
  onReportSettings?: (settings: RoadReportSettings) => void
}) {
  const issue = value ?? EMPTY_PROJECT_ISSUE
  const { profile } = useBranding()
  const set = (patch: Partial<ProjectIssue>) => {
    const next = { ...issue, ...patch }
    // A cleared designation is removed, so the project file is the same as one that never had one.
    if (!next.designation) delete next.designation
    onChange(next)
  }
  // Your details fill only what the stamp leaves blank; the stamp is the project's record.
  const fromProfile = blanksFilledFromProfile<'preparedBy' | 'designation' | 'organisation'>(issue, {
    preparedBy: profile?.name ?? '',
    designation: profile ? designationText(profile) : '',
    organisation: profile?.organisation ?? '',
  })
  const text = (
    key: 'preparedBy' | 'designation' | 'organisation' | 'revision' | 'note',
    maxLength: number,
    placeholder: string,
  ) => (
    <input
      className={roadFieldClass}
      value={issue[key] ?? ''}
      maxLength={maxLength}
      placeholder={placeholder}
      onChange={(event) => set({ [key]: event.target.value })}
    />
  )
  return (
    <div className="max-w-xl space-y-3" data-testid="road-issue-stamp">
      <p className="text-xs text-muted-foreground">
        Printed at the top of the report, on the map PDF and in every plot-book title block, with the terrain source and
        &ldquo;not for construction&rdquo;. Saved with the project.
      </p>
      <UseMyDetailsButton patch={fromProfile} onApply={set} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Prepared by">{text('preparedBy', 200, 'Your name')}</Field>
        <Field label="Designation" hint="Printed after the name, such as RPF #4521 or P.Eng.">
          {text('designation', 120, 'Optional')}
        </Field>
        <Field label="Organisation">{text('organisation', 200, 'Company or licensee')}</Field>
        <Field label="Revision" hint="Free text, such as A, 2 or Issued for review. Change it each time you issue.">
          {text('revision', 40, 'e.g. A')}
        </Field>
        <Field
          label="Date of issue"
          hint="Leave it empty to print the day each document is made. Enter a date to hold it on reissued copies."
        >
          <input
            type="date"
            className={roadFieldClass}
            value={issue.issuedOn}
            onChange={(event) => set({ issuedOn: event.target.value })}
          />
        </Field>
      </div>
      {!issue.issuedOn && <p className="text-xs text-muted-foreground">No date entered: documents print {today}.</p>}
      <Field label="Note" hint="One line printed under the stamp in the report, such as what changed in this revision.">
        {text('note', 500, 'Optional')}
      </Field>
      {onReportSettings && (
        <div className="max-w-xs">
          <Field
            label="A field left empty prints"
            hint="Applies to every printed file of this project: the report, plot book, report package, estimate, map PDF, D-line sheet, block map sheet and field review pack. Blank keeps the field's label with nothing after it, so it can be written in by hand. The line above still says which fields are missing."
          >
            <RoadSelect
              ariaLabel="A field left empty prints"
              value={emptyFieldsMode(reportSettings)}
              options={EMPTY_FIELDS_OPTIONS}
              onValueChange={(mode) => {
                const next: RoadReportSettings = {
                  ...(reportSettings ?? createRoadReportSettings()),
                  emptyFields: mode as EmptyFields,
                }
                // Blank is the default and is not stored, so the project file stays as it was.
                if (next.emptyFields !== 'stated') delete next.emptyFields
                onReportSettings(next)
              }}
            />
          </Field>
        </div>
      )}
    </div>
  )
}
