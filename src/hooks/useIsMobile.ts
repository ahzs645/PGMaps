import { useMediaQuery } from './useMediaQuery'

// Single source of truth for the app's mobile/desktop split (Tailwind's md breakpoint).
export const MOBILE_MEDIA_QUERY = '(max-width: 767px)'

// Imperative check for event handlers and non-React code paths.
export function isMobileViewport(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia(MOBILE_MEDIA_QUERY).matches
}

export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_MEDIA_QUERY)
}
