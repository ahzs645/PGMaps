import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import process from 'node:process'

const root = fileURLToPath(new URL('../../', import.meta.url))
const packageRoot = path.join(root, 'packages/geo-toolkit')
const failures = []
let modules = 0

async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) await inspect(file)
    else if (/\.(tsx?|mjs|css)$/.test(file) && !/\.test\./.test(file)) {
      modules++
      const text = await readFile(file, 'utf8')
      const label = path.relative(root, file)
      if (/['"]@\//.test(text)) failures.push(`${label}: application alias import`)
      if (/import\.meta\.env|(?:public\/data|vendor\/bcdatamapper)/.test(text))
        failures.push(`${label}: application build/data dependency`)
      for (const match of text.matchAll(/(?:from\s*|import\s*\(|@import\s*)['"]([^'"]+)['"]/g)) {
        const specifier = match[1]
        if (
          specifier.startsWith('.') &&
          !path.resolve(path.dirname(file), specifier).startsWith(packageRoot + path.sep)
        )
          failures.push(`${label}: import escapes package (${specifier})`)
      }
    }
  }
}

await inspect(path.join(packageRoot, 'src'))
if (failures.length) {
  process.stderr.write(failures.join('\n') + '\n')
  process.exit(1)
}
process.stdout.write(`Toolkit boundary check passed (${modules} modules; no imports back into PG Maps).\n`)
