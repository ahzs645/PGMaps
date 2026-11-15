/**
 * Symbols and layers in a form two equal drawings share, for the ArcGIS round-trip tests: colours
 * as RGBA with any opacity folded into alpha (two decimals), defaults filled in (butt caps, mitre
 * joins, a white secondary icon colour, markers starting half a spacing in, no offset), odd dash
 * lists doubled, and numbers to three decimals. These are the tolerances the tests document.
 * Test support only; no DOM or network access.
 */
import type { StrokeStyle } from '@/lib/mapSheet/drawOps'
import type { SheetSymbol } from '@/lib/mapSheet/symbols'
import { withOpacity } from '../color'
import type { LabelStyle, StyledLayer } from '../model'

const n = (value: number) => Math.round(value * 1000) / 1000
const color = (css: string, opacity = 1) => {
  const c = withOpacity(css, opacity)
  return `${c.r},${c.g},${c.b},${Math.round(c.a * 100) / 100}`
}
const stroke = (s: StrokeStyle) => ({
  color: color(s.color, s.opacity ?? 1),
  width: n(s.width),
  dash: s.dash ? (s.dash.length % 2 ? [...s.dash, ...s.dash] : s.dash).map(n) : null,
  cap: s.cap ?? 'butt',
  join: s.join ?? 'miter',
})

export function canonicalSymbol(symbol: SheetSymbol): unknown {
  switch (symbol.kind) {
    case 'line':
      return {
        kind: 'line',
        layers: symbol.layers.map((layer) => ({ ...stroke(layer), offset: n(layer.offset ?? 0) })),
        markers: (symbol.markers ?? []).map((m) => ({
          icon: m.icon,
          spacing: n(m.spacing),
          size: n(m.size),
          color: color(m.color),
          secondary: color(m.secondary ?? '#ffffff'),
          start: n(m.start ?? m.spacing / 2),
          offset: n(m.offset ?? 0),
        })),
      }
    case 'area':
      return {
        kind: 'area',
        fill: symbol.fill ? color(symbol.fill, symbol.fillOpacity ?? 1) : null,
        hatches: (symbol.hatches ?? []).map((h) => ({
          angle: n(h.angleDeg),
          spacing: n(h.spacing),
          stroke: stroke(h.stroke),
          phase: n(h.phase ?? 0),
        })),
        markerFill: symbol.markerFill
          ? {
              icon: symbol.markerFill.icon,
              size: n(symbol.markerFill.size),
              color: color(symbol.markerFill.color),
              secondary: color(symbol.markerFill.secondary ?? '#ffffff'),
              x: n(symbol.markerFill.spacingX),
              y: n(symbol.markerFill.spacingY),
              stagger: Boolean(symbol.markerFill.stagger),
            }
          : null,
        outline: symbol.outline.map((o) => ({ ...stroke(o), inside: Boolean(o.inside) })),
      }
    case 'point':
      return {
        kind: 'point',
        icon: symbol.icon,
        size: n(symbol.size),
        color: color(symbol.color),
        secondary: color(symbol.secondary ?? '#ffffff'),
        halo: symbol.halo ? { color: color(symbol.halo.color), width: n(symbol.halo.width) } : null,
      }
    case 'class':
      return { kind: 'class', color: color(symbol.color, symbol.opacity) }
  }
}

export const canonicalLabel = (label?: LabelStyle) =>
  label && {
    field: label.field,
    size: n(label.size),
    color: color(label.color),
    halo: label.halo ? { color: color(label.halo.color), width: n(label.halo.width) } : null,
    placement: label.placement,
    bold: Boolean(label.bold),
  }

export const canonicalLayer = (layer: StyledLayer) => ({
  id: layer.id,
  name: layer.name,
  geometry: layer.geometry,
  fields: layer.fields,
  hidden: Boolean(layer.hidden),
  rules: layer.rules.map((rule) => ({ label: rule.label, filter: rule.filter, symbol: canonicalSymbol(rule.symbol) })),
  label: canonicalLabel(layer.label) ?? null,
})
