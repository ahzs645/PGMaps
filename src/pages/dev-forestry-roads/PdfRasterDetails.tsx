import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { StyledSelect } from '@/components/ui/styled-select'
import { InlineAlert } from '@/components/ui/map-panels'
import { EngineeringTable, ColumnHeader } from '@/components/ui/engineering-table'
import { classAreaBreakdown, codeLabel, summarizeClassSteps, type ClassAreaSummary } from '@/lib/geoPdf/classGrid'
import type { PdfClassGrid } from '@/lib/geoPdf/types'
import type { RoadProject } from './types'
import { runCooperatively } from './cooperative'
import { summarizeTerrainSlopeSteps, type TerrainSlopeSummary } from './terrainSlopeClasses'
import { CONTOUR_SLOPE_CHECK, isContourTerrain } from './contourTerrain'

export function PdfRasterDetails({ grid, project, id }: { grid: PdfClassGrid; project: RoadProject; id: string }) {
  const areas = useMemo(
    () => [
      ...project.context.flatMap((f) =>
        f.geometry.type === 'Polygon' && f.kind === 'harvest' ? [{ id: f.id, name: f.name, geometry: f.geometry }] : [],
      ),
      ...(project.reference ?? []).flatMap((f) =>
        f.geometry.type === 'Polygon' && !f.sheet && !f.classGrid
          ? [{ id: f.id, name: f.name, geometry: f.geometry }]
          : [],
      ),
    ],
    [project.context, project.reference],
  )
  const [selected, setSelected] = useState('')
  const area = areas.find((a) => a.id === selected) ?? areas[0]
  // Slope sheets compare with the project's terrain, read with the sheet's own legend ranges.
  const terrain = grid.kind === 'slope' ? project.terrain.raster : undefined
  const key = `${grid.checksum}:${area?.id}:${JSON.stringify(area?.geometry)}:${terrain?.id ?? ''}:${terrain?.sha256 ?? ''}`
  const [result, setResult] = useState<{
    key: string
    grid: PdfClassGrid
    data: ClassAreaSummary
    terrain: TerrainSlopeSummary | null
    terrainError: string
  } | null>(null)
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  const summarize = async () => {
    if (!area) return
    controller.current?.abort()
    const current = new AbortController()
    controller.current = current
    setBusy(true)
    setError('')
    try {
      const data = await runCooperatively(summarizeClassSteps(grid, area.geometry), { signal: current.signal })
      let slope: TerrainSlopeSummary | null = null,
        terrainError = ''
      if (terrain)
        try {
          slope = await runCooperatively(summarizeTerrainSlopeSteps(terrain, area.geometry, grid.legend), {
            signal: current.signal,
          })
        } catch (e) {
          if (current.signal.aborted) throw e
          terrainError = e instanceof Error ? e.message : 'Could not read slope from the terrain.'
        }
      if (!current.signal.aborted) setResult({ key, grid, data, terrain: slope, terrainError })
    } catch (e) {
      if (!current.signal.aborted) setError(e instanceof Error ? e.message : 'Could not summarize this area.')
    } finally {
      if (controller.current === current && !current.signal.aborted) setBusy(false)
    }
  }
  const current = result?.key === key && result.grid === grid ? result : null
  const data = current?.data ?? null
  const slope = current?.terrain ?? null
  const terrainCell = (m2: number) => (slope ? <td>{ha(m2)}</td> : null)
  const split = data ? classAreaBreakdown(data, grid) : null
  const percent = (m2: number) => (data ? `${((m2 / data.areaM2) * 100).toFixed(1)}%` : '')
  const ha = (m2: number) => (m2 / 10000).toFixed(3)
  const exactClasses = split?.exactClassM2.reduce((s, n) => s + n, 0) ?? 0
  const lowest = Math.min(...grid.legend.map((c) => c.minimum))
  return (
    <div className="space-y-2 text-2xs" data-testid="pdf-raster-details">
      <p>
        Native PDF grid: {grid.width.toLocaleString()} × {grid.height.toLocaleString()} pixels. Click the plan in
        Inspect mode to query visible class layers.
      </p>
      <p>
        Lossless palette matches are solid. JPEG estimates are faded: read them as area shares, not single pixels.
        Transparent pixels are the sheet's unpainted class{grid.undrawn ? ` (${grid.undrawn.label} ${grid.unit})` : ''}.
      </p>
      {areas.length ? (
        <>
          <label className="block">
            Area to summarize
            <StyledSelect
              aria-label={`Area to summarize ${id}`}
              value={area?.id ?? ''}
              disabled={busy}
              onChange={(e) => setSelected(e.target.value)}
            >
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </StyledSelect>
          </label>
          <Button size="xs" variant="outline" disabled={busy} onClick={() => void summarize()}>
            {busy ? 'Summarizing…' : 'Summarize mapped classes'}
          </Button>
          {busy && (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                controller.current?.abort()
                setBusy(false)
              }}
            >
              Cancel
            </Button>
          )}
        </>
      ) : (
        <p>Import or draw a block to summarize its mapped classes.</p>
      )}
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      {data && split && (
        <div className="space-y-2" data-testid="pdf-class-summary">
          <p>Selected area: {(data.areaM2 / 10000).toFixed(2)} ha.</p>
          {grid.undrawn ? (
            <p data-testid="pdf-class-exact-split">
              Exact from the sheet's lossless transparency: {grid.undrawn.label} {grid.unit} (not drawn){' '}
              {percent(split.undrawnM2)}; {lowest} {grid.unit} or more {percent(exactClasses + split.drawnNotExactM2)}.
              Exact class known for {percent(exactClasses)}; JPEG estimates cover{' '}
              {percent(split.estimatedClassM2.reduce((s, n) => s + n, 0))}.
            </p>
          ) : (
            <p>
              Lossless matched: {percent(exactClasses)}. JPEG estimates:{' '}
              {percent(split.estimatedClassM2.reduce((s, n) => s + n, 0))}. Re-import the PDF to separate the not-drawn
              class.
            </p>
          )}
          <div
            className="flex h-2 overflow-hidden rounded-sm bg-muted"
            role="img"
            aria-label="Area share: not drawn, exact class, drawn without an exact class, and unknown"
          >
            <span className="bg-muted-foreground/40" style={{ width: percent(split.undrawnM2) }} />
            <span className="bg-success" style={{ width: percent(exactClasses) }} />
            <span className="bg-warning" style={{ width: percent(split.drawnNotExactM2) }} />
          </div>
          <EngineeringTable compact rowHeaders aria-label="Mapped class areas">
            <thead>
              <tr>
                <ColumnHeader label={`Range (${grid.unit})`} />
                <ColumnHeader label="Exact" unit="ha" />
                <ColumnHeader label="JPEG estimate" unit="ha" />
                {slope && <ColumnHeader label="From terrain" unit="ha" />}
              </tr>
            </thead>
            <tbody>
              {grid.undrawn && (
                <tr>
                  <th scope="row">{grid.undrawn.label} (not drawn)</th>
                  <td>{ha(split.undrawnM2)}</td>
                  <td>—</td>
                  {terrainCell(slope?.belowM2 ?? 0)}
                </tr>
              )}
              {grid.legend.map((c, i) => (
                <tr key={c.label}>
                  <th scope="row">{c.label}</th>
                  <td>{ha(split.exactClassM2[i])}</td>
                  <td>{ha(split.estimatedClassM2[i])}</td>
                  {terrainCell(slope?.classM2[i] ?? 0)}
                </tr>
              ))}
              {grid.undrawn && (
                <tr>
                  <th scope="row">Drawn, class not exact</th>
                  <td>{ha(split.drawnNotExactM2)}</td>
                  <td>—</td>
                  {slope && <td>—</td>}
                </tr>
              )}
              <tr>
                <th scope="row">Not known</th>
                <td>{ha(split.otherUnknownM2)}</td>
                <td>—</td>
                {terrainCell(slope?.missingM2 ?? 0)}
              </tr>
            </tbody>
          </EngineeringTable>
          <p>
            "Drawn, class not exact" is at or above {lowest} {grid.unit} for certain; its JPEG estimates are listed per
            range and never added to the exact column. Fractional boundary pixels and holes are included; each
            percentage uses the full selected area.
          </p>
          {slope && terrain && (
            <p data-testid="pdf-class-terrain-note">
              From terrain: slope of {project.terrain.name} on its {slope.cellM} m cells, read with this sheet's ranges
              (cell centres inside the area; "Not known" is missing terrain).{' '}
              {isContourTerrain(terrain)
                ? CONTOUR_SLOPE_CHECK
                : 'A different measurement from the sheet: compare ranges, not cells.'}
            </p>
          )}
          {current?.terrainError && <InlineAlert tone="warning">{current.terrainError}</InlineAlert>}
          {grid.kind === 'slope' && !terrain && (
            <p>Load a terrain raster (LiDAR, a GeoTIFF or a sheet's contours) to compare slope ranges with it.</p>
          )}
          <details>
            <summary>Pixels without an exact class</summary>
            <ul className="space-y-1">
              {Object.entries(data.unknownAreasM2).map(([code, value]) => (
                <li key={code}>
                  {Number(code) > 64 && Number(code) <= 64 + grid.legend.length
                    ? `JPEG estimate: ${grid.legend[Number(code) - 65]?.label}`
                    : codeLabel(Number(code), grid)}{' '}
                  · {ha(value)} ha
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
      <details>
        <summary>Raster interpretation</summary>
        {grid.notes.map((note) => (
          <p key={note} className="mt-1">
            {note}
          </p>
        ))}
      </details>
    </div>
  )
}
