// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function verifyUpstream(referenceDirectory) {
  const upstream = path.join(referenceDirectory, 'upstream')
  const manifest = JSON.parse(fs.readFileSync(path.join(upstream, 'manifest.json'), 'utf8'))
  assert.equal(manifest.sourceCommit, 'e02ddcbf8203e65bada1a36655887e1d0c8fe2f5')
  for (const file of manifest.files) {
    const bytes = fs.readFileSync(path.join(upstream, file.path))
    assert.equal(bytes.length, file.bytes, `${file.path}: size`)
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, `${file.path}: SHA256`)
    assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), file.gitBlobSha, `${file.path}: Git object`)
  }
  return manifest.files.length
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const reference = path.resolve(process.argv[2] ?? path.dirname(fileURLToPath(import.meta.url)))
  console.log(`Verified ${verifyUpstream(reference)} exact upstream files.`)
}
