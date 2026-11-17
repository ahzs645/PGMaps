#!/usr/bin/env node
/**
 * Fails when the road designer reaches code outside itself and PGMaps' shared code: another page,
 * the app shell, a package package.json does not list, or an import that resolves to nothing. That
 * boundary is what lets the designer build on its own (`npm run road-design:build`) and be exported
 * to a repository of its own (`npm run road-design:export`). Guide:
 * docs/forestry-road-design/standalone-build.md.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { boundaryProblems, isOwn, packageDependencies, toolStarts, walk } from './graph.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const graph = walk(root, toolStarts(root))
const problems = boundaryProblems(root, graph, packageDependencies(root))
if (problems.length) {
  console.error(`The road designer's boundary is broken (${problems.length}):\n`)
  for (const problem of problems) console.error(`- ${problem}\n`)
  console.error(
    'Move what it needs into shared code (src/lib, src/components, …) or into the designer, so another page is never imported.',
  )
  process.exit(1)
}
const own = [...graph.reached.keys()].filter(isOwn).length
console.log(
  `Road designer boundary holds: ${graph.reached.size} files reached (${own} its own, ${graph.reached.size - own} shared), ${graph.packages.size} packages.`,
)
