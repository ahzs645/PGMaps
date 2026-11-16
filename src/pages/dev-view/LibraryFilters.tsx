import { SlidersHorizontal, X } from 'lucide-react'
import { CollapsibleSection } from '@/components/ui/map-panels'
import { SelectField, StyledSelect } from '@/components/ui/form-field'
import { Button } from '@/components/ui/button'
import { PanelDialog } from '@/components/ui/dialog-shell'
import { InfoTip } from '@/components/ui/info-tip'
import { cn } from '@/lib/utils'
import {
  EMPTY_FILTERS,
  FILTER_FIELDS,
  activeFilters,
  filterChoices,
  type FilterOptions,
  type OrganizationFilters,
} from './libraryOrganization'

type FilterProps = {
  values: OrganizationFilters
  options: FilterOptions
  sourceMode: boolean
  onChange: (next: OrganizationFilters) => void
}

const NOTE =
  'Subject and region are catalogue categories, separate from how well a map is placed. Map dates come from the map itself, not its scan or processing date.'

/** The filters that have something to choose from in this catalogue and scope. */
function fields({ options, sourceMode }: Pick<FilterProps, 'options' | 'sourceMode'>) {
  return FILTER_FIELDS.map((field) => ({ ...field, choices: filterChoices(field.key, options, sourceMode) })).filter(
    (field) => field.choices.length,
  )
}

/** One dropdown per filter: a labelled column for a dialog or sidebar, or an unlabelled row for a toolbar. */
function FilterSelects({ layout, ...props }: FilterProps & { layout: 'stacked' | 'row' }) {
  const { values, onChange } = props
  return (
    <>
      {fields(props).map(({ key, title, all, choices }) => {
        const children = (
          <>
            <option value="">{all}</option>
            {choices.map((choice) => (
              <option value={choice.id} key={choice.id}>
                {choice.label}
              </option>
            ))}
          </>
        )
        const change = (event: { target: { value: string } }) => onChange({ ...values, [key]: event.target.value })
        return layout === 'stacked' ? (
          <SelectField
            key={key}
            label={title}
            aria-label={title}
            value={values[key]}
            onChange={change}
            fieldClassName="min-w-0"
            className="h-10 w-full min-w-0 rounded-md border bg-background px-2 text-sm"
          >
            {children}
          </SelectField>
        ) : (
          <StyledSelect
            key={key}
            aria-label={title}
            value={values[key]}
            onChange={change}
            className={cn(
              'h-9 min-w-0 max-w-64 flex-1 basis-0 rounded-md border bg-background px-2 text-sm',
              values[key] ? 'border-foreground/50 font-medium' : 'text-muted-foreground',
            )}
          >
            {children}
          </StyledSelect>
        )
      })}
    </>
  )
}

/** The filters as one toolbar row, for a page wide enough to keep them in view. */
export function FilterRow({ className, ...props }: FilterProps & { className?: string }) {
  const active = activeFilters(props.values, props.options, props.sourceMode).length
  if (!fields(props).length) return null
  return (
    <div className={cn('items-center gap-2', className)} role="group" aria-label="Filters">
      <FilterSelects {...props} layout="row" />
      <InfoTip label="About these filters">{NOTE}</InfoTip>
      {active > 0 && (
        <Button size="sm" variant="ghost" onClick={() => props.onChange({ ...EMPTY_FILTERS })}>
          Clear
        </Button>
      )}
    </div>
  )
}

/** The button that opens the filters where there is no room for the row, counting the ones in use. */
export function FilterButton({
  count,
  onClick,
  className,
}: {
  count: number
  onClick: () => void
  className?: string
}) {
  return (
    <Button variant="outline" className={cn('shrink-0 gap-1.5 px-3', className)} onClick={onClick}>
      <SlidersHorizontal />
      Filters
      {count > 0 && (
        <span className="rounded-full bg-primary px-1.5 text-2xs font-semibold leading-4 text-primary-foreground">
          {count}
        </span>
      )}
    </Button>
  )
}

/** The filters in a dialog (a bottom sheet on a phone). They apply as they are chosen. */
export function FilterDialog({
  open,
  onClose,
  resultLabel,
  ...props
}: FilterProps & { open: boolean; onClose: () => void; resultLabel: string }) {
  const active = activeFilters(props.values, props.options, props.sourceMode).length
  return (
    <PanelDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="Filters"
      size="md"
      footer={
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" disabled={!active} onClick={() => props.onChange({ ...EMPTY_FILTERS })}>
            Clear all
          </Button>
          <Button onClick={onClose}>Show {resultLabel}</Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <FilterSelects {...props} layout="stacked" />
      </div>
      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">{NOTE}</p>
    </PanelDialog>
  )
}

/** One removable chip per filter in use, so a narrowed list says why wherever the dropdowns are out of view. */
export function ActiveFilterChips({ className, ...props }: FilterProps & { className?: string }) {
  const active = activeFilters(props.values, props.options, props.sourceMode)
  if (!active.length) return null
  return (
    <ul className={cn('flex min-w-0 flex-wrap items-center gap-1.5', className)} aria-label="Filters in use">
      {active.map(({ key, title, label }) => (
        <li key={key} className="min-w-0 max-w-full">
          <button
            type="button"
            aria-label={`Remove filter: ${title}: ${label}`}
            onClick={() => props.onChange({ ...props.values, [key]: '' })}
            className="inline-flex max-w-full items-center gap-1 rounded-full border bg-card py-1 pl-2.5 pr-1.5 text-xs text-foreground hover:bg-accent touch:min-h-8"
          >
            <span className="truncate">{label}</span>
            <X className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  )
}

/** The filters folded into a sidebar section, beside a map. */
export function LibraryFilters(props: FilterProps) {
  const count = activeFilters(props.values, props.options, props.sourceMode).length
  if (!fields(props).length) return null
  return (
    <CollapsibleSection
      label="Filters"
      collapseOn="always"
      summary={count ? `${count} in use` : 'Subject, region, date, source'}
      className="mt-3 rounded-lg border"
      contentClassName="p-3"
      actions={
        count ? (
          <Button size="sm" variant="ghost" onClick={() => props.onChange({ ...EMPTY_FILTERS })}>
            Clear
          </Button>
        ) : undefined
      }
    >
      <div className="grid gap-3">
        <FilterSelects {...props} layout="stacked" />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{NOTE}</p>
    </CollapsibleSection>
  )
}
