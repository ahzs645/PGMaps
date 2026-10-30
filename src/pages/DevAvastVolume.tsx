import { writeClipboardText, copyTextWithSelection } from '@/hooks/useClipboardText'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TreePine } from 'lucide-react'
import { MAP_SIDEBAR_CLASS, MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { MapSidebarShell, InlineAlert } from '@/components/ui/map-panels'
import { Button } from '@/components/ui/button'
import { StepMarker, type StepStatus } from '@/components/ui/step-section'
import { TabBar } from '@/components/ui/tab-bar'
import { downloadBlob } from '@/lib/download'
import { useWebMCPTools, type WebMCPTool } from '@/lib/webmcp'
import { AvastMap, type MapView } from './dev-avast/AvastMap'
import { InputsPanel } from './dev-avast/InputsPanel'
import { ResultsPanel } from './dev-avast/ResultsPanel'
import { SettingsPanel } from './dev-avast/SettingsPanel'
import { VriWhatIfPanel, whatIfRows, type WhatIfRow } from './dev-avast/VriWhatIfPanel'
import { useVriFill } from './dev-avast/useVriFill'
import {
  DEFAULT_VRI_RULES,
  describeVriRules,
  vriDensity,
  vriFillTotals,
  type VriPiece,
  type VriRules,
} from './dev-avast/vriFill'
import { buildWorkbook } from './dev-avast/excel'
import { writeGeodatabase } from './dev-avast/gdal'
import { guessProjectName } from './dev-avast/inputs'
import { datasetName, geodatabaseLayers } from './dev-avast/outputs'
import { albersBoxToLngLat, multiPolygonToLngLat } from './dev-avast/projection'
import { DEFAULT_SETTINGS, summarize } from './dev-avast/report'
import { useAvastInputs, useCandidates } from './dev-avast/useAvastInputs'
import { runSignature, useAvastRun } from './dev-avast/useAvastRun'
import { blockRowsTsv, exportBlockRows } from './dev-avast/workbookRows'
import type { AvastSettings, BBox, GeometrySettings, MultiPolygonCoords } from './dev-avast/types'

type Tab = 'inputs' | 'settings' | 'results' | 'vri'
const SETTINGS_KEY = 'pgmaps:avast-volume:settings'
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

function loadSettings(): AvastSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as Partial<AvastSettings> | null
    return { ...DEFAULT_SETTINGS, ...(stored ?? {}) }
  } catch {
    return DEFAULT_SETTINGS
  }
}

const geometryOf = (settings: AvastSettings): GeometrySettings => ({
  slopeSource: settings.slopeSource,
  slopeBreaks: settings.slopeBreaks,
  demZoom: settings.demZoom,
  slopeCellMeters: settings.slopeCellMeters,
  minPieceHa: settings.minPieceHa,
})

/** Re-projects each piece once; later renders reuse the converted feature. */
function useProjected<T extends object>(
  items: readonly T[],
  version: number,
  toFeature: (item: T) => GeoJSON.Feature | null,
) {
  const cache = useRef(new WeakMap<T, GeoJSON.Feature | null>())
  return useMemo<GeoJSON.FeatureCollection>(() => {
    const features: GeoJSON.Feature[] = []
    for (const item of items) {
      let feature = cache.current.get(item)
      if (feature === undefined) {
        feature = toFeature(item)
        cache.current.set(item, feature)
      }
      if (feature) features.push(feature)
    }
    return { type: 'FeatureCollection', features }
    // `items` is mutated in place while a run streams in; `version` marks each change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, version, items.length])
}

/** What the block hover card shows about the VRI what-if. */
function whatIfProperties(row: WhatIfRow | undefined) {
  if (!row) return {}
  return {
    vriFill: row.withVri - row.avastVolume,
    withVri: row.withVri,
    m3haWithVri: row.m3haWithVri,
    coverageWithVri: row.coverageWithVri,
    flagged: row.belowMinimum,
  }
}

const unionBox = (boxes: BBox[]): BBox | null =>
  boxes.length
    ? [
        Math.min(...boxes.map((box) => box[0])),
        Math.min(...boxes.map((box) => box[1])),
        Math.max(...boxes.map((box) => box[2])),
        Math.max(...boxes.map((box) => box[3])),
      ]
    : null

export default function DevAvastVolume() {
  const inputs = useAvastInputs()
  const candidateState = useCandidates(inputs.entries, inputs.datasets)
  const { candidates } = candidateState
  const [settings, setSettings] = useState<AvastSettings>(loadSettings)
  const [tab, setTab] = useState<Tab>('inputs')
  const [view, setView] = useState<MapView>('density')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  // Picking a block from the list zooms to it; clicking it on the map does not move the camera.
  const [focusBox, setFocusBox] = useState<BBox | null>(null)
  const [showVri, setShowVri] = useState(false)
  const [highlightLow, setHighlightLow] = useState(false)
  const { state: run, results, version, run: startRun, cancel } = useAvastRun()
  const vri = useVriFill()
  const [vriRules, setVriRules] = useState<VriRules>(DEFAULT_VRI_RULES)

  useEffect(() => {
    const previous = document.title
    document.title = 'AVAST volume · PGMaps Dev'
    return () => {
      document.title = previous
    }
  }, [])
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    } catch {
      /* storage unavailable */
    }
  }, [settings])
  const updateSettings = useCallback(
    (patch: Partial<AvastSettings>) => setSettings((current) => ({ ...current, ...patch })),
    [],
  )

  const candidateSources = useMemo(
    () => inputs.entries.filter((entry) => entry.role === 'candidates').map((entry) => entry.dataset.label),
    [inputs.entries],
  )
  const projectName =
    settings.projectName.trim() || (candidateSources.length ? guessProjectName(candidateSources) : 'Project')
  const effectiveSettings = useMemo(() => ({ ...settings, projectName }), [settings, projectName])
  const avastEntries = inputs.entries.filter((entry) => entry.role === 'avast' && entry.status === 'ready')
  const lidarEntries = inputs.entries.filter((entry) => entry.role === 'lidar' && entry.status === 'ready')
  const avastNames = run.layers.filter((layer) => layer.kind === 'avast').map((layer) => layer.name)
  const lidarNames = run.layers.filter((layer) => layer.kind === 'lidar').map((layer) => layer.name)

  const geometrySettings = useMemo(() => geometryOf(settings), [settings])
  const currentSignature = runSignature(candidates, inputs.entries, geometrySettings)
  const stale = run.signature !== null && run.signature !== currentSignature

  const summary = useMemo(() => {
    if (!results.raws.size) return null
    return summarize(candidates, results.raws, effectiveSettings, {
      avastLayerNames: avastNames,
      lidarLayerNames: lidarNames,
      slopeAssessed: run.slopeAssessed,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, results, version, effectiveSettings, run.layers, run.slopeAssessed])
  const rowsByKey = useMemo(() => new Map(summary?.candidates.map((row) => [row.key, row]) ?? []), [summary])

  const operatingAreas = useMemo(
    () =>
      [
        ...new Set(
          candidates
            .map((candidate) => candidate.operatingArea || results.raws.get(candidate.key)?.avast.operatingArea || '')
            .filter(Boolean),
        ),
      ].sort(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [candidates, version],
  )

  const vriTotals = useMemo(
    () => vriFillTotals(vri.pieces, vri.byFid, vriRules, summary?.factor ?? null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vri.pieces, vri.byFid, vri.version, vriRules, summary?.factor],
  )
  const whatIf = useMemo(
    () => (summary ? whatIfRows(summary, vriTotals, vriRules.minimumM3ha) : []),
    [summary, vriTotals, vriRules.minimumM3ha],
  )
  const vriDone = vri.state.status === 'done'
  const whatIfByKey = useMemo(() => new Map(vriDone ? whatIf.map((row) => [row.key, row]) : []), [whatIf, vriDone])
  // Blocks under the merchantability minimum once VRI fills the gaps; outlined yellow while highlighted.
  const flaggedKeys = useMemo(
    () => whatIf.filter((row) => vriDone && row.belowMinimum).map((row) => row.key),
    [whatIf, vriDone],
  )
  const candidateFc = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: candidates.map((candidate) => {
        const row = rowsByKey.get(candidate.key)
        const state =
          candidate.key === run.currentKey
            ? 'current'
            : row
              ? row.volumeSource === 'LiDAR'
                ? 'lidar'
                : row.coverageClass
              : 'pending'
        return {
          type: 'Feature',
          id: candidate.key,
          geometry: multiPolygonToLngLat(candidate.geometry),
          properties: {
            key: candidate.key,
            blockId: candidate.id,
            operatingArea: candidate.operatingArea || row?.operatingArea || '',
            state,
            grossHa: row?.grossHa ?? candidate.fieldHa ?? candidate.geometryHa,
            ...(row && { coveragePct: row.avastCoveragePct, volume: row.reportedVolume }),
            ...(row?.classVolume && {
              class1: row.classVolume[0],
              class2: row.classVolume[1],
              class3: row.classVolume[2],
            }),
            ...whatIfProperties(whatIfByKey.get(candidate.key)),
          },
        }
      }),
    }),
    [candidates, rowsByKey, run.currentKey, whatIfByKey],
  )

  const idOf = useCallback(
    (key: string) => candidates.find((candidate) => candidate.key === key)?.id ?? '',
    [candidates],
  )
  const pieceFc = useProjected(results.pieces.avastPieces, version, (piece) => ({
    type: 'Feature',
    geometry: multiPolygonToLngLat(piece.geometry),
    properties: {
      blockId: idOf(piece.candidateKey),
      density: piece.density,
      volume: piece.volume,
      areaHa: piece.areaHa,
    },
  }))
  const slopeItems = useMemo(() => {
    if (results.pieces.slopeClasses.size) {
      return [...results.pieces.slopeClasses.entries()].flatMap(([key, classes]) =>
        ([1, 2, 3] as const)
          .filter((slopeClass) => classes[slopeClass].length)
          .map((slopeClass) => ({
            key,
            slopeClass,
            geometry: classes[slopeClass] as MultiPolygonCoords,
            areaHa: undefined as number | undefined,
            volume: undefined as number | undefined,
          })),
      )
    }
    return results.pieces.avastSlopePieces.map((piece) => ({
      key: piece.candidateKey,
      slopeClass: piece.slopeClass,
      geometry: piece.geometry,
      areaHa: piece.areaHa,
      volume: piece.volume,
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, version])
  const slopeCache = useRef(new Map<string, GeoJSON.Feature>())
  const slopeFc = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: slopeItems.map((item, index) => {
        const cacheKey = `${item.key}:${item.slopeClass}:${index}:${item.geometry.length}`
        let feature = slopeCache.current.get(cacheKey)
        if (!feature) {
          feature = {
            type: 'Feature',
            geometry: multiPolygonToLngLat(item.geometry),
            properties: {
              blockId: idOf(item.key),
              slopeClass: item.slopeClass,
              areaHa: item.areaHa,
              volume: item.volume,
            },
          }
          slopeCache.current.set(cacheKey, feature)
        }
        return feature
      }),
    }),
    [slopeItems, idOf],
  )
  const contextFc = useProjected(results.avastFeatures, version, (feature) => ({
    type: 'Feature',
    geometry: multiPolygonToLngLat(feature.geometry),
    properties: { density: feature.density ?? 0 },
  }))

  const vriGeometry = useRef(new WeakMap<VriPiece, GeoJSON.Geometry>())
  const vriFc = useMemo<GeoJSON.FeatureCollection>(() => {
    const lidarKeys = new Set(
      summary?.candidates.filter((row) => row.volumeSource === 'LiDAR').map((row) => row.key) ?? [],
    )
    const scale = vriRules.applyFactor && summary?.factor != null ? summary.factor : 1
    const features: GeoJSON.Feature[] = []
    for (const piece of vri.pieces) {
      if (lidarKeys.has(piece.candidateKey) || (piece.source === 'zero' && !vriRules.fillZeroAvast)) continue
      const feature = vri.byFid.get(piece.fid)
      let geometry = vriGeometry.current.get(piece)
      if (!geometry) {
        geometry = multiPolygonToLngLat(piece.geometry)
        vriGeometry.current.set(piece, geometry)
      }
      const density = feature ? vriDensity(feature, vriRules) * scale : 0
      features.push({
        type: 'Feature',
        geometry,
        properties: {
          blockId: idOf(piece.candidateKey),
          source: piece.source,
          density,
          areaHa: piece.areaHa,
          volume: density * piece.areaHa,
          species: feature?.species ?? '',
          age: feature?.age ?? null,
        },
      })
    }
    return { type: 'FeatureCollection', features }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vri.pieces, vri.byFid, vri.version, vriRules, summary, idOf])

  const bounds = useMemo(() => {
    const box = unionBox(candidates.map((candidate) => candidate.bbox))
    return box ? albersBoxToLngLat(box) : null
  }, [candidates])
  const focus = useMemo(() => (focusBox ? albersBoxToLngLat(focusBox) : null), [focusBox])
  const focusKeys = (keys: string[]) => {
    const box = unionBox(
      candidates.filter((candidate) => keys.includes(candidate.key)).map((candidate) => candidate.bbox),
    )
    if (box) setFocusBox(box)
  }
  const toggleHighlight = () => {
    const next = !highlightLow
    setHighlightLow(next)
    if (next) focusKeys(flaggedKeys)
  }

  const canRun = !candidates.length
    ? candidateState.loading
      ? 'Reading candidate blocks…'
      : 'Add candidate blocks first.'
    : !avastEntries.length
      ? 'Add the AVAST geodatabase first.'
      : avastEntries.some((entry) => !entry.densityFields.densityField)
        ? 'Choose the AVAST volume density field (CMM_m3ha).'
        : inputs.entries.some((entry) => entry.status === 'reading')
          ? 'Still reading inputs…'
          : null

  const onRun = () => {
    vri.reset()
    setHighlightLow(false)
    setTab('results')
    setSelectedKey(null)
    void startRun({ candidates, entries: inputs.entries, datasets: inputs.datasets, settings: geometrySettings })
  }

  const workbookContext = () => ({
    projectName,
    candidateSources,
    avastLayerNames: avastNames,
    lidarLayerNames: lidarNames,
    densityField: run.densityField || 'CMM_m3ha',
    lidarDensityField: run.lidarDensityField,
    slopeDescription: !run.slopeAssessed
      ? null
      : settings.slopeSource === 'dem'
        ? `Percent slope (Horn) from AWS Terrain Tiles at zoom ${settings.demZoom}, resampled to a ${settings.slopeCellMeters} m BC Albers grid and intersected with every piece.`
        : "Each AVAST polygon's average slope attribute classifies its piece.",
    generatedAt: new Date(),
    avastPieces: results.pieces.avastPieces,
    candidateIds: new Map(
      candidates.map((candidate) => [
        candidate.key,
        { id: candidate.id, operatingArea: rowsByKey.get(candidate.key)?.operatingArea ?? candidate.operatingArea },
      ]),
    ),
    vri:
      settings.excelIncludeVri && vriDone
        ? {
            rows: new Map(whatIf.map((row) => [row.key, row])),
            description: describeVriRules(vriRules, summary?.factor ?? null, vri.state.projectedDate),
          }
        : undefined,
  })

  const onDownloadExcel = async () => {
    if (!summary) return
    const buffer = await buildWorkbook(summary, effectiveSettings, workbookContext())
    downloadBlob(
      new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      `${datasetName(projectName)}_Volume_Summary_All_Blocks.xlsx`,
    )
  }
  const onDownloadGdb = async () => {
    if (!summary) return
    const name = `${datasetName(projectName)}_AVAST_Volume`
    const layers = geodatabaseLayers({
      project: projectName,
      candidates,
      summary,
      pieces: results.pieces,
      settings: effectiveSettings,
      densityField: run.densityField || 'CMM_m3ha',
      lidarDensityField: run.lidarDensityField,
      avastLayerNames: avastNames,
      lidarLayerNames: lidarNames,
    })
    downloadBlob(await writeGeodatabase(name, layers), `${name}.gdb.zip`)
  }
  const pasteRows = (startRow: number, formulas: boolean) => {
    // Same rows as the workbook, including step 4's VRI fill in F when that export option is on.
    const vriRows = settings.excelIncludeVri && vriDone ? new Map(whatIf.map((row) => [row.key, row])) : undefined
    const rows = summary ? exportBlockRows(summary, effectiveSettings, vriRows).map((entry) => entry.row) : []
    return { rows, text: blockRowsTsv(rows, { startRow, formulas }) }
  }
  const onCopyRows = async ({ startRow, formulas }: { startRow: number; formulas: boolean }) => {
    const { rows, text } = pasteRows(startRow, formulas)
    await writeClipboardText(text, {
      fallback: (value) => {
        if (!copyTextWithSelection(value))
          throw new Error(
            'This browser blocked clipboard access. Download the rows as .tsv instead and copy them from there.',
          )
      },
    })
    return rows.length
  }
  const onDownloadTsv = async ({ startRow, formulas }: { startRow: number; formulas: boolean }) => {
    const { text } = pasteRows(startRow, formulas)
    downloadBlob(
      new Blob([text], { type: 'text/tab-separated-values' }),
      `${datasetName(projectName)}_Block_Volume_Inputs_rows.tsv`,
    )
  }

  const tools: WebMCPTool[] = [
    {
      name: 'read_avast_volume',
      title: 'Read AVAST volume run',
      description: 'Read the AVAST volume utility inputs, run status and per-block planning volumes.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute(args) {
        if (Object.keys(args).length) throw new Error('This tool takes no parameters.')
        return {
          inputs: inputs.entries.map((entry) => ({
            role: entry.role,
            label: entry.dataset.label,
            status: entry.status,
            layer: entry.layer,
            error: entry.error,
          })),
          candidates: candidates.length,
          run: { status: run.status, done: run.done, total: run.total, error: run.error, layers: run.layers, stale },
          settings: effectiveSettings,
          totals: summary?.totals ?? null,
          factor: summary?.factor ?? null,
          byOperatingArea: summary?.byOperatingArea ?? [],
          qa: summary?.qa ?? [],
          vriWhatIf: {
            status: vri.state.status,
            error: vri.state.error,
            polygons: vri.state.featureCount,
            projectedDate: vri.state.projectedDate,
            rules: vriRules,
            avastVolume: whatIf.reduce((sum, row) => sum + row.avastVolume, 0),
            withVri: whatIf.reduce((sum, row) => sum + row.withVri, 0),
          },
          blocks:
            summary?.candidates.map((row) => ({
              id: row.id,
              operatingArea: row.operatingArea,
              grossHa: row.grossHa,
              avastHa: row.avastCoveredHa,
              coveragePct: row.avastCoveragePct,
              rawVolume: row.avastRawVolume,
              finalVolume: row.finalVolume,
              reportedVolume: row.reportedVolume,
              classVolume: row.classVolume,
              vph: row.preferredVph,
              source: row.volumeSource,
              duplicate: row.duplicate,
              warnings: row.warnings,
            })) ?? [],
        }
      },
    },
  ]
  useWebMCPTools(tools)

  const inputsDone = candidates.length > 0 && avastEntries.length > 0
  const statuses: Record<Tab, StepStatus> = {
    inputs: inputsDone ? 'done' : 'current',
    settings: run.status === 'done' && !stale ? 'done' : inputsDone ? 'current' : 'todo',
    results: run.status === 'done' && !stale ? 'done' : run.status === 'idle' ? 'todo' : 'current',
    vri:
      vri.state.status === 'done'
        ? 'done'
        : vri.state.status === 'fetching' || vri.state.status === 'intersecting'
          ? 'current'
          : 'todo',
  }
  const panel = (id: Tab) => ({
    role: 'tabpanel' as const,
    id: `avast-steps-panel-${id}`,
    'aria-labelledby': `avast-steps-tab-${id}`,
    hidden: tab !== id,
  })
  const totalHa = candidates.reduce((sum, candidate) => sum + (candidate.fieldHa ?? candidate.geometryHa), 0)

  const sidebar = (
    <MapSidebarShell
      title="AVAST volume"
      subtitle="Planning volume for candidate blocks"
      icon={TreePine}
      className={MAP_SIDEBAR_CLASS}
    >
      <div className="sticky top-0 z-10 border-b border-border bg-background/95 px-2 pt-1 backdrop-blur">
        <TabBar
          label="Procedure steps"
          variant="underline"
          stretch
          stacked
          idPrefix="avast-steps"
          className="border-b-0"
          value={tab}
          onChange={setTab}
          options={(
            [
              ['inputs', 'Inputs', 1],
              ['settings', 'Settings', 2],
              ['results', 'Run & results', 3],
              ['vri', 'VRI (optional)', 4],
            ] as const
          ).map(([value, label, step]) => ({
            value,
            label,
            marker: <StepMarker step={step} status={statuses[value]} className="h-5 w-5 text-[11px]" />,
            ...(value === 'vri' && { ariaLabel: 'Step 4, optional: fill AVAST gaps with VRI' }),
          }))}
          getTabProps={(option) => ({ 'data-avast-tab': option.value })}
        />
      </div>
      <div {...panel('inputs')}>
        <InputsPanel
          entries={inputs.entries}
          onAdd={inputs.addFiles}
          onRemove={inputs.remove}
          onLayer={inputs.setLayer}
          onUpdate={(id, patch) => inputs.update(id, patch)}
          candidateSummary={
            <>
              {candidateState.loading && <InlineAlert loading>Reading candidate polygons…</InlineAlert>}
              {candidateState.error && <InlineAlert tone="error">{candidateState.error}</InlineAlert>}
              {candidates.length > 0 && (
                <p className="text-xs text-muted-foreground" data-avast-candidates={candidates.length}>
                  {candidates.length.toLocaleString('en-CA')} candidates · {Math.round(totalHa).toLocaleString('en-CA')}{' '}
                  ha
                  {candidateState.skipped ? ` · ${candidateState.skipped} without polygon geometry skipped` : ''}
                </p>
              )}
            </>
          }
        />
        {canRun === null && (
          <div className="px-4 pb-4">
            <InlineAlert tone="success" title="Ready">
              Inputs are set. Review the settings, or go straight to Run & results.
            </InlineAlert>
          </div>
        )}
      </div>
      <div {...panel('settings')}>
        <SettingsPanel
          settings={effectiveSettings}
          onChange={updateSettings}
          operatingAreas={operatingAreas}
          lidarAvailable={lidarEntries.length > 0}
          stale={stale}
        />
      </div>
      <div {...panel('results')}>
        <ResultsPanel
          run={run}
          summary={summary}
          settings={effectiveSettings}
          canRun={canRun}
          stale={stale}
          onRun={onRun}
          onCancel={cancel}
          selectedKey={selectedKey}
          onSelect={(key) => {
            setSelectedKey(key)
            if (key) focusKeys([key])
          }}
          onDownloadExcel={onDownloadExcel}
          onDownloadGdb={onDownloadGdb}
          onCopyRows={onCopyRows}
          onDownloadTsv={onDownloadTsv}
          onSettings={updateSettings}
          exportNote={
            settings.excelIncludeVri && vriDone ? (
              <InlineAlert tone="warning" title="Exports include VRI">
                Direct Est. Vol (F), the Management Summary and Copy rows include step 4's audit-adjusted VRI fill. Turn
                it off in step 4 for AVAST-only volumes.
              </InlineAlert>
            ) : null
          }
          whatIf={
            summary && run.status === 'done' ? (
              <div className="px-4 pb-3">
                <InlineAlert title="Optional step 4: fill AVAST gaps with VRI">
                  <p>Estimate the ground AVAST leaves empty from the provincial VRI, kept apart from these totals.</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    onClick={() => setTab('vri')}
                    data-avast-open-vri
                  >
                    Open step 4
                  </Button>
                </InlineAlert>
              </div>
            ) : null
          }
        />
      </div>
      <div {...panel('vri')}>
        {summary && run.status === 'done' ? (
          <VriWhatIfPanel
            state={vri.state}
            summary={summary}
            rows={whatIf}
            rules={vriRules}
            settings={effectiveSettings}
            onRules={(patch) => setVriRules((current) => ({ ...current, ...patch }))}
            onRun={() => {
              const ran = new Set(results.raws.keys())
              void vri.run(
                candidates.filter((candidate) => ran.has(candidate.key)),
                results.pieces.avastPieces,
                run.signature ?? '',
                settings.minPieceHa,
              )
              setShowVri(true)
              if (view === 'coverage') setView('density')
            }}
            stale={vri.state.runSignature !== null && vri.state.runSignature !== run.signature}
            selectedKey={selectedKey}
            canRun={!stale}
            highlight={highlightLow}
            onHighlight={toggleHighlight}
            onSelect={(key) => {
              setSelectedKey(key)
              focusKeys([key])
            }}
            excelIncludeVri={settings.excelIncludeVri}
            onExcelIncludeVri={(excelIncludeVri) => updateSettings({ excelIncludeVri })}
            onDownloadExcel={onDownloadExcel}
          />
        ) : (
          <div className="p-4">
            <InlineAlert title="Run step 3 first">
              VRI fills the gaps in a finished AVAST run, so it opens once step 3 has run.
            </InlineAlert>
          </div>
        )}
      </div>
    </MapSidebarShell>
  )

  return (
    <MapSectionLayout
      sidebar={sidebar}
      mobileInitialSheetState="half"
      mobileScrimEnabled={false}
      mobilePeekTitle="AVAST volume"
      mobilePeekSubtitle={
        run.status === 'running' ? `${run.done} of ${run.total} blocks` : `${candidates.length} candidate blocks`
      }
    >
      <AvastMap
        candidates={candidates.length ? candidateFc : EMPTY}
        pieces={pieceFc}
        slope={slopeFc}
        context={contextFc}
        bounds={bounds}
        focus={focus}
        view={view}
        onViewChange={setView}
        selectedKey={selectedKey}
        onSelect={(key) => {
          setSelectedKey(key)
          if (key) setTab('results')
        }}
        slopeBreaks={settings.slopeBreaks}
        slopeAvailable={run.slopeAssessed && slopeFc.features.length > 0}
        vriFill={vriDone || vri.state.status === 'intersecting' ? vriFc : EMPTY}
        showVri={showVri}
        onShowVriChange={setShowVri}
        highlight={highlightLow && flaggedKeys.length > 0}
        highlightLabel={`Below ${vriRules.minimumM3ha} m³/ha with VRI`}
      />
    </MapSectionLayout>
  )
}
