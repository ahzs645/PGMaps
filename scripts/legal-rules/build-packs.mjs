import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
const root = new URL('../../packages/legal-rules/', import.meta.url)
const read = (path) => JSON.parse(readFileSync(new URL(path, root), 'utf8'))
const built = []
for (const name of readdirSync(new URL('instruments/', root)).filter((name) => name.endsWith('.json'))) {
  const { sourceFiles, ruleFiles, ...header } = read('instruments/' + name)
  const pack = { ...header, sources: sourceFiles.map((file) => read(file).citation), rules: ruleFiles.flatMap(read) }
  built.push(pack)
  const output = new URL('packs/' + name, root)
  if (process.argv.includes('--check')) {
    // JSON member order also stays stable across re-installation of a release.
    if (JSON.stringify(read('packs/' + name)) !== JSON.stringify(pack)) throw Error('Rebuild ' + name)
  } else writeFileSync(output, JSON.stringify(pack, null, 2) + '\n')
}
// A fact linked `sameAs` another instrument's fact must be asked there with the same answers
// (`checkFactLinks` in src/contract.ts checks every installed release the same way).
const answers = (f) => JSON.stringify([f.type, f.unit, f.min, f.max, f.choices])
for (const pack of built)
  for (const fact of pack.facts.filter((f) => f.sameAs)) {
    const [id, factId] = fact.sameAs.split(':')
    const other = built.find((p) => p.id === id)?.facts.find((f) => f.id === factId)
    if (!other) throw Error(`${pack.id} ${fact.id} names ${fact.sameAs}, which no built instrument asks`)
    if (answers(other) !== answers(fact)) throw Error(`${pack.id} ${fact.id} and ${fact.sameAs} take different answers`)
  }
