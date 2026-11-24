import { Button } from '@/components/ui/button'
import { DisclosureCard } from '@/components/ui/disclosure'
import { StyledSelect } from '@/components/ui/styled-select'
import { fieldNames, fieldValues, mappingSummary, mapRows, type ImportMapping, type MappingRole } from './importMapping'
import type { SpatialFile } from './spatialImport'

/** A field listed with this many distinct values or fewer can choose rows or statuses by value. */
const MAX_VALUE_CHOICES = 60
/** At most this many fields are tried in turn for a name. */
const MAX_NAME_FIELDS = 3

/** Where the mapping shown came from, for the line under it. */
export type MappingOrigin = { kind: 'guess' } | { kind: 'saved'; savedAt: string } | { kind: 'edited' }

/**
 * The import's mapping step for one GIS layer (guide `exports-and-project-files.md`, **Mapping a
 * layer's fields**): which fields name its features, which rows come in and, for planned blocks,
 * which rows the file calls harvested, their year and opening ID. Every choice shows the file's own
 * values, and the summary shows what the import will make.
 */
export function ImportMappingFields({
  file,
  role,
  mapping,
  origin,
  disabled,
  onChange,
  onReset,
  onForget,
}: {
  file: SpatialFile
  role: MappingRole
  mapping: ImportMapping
  origin: MappingOrigin
  disabled: boolean
  onChange: (mapping: ImportMapping) => void
  /** Back to the guess from the field names. */
  onReset: () => void
  /** Forget the saved mapping for files of these fields; the guess is shown. */
  onForget: () => void
}) {
  const fields = fieldNames(file)
  if (!fields.length) return null
  const total = file.collection.features.length
  const values = Object.fromEntries(fields.map((field) => [field, fieldValues(file, field)]))
  const option = (field: string) => {
    const { filled, values: list } = values[field]
    const sample = list
      .filter(([value]) => value)
      .slice(0, 3)
      .map(([value]) => value)
    return (
      <option key={field} value={field}>
        {field} · {filled} of {total} filled{sample.length ? ` · ${sample.join(', ')}` : ''}
      </option>
    )
  }
  const choosable = fields.filter((field) => values[field].distinct > 0 && values[field].distinct <= MAX_VALUE_CHOICES)
  const rows = mapRows(file, mapping, role)
  const summary = mappingSummary(rows, total)
  const thing = role === 'planned-block' ? 'block' : role === 'proposed-road' ? 'road' : 'feature'
  const set = (patch: Partial<ImportMapping>) => onChange({ ...mapping, ...patch })
  const nameSlots = Math.min(MAX_NAME_FIELDS, mapping.nameFields.length + 1)
  return (
    <DisclosureCard
      title="Fields"
      summary={`${summary.kept} ${thing}${summary.kept === 1 ? '' : 's'}${summary.leftOut ? ` of ${total} rows` : ''} · ${
        origin.kind === 'saved' ? 'saved mapping' : origin.kind === 'edited' ? 'your mapping' : 'guessed'
      }`}
      defaultOpen
      className="mt-2"
    >
      <div className="grid gap-3 text-xs" data-testid="import-mapping">
        <fieldset className="grid gap-1" disabled={disabled}>
          <legend className="mb-1 font-medium">Name</legend>
          {Array.from({ length: nameSlots }, (_, slot) => (
            <StyledSelect
              key={slot}
              aria-label={`${slot === 0 ? 'Name field' : `Name field ${slot + 1}`} for ${file.fileName}`}
              value={mapping.nameFields[slot] ?? ''}
              onChange={(event) => {
                const next = mapping.nameFields.slice(0, slot)
                if (event.target.value) next.push(event.target.value, ...mapping.nameFields.slice(slot + 1))
                const nameFields = [...new Set(next)]
                // A field that names a feature cannot also number it.
                set({
                  nameFields,
                  groupField: mapping.groupField && nameFields.includes(mapping.groupField) ? null : mapping.groupField,
                })
              }}
            >
              <option value="">{slot === 0 ? 'No name field' : 'No other field'}</option>
              {fields.filter((field) => !mapping.nameFields.slice(0, slot).includes(field)).map(option)}
            </StyledSelect>
          ))}
          <span className="text-muted-foreground">
            {mapping.nameFields.length > 1 ? 'Each field is tried in turn; the first that is not blank names it.' : ''}
          </span>
          <label className="grid gap-1">
            {mapping.nameFields.length ? 'Where blank, number within' : 'Number within'}
            <StyledSelect
              aria-label={`Group field for ${file.fileName}`}
              value={mapping.groupField ?? ''}
              onChange={(event) => set({ groupField: event.target.value || null })}
            >
              <option value="">The file name</option>
              {fields.filter((field) => !mapping.nameFields.includes(field)).map(option)}
            </StyledSelect>
          </label>
        </fieldset>

        <fieldset className="grid gap-1" disabled={disabled}>
          <legend className="mb-1 font-medium">Rows to import</legend>
          <StyledSelect
            aria-label={`Rows to import from ${file.fileName}`}
            value={mapping.keep?.field ?? ''}
            onChange={(event) => {
              const field = event.target.value
              set({
                keep: field ? { field, values: values[field].values.map(([value]) => value) } : undefined,
              })
            }}
          >
            <option value="">Every row</option>
            {choosable.map((field) => (
              <option key={field} value={field}>
                Rows by {field} ({valueCount(values[field])})
              </option>
            ))}
          </StyledSelect>
          {mapping.keep && (
            <ValueChoices
              label="Import"
              field={mapping.keep.field}
              values={values[mapping.keep.field]?.values ?? []}
              chosen={mapping.keep.values}
              onChange={(chosen) => set({ keep: { field: mapping.keep!.field, values: chosen } })}
            />
          )}
        </fieldset>

        {role === 'planned-block' && (
          <fieldset className="grid gap-1" disabled={disabled}>
            <legend className="mb-1 font-medium">Status</legend>
            <StyledSelect
              aria-label={`Status field for ${file.fileName}`}
              value={mapping.status?.field ?? ''}
              onChange={(event) => {
                const field = event.target.value
                set({ status: field ? { field, harvested: [] } : undefined })
              }}
            >
              <option value="">Every block is proposed</option>
              {choosable.map((field) => (
                <option key={field} value={field}>
                  Harvested when {field} is… ({values[field].distinct} values)
                </option>
              ))}
            </StyledSelect>
            {mapping.status && (
              <ValueChoices
                label="Harvested"
                field={mapping.status.field}
                values={(values[mapping.status.field]?.values ?? []).filter(([value]) => value)}
                chosen={mapping.status.harvested}
                onChange={(harvested) => set({ status: { field: mapping.status!.field, harvested } })}
              />
            )}
            {mapping.status && (
              <label className="grid gap-1">
                Year harvested
                <StyledSelect
                  aria-label={`Harvest year field for ${file.fileName}`}
                  value={mapping.yearField ?? ''}
                  onChange={(event) => set({ yearField: event.target.value || null })}
                >
                  <option value="">Not given</option>
                  {fields.map(option)}
                </StyledSelect>
              </label>
            )}
            <label className="grid gap-1">
              Opening ID
              <StyledSelect
                aria-label={`Opening ID field for ${file.fileName}`}
                value={mapping.openingIdField ?? ''}
                onChange={(event) => set({ openingIdField: event.target.value || null })}
              >
                <option value="">Not given</option>
                {fields.map(option)}
              </StyledSelect>
            </label>
          </fieldset>
        )}

        <div className="grid gap-1 rounded-md bg-muted/40 p-2" data-testid="import-mapping-summary">
          <p className="[overflow-wrap:anywhere]">
            Makes {summary.kept} {thing}
            {summary.kept === 1 ? '' : 's'}
            {summary.sample.length ? `: ${summary.sample.join(', ')}` : ''}
            {summary.distinctNames > summary.sample.length ? `, among ${summary.distinctNames} names` : ''}.
          </p>
          {summary.leftOut > 0 && (
            <p>
              {summary.leftOut} of {total} rows left out.
            </p>
          )}
          {summary.repeated > 0 && (
            <p className="text-warning">
              {summary.repeated} row{summary.repeated === 1 ? ' repeats a name' : 's repeat a name'} already given.
              Choose name fields that tell them apart, or number blank names within a field.
            </p>
          )}
          {summary.numbered.length > 0 && (
            <p className="text-muted-foreground [overflow-wrap:anywhere]">
              Numbered within {mapping.groupField}:{' '}
              {summary.numbered
                .slice(0, 8)
                .map(([group, count]) => `${group} ${count}`)
                .join(', ')}
              {summary.numbered.length > 8 ? ` and ${summary.numbered.length - 8} more` : ''}.
            </p>
          )}
          {role === 'planned-block' && summary.harvested > 0 && (
            <p>
              {summary.harvested} past harvest{summary.harvested === 1 ? '' : 's'}, the rest proposed
              {summary.harvestedWithoutYear ? `; ${summary.harvestedWithoutYear} without a year` : ''}.
            </p>
          )}
          <p className="text-muted-foreground">The file's own attributes are kept as read.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
          <span>
            {origin.kind === 'saved'
              ? `Saved for files with these fields, ${new Date(origin.savedAt).toLocaleDateString('en-CA')}.`
              : origin.kind === 'edited'
                ? 'Saved in this browser for files with these fields when you import.'
                : 'Guessed from the field names.'}
            {mapping.keep ? ' The rows chosen are for this file only and are never saved.' : ''}
          </span>
          {origin.kind !== 'guess' && (
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={origin.kind === 'saved' ? onForget : onReset}
            >
              {origin.kind === 'saved' ? 'Forget it' : 'Back to the guess'}
            </Button>
          )}
        </div>
      </div>
    </DisclosureCard>
  )
}

const valueCount = ({ distinct, values }: ReturnType<typeof fieldValues>) =>
  `${distinct} value${distinct === 1 ? '' : 's'}${values.some(([value]) => !value) ? ' and blanks' : ''}`

/** A field's values as ticks, each with its row count; blank shown as "(blank)". */
function ValueChoices({
  label,
  field,
  values,
  chosen,
  onChange,
}: {
  label: string
  field: string
  values: readonly (readonly [string, number])[]
  chosen: readonly string[]
  onChange: (chosen: string[]) => void
}) {
  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">
          {label}: {chosen.length} of {values.length}
        </span>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => onChange(values.map(([value]) => value))}>
          All
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onChange([])}>
          None
        </Button>
      </div>
      <div className="grid max-h-40 gap-1 overflow-y-auto rounded-md border p-2 sm:grid-cols-2">
        {values.map(([value, count]) => (
          <label key={value} className="flex min-w-0 items-center gap-2">
            <input
              type="checkbox"
              aria-label={`${label} ${field} ${value || '(blank)'}`}
              checked={chosen.includes(value)}
              onChange={(event) =>
                onChange(event.target.checked ? [...chosen, value] : chosen.filter((item) => item !== value))
              }
            />
            <span className="min-w-0 truncate">{value || '(blank)'}</span>
            <span className="ml-auto shrink-0 text-muted-foreground">{count}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
