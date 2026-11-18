import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Loader2, Save } from 'lucide-react'
import { Button, type ButtonProps } from '@/components/ui/button'
import {
  SaveFileError,
  saveFileAs,
  saveFilePickerSupported,
  type SaveFileContent,
  type SaveFileEnvironment,
  type SaveFileResult,
  type SaveFileType,
} from '@/lib/saveFile'

/** How long "Saved" shows before the button reads as before, ms. */
export const SAVE_AS_SAVED_MS = 3000
/** How long a failure's reason stays beside the button, ms. */
export const SAVE_AS_FAILURE_MS = 8000

export type SaveAsButtonProps = Omit<
  ButtonProps,
  'onClick' | 'children' | 'type' | 'asChild' | 'content' | 'onError'
> & {
  /** The name offered in the dialog; the extension is added when missing. */
  suggestedName: string
  fileType: SaveFileType
  /** Builds the file; runs only after a place is chosen, so it may be slow. The same build Download uses. */
  content: () => SaveFileContent | Promise<SaveFileContent>
  /** Lets the dialog reopen in the folder last used for this kind of file. */
  rememberFolderAs?: string
  /** The label. Default "Save as…". */
  children?: ReactNode
  /**
   * Show the button where the browser has no save dialog, where it can only download. Default
   * false: beside a Download button it would do the same thing twice.
   */
  showWithoutPicker?: boolean
  /** Show the save icon. Default true. */
  icon?: boolean
  onResult?: (result: SaveFileResult) => void
  onError?: (error: SaveFileError) => void
  /** The save dialog and download, for tests. Default the browser's. */
  environment?: SaveFileEnvironment
}

type Feedback =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'saved'; fileName: string }
  | { status: 'failed'; message: string }

/**
 * "Save as…": the browser's save dialog, then the file built and written where the person
 * chose. An extra beside a tool's Download button, never a replacement for it.
 */
export function SaveAsButton({
  suggestedName,
  fileType,
  content,
  rememberFolderAs,
  children = 'Save as…',
  showWithoutPicker = false,
  icon = true,
  onResult,
  onError,
  environment,
  variant = 'outline',
  size = 'xs',
  disabled,
  ...props
}: SaveAsButtonProps) {
  const [feedback, setFeedback] = useState<Feedback>({ status: 'idle' })
  const attempt = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(
    () => () => {
      attempt.current++
      clearTimeout(timer.current)
    },
    [],
  )
  if (!showWithoutPicker && !saveFilePickerSupported(environment)) return null

  const settle = (id: number, next: Feedback, resetAfterMs: number) => {
    if (attempt.current !== id) return
    setFeedback(next)
    clearTimeout(timer.current)
    if (next.status === 'idle') return
    timer.current = setTimeout(() => {
      if (attempt.current === id) setFeedback({ status: 'idle' })
    }, resetAfterMs)
  }

  const save = () => {
    const id = ++attempt.current
    clearTimeout(timer.current)
    // Synchronously, inside the click: the dialog needs the click's activation.
    const saving = saveFileAs({ suggestedName, type: fileType, content, rememberFolderAs, environment })
    setFeedback({ status: 'pending' })
    saving.then(
      (result) => {
        settle(
          id,
          result.outcome === 'cancelled' ? { status: 'idle' } : { status: 'saved', fileName: result.fileName },
          SAVE_AS_SAVED_MS,
        )
        if (attempt.current === id) onResult?.(result)
      },
      (reason: unknown) => {
        const error =
          reason instanceof SaveFileError
            ? reason
            : new SaveFileError('write-failed', 'The file could not be saved. Use Download instead.', { cause: reason })
        settle(id, { status: 'failed', message: error.message }, SAVE_AS_FAILURE_MS)
        if (attempt.current === id) onError?.(error)
      },
    )
  }

  const pending = feedback.status === 'pending'
  const Icon = pending ? Loader2 : Save
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <Button
        {...props}
        type="button"
        variant={variant}
        size={size}
        disabled={disabled || pending}
        aria-busy={pending}
        onClick={save}
      >
        {icon && <Icon className={pending ? 'animate-spin' : undefined} aria-hidden="true" />}
        {pending ? 'Saving…' : feedback.status === 'saved' ? 'Saved' : children}
      </Button>
      <span
        aria-live="polite"
        className={
          feedback.status === 'failed' ? 'text-2xs text-danger' : 'text-2xs text-muted-foreground empty:hidden'
        }
      >
        {feedback.status === 'failed'
          ? feedback.message
          : feedback.status === 'saved'
            ? `Saved as ${feedback.fileName}`
            : ''}
      </span>
    </span>
  )
}
