// Deterministic edatopic-overlap cases for comparing the browser CCISS port with
// ccissr's edatopicOverlap (R/eda_overlap.R at the pinned commit). Each case has
// a current BGC "A", regular and special E1 series, ordinary and special phases,
// and a 2041 BGC prediction split into eighths (eight equally weighted members).
// Usage: node scripts/cciss/eda-reference/generate-cases.mjs > cases.json
const CELLS = ['B2', 'B3', 'C2', 'C3', 'C4', 'D3', 'D4', 'D5']
const BGCS = ['A', 'B', 'C', 'D']
const CODES = ['wet', 'dry']
const CASES = 120

let seed = 20261102
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  return seed / 2 ** 32
}
const pick = (items) => items[Math.floor(random() * items.length)]
const cells = () => {
  const chosen = CELLS.filter(() => random() < 0.45)
  return chosen.length ? chosen : [pick(CELLS)]
}

const cases = []
for (let id = 1; id <= CASES; id++) {
  const E1 = []
  const E1_Phase = []
  for (const bgc of BGCS) {
    const regular = 1 + Math.floor(random() * 3)
    for (let n = 1; n <= regular; n++) {
      const series = `${bgc}/0${n}`
      for (const cell of cells()) E1.push({ BGC: bgc, SS_NoSpace: series, Edatopic: cell, SpecialCode: null })
      // Ordinary phase of this main unit.
      if (random() < 0.3)
        for (const cell of cells())
          E1_Phase.push({ BGC: bgc, SS_NoSpace: `${series}a`, Edatopic: cell, SpecialCode: null, MainUnit: series })
      // Special phase of this main unit.
      if (random() < 0.35) {
        const code = pick(CODES)
        for (const cell of cells())
          E1_Phase.push({ BGC: bgc, SS_NoSpace: `${series}b`, Edatopic: cell, SpecialCode: code, MainUnit: series })
      }
    }
    // Special E1 series.
    if (random() < 0.5) {
      const code = pick(CODES)
      const series = `${bgc}/${code === 'wet' ? 'Ws' : 'Ds'}`
      for (const cell of cells()) E1.push({ BGC: bgc, SS_NoSpace: series, Edatopic: cell, SpecialCode: code })
    }
  }
  // Eight equally weighted members; the current BGC can persist.
  const members = Array.from({ length: 8 }, () => pick(BGCS))
  cases.push({ id, currentBgc: 'A', members, E1, E1_Phase })
}
process.stdout.write(JSON.stringify({ schema: 'cciss-eda-reference-cases-v1', cases }, null, 1) + '\n')
