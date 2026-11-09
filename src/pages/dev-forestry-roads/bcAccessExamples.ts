/** Live recipes, not stored provincial feature extracts. Re-query to inspect current source records. */
export interface BcAccessExample {
  id: string
  title: string
  openingId: string
  description: string
  verifiedOn: string
}

export const BC_ACCESS_EXAMPLES: readonly BcAccessExample[] = [
  {
    id: 'bc-opening-60677',
    openingId: '60677',
    title: 'Opening 60677 · 1997 harvest',
    description:
      'Inspect the reported A18165 / 70 / 1 opening and its R01860 / K6 geometric road candidate. Re-query the actual records; historical use and crossing evidence remain unassessed.',
    verifiedOn: '2026-11-09',
  },
  {
    id: 'bc-opening-56944',
    openingId: '56944',
    title: 'Opening 56944 · 1996 harvest and mapped gap',
    description:
      'A18165 / 38 / 7A reports a 1996 harvest. The verified local query found three roads; R02946 / C was about 8.7 m from the footprint. Inspect the gap without inventing an entrance or a historical connection.',
    verifiedOn: '2026-11-09',
  },
  {
    id: 'bc-opening-11981',
    openingId: '11981',
    title: 'Opening 11981 · 1989 harvest and road contact',
    description:
      'A18165 / 407 / 1 reports harvesting in 1989. R03890 / B intersects its footprint; other nearby roads report different clients. Compare administrative identifiers with geometric candidates before investigating historical use.',
    verifiedOn: '2026-11-09',
  },
  {
    id: 'bc-opening-11984',
    openingId: '11984',
    title: 'Opening 11984 · 1988–1990 reported interval',
    description:
      'A18165 / 408 / 1 is near opening 11981 and reports a longer harvesting interval, with completion potentially estimated. R03890 / A intersects this different footprint. Compare the neighbouring blocks and their separate road candidates.',
    verifiedOn: '2026-11-09',
  },
]
