import { useEffect, useState } from 'react'
import { SidebarSection } from '@/components/ui/map-panels'
import { fetchJson } from '@/lib/fetchJson'

export function Silvics({ species }: { species: string }) {
  const [data, setData] = useState<{ name: string; columns: string[]; rows: unknown[][] }[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    Promise.all(
      ['tol', 'resist', 'regen', 'mature'].map(async (name) => ({
        name,
        ...(await fetchJson<{ columns: string[]; rows: unknown[][] }>(
          `/data/cciss/current-reference/package-silvics_${name}.json.gz`,
        )),
      })),
    )
      .then((v) => {
        if (active) setData(v)
      })
      .catch((e: unknown) => {
        if (active) setError(String(e))
      })
    return () => {
      active = false
    }
  }, [])
  if (error) return <p role="alert">{error}</p>
  if (!data) return <p role="status">Loading silvics reference…</p>
  const titles: Record<string, string> = {
    tol: 'Tolerance',
    resist: 'Resistance',
    regen: 'Regeneration',
    mature: 'Maturing',
  }
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Public ccissr reference snapshot a6ab8ee3. These reference values are independent of the assessment results;
        they are not a stocking recommendation.
      </p>
      {data.map((t) => {
        const row = t.rows.find((r) => r[t.columns.indexOf('Tree Code')] === species)
        return (
          <SidebarSection title={titles[t.name]} key={t.name}>
            {row ? (
              <dl className="grid gap-2 sm:grid-cols-2">
                {t.columns.map((c, i) => (
                  <div key={c}>
                    <dt className="text-xs text-muted-foreground">{c}</dt>
                    <dd className="text-sm">{String(row[i] ?? '—')}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm">No exact reference entry for {species}.</p>
            )}
          </SidebarSection>
        )
      })}
    </div>
  )
}
