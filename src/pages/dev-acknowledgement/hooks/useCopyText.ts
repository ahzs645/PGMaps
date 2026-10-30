import { useClipboardText } from '@/hooks/useClipboardText'

/** Preserve draft-specific wording while sharing clipboard state and cleanup. */
export function useCopyText() {
  const { copy, status } = useClipboardText({ resetAfterMs: 3000, failureResetAfterMs: 0 })
  const message =
    status === 'copied'
      ? 'Copied to clipboard.'
      : status === 'failed'
        ? 'Copy was unavailable. Select the draft text and use your device’s Copy command.'
        : ''
  return { copy, message }
}
