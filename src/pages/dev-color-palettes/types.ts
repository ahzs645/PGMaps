export interface CatalogPalette {
  id: string
  name: string
  colors: string[]
  positions?: number[]
  missingColor?: string
  file: string
  line?: number
  pointer?: string
  kind: string
  theme: {
    status: 'same' | 'different' | 'unknown'
    evidence: string
    variant?: 'light' | 'dark'
    counterpartId?: string
  }
  pages: { href: string; evidence: string }[]
  directPages: { href: string; evidence: string }[]
  directReferences: { file: string; line: number }[]
}
export interface ColorCatalog {
  scope: string
  distinctLiterals: number
  groups: { prefix: string; filesScanned: number; filesWithColors: number; literals: number; uniqueLiterals: number }[]
  tailwind: { occurrences: number; uniqueTokens: number; files: number }
  projectBasemaps: Record<string, number>
  palettes: CatalogPalette[]
  inventory: { color: string; occurrences: number; locations: { file: string; line: number }[] }[]
}
