// SPDX-License-Identifier: Apache-2.0
import type { CastorSnapshot } from './types'

/**
 * A per-cell snapshot array as one transferable Float64 buffer. Null cells are
 * recorded in a separate mask (allocated only when a null exists), so every
 * number — including NaN — and every null comes back exactly as it was.
 */
export interface PackedCastorArray {
  packed: Float64Array
  nulls?: Uint8Array
}
export type PackedCastorSnapshot = { [K in keyof CastorSnapshot]: CastorSnapshot[K] | PackedCastorArray }

function packArray(values: ReadonlyArray<number | null>): PackedCastorArray {
  const packed = new Float64Array(values.length)
  let nulls: Uint8Array | undefined
  for (let index = 0; index < values.length; index++) {
    const value = values[index]
    if (value === null) {
      nulls ??= new Uint8Array(values.length)
      nulls[index] = 1
      packed[index] = Number.NaN
    } else if (typeof value === 'number') packed[index] = value
    else throw new Error('Castor snapshot arrays may contain only numbers and null.')
  }
  return nulls ? { packed, nulls } : { packed }
}

function unpackArray({ packed, nulls }: PackedCastorArray): Array<number | null> {
  const values = new Array<number | null>(packed.length)
  if (nulls) for (let index = 0; index < packed.length; index++) values[index] = nulls[index] ? null : packed[index]
  else for (let index = 0; index < packed.length; index++) values[index] = packed[index]
  return values
}

function isPacked(value: unknown): value is PackedCastorArray {
  return typeof value === 'object' && value !== null && (value as PackedCastorArray).packed instanceof Float64Array
}

/** Packs one snapshot. Key order is kept so JSON exports of the unpacked result are byte-identical. */
export function packCastorSnapshot(snapshot: CastorSnapshot): PackedCastorSnapshot {
  const packed: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(snapshot))
    packed[key] = Array.isArray(value) ? packArray(value as Array<number | null>) : value
  return packed as PackedCastorSnapshot
}
export function unpackCastorSnapshot(snapshot: PackedCastorSnapshot): CastorSnapshot {
  const unpacked: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(snapshot)) unpacked[key] = isPacked(value) ? unpackArray(value) : value
  return unpacked as unknown as CastorSnapshot
}

/** The buffers to transfer with a packed snapshot; they become unusable in the sender. */
export function castorSnapshotTransfer(snapshot: PackedCastorSnapshot): ArrayBuffer[] {
  const transfer: ArrayBuffer[] = []
  for (const value of Object.values(snapshot))
    if (isPacked(value)) {
      transfer.push(value.packed.buffer as ArrayBuffer)
      if (value.nulls) transfer.push(value.nulls.buffer as ArrayBuffer)
    }
  return transfer
}
