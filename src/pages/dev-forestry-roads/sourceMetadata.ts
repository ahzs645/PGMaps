import { PDF_LIMITS, type PdfSheet, type PdfSource, type SourceAttributes } from '@/lib/geoPdf/types'

/** Original scalar GIS attributes. Kept beside, never interpreted as, model inputs. */
export function sourceAttributes(raw: unknown): SourceAttributes | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: SourceAttributes = {}
  for (const [key, value] of Object.entries(raw)) {
    if (Object.keys(out).length >= 200 || key.length > 100 || ['__proto__', 'constructor', 'prototype'].includes(key))
      continue
    if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)))
      out[key] = value
    else if (typeof value === 'string') out[key] = value.slice(0, 2000)
    else if (value instanceof Date && Number.isFinite(value.getTime())) out[key] = value.toISOString()
  }
  return Object.keys(out).length ? out : undefined
}

export function parsePdfSource(raw: unknown): PdfSource | undefined {
  if (raw === undefined) return undefined
  if (!raw || typeof raw !== 'object') throw Error('Invalid PDF source record.')
  const r = raw as Record<string, unknown>
  for (const key of ['file', 'layer', 'profile'])
    if (typeof r[key] !== 'string' || !(r[key] as string).trim() || (r[key] as string).length > 500)
      throw Error('Invalid PDF source text.')
  if (
    typeof r.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(r.sha256) ||
    !Number.isInteger(r.page) ||
    Number(r.page) < 1 ||
    Number(r.page) > PDF_LIMITS.pages ||
    typeof r.registrationErrorM !== 'number' ||
    !Number.isFinite(r.registrationErrorM) ||
    r.registrationErrorM < 0 ||
    r.registrationErrorM > PDF_LIMITS.registrationErrorM
  )
    throw Error('Invalid PDF source registration.')
  return {
    file: r.file as string,
    layer: r.layer as string,
    profile: r.profile as string,
    sha256: r.sha256,
    page: r.page as number,
    registrationErrorM: r.registrationErrorM,
  }
}

export function parsePdfSheet(raw: unknown): PdfSheet | undefined {
  if (raw === undefined) return undefined
  if (!raw || typeof raw !== 'object') throw Error('Invalid PDF sheet preview.')
  const r = raw as Record<string, unknown>
  if (
    typeof r.image !== 'string' ||
    r.image.length > 3_000_000 ||
    !/^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/]+=*$/.test(r.image)
  )
    throw Error('Invalid PDF sheet image.')
  if (
    !Array.isArray(r.corners) ||
    r.corners.length !== 4 ||
    r.corners.some(
      (p) =>
        !Array.isArray(p) ||
        p.length !== 2 ||
        !p.every(Number.isFinite) ||
        Math.abs(p[0]) > 180 ||
        Math.abs(p[1]) >= 85,
    )
  )
    throw Error('Invalid PDF sheet coordinates.')
  return { image: r.image, corners: r.corners as PdfSheet['corners'] }
}
