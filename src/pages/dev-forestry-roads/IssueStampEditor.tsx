import { Field, roadFieldClass } from './Controls'
import { EMPTY_PROJECT_ISSUE, type ProjectIssue } from './projectIssue'

/**
 * Who prepared the documents, for whom, which revision and when. Saved in the project file and
 * printed on the report, the map PDF and every plot-book title block.
 */
export function IssueStampEditor({
  value,
  onChange,
  today,
}: {
  value: ProjectIssue | undefined
  onChange: (issue: ProjectIssue) => void
  /** YYYY-MM-DD printed while no date of issue is entered. */
  today: string
}) {
  const issue = value ?? EMPTY_PROJECT_ISSUE
  const set = (patch: Partial<ProjectIssue>) => onChange({ ...issue, ...patch })
  const text = (key: 'preparedBy' | 'organisation' | 'revision' | 'note', maxLength: number, placeholder: string) => (
    <input
      className={roadFieldClass}
      value={issue[key]}
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
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Prepared by">{text('preparedBy', 200, 'Your name')}</Field>
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
    </div>
  )
}
