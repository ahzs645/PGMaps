import { useEffect, useState } from 'react'
import { resolveFpccLanguagesAtPoint } from '../spatial'
import type { GeocodeResult } from '../types'

/** Optional language evidence cannot block or change Nation selection. */
export function LanguageContext({ result }: { result: GeocodeResult }) {
  const [enabled, setEnabled] = useState(false)
  const [names, setNames] = useState<string[]>([])
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    resolveFpccLanguagesAtPoint(result.latitude, result.longitude)
      .then((value) => {
        if (!cancelled) {
          setNames(value)
          setStatus('done')
        }
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [enabled, result.latitude, result.longitude, retry])
  return (
    <section className="rounded-xl border bg-white p-4">
      <button
        type="button"
        aria-expanded={enabled}
        onClick={() => {
          setStatus('loading')
          setEnabled((value) => !value)
        }}
        className="min-h-11 text-left text-sm font-semibold"
      >
        {enabled ? 'Hide' : 'Explore'} local language context
      </button>
      {enabled && (
        <div className="space-y-2 text-sm leading-6">
          <p role="status">
            {status === 'loading'
              ? 'Loading FPCC language context…'
              : status === 'error'
                ? 'Language context is unavailable. Your Nation selections are unaffected.'
                : names.length
                  ? names.join(', ')
                  : 'No language polygon matched this point.'}
          </p>
          {status === 'error' && (
            <button
              type="button"
              onClick={() => {
                setStatus('loading')
                setRetry((value) => value + 1)
              }}
              className="min-h-11 underline"
            >
              Retry language context
            </button>
          )}
          <p>Language areas are context and are kept separate from Nation selections.</p>
          <a
            href="https://maps.fpcc.ca/"
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center text-teal-800 underline"
          >
            First Peoples’ Map of B.C.
          </a>
        </div>
      )}
    </section>
  )
}
