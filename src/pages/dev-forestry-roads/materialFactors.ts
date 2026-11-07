/** Explicit volume-state conversion. Reusable fraction remains a separate material property. */
import type { GroundMaterial, MaterialVolumeFactorConvention, MaterialVolumeFactorProvenance } from './engineeringTypes'

const positive = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
    throw new Error(`${label} must be a finite positive number.`)
  return value
}

/** Return compacted fill volume per reusable bank volume, without rounding. */
export function convertMaterialVolumeFactor(enteredFactor: number, convention: MaterialVolumeFactorConvention): number {
  const entered = positive(enteredFactor, 'Entered volume factor')
  if (convention !== 'compacted-per-bank' && convention !== 'bank-per-compacted')
    throw new Error('Volume factor convention must be compacted-per-bank or bank-per-compacted.')
  return positive(convention === 'bank-per-compacted' ? 1 / entered : entered, 'Converted volume factor')
}

/** Preserve the existing saved material range. Pure conversion itself accepts any positive finite ratio. */
function canonical(value: unknown): number {
  const factor = positive(value, 'Canonical volume factor')
  if (factor < 0.1 || factor > 2) throw new Error('Canonical volume factor must be between 0.1 and 2.')
  return factor
}

const agrees = (a: number, b: number) => Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b))

/** Validate imported evidence against both its conversion and the material used by the engine. */
export function parseMaterialVolumeFactorProvenance(
  raw: unknown,
  compactionFactor: number,
): MaterialVolumeFactorProvenance {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('Volume factor provenance must be an object.')
  const value = raw as Record<string, unknown>
  if (value.convention !== 'compacted-per-bank' && value.convention !== 'bank-per-compacted')
    throw new Error('Volume factor convention must be compacted-per-bank or bank-per-compacted.')
  const enteredFactor = positive(value.enteredFactor, 'Entered volume factor')
  const canonicalFactor = canonical(value.canonicalFactor)
  const converted = convertMaterialVolumeFactor(enteredFactor, value.convention)
  if (!agrees(canonicalFactor, converted) || !agrees(canonicalFactor, canonical(compactionFactor)))
    throw new Error('Volume factor provenance is inconsistent with its conversion or material compaction factor.')
  if (value.source !== undefined && (typeof value.source !== 'string' || value.source.length > 500))
    throw new Error('Volume factor source must contain at most 500 characters.')
  const source = typeof value.source === 'string' ? value.source.trim() : undefined
  return {
    convention: value.convention,
    enteredFactor,
    canonicalFactor,
    ...(source ? { source } : {}),
  }
}

export function createMaterialVolumeFactorProvenance(
  enteredFactor: number,
  convention: MaterialVolumeFactorConvention,
  source?: string,
): MaterialVolumeFactorProvenance {
  const canonicalFactor = convertMaterialVolumeFactor(enteredFactor, convention)
  return parseMaterialVolumeFactorProvenance({ convention, enteredFactor, canonicalFactor, source }, canonicalFactor)
}

/** A direct edit cannot keep evidence for an earlier ratio. Other material edits can keep it. */
export function materialCompactionFactorPatch(
  material: GroundMaterial,
  compactionFactor: number,
): Pick<GroundMaterial, 'compactionFactor' | 'volumeFactorProvenance'> {
  return {
    compactionFactor: canonical(compactionFactor),
    volumeFactorProvenance:
      compactionFactor === material.compactionFactor ? material.volumeFactorProvenance : undefined,
  }
}
