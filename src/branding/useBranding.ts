import { useEffect, useSyncExternalStore } from 'react'
import { getBrandingState, initializeBranding, serverBrandingState, subscribeBranding } from './store'

export function useBranding() {
  const state = useSyncExternalStore(subscribeBranding, getBrandingState, serverBrandingState)
  useEffect(() => {
    void initializeBranding()
  }, [])
  return state
}
