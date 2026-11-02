// SPDX-License-Identifier: Apache-2.0
// Deterministic reference inputs, independent of the TypeScript model implementation.
import fs from 'node:fs'
import path from 'node:path'

const output = path.resolve(process.argv[2] ?? 'scripts/forest-drought/reference/cases')
fs.mkdirSync(output, { recursive: true })
const allDates = []
for (let stamp = Date.UTC(2000, 0, 1); stamp < Date.UTC(2002, 0, 1); stamp += 86400000) {
  allDates.push(new Date(stamp).toISOString().slice(0, 10))
}
const seasonal = allDates.map((date, i) => {
  const mean = 3 + 13 * Math.sin((2 * Math.PI * (i - 100)) / 365.25)
  return [date, (mean - 5).toFixed(3), (mean + 5).toFixed(3), i % 7 === 0 ? 8 : 0]
})
const cases = {
  seasonal,
  frozen: allDates.slice(0, 366).map((date) => [date, -15, -8, 2]),
  dry: allDates.slice(0, 366).map((date) => [date, 10, 25, 0]),
  wet: allDates.slice(0, 366).map((date, i) => [date, 3, 16, i % 4 === 0 ? 80 : 0]),
  lateral: seasonal,
}
for (const [name, rows] of Object.entries(cases)) {
  fs.writeFileSync(path.join(output, `${name}.csv`), ['date,tmn,tmx,ppt', ...rows.map((row) => row.join(',')), ''].join('\n'))
}
fs.writeFileSync(path.join(output, 'cases.json'), JSON.stringify({
  schema: 'forest-drought-reference-cases-v1',
  upstreamCommit: 'e02ddcbf8203e65bada1a36655887e1d0c8fe2f5',
  synthetic: true,
  cases: Object.keys(cases),
  latitudes: [50, 55, 60],
  lateralSoilChanges: { '3': { infiltrationRate: -10 }, '5': { infiltrationRate: -28.4 } },
}, null, 2) + '\n')
console.log(`Wrote ${Object.keys(cases).length} deterministic reference inputs to ${output}`)
