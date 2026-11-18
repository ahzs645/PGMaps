import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ClipboardCopy, Loader2 } from 'lucide-react'
import { Button, type ButtonProps } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import {
  ClipboardImageError,
  clipboardImageUnsupportedReason,
  copyImageToClipboard,
  type ImageClipboardEnvironment,
} from '@/lib/clipboardImage'

/** How long "Copied" shows before the button reads as before, ms. */
export const COPY_IMAGE_COPIED_MS = 2000
/** How long a failure's reason stays beside the button, ms. */
export const COPY_IMAGE_FAILURE_MS = 8000

export type CopyImageResult = { copied: true } | { copied: false; error: ClipboardImageError }

export type CopyImageButtonProps = Omit<ButtonProps, 'onClick' | 'children' | 'type' | 'asChild'> & {
  /**
   * Makes the PNG. Called synchronously in the click; it may return a promise and take its time,
   * because the clipboard write has already started (Safari needs that).
   */
  png: () => Blob | Promise<Blob>
  /** The button's label. Default "Copy image". */
  children?: ReactNode
  /**
   * Where this browser cannot copy images: `hide` (default) renders nothing, so the Download
   * beside it is the only action; `explain` shows the button disabled with the reason behind an (i).
   */
  whenUnsupported?: 'hide' | 'explain'
  /** Show the clipboard icon. Default true. */
  icon?: boolean
  onResult?: (result: CopyImageResult) => void
  /** The clipboard, for tests. Default the browser's. */
  environment?: ImageClipboardEnvironment
}

type Feedback =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'copied' }
  | { status: 'failed'; message: string }

/**
 * Copy a picture (a map, a sheet, a figure) to the clipboard as PNG. Shows working, copied and
 * the failure's reason. Put it beside the Download button, never in place of it.
 */
export function CopyImageButton({
  png,
  children = 'Copy image',
  whenUnsupported = 'hide',
  icon = true,
  onResult,
  environment,
  variant = 'outline',
  size = 'xs',
  disabled,
  ...props
}: CopyImageButtonProps) {
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
  const unsupported = clipboardImageUnsupportedReason(environment)
  if (unsupported && whenUnsupported === 'hide') return null

  const settle = (id: number, next: Feedback, resetAfterMs: number) => {
    if (attempt.current !== id) return
    setFeedback(next)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      if (attempt.current === id) setFeedback({ status: 'idle' })
    }, resetAfterMs)
  }

  const copy = () => {
    const id = ++attempt.current
    clearTimeout(timer.current)
    let rendering: Promise<Blob>
    try {
      rendering = Promise.resolve(png())
    } catch (reason) {
      rendering = Promise.reject(reason)
    }
    // Synchronously, inside the click: the write must begin before the picture exists.
    const copying = copyImageToClipboard(rendering, environment)
    setFeedback({ status: 'pending' })
    copying.then(
      () => {
        settle(id, { status: 'copied' }, COPY_IMAGE_COPIED_MS)
        if (attempt.current === id) onResult?.({ copied: true })
      },
      (reason: unknown) => {
        const error =
          reason instanceof ClipboardImageError
            ? reason
            : new ClipboardImageError('failed', 'The picture could not be copied. Use Download instead.', {
                cause: reason,
              })
        settle(id, { status: 'failed', message: error.message }, COPY_IMAGE_FAILURE_MS)
        if (attempt.current === id) onResult?.({ copied: false, error })
      },
    )
  }

  const pending = feedback.status === 'pending'
  const Icon = pending ? Loader2 : feedback.status === 'copied' ? Check : ClipboardCopy
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <Button
        {...props}
        type="button"
        variant={variant}
        size={size}
        disabled={disabled || pending || Boolean(unsupported)}
        aria-busy={pending}
        onClick={copy}
      >
        {icon && <Icon className={pending ? 'animate-spin' : undefined} aria-hidden="true" />}
        {pending ? 'Copying…' : feedback.status === 'copied' ? 'Copied' : children}
      </Button>
      {unsupported && (
        <InfoTip label="Why copying is unavailable" tone="warning">
          {unsupported}
        </InfoTip>
      )}
      <span aria-live="polite" className="text-2xs text-danger empty:hidden">
        {feedback.status === 'failed' ? feedback.message : ''}
      </span>
    </span>
  )
}
