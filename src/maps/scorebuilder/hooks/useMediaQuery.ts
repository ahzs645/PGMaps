import { useEffect, useState } from 'react'

function getMatch(query: string): boolean {
  if (typeof window === 'undefined') {
    return false
  }
  return window.matchMedia(query).matches
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => getMatch(query))

  useEffect(() => {
    const mediaQueryList = window.matchMedia(query)

    const updateMatch = () => {
      setMatches(mediaQueryList.matches)
    }

    updateMatch()
    mediaQueryList.addEventListener('change', updateMatch)

    return () => {
      mediaQueryList.removeEventListener('change', updateMatch)
    }
  }, [query])

  return matches
}
