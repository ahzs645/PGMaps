#!/usr/bin/env node
/**
 * Rebuilds the heic-decode crate (crates/heic-decode) to the WebAssembly file the photo tools
 * load, src/lib/heic/heic_decode.wasm, byte for byte the same on any
 * machine with the pinned toolchain (rust-toolchain.toml): release profile, one codegen unit,
 * panic=abort, no debug info, stripped, and every local path remapped out of the binary.
 *
 *   npm run wasm:heic            rebuild and copy
 *   npm run wasm:heic -- --check rebuild and fail if the committed file differs
 */
import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const crate = join(root, 'crates', 'heic-decode')
const target = join(crate, 'target')
const built = join(target, 'wasm32-unknown-unknown', 'release', 'heic_decode.wasm')
const committed = join(root, 'src', 'lib', 'heic', 'heic_decode.wasm')
const check = process.argv.includes('--check')

const cargoHome = process.env.CARGO_HOME ?? join(homedir(), '.cargo')
const cargo =
  process.env.CARGO ?? (existsSync(join(cargoHome, 'bin', 'cargo')) ? join(cargoHome, 'bin', 'cargo') : 'cargo')
const rustupHome = process.env.RUSTUP_HOME ?? join(homedir(), '.rustup')
// Separated by 0x1f so paths with spaces survive.
const flags = [
  `--remap-path-prefix=${crate}=crates/heic-decode`,
  `--remap-path-prefix=${cargoHome}=/cargo`,
  `--remap-path-prefix=${rustupHome}=/rustup`,
].join('\x1f')

execFileSync(cargo, ['build', '--release', '--locked', '--target', 'wasm32-unknown-unknown'], {
  cwd: crate,
  stdio: 'inherit',
  env: {
    ...process.env,
    CARGO_TARGET_DIR: target,
    CARGO_ENCODED_RUSTFLAGS: flags,
    RUSTFLAGS: '',
    SOURCE_DATE_EPOCH: '0',
  },
})

if (check) {
  const same = existsSync(committed) && Buffer.compare(readFileSync(built), readFileSync(committed)) === 0
  if (!same) {
    process.stderr.write(`heic_decode.wasm differs from a clean rebuild. Commit ${built} as ${committed}.\n`)
    process.exit(1)
  }
  process.stdout.write('heic_decode.wasm matches a clean rebuild.\n')
} else {
  copyFileSync(built, committed)
  process.stdout.write(`Wrote ${committed} (${readFileSync(committed).length} bytes).\n`)
}
