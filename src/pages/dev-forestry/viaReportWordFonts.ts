/**
 * The faces the VIA report's Word layout is drawn in: Arimo, document-kit's open stand-in for Arial, the one face the
 * report names (`viaReport/word.ts`). Vite emits each file as a hashed asset of this build and gives its URL under the
 * deploy's base; nothing here is a data folder, so `withBase` and the data hosts never move them. Only this module
 * names the files, and it is imported only when a Word layout is asked for, so the fonts are fetched then and never
 * with the page.
 */
import arimoBold from 'document-kit/fonts/Arimo-Bold.ttf?url'
import arimoBoldItalic from 'document-kit/fonts/Arimo-BoldItalic.ttf?url'
import arimoItalic from 'document-kit/fonts/Arimo-Italic.ttf?url'
import arimoRegular from 'document-kit/fonts/Arimo-Regular.ttf?url'

/** Each bundled file the layout may ask for, by the kit's file name (`STAND_IN_FILES`). */
export const WORD_FONT_URLS: Readonly<Record<string, string>> = {
  'Arimo-Regular.ttf': arimoRegular,
  'Arimo-Bold.ttf': arimoBold,
  'Arimo-Italic.ttf': arimoItalic,
  'Arimo-BoldItalic.ttf': arimoBoldItalic,
}
