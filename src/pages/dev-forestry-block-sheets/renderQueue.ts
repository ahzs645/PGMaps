import { useEffect, useState, type RefObject } from 'react'

let tail: Promise<unknown> = Promise.resolve()

/**
 * Runs heavy drawing one job at a time, with a frame between jobs, so a page of sheet previews
 * fills in without freezing the page.
 */
export function enqueueRender<T>(job: () => T | Promise<T>): Promise<T> {
  const run = tail.then(
    () =>
      new Promise<T>((resolve, reject) => {
        setTimeout(() => {
          Promise.resolve().then(job).then(resolve, reject)
        }, 0)
      }),
  )
  tail = run.catch(() => undefined)
  return run
}

/** True once the element has come within a screen of the viewport; it stays true. */
export function useSeen(ref: RefObject<Element | null>) {
  // Without an observer (old browsers, tests) everything counts as seen.
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const element = ref.current
    if (seen || !element) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true)
          observer.disconnect()
        }
      },
      { rootMargin: '100% 0px' },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, seen])
  return seen
}
