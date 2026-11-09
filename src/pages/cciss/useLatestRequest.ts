import { useEffect, useMemo, useRef } from 'react'

/**
 * Numbers async work so only the latest request may update state. Starting another request,
 * or unmounting, retires every earlier one.
 */
export function useLatestRequest() {
  const request = useRef(0)
  useEffect(
    () => () => {
      request.current++
    },
    [],
  )
  return useMemo(
    () => ({
      next: () => ++request.current,
      isLatest: (id: number) => id === request.current,
    }),
    [],
  )
}

export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))
