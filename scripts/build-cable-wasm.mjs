#!/usr/bin/env node
/**
 * Rebuilds the cable-layout crate (crates/cable-layout) to the WebAssembly file the road tool
 * loads, src/pages/dev-forestry-roads/cableLayout/cable_layout.wasm, byte for byte the same on any
 * machine with the pinned toolchain (rust-toolchain.toml): release profile, one codegen unit,
 * panic=abort, no debug info, stripped, and every local path remapped out of the binary.
 *
 *   npm run wasm:cable            rebuild and copy
 *   npm run wasm:cable -- --check rebuild and fail if the committed file differs
 */
import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const crate = join(root, 'crates', 'cable-layout')
const target = join(crate, 'target')
const built = join(target, 'wasm32-unknown-unknown', 'release', 'cable_layout.wasm')
const committed = join(root, 'src', 'pages', 'dev-forestry-roads', 'cableLayout', 'cable_layout.wasm')
const check = process.argv.includes('--check')

const cargoHome = process.env.CARGO_HOME ?? join(homedir(), '.cargo')
const cargo =
  process.env.CARGO ?? (existsSync(join(cargoHome, 'bin', 'cargo')) ? join(cargoHome, 'bin', 'cargo') : 'cargo')
const rustupHome = process.env.RUSTUP_HOME ?? join(homedir(), '.rustup')
// Separated by 0x1f so paths with spaces survive.
const flags = [
  `--remap-path-prefix=${crate}=crates/cable-layout`,
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
    process.stderr.write(`cable_layout.wasm differs from a clean rebuild. Commit ${built} as ${committed}.\n`)
    process.exit(1)
  }
  process.stdout.write('cable_layout.wasm matches a clean rebuild.\n')
} else {
  copyFileSync(built, committed)
  process.stdout.write(`Wrote ${committed} (${readFileSync(committed).length} bytes).\n`)
}
