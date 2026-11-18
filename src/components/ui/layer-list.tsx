import type { ReactNode } from 'react'

import { InfoTip } from '@/components/ui/info-tip'
import { cn } from '@/lib/utils'

export type LayerListItem = {
  id: string
  label: string
  /** The symbol the layer draws with, at swatch size. */
  swatch?: ReactNode
  /** Where the layer comes from and what it means, behind an (i) on its row. */
  help?: ReactNode
  /** A word or two on the row while the layer can still be switched on: "reading…", "part read". */
  status?: string
  /** Why the layer cannot be shown here. The row stays, its switch off, with this in place of the status. */
  unavailable?: string
}

export type LayerListGroup = { id: string; title: string; items: readonly LayerListItem[] }

export type LayerListProps = {
  /** What the layers are drawn on, for the switches' names: "the photo", "the plan". */
  subject: string
  groups: readonly LayerListGroup[]
  visibility: Readonly<Record<string, boolean>>
  onChange: (id: string, on: boolean) => void
  /** A row under the pointer or the keyboard, for a caller that highlights its layer; null when it leaves. */
  onHover?: (id: string | null) => void
  /** Puts every layer back to how it starts. The button is left out when absent. */
  onReset?: () => void
  className?: string
}

const shown = (item: LayerListItem, visibility: Readonly<Record<string, boolean>>) =>
  !item.unavailable && !!visibility[item.id]

/**
 * Layers a reader switches on and off over a picture or a map, in titled groups: the switch and the symbol first, the
 * name, then a word on its state, with the longer explanation behind an (i). Each group says how many of its layers
 * are on and switches them together; a layer that cannot be shown says why and stays off rather than reading as
 * empty. The list knows nothing of what the layers are: a caller hands it groups, and adds one for anything new it can
 * draw.
 */
export function LayerList({ subject, groups, visibility, onChange, onHover, onReset, className }: LayerListProps) {
  const all = groups.flatMap((group) => group.items)
  const on = all.filter((item) => shown(item, visibility)).length
  return (
    <div className={cn('space-y-3 p-3 text-xs', className)} onMouseLeave={() => onHover?.(null)}>
      <div className="flex items-center justify-between gap-2 text-2xs text-muted-foreground">
        <span className="tabular-nums" role="status">
          {on} of {all.length} shown
        </span>
        {onReset && (
          <button
            type="button"
            className="rounded-sm underline-offset-2 hover:text-foreground hover:underline"
            onClick={onReset}
          >
            Back to the usual layers
          </button>
        )}
      </div>
      {groups.map((group) => {
        if (!group.items.length) return null
        const usable = group.items.filter((item) => !item.unavailable)
        const groupOn = usable.filter((item) => visibility[item.id]).length
        const allOn = usable.length > 0 && groupOn === usable.length
        return (
          <section key={group.id} className="space-y-1" aria-label={group.title}>
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-2xs font-semibold tracking-wide text-muted-foreground uppercase">
                {group.title}
                <span className="ml-1.5 font-normal tracking-normal normal-case tabular-nums">
                  {groupOn} of {group.items.length}
                </span>
              </h4>
              {usable.length > 1 && (
                <button
                  type="button"
                  className="rounded-sm text-2xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  aria-label={`${allOn ? 'Hide' : 'Show'} all of ${group.title.toLowerCase()} on ${subject}`}
                  onClick={() => {
                    for (const item of usable) if (!!visibility[item.id] === allOn) onChange(item.id, !allOn)
                  }}
                >
                  {allOn ? 'Hide all' : 'Show all'}
                </button>
              )}
            </div>
            <ul>
              {group.items.map((item) => {
                const state = item.unavailable ?? item.status
                return (
                  <li
                    key={item.id}
                    className="-mx-1.5 flex items-center gap-1 rounded-sm px-1.5 transition-colors hover:bg-foreground/[0.05]"
                    onMouseEnter={() => onHover?.(item.id)}
                    onFocus={() => onHover?.(item.id)}
                    onBlur={() => onHover?.(null)}
                  >
                    <label
                      className={cn(
                        'flex min-w-0 flex-1 items-center gap-2 py-1 touch:min-h-10',
                        item.unavailable && 'text-muted-foreground',
                      )}
                    >
                      <input
                        type="checkbox"
                        className="shrink-0"
                        aria-label={`Show ${item.label.toLowerCase()} on ${subject}`}
                        checked={shown(item, visibility)}
                        disabled={!!item.unavailable}
                        onChange={(event) => onChange(item.id, event.target.checked)}
                      />
                      <span className="flex w-8 shrink-0 items-center justify-center" aria-hidden>
                        {item.swatch}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {state && (
                        <span className="max-w-[45%] shrink-0 truncate text-2xs text-muted-foreground" title={state}>
                          {state}
                        </span>
                      )}
                    </label>
                    {item.help && <InfoTip label={`About ${item.label.toLowerCase()}`}>{item.help}</InfoTip>}
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
