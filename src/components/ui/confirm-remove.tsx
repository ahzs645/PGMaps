/**
 * A remove control that asks once: the bin opens a small popover with the question and two buttons of one size,
 * *Remove* and *Keep*, and only *Remove* acts. For removals that cannot be undone, where a dialog would be heavy and
 * a bare button too easy to hit. Focus lands on *Keep*, so a second Enter never removes; Escape or a press outside
 * keeps, and focus goes back to the bin. The popover is the application's (`Popover`), so it opens above a dialog and
 * stays on screen at the edge of a list.
 */
import { Trash2 } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export function ConfirmRemoveButton({
  label,
  children,
  question,
  detail,
  confirmLabel = 'Remove',
  keepLabel = 'Keep',
  onConfirm,
  disabled,
  className,
}: {
  /** The control's accessible name, and its tooltip when it shows only the icon: "Remove IMG_1.HEIC". */
  label: string
  /** Text beside the icon; without it the control is the icon alone. */
  children?: ReactNode
  /** What is asked: "Remove this photo?". */
  question: string
  /** What goes with it, in a line under the question: "Its field record and its original go with it." */
  detail?: ReactNode
  confirmLabel?: string
  keepLabel?: string
  onConfirm: () => void
  disabled?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const keep = useRef<HTMLButtonElement>(null)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={children ? 'sm' : 'icon-xs'}
          className={cn('shrink-0 text-muted-foreground hover:text-danger', className)}
          aria-label={label}
          title={children ? undefined : label}
          disabled={disabled}
        >
          <Trash2 aria-hidden />
          {children}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        role="alertdialog"
        aria-label={label}
        className="w-64 max-w-[calc(100vw-16px)] space-y-3 p-3 text-xs"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          keep.current?.focus()
        }}
      >
        <div className="space-y-1">
          <p className="font-medium text-foreground">{question}</p>
          {detail && <p className="leading-5 text-muted-foreground">{detail}</p>}
        </div>
        <div className="flex justify-end gap-2">
          <Button ref={keep} type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
            {keepLabel}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => {
              setOpen(false)
              onConfirm()
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
