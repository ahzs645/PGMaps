import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
const root = new URL('../../packages/legal-rules/', import.meta.url)
const read = (path) => JSON.parse(readFileSync(new URL(path, root), 'utf8'))
for (const name of readdirSync(new URL('instruments/', root)).filter((name) => name.endsWith('.json'))) {
  const { sourceFiles, ruleFiles, ...header } = read('instruments/' + name)
  const pack = { ...header, sources: sourceFiles.map((file) => read(file).citation), rules: ruleFiles.flatMap(read) }
  const output = new URL('packs/' + name, root)
  if (process.argv.includes('--check')) {
    // JSON member order also stays stable across re-installation of a release.
    if (JSON.stringify(read('packs/' + name)) !== JSON.stringify(pack)) throw Error('Rebuild ' + name)
  } else writeFileSync(output, JSON.stringify(pack, null, 2) + '\n')
}
