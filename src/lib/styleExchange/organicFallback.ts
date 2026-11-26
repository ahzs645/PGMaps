/**
 * QGIS, ArcGIS Pro, SLD, MapLibre, GeoLibre and KML have no organic hatch, so it reaches them as
 * the closest straight hatch: near-vertical lines at the organic strokes' spacing, width and
 * colour. Each replacement is reported per format rather than dropped. PGMaps' own style
 * documents and sheets keep the organic hatch itself. No DOM or network access.
 */
import type { AreaSymbol, SheetSymbol } from '@/lib/mapSheet/symbols'
import type { ExchangeDiagnostic, ExchangeFormat, StyleDocument } from './model'

/** Organic strokes run down their bands, leaning a little; the straight hatch leans the same way. */
export const ORGANIC_FALLBACK_ANGLE = 80

/** The symbol with any organic hatch drawn as straight lines instead; the same object when it has none. */
export function straightenedOrganicHatch<T extends SheetSymbol>(symbol: T): T {
  if (symbol.kind !== 'area') return symbol
  const { organicHatch, ...rest } = symbol as AreaSymbol
  if (!organicHatch) return symbol
  return {
    ...rest,
    hatches: [
      ...(rest.hatches ?? []),
      {
        angleDeg: ORGANIC_FALLBACK_ANGLE,
        spacing: organicHatch.spacing,
        stroke: {
          color: organicHatch.color,
          width: Math.round(organicHatch.strokeWidth * 0.8 * 100) / 100,
          ...(organicHatch.opacity !== undefined ? { opacity: organicHatch.opacity } : {}),
        },
      },
    ],
  } as T
}

/** A style document for another program, with the rules that used an organic hatch named. */
export function documentWithoutOrganicHatches(document: StyleDocument): {
  document: StyleDocument
  replaced: string[]
} {
  const replaced: string[] = []
  const layers = document.layers.map((layer) => ({
    ...layer,
    rules: layer.rules.map((rule) => {
      const symbol = straightenedOrganicHatch(rule.symbol)
      if (symbol !== rule.symbol) replaced.push(`${layer.name}: ${rule.label}`)
      return symbol === rule.symbol ? rule : { ...rule, symbol }
    }),
  }))
  return { document: replaced.length ? { ...document, layers } : document, replaced }
}

/** One note per replaced rule for each format written. */
export function organicFallbackDiagnostics(
  replaced: readonly string[],
  formats: Iterable<ExchangeFormat>,
): ExchangeDiagnostic[] {
  const out: ExchangeDiagnostic[] = []
  for (const format of new Set(formats))
    for (const subject of replaced)
      out.push({
        severity: 'info',
        format,
        subject,
        message: `The organic hatch is drawn as straight lines at ${ORGANIC_FALLBACK_ANGLE}°; this format has no curved hatch. PGMaps sheets keep the curves.`,
      })
  return out
}
