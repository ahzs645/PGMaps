/**
 * Screen pages: the HTML a Save & export preview draws to describe a file it cannot show (a project file, a zip's
 * contents), as opposed to a document, which is the file itself and is drawn on paper. A screen page takes its
 * colours through {@link screenColour}; `FramePages` with `page="screen"` fills them from the app's theme, so the page
 * follows light and dark mode and the Appearance theme, and opened in a new tab it keeps the light fallbacks.
 * DOM-free.
 */

/** Each colour a screen page reads, and the app token (`src/index.css`) it is filled from. */
export const SCREEN_PAGE_TOKENS = {
  fg: 'foreground',
  bg: 'background',
  muted: 'muted-foreground',
  line: 'border',
  panel: 'muted',
} as const

export type ScreenPageColour = keyof typeof SCREEN_PAGE_TOKENS

const LIGHT: Record<ScreenPageColour, string> = {
  fg: '#1c1917',
  bg: '#fff',
  muted: '#78716c',
  line: '#e7e5e4',
  panel: '#fafaf9',
}

/** The custom property `FramePages` sets for one colour. */
export const screenColourProperty = (name: ScreenPageColour) => `--screen-${name}`

/** A colour of a screen page: the app's while previewed, else `fallback` (the light default). */
export const screenColour = (name: ScreenPageColour, fallback = LIGHT[name]) =>
  `var(${screenColourProperty(name)},${fallback})`

/** Whether an HSL token (`"0 0% 3.9%"`, as the app's tokens are written) is a dark colour. */
export function isDarkToken(value: string): boolean {
  const lightness = /([\d.]+)%\s*(?:\/.*)?$/.exec(value.trim())
  return lightness !== null && Number(lightness[1]) < 50
}
