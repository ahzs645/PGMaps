import { useEffect } from 'react'
import { safeLink } from '../SafeRichText.js'

export interface StoryFontFace {
  url: string
  weight?: string
  style?: string
  unicodeRange?: string
}
/** Registers only the current document's explicitly imported fonts, releasing them on leave. */
export function useStoryFonts(fonts: StoryFontFace[]) {
  const key = JSON.stringify(fonts)
  useEffect(() => {
    let disposed = false
    const loaded: FontFace[] = []
    const entries = JSON.parse(key) as StoryFontFace[]
    const pending = entries.flatMap((entry) => {
      const url = safeLink(entry.url)
      if (!url) return []
      const face = new FontFace('ImportedStoryFont', `url(${JSON.stringify(url)})`, {
        weight: entry.weight || '400',
        style: entry.style || 'normal',
        ...(entry.unicodeRange ? { unicodeRange: entry.unicodeRange } : {}),
      })
      return [face.load()]
    })
    // Publish the family together so a faster bold file cannot briefly become
    // the only available face for ordinary body text.
    void Promise.allSettled(pending).then((results) => {
      if (disposed) return
      for (const result of results)
        if (result.status === 'fulfilled') {
          document.fonts.add(result.value)
          loaded.push(result.value)
        }
    })
    return () => {
      disposed = true
      loaded.forEach((font) => document.fonts.delete(font))
    }
  }, [key])
}
