import { useEffect, useState } from 'react'
import { DialogShell } from '@/components/ui/dialog-shell'
import { InlineAlert, SidebarSection } from '@/components/ui/map-panels'
import { Button } from '@/components/ui/button'
import {
  bgcLabel,
  legacyRating,
  ratingLabel,
  regionalOutlook,
  type Edatope,
  type LegacyManifest,
  type LegacyReference,
  type LegacyRegion,
} from './legacyAnalysis'
import { loadLegacyManifest, loadLegacyReference, loadLegacyRegion, sampleLegacy } from './legacyData'

const selectClass = 'mt-1 w-full rounded-md border border-border bg-background p-2 text-sm'
const percent = (n: number | null) => (n == null ? '—' : `${(n * 100).toFixed(1)}%`)

export function LegacyAnalysisDialog({ point, onClose }: { point: [number, number]; onClose: () => void }) {
  const [manifest, setManifest] = useState<LegacyManifest | null>(null)
  const [error, setError] = useState('')
  const [edatope, setEdatope] = useState<Edatope>('C4')
  const [period, setPeriod] = useState('2061_2080')
  const [model, setModel] = useState('ACCESS-ESM1-5')
  const [region, setRegion] = useState('BC')
  useEffect(() => {
    let active = true
    loadLegacyManifest()
      .then((m) => {
        if (active) setManifest(m)
      })
      .catch((e: unknown) => {
        if (active) setError(String(e))
      })
    return () => {
      active = false
    }
  }, [])
  return (
    <DialogShell
      title="Legacy CCISS analysis"
      subtitle="Numeric source data · older spatial prototype · SSP2-4.5"
      onClose={onClose}
      size="xl"
    >
      <div className="space-y-5">
        <InlineAlert tone="warning">
          These results use the older spatial lookup and regional formulas. The grid is 0.025°; this is not the current
          CCISS site-series assessment. Map tile colours are not calculation inputs. Raster BGC labels were reconciled
          against 37 matching raster summaries because the original codebook disagrees; point results remain
          provisional.
        </InlineAlert>
        {error && <p role="alert">{error}</p>}
        {!manifest && !error && <p role="status">Loading analysis data…</p>}
        {manifest && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <label>
                Site condition
                <select
                  aria-label="Analysis site condition"
                  className={selectClass}
                  value={edatope}
                  onChange={(e) => setEdatope(e.target.value as Edatope)}
                >
                  <option value="B2">B2 · Poor / subxeric</option>
                  <option value="C4">C4 · Medium / mesic</option>
                  <option value="D6">D6 · Rich / hygric</option>
                </select>
              </label>
              <label>
                Climate model
                <select className={selectClass} value={model} onChange={(e) => setModel(e.target.value)}>
                  {[...new Set(manifest.rasters.filter((r) => r.scenario === 'ssp245').map((r) => r.model))].map(
                    (m) => (
                      <option key={m}>{m}</option>
                    ),
                  )}
                </select>
              </label>
              <label>
                Projection period
                <select className={selectClass} value={period} onChange={(e) => setPeriod(e.target.value)}>
                  {[...new Set(manifest.rasters.filter((r) => r.scenario === 'ssp245').map((r) => r.period))].map(
                    (p) => (
                      <option key={p} value={p}>
                        {p.replace('_', '–')}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label>
                Regional summary
                <select className={selectClass} value={region} onChange={(e) => setRegion(e.target.value)}>
                  {manifest.regions.map((r) => (
                    <option key={r.id}>{r.id}</option>
                  ))}
                </select>
              </label>
            </div>
            <AnalysisResults
              key={[...point, edatope, period, model, region].join('|')}
              {...{ manifest, point, edatope, period, model, region }}
            />
          </>
        )}
      </div>
    </DialogShell>
  )
}

function AnalysisResults({
  manifest,
  point,
  edatope,
  period,
  model,
  region,
}: {
  manifest: LegacyManifest
  point: [number, number]
  edatope: Edatope
  period: string
  model: string
  region: string
}) {
  const [data, setData] = useState<{
    reference: LegacyReference
    region: LegacyRegion
    baseline: string | null
    future: string | null
  } | null>(null)
  const [error, setError] = useState('')
  const [species, setSpecies] = useState('Pl')
  useEffect(() => {
    let active = true
    const baseline = manifest.rasters.find((r) => r.model === 'Reference')
    const future = manifest.rasters.find((r) => r.model === model && r.period === period)
    const regional = manifest.regions.find((r) => r.id === region)
    if (!baseline || !future || !regional) return
    Promise.all([
      loadLegacyReference(manifest.reference.file),
      loadLegacyRegion(regional.file),
      sampleLegacy(baseline.file, ...point),
      sampleLegacy(future.file, ...point),
    ])
      .then(([reference, regionalData, b, f]) => {
        if (active)
          setData({
            reference,
            region: regionalData,
            baseline: b.status === 'value' ? bgcLabel(reference, b.value) : null,
            future: f.status === 'value' ? bgcLabel(reference, f.value) : null,
          })
      })
      .catch((e: unknown) => {
        if (active) setError(String(e))
      })
    return () => {
      active = false
    }
  }, [manifest, point, edatope, period, model, region])
  if (error) return <p role="alert">Could not load analysis: {error}</p>
  if (!data) return <p role="status">Reading numeric rasters and reference tables…</p>
  const availableSpecies = data.region.tables[`PredSum.spp.${edatope}`]?.columns ?? []
  const rows = availableSpecies.map((spp) => ({
    species: spp,
    name: data.reference.names[spp] ?? spp,
    baseline: data.baseline ? legacyRating(data.reference, data.baseline, edatope, spp) : null,
    future: data.future ? legacyRating(data.reference, data.future, edatope, spp) : null,
  }))
  const trends = regionalOutlook(data.region, edatope, species, model)
  const run = manifest.rasters.find((r) => r.model === model && r.period === period)?.run
  function download() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            method: 'CCISS legacy spatial lookup; not current site-series assessment',
            dataset: manifest.schema,
            longitude: point[0],
            latitude: point[1],
            edatope,
            model,
            run,
            scenario: 'ssp245',
            period,
            referenceBGC: data?.baseline,
            predictedBGC: data?.future,
            species: rows,
            regional: { region, species, trends },
          },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    )
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'cciss-legacy-analysis.json'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <div className="space-y-5">
      <SidebarSection title="Species suitability at the selected map point">
        <p className="text-sm">
          {point[1].toFixed(5)}, {point[0].toFixed(5)} · {model} · {run}
        </p>
        <p className="my-2 text-sm">
          Reference BGC: <strong>{data.baseline ?? 'No data'}</strong> → Predicted BGC:{' '}
          <strong>{data.future ?? 'No data'}</strong>
        </p>
        {(!data.baseline || !data.future) && (
          <InlineAlert tone="warning">
            This location has no valid BGC in one or both legacy rasters. Select a land location inside BC. Regional
            summaries remain available.
          </InlineAlert>
        )}
        <p className="mb-2 text-xs text-muted-foreground">
          Site series: {data.baseline ? (data.reference.sites[data.baseline]?.[edatope] ?? 'Not mapped') : '—'} →{' '}
          {data.future ? (data.reference.sites[data.future]?.[edatope] ?? 'Not mapped') : '—'}. No rating means the
          lookup has no result; it does not mean unsuitable.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Legacy species suitability</caption>
            <thead>
              <tr className="border-b">
                <th className="py-2">Species</th>
                <th>1961–1990</th>
                <th>{period.replace('_', '–')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr className="border-b" key={r.species}>
                  <td className="py-1.5">
                    {r.species} · {r.name}
                  </td>
                  <td>{ratingLabel(r.baseline)}</td>
                  <td>{ratingLabel(r.future)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SidebarSection>
      <SidebarSection title={`Regional outlook · ${region}`}>
        <label className="block max-w-sm text-sm">
          Outlook species
          <select className={selectClass} value={species} onChange={(e) => setSpecies(e.target.value)}>
            {availableSpecies.map((s) => (
              <option key={s} value={s}>
                {s} · {data.reference.names[s] ?? s}
              </option>
            ))}
          </select>
        </label>
        <p className="my-2 text-xs text-muted-foreground">
          Persistence is the retained suitable grid-cell count divided by its 1961–1990 count. Expansion is suitable
          count outside the historical range divided by that same baseline. These are regional ratios, not point
          probabilities or hectares. A zero baseline gives no ratio.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Regional persistence and expansion</caption>
            <thead>
              <tr className="border-b">
                <th>Period / run</th>
                <th>Persistence</th>
                <th>Expansion</th>
              </tr>
            </thead>
            <tbody>
              {trends.map((r, i) => (
                <tr className="border-b" key={i}>
                  <td className="py-2">
                    {r.PERIOD?.replace('_', '–')} · {r.RUN}
                  </td>
                  <td>{percent(r.persistence)}</td>
                  <td>{percent(r.expansion)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!trends.length && <p>No regional rows for this selection.</p>}
      </SidebarSection>
      <Button onClick={download}>Download analysis JSON</Button>
      <p className="text-xs text-muted-foreground">
        Source: Province of British Columbia, CCISS_ShinyApp / Development/OLD/spatial_app. Regional data cover the
        chosen named area; changing this selection does not move the map point.
      </p>
    </div>
  )
}
