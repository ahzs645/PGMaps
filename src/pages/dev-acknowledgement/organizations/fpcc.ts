// Maps FPCC (First Peoples' Map of B.C.) language-territory names to the
// Nation(s) / people-group(s) associated with that language, so the FPCC
// language-polygon match can feed Nation resolution alongside Native Land.
// Data lives in fpcc-language-map.json (keyed by the exact FPCC language name).

import fpccLanguageMapData from './fpcc-language-map.json'

const fpccLanguageMap = fpccLanguageMapData as Record<string, string[]>

/** Nation/people-group names for the given FPCC language-territory name(s). */
export function fpccLanguageNations(languages: string[] | undefined): string[] {
  if (!languages) return []
  const out = new Set<string>()
  for (const language of languages) {
    for (const nation of fpccLanguageMap[language] ?? []) out.add(nation)
  }
  return [...out]
}
