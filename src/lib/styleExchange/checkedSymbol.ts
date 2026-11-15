/**
 * A `SheetSymbol` checked field by field, for symbols that come back from browser storage or a
 * file: known kinds, finite non-negative sizes within drawing limits, colours the writers can read,
 * icon ids PGMaps draws. Unknown fields are dropped. Throws an Error naming the first problem.
 * No DOM or network access.
 */
import { ICON_IDS, type IconId } from '@/lib/mapSheet/icons'
import type { StrokeStyle } from '@/lib/mapSheet/drawOps'
import type {
  AreaSymbol,
  Hatch,
  LineLayer,
  LineMarker,
  MarkerFill,
  OutlineLayer,
  SheetSymbol,
} from '@/lib/mapSheet/symbols'
import { parseColor } from './color'

/** Largest width, size or spacing a symbol may use, points. */
export const MAX_SYMBOL_POINTS = 500
const MAX_PARTS = 16

type Raw = Record<string, unknown>
const object = (value: unknown, what: string): Raw => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(`${what} is not an object.`)
  return value as Raw
}
const list = (value: unknown, what: string): unknown[] => {
  if (!Array.isArray(value)) throw Error(`${what} is not a list.`)
  if (value.length > MAX_PARTS) throw Error(`${what} has more than ${MAX_PARTS} parts.`)
  return value
}
const size = (value: unknown, what: string, min = 0): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > MAX_SYMBOL_POINTS)
    throw Error(`${what} must be a number from ${min} to ${MAX_SYMBOL_POINTS}.`)
  return value
}
const signed = (value: unknown, what: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > MAX_SYMBOL_POINTS)
    throw Error(`${what} must be a number within ±${MAX_SYMBOL_POINTS}.`)
  return value
}
const unit = (value: unknown, what: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)
    throw Error(`${what} must be from 0 to 1.`)
  return value
}
const color = (value: unknown, what: string): string => {
  if (typeof value !== 'string' || value.length > 40 || !parseColor(value)) throw Error(`${what} is not a colour.`)
  return value
}
const label = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > 200)
    throw Error('A symbol needs a name of 1–200 characters.')
  return value
}
const icon = (value: unknown): IconId => {
  if (typeof value !== 'string' || !(ICON_IDS as string[]).includes(value))
    throw Error(`"${String(value)}" is not a PGMaps icon.`)
  return value as IconId
}
const optional = <T>(raw: Raw, key: string, read: (value: unknown, what: string) => T) =>
  raw[key] === undefined ? {} : { [key]: read(raw[key], key) }

function stroke(value: unknown, what: string): StrokeStyle {
  const raw = object(value, what)
  const dash = raw.dash === undefined ? undefined : list(raw.dash, `${what} dash`).map((d) => size(d, `${what} dash`))
  if (dash && (!dash.length || dash.every((d) => d === 0))) throw Error(`${what} has an empty dash.`)
  const cap = raw.cap
  const join = raw.join
  if (cap !== undefined && cap !== 'butt' && cap !== 'round' && cap !== 'square') throw Error(`${what} cap is unknown.`)
  if (join !== undefined && join !== 'miter' && join !== 'round' && join !== 'bevel')
    throw Error(`${what} join is unknown.`)
  return {
    color: color(raw.color, `${what} colour`),
    width: size(raw.width, `${what} width`),
    ...(dash ? { dash } : {}),
    ...(cap ? { cap } : {}),
    ...(join ? { join } : {}),
    ...optional(raw, 'opacity', unit),
  } as StrokeStyle
}

function marker(value: unknown): LineMarker {
  const raw = object(value, 'A line marker')
  return {
    icon: icon(raw.icon),
    spacing: size(raw.spacing, 'Marker spacing', 0.5),
    size: size(raw.size, 'Marker size', 0.1),
    color: color(raw.color, 'Marker colour'),
    ...optional(raw, 'secondary', color),
    ...optional(raw, 'start', size),
    ...optional(raw, 'offset', signed),
  } as LineMarker
}

function hatch(value: unknown): Hatch {
  const raw = object(value, 'A hatch')
  return {
    angleDeg: signed(raw.angleDeg, 'Hatch angle'),
    spacing: size(raw.spacing, 'Hatch spacing', 0.5),
    stroke: stroke(raw.stroke, 'Hatch line'),
    ...optional(raw, 'phase', signed),
  }
}

function markerFill(value: unknown): MarkerFill {
  const raw = object(value, 'A marker fill')
  if (raw.stagger !== undefined && typeof raw.stagger !== 'boolean')
    throw Error('Marker fill stagger must be true or false.')
  return {
    icon: icon(raw.icon),
    size: size(raw.size, 'Marker size', 0.1),
    color: color(raw.color, 'Marker colour'),
    ...optional(raw, 'secondary', color),
    spacingX: size(raw.spacingX, 'Marker spacing', 0.5),
    spacingY: size(raw.spacingY, 'Marker spacing', 0.5),
    ...(raw.stagger ? { stagger: true } : {}),
  }
}

export function checkedSheetSymbol(value: unknown): SheetSymbol {
  const raw = object(value, 'A symbol')
  switch (raw.kind) {
    case 'line': {
      const layers = list(raw.layers, 'Line strokes').map(
        (layer, i): LineLayer => ({
          ...stroke(layer, `Stroke ${i + 1}`),
          ...optional(object(layer, 'A stroke'), 'offset', signed),
        }),
      )
      const markers = raw.markers === undefined ? undefined : list(raw.markers, 'Line markers').map(marker)
      if (!layers.length && !markers?.length) throw Error('A line symbol needs a stroke or a marker.')
      return { kind: 'line', label: label(raw.label), layers, ...(markers?.length ? { markers } : {}) }
    }
    case 'area': {
      const outline = list(raw.outline ?? [], 'Outline').map((layer, i): OutlineLayer => {
        const inside = object(layer, 'An outline').inside
        return { ...stroke(layer, `Outline ${i + 1}`), ...(inside === true ? { inside: true } : {}) }
      })
      const symbol: AreaSymbol = {
        kind: 'area',
        label: label(raw.label),
        ...optional(raw, 'fill', color),
        ...optional(raw, 'fillOpacity', unit),
        outline,
      }
      if (raw.hatches !== undefined) symbol.hatches = list(raw.hatches, 'Hatches').map(hatch)
      if (raw.markerFill !== undefined) symbol.markerFill = markerFill(raw.markerFill)
      if (!symbol.fill && !symbol.hatches?.length && !symbol.markerFill && !outline.length)
        throw Error('An area symbol draws nothing: give it a fill, hatch, marker fill or outline.')
      return symbol
    }
    case 'point': {
      const halo = raw.halo === undefined ? undefined : object(raw.halo, 'A halo')
      return {
        kind: 'point',
        label: label(raw.label),
        icon: icon(raw.icon),
        size: size(raw.size, 'Icon size', 0.1),
        color: color(raw.color, 'Icon colour'),
        ...optional(raw, 'secondary', color),
        ...(halo ? { halo: { color: color(halo.color, 'Halo colour'), width: size(halo.width, 'Halo width') } } : {}),
      }
    }
    case 'class':
      return {
        kind: 'class',
        label: label(raw.label),
        color: color(raw.color, 'Class colour'),
        opacity: unit(raw.opacity, 'Class opacity'),
      }
    default:
      throw Error(`"${String(raw.kind)}" is not a symbol kind.`)
  }
}
