import { useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { useCopyText } from '../hooks/useCopyText'

export function DraftEditor({
  text,
  onChange,
  suggestion,
  context,
  edited,
  onReplace,
  children,
  purposeControls,
  canCopy,
  notice,
}: {
  text: string
  onChange: (value: string) => void
  suggestion: string
  context: string
  edited: boolean
  onReplace: () => void
  purposeControls?: ReactNode
  children: ReactNode
  canCopy: boolean
  notice?: string
}) {
  const { copy, message } = useCopyText()
  const [reading, setReading] = useState(false)
  const [keepSuggestion, setKeepSuggestion] = useState<string | null>(null)
  return (
    <section className="min-w-0 space-y-4 rounded-xl border border-teal-200 dark:border-teal-800 bg-card p-4 sm:p-5">
      <div>
        <h2 className="text-lg font-semibold">Your draft acknowledgment</h2>
        <p className="mt-1 break-words text-sm text-muted-foreground">{context}</p>
      </div>
      {notice && (
        <p role="status" className="rounded-lg bg-warning-surface p-3 text-sm leading-6 text-warning-foreground">
          {notice}
        </p>
      )}
      {reading ? (
        <div
          aria-label="Reading view"
          className="whitespace-pre-wrap break-words rounded-lg bg-background p-4 text-2xl leading-relaxed"
        >
          {text || 'Choose a location and review Nations to begin.'}
        </div>
      ) : (
        <textarea
          id="acknowledgement-draft"
          aria-label="Draft acknowledgment"
          value={text}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Choose a location and review Nations, or write your own sourced acknowledgment here."
          className="min-h-52 w-full resize-y rounded-lg border bg-background p-3 text-base leading-7"
        />
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!text.trim() || !canCopy}
          onClick={() => void copy(text)}
          className="min-h-11 rounded-lg bg-teal-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          Copy draft
        </button>
        <button
          type="button"
          aria-pressed={reading}
          onClick={() => setReading((value) => !value)}
          className="min-h-11 rounded-lg border px-3 text-sm"
        >
          {reading ? 'Edit draft' : 'Reading view'}
        </button>
        <button
          type="button"
          onClick={() => {
            // Keep selection inside the user's gesture, including on mobile Safari.
            flushSync(() => setReading(false))
            const input = document.getElementById('acknowledgement-draft') as HTMLTextAreaElement | null
            input?.focus()
            input?.select()
          }}
          className="min-h-11 rounded-lg border px-3 text-sm"
        >
          Select text
        </button>
      </div>
      <p role="status" aria-live="polite" className="text-sm text-teal-900 dark:text-teal-200">
        {message}
      </p>
      {edited && suggestion !== text && (
        <details
          open={keepSuggestion !== suggestion}
          className="rounded-lg border border-warning-border bg-warning-surface p-3"
        >
          <summary className="min-h-11 cursor-pointer text-sm font-medium">
            Your wording is kept. A generated suggestion is available.
          </summary>
          <p className="whitespace-pre-wrap text-sm leading-6">
            {suggestion || 'Complete the location review to generate a new suggestion.'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!suggestion}
              onClick={() => {
                onReplace()
                setKeepSuggestion(null)
              }}
              className="min-h-11 rounded-lg border bg-card px-3 text-sm disabled:opacity-50"
            >
              Replace with suggestion
            </button>
            <button
              type="button"
              onClick={() => setKeepSuggestion(suggestion)}
              className="min-h-11 rounded-lg border bg-card px-3 text-sm"
            >
              Keep my wording
            </button>
          </div>
        </details>
      )}
      <p className="text-sm leading-6 text-muted-foreground">
        Review names and local guidance before using this draft. Consider adding why this acknowledgment matters to you
        and a specific commitment you can act on.
      </p>
      {purposeControls}
      <details className="rounded-lg border p-3">
        <summary className="min-h-11 cursor-pointer text-sm font-semibold">Voice, occasion and scope</summary>
        {children}
      </details>
    </section>
  )
}
