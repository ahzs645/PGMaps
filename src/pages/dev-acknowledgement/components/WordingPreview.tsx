import { BookOpen, Check, Copy } from 'lucide-react'

type WordingPreviewProps = {
  wording: string
  copied: boolean
  onCopy: () => void
}

/**
 * Read-only preview of the generated acknowledgement, shown on the Map & Nations
 * tab so the wording is visible while picking points and Nations. Refinement
 * (voice, mode, scope, editing) lives on the Wording tab.
 */
export function WordingPreview({ wording, copied, onCopy }: WordingPreviewProps) {
  const text = wording.trim()
  return (
    <section className="rounded-lg border border-teal-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-teal-700" />
          <h2 className="text-sm font-semibold">Acknowledgement</h2>
        </div>
        <button
          type="button"
          onClick={onCopy}
          disabled={!text}
          className="inline-flex items-center gap-1 text-xs font-medium text-teal-800 disabled:opacity-40"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="rounded-md bg-slate-50 p-3 text-sm leading-6 text-slate-900">
        {text || <span className="text-slate-400">Select a location and Nation(s) to generate wording.</span>}
      </p>
    </section>
  )
}
