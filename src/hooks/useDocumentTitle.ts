import { useEffect } from 'react'

/** Name the browser tab for the life of a page, then hand it back to whatever came before. */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    const previous = document.title
    document.title = title
    return () => {
      document.title = previous
    }
  }, [title])
}
