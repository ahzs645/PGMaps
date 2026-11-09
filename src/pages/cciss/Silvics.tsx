import { useEffect, useState } from 'react'
import { InlineAlert, KeyValueRows, SidebarSection } from '@/components/ui/map-panels'
import { fetchJson } from '@/lib/fetchJson'

type SilvicsTable = { name: string; columns: string[]; rows: unknown[][] }

const TABLES = [
  { name: 'tol', title: 'Tolerance' },
  { name: 'resist', title: 'Resistance' },
  { name: 'regen', title: 'Regeneration' },
  { name: 'mature', title: 'Maturing' },
] as const

/** The public ccissr silvics reference for one species. Independent of any assessment result. */
export function Silvics({ species }: { species: string }) {
  const [data, setData] = useState<SilvicsTable[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    Promise.all(
      TABLES.map(async ({ name }) => ({
        name,
        ...(await fetchJson<{ columns: string[]; rows: unknown[][] }>(
          `/data/cciss/current-reference/package-silvics_${name}.json.gz`,
        )),
      })),
    )
      .then((tables) => {
        if (active) setData(tables)
      })
      .catch((cause: unknown) => {
        if (active) setError(String(cause))
      })
    return () => {
      active = false
    }
  }, [])
  if (error) return <InlineAlert tone="error">{error}</InlineAlert>
  if (!data) return <InlineAlert loading>Loading silvics reference…</InlineAlert>
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Public ccissr reference snapshot a6ab8ee3. These reference values are independent of the assessment results;
        they are not a stocking recommendation.
      </p>
      {data.map((table, index) => {
        const row = table.rows.find((r) => r[table.columns.indexOf('Tree Code')] === species)
        return (
          <SidebarSection title={TABLES[index].title} key={table.name}>
            {row ? (
              <KeyValueRows
                variant="grid"
                size="sm"
                rows={table.columns.map((column, i) => ({ key: column, label: column, value: String(row[i] ?? '—') }))}
              />
            ) : (
              <p className="text-sm">No exact reference entry for {species}.</p>
            )}
          </SidebarSection>
        )
      })}
    </div>
  )
}
