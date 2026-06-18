import type { SourceMatch } from './types'

export function normalizeName(name: string) {
  return name
    .toLowerCase()
    .replace(/first nation|indian band|band|treaty area|treaty lands/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function candidateId(name: string) {
  return normalizeName(name).replace(/\s+/g, '-') || name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

export function normalizeMatchText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export function uniqueMatches(matches: SourceMatch[]) {
  const seen = new Set<string>()
  return matches.filter((match) => {
    const key = `${match.source}:${normalizeName(match.name)}:${match.label}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
