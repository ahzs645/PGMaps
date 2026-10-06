import { createHash } from 'node:crypto'
import { cpSync, existsSync, lstatSync, readdirSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const VERSION = 1
export const incrementalDataPath = fileURLToPath(import.meta.url)

function fileStamp(file) {
  try {
    const stat = lstatSync(file)
    return [stat.size, stat.mtimeMs, stat.ctimeMs]
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

function readState(file) {
  try {
    const state = JSON.parse(readFileSync(file, 'utf8'))
    return state.version === VERSION ? state : null
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null
    throw error
  }
}

function saveState(file, state) {
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify({ version: VERSION, ...state }))
  renameSync(temporary, file)
}

function snapshot(file) {
  const stamp = fileStamp(file)
  if (stamp && lstatSync(file).isDirectory()) {
    return [
      resolve(file),
      stamp,
      readdirSync(file)
        .sort()
        .map((name) => snapshot(join(file, name))),
    ]
  }
  return [resolve(file), stamp]
}

function fingerprint(files) {
  return createHash('sha256')
    .update(JSON.stringify([process.version, files.map(snapshot)]))
    .digest('hex')
}

/** Local stamps stay outside public/; missing or edited outputs always rebuild. */
export function beginDataBuild(root, key, inputs, outputs, force = false) {
  const cacheFile = join(root, '.vite', 'pgmaps-data', `${key}.json`)
  const input = fingerprint([...new Set([...inputs, incrementalDataPath])].sort())
  const output = fingerprint(outputs)
  const previous = readState(cacheFile)
  const needsBuild = force || !outputs.every(existsSync) || previous?.input !== input || previous?.output !== output
  return {
    needsBuild,
    complete() {
      saveState(cacheFile, { input, output: fingerprint(outputs) })
    },
  }
}

/** Assemble the final file plan first, so overlapping mappings copy only their winner. */
export function createIncrementalCopier(root) {
  const cacheFile = join(root, '.vite', 'pgmaps-data', 'sync.json')
  const previous = readState(cacheFile)?.files ?? {}
  const planned = new Map()
  const directories = new Set()
  return {
    copy(source, destination, include = () => true) {
      function visit(sourcePath, destinationPath) {
        if (!include(sourcePath)) return
        if (lstatSync(sourcePath).isDirectory()) {
          directories.add(destinationPath)
          for (const name of readdirSync(sourcePath)) visit(join(sourcePath, name), join(destinationPath, name))
        } else {
          planned.set(destinationPath, sourcePath)
        }
      }
      visit(source, destination)
    },
    complete() {
      const files = {}
      let copied = 0,
        skipped = 0
      for (const directory of directories) mkdirSync(directory, { recursive: true })
      for (const [destination, source] of planned) {
        const input = fileStamp(source),
          output = fileStamp(destination)
        const stamp = previous[destination]
        if (
          lstatSync(source).isFile() &&
          stamp?.source === source &&
          JSON.stringify(stamp.input) === JSON.stringify(input) &&
          output &&
          JSON.stringify(stamp.output) === JSON.stringify(output)
        ) {
          files[destination] = stamp
          skipped++
          continue
        }
        mkdirSync(dirname(destination), { recursive: true })
        cpSync(source, destination, { force: true })
        files[destination] = { source, input, output: fileStamp(destination) }
        copied++
      }
      saveState(cacheFile, { files })
      return { copied, skipped }
    },
  }
}

/** Bound the number of simultaneously retained GeoJSON inputs, preserving order. */
export async function mapLimit(items, limit, transform) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Concurrency must be a positive integer')
  const result = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++
        result[index] = await transform(items[index], index)
      }
    }),
  )
  return result
}
