import { CollapsibleSection } from '@/components/ui/map-panels'
import { SelectField } from '@/components/ui/form-field'
import { Button } from '@/components/ui/button'
import type { Facet } from './catalogue'
import { EMPTY_FILTERS, type OrganizationFilters } from './libraryOrganization'

export function LibraryFilters({
  values,
  options,
  sourceMode,
  onChange,
}: {
  values: OrganizationFilters
  options: { subjects: Facet[]; regions: Facet[]; eras: Facet[]; sources: Facet[] }
  sourceMode: boolean
  onChange: (next: OrganizationFilters) => void
}) {
  const count = Object.entries(values).filter(([key, value]) => value && !(sourceMode && key === 'confidence')).length
  if (
    sourceMode &&
    !options.subjects.length &&
    !options.regions.length &&
    !options.eras.length &&
    !options.sources.length
  )
    return null
  const select = (key: keyof OrganizationFilters, title: string, all: string, choices: Facet[]) => (
    <SelectField
      label={title}
      aria-label={title}
      value={values[key]}
      onChange={(e) => onChange({ ...values, [key]: e.target.value })}
      fieldClassName="min-w-0"
      className="h-10 w-full min-w-0 rounded-md border bg-background px-2 text-sm"
    >
      <option value="">{all}</option>
      {choices.map((f) => (
        <option value={f.id} key={f.id}>
          {f.label}
        </option>
      ))}
    </SelectField>
  )
  return (
    <CollapsibleSection
      label="Categories & filters"
      collapseOn="always"
      summary={count ? `${count} active` : 'Subject, region, date and source'}
      className="mt-3 rounded-lg border"
      contentClassName="p-3"
      actions={
        count ? (
          <Button size="sm" variant="ghost" onClick={() => onChange({ ...EMPTY_FILTERS })}>
            Clear filters
          </Button>
        ) : undefined
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {!!options.subjects.length && select('subject', 'Subject', 'All subjects', options.subjects)}
        {!!options.regions.length && select('region', 'Broad region', 'All regions', options.regions)}
        {!!options.eras.length && select('era', 'Map-date era', 'All map-date eras', options.eras)}
        {!!options.sources.length && select('sourceGroup', 'Source document', 'All source documents', options.sources)}
        {!sourceMode &&
          select('confidence', 'Placement confidence', 'All placements', [
            { id: 'provisional', label: 'Provisional' },
            { id: 'experimental', label: 'Experimental' },
          ])}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Category confidence and geographic placement confidence are separate. Map-date eras use the supplied map-date
        evidence, not scan or processing dates.
      </p>
    </CollapsibleSection>
  )
}
