/**
 * The title a printed document carries (`docs/shared-ui.md`, **Document titles**; rule in `src/lib/documentTitle.ts`).
 * While the person has typed nothing the field shows the name it follows as its placeholder, and every document prints
 * that name; once they type, their title is stored and printed; clearing the field, or *Follow … again*, removes it.
 * Every Save & export that prints a title shows this field above its outputs' settings: never a page's own title input.
 */
import { useId, useState } from 'react'
import { Link2 } from 'lucide-react'

import { documentTitle, MAX_DOCUMENT_TITLE, storedDocumentTitle } from '@/lib/documentTitle'
import { cn } from '@/lib/utils'

import { FORM_INPUT_CLASS } from './form-field'
import { InfoTip } from './info-tip'
import { TextButton } from './text-button'

export type DocumentTitleFieldProps = {
  /** The title the person set; absent while the documents follow the name. */
  value: string | undefined
  /** The name the title follows while none is set: the project's name, the site's. */
  follows: string
  /** What the name is, in the field's wording: "the project name" (the default), "the site name". */
  followsLabel?: string
  /** The stored title, or `undefined` to follow the name again. */
  onChange: (title: string | undefined) => void
  label?: string
  /** Which documents print it, behind the (i): "Printed as the heading of the report and the map PDF." */
  printedOn?: string
  className?: string
  disabled?: boolean
}

export function DocumentTitleField({
  value,
  follows,
  followsLabel = 'the project name',
  onChange,
  label = 'Title',
  printedOn,
  className,
  disabled,
}: DocumentTitleFieldProps) {
  const id = useId()
  const own = storedDocumentTitle(value)
  // The text as typed, so a space at the end of a word is not taken away while the stored title drops it. Another
  // change to the stored title (Undo, a project opened) replaces it.
  const [draft, setDraft] = useState(own ?? '')
  if (storedDocumentTitle(draft) !== own) setDraft(own ?? '')
  const following = own === undefined
  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1', className)} data-testid="document-title">
      <label htmlFor={id} className="shrink-0 text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <input
        id={id}
        className={cn(FORM_INPUT_CLASS, 'h-8 min-w-[12rem] flex-1 py-1 md:text-xs')}
        value={draft}
        placeholder={documentTitle(undefined, follows)}
        maxLength={MAX_DOCUMENT_TITLE}
        disabled={disabled}
        aria-describedby={`${id}-state`}
        data-follows-name={following || undefined}
        onChange={(event) => {
          setDraft(event.target.value)
          const next = storedDocumentTitle(event.target.value)
          if (next !== own) onChange(next)
        }}
        onBlur={() => setDraft(own ?? '')}
      />
      <span id={`${id}-state`} className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
        {following ? (
          <>
            <Link2 className="size-3.5" aria-hidden />
            Follows {followsLabel}
          </>
        ) : (
          <TextButton disabled={disabled} onClick={() => onChange(undefined)}>
            <Link2 className="size-3.5" aria-hidden />
            Follow {followsLabel}
          </TextButton>
        )}
        <InfoTip label={`About the ${label.toLowerCase()}`}>
          Until you type a title of your own, it is {followsLabel}, and renaming changes it. Once you type one, it stays
          as typed; clear the field to follow {followsLabel} again.{printedOn ? ` ${printedOn}` : ''}
        </InfoTip>
      </span>
    </div>
  )
}
