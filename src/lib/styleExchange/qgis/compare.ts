/**
 * Symbols in a canonical form for comparing a written and read-back symbol: colours as rounded
 * RGBA with opacity folded in, defaults filled (butt caps, mitre joins, zero offsets, markers
 * starting half a spacing in), numbers rounded to 0.001 pt, and class swatches as plain fills, since
 * QGIS holds both the same way. No DOM or network access.
 */
import type { StrokeStyle } from '@/lib/mapSheet/drawOps'
import type { SheetSymbol } from '@/lib/mapSheet/symbols'
import { withOpacity } from '../color'

const r3 = (value: number) => Math.round(value * 1000) / 1000
const rgba = (color: string, opacity = 1) => {
  const c = withOpacity(color, opacity)
  return [c.r, c.g, c.b, Math.round(c.a * 100) / 100]
}
const stroke = (s: StrokeStyle & { offset?: number }) => ({
  rgba: rgba(s.color, s.opacity),
  width: r3(s.width),
  // An odd dash list repeats to alternate on and off, as SVG and QGIS draw it.
  dash: s.dash ? (s.dash.length % 2 ? [...s.dash, ...s.dash] : s.dash).map(r3) : null,
  cap: s.cap ?? 'butt',
  join: s.join ?? 'miter',
  offset: r3(s.offset ?? 0),
})

export function canonicalSymbol(symbol: SheetSymbol): unknown {
  switch (symbol.kind) {
    case 'line':
      return {
        kind: 'line',
        layers: symbol.layers.map(stroke),
        markers: (symbol.markers ?? []).map((m) => ({
          icon: m.icon,
          spacing: r3(m.spacing),
          size: r3(m.size),
          rgba: rgba(m.color),
          secondary: m.secondary ? rgba(m.secondary) : null,
          start: r3(m.start ?? m.spacing / 2),
          offset: r3(m.offset ?? 0),
        })),
      }
    case 'class':
      return { kind: 'area', fill: rgba(symbol.color, symbol.opacity), hatches: [], markerFill: null, outline: [] }
    case 'area':
      return {
        kind: 'area',
        fill: symbol.fill ? rgba(symbol.fill, symbol.fillOpacity) : null,
        hatches: (symbol.hatches ?? []).map((h) => ({
          angle: r3(h.angleDeg),
          spacing: r3(h.spacing),
          phase: r3(h.phase ?? 0),
          stroke: stroke(h.stroke),
        })),
        markerFill: symbol.markerFill
          ? {
              icon: symbol.markerFill.icon,
              size: r3(symbol.markerFill.size),
              rgba: rgba(symbol.markerFill.color),
              secondary: symbol.markerFill.secondary ? rgba(symbol.markerFill.secondary) : null,
              x: r3(symbol.markerFill.spacingX),
              y: r3(symbol.markerFill.spacingY),
              stagger: Boolean(symbol.markerFill.stagger),
            }
          : null,
        outline: symbol.outline.map((o) => ({ ...stroke(o), inside: Boolean(o.inside) })),
      }
    case 'point':
      return {
        kind: 'point',
        icon: symbol.icon,
        size: r3(symbol.size),
        rgba: rgba(symbol.color),
        secondary: symbol.secondary ? rgba(symbol.secondary) : null,
        halo: symbol.halo ? { rgba: rgba(symbol.halo.color), width: r3(symbol.halo.width) } : null,
      }
  }
}
