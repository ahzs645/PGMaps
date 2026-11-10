import { Badge } from '@/components/ui/badge'
import { catalogueEntry } from '@/lib/forestry/blockSheet/symbolCatalogue'
import { mismatchSymbol, SYMBOL_MISMATCHES, usesMapValue } from '@/lib/forestry/blockSheet/symbolMismatches'
import { SymbolSample } from './SymbolSheet'

const SAMPLE = { width: 120, height: 48, zoom: 3 }

/** Where the reference legends and maps disagreed: both renderings, and what PGMaps draws. */
export function MismatchPanel() {
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted-foreground">
        The reference sheets' legends drew these features differently from their maps. PGMaps uses the map's value and
        draws its legend from that same symbol, so its own map and legend cannot disagree. Samples are three times print
        size.
      </p>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead className="border-b bg-muted/40 text-2xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="p-2 font-medium">Feature</th>
              <th className="p-2 font-medium">Reference legend</th>
              <th className="p-2 font-medium">Reference map</th>
              <th className="p-2 font-medium">PGMaps draws</th>
            </tr>
          </thead>
          <tbody>
            {SYMBOL_MISMATCHES.map((mismatch) => {
              const used = mismatchSymbol(mismatch)
              const matchesMap = usesMapValue(mismatch)
              return (
                <tr key={mismatch.id} className="border-b align-top last:border-b-0" data-testid="symbol-mismatch">
                  <td className="p-2 font-medium">{mismatch.feature}</td>
                  <td className="p-2">
                    <SymbolSample symbol={mismatch.legend} background={mismatch.background} {...SAMPLE} />
                    <div className="mt-1 font-mono text-2xs text-muted-foreground">{mismatch.legendSpec}</div>
                  </td>
                  <td className="p-2">
                    <SymbolSample symbol={mismatch.map} background={mismatch.background} {...SAMPLE} />
                    <div className="mt-1 font-mono text-2xs text-muted-foreground">{mismatch.mapSpec}</div>
                  </td>
                  <td className="p-2">
                    <SymbolSample symbol={used} background={mismatch.background} {...SAMPLE} />
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <code className="text-3xs text-muted-foreground">{catalogueEntry(mismatch.uses).id}</code>
                      <Badge tone={matchesMap ? 'success' : 'danger'} size="xs">
                        {matchesMap ? 'Map value' : 'Differs from the map'}
                      </Badge>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
