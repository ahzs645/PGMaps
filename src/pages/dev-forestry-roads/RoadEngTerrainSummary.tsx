import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { CollapsibleSection, KeyValueRows } from '@/components/ui/map-panels'
import type { RoadEngTerrainSource } from './roadEngTerrain'
import {
  roadEngClassLabel,
  roadEngKeptCounts,
  roadEngTerrainGridFingerprint,
  ROADENG_FEATURE_CLASSES,
  type RoadEngOriginalTer,
} from './roadEngTerrainOriginal'
import { MAX_RETAINED_TIN_INDICES, MAX_RETAINED_TIN_VERTICES } from './terrainPreparation'
import { terrainGridCellM, tinGroundFacts } from './tinGround'
import { planTerrainCellM } from './terrainDisplay'
import type { TerrainMetadata } from './types'

const fmt = (n: number) => n.toLocaleString('en-CA')
const megabytes = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`

/** Whether this browser holds the file: unknown while checking. */
type Held = 'checking' | 'held' | 'missing'

/**
 * The Terrain tab's summary of a terrain read from RoadEng: its TIN, the features its file holds,
 * what is kept with it, and whether RoadEng's own `Terrain1.ter` is in this browser, so a RoadEng
 * project export can write it back as read. When the file is missing, the person can choose it again.
 */
export function RoadEngTerrainSummary({ terrain }: { terrain: TerrainMetadata }) {
  const source = terrain.roadEngSource
  const original = source?.original
  const [held, setHeld] = useState<Held>('checking')
  const [chosen, setChosen] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const sha256 = original?.sha256
  const size = original?.size
  useEffect(() => {
    if (!sha256 || !size) return
    let live = true
    setHeld('checking')
    void import('./roadEngTerrainStore')
      .then(({ hasRoadEngOriginal }) => hasRoadEngOriginal({ sha256, size }))
      .then((has) => live && setHeld(has ? 'held' : 'missing'))
    return () => {
      live = false
    }
  }, [sha256, size])
  // The grid as read from the file, or changed since: the export writes the grid once it changes.
  // Hashing every level is the export's check; here it runs again only when the grid's identity does.
  const raster = terrain.raster
  const gridKey = [
    original?.grid,
    terrain.epsg,
    terrain.localPlane?.offsetM.join(),
    raster?.sha256,
    raster?.id,
    raster?.width,
    raster?.height,
    raster?.origin.join(),
    raster?.pixelSize.join(),
  ].join('|')
  const gridAsRead = useMemo(
    () => (original ? roadEngTerrainGridFingerprint(terrain) === original.grid : false),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the grid's identity, not the object
    [gridKey],
  )
  // How much of the grid's box holds ground: a long road's TIN covers a small share of it.
  const filledShare = useMemo(() => {
    if (!raster?.values.length) return null
    let filled = 0
    for (const v of raster.values) if (v !== null) filled++
    return filled / raster.values.length
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the grid's identity, not the object
  }, [gridKey])
  if (!source) return null

  const choose = async (file: File) => {
    if (!original) return
    setChosen(null)
    try {
      const [{ roadEngTerCandidates, sha256Hex }, { storeRoadEngOriginal }] = await Promise.all([
        import('./roadEngTerrainOriginal'),
        import('./roadEngTerrainStore'),
      ])
      const bytes = new Uint8Array(await file.arrayBuffer())
      for (const ter of roadEngTerCandidates(bytes)) {
        if (ter.length !== original.size || (await sha256Hex(ter)) !== original.sha256) continue
        await storeRoadEngOriginal(original.sha256, ter)
        setHeld('held')
        setChosen(`${file.name} holds this terrain's Terrain1.ter; it is now kept in this browser.`)
        return
      }
      setChosen(`${file.name} does not hold the Terrain1.ter this terrain was read from.`)
    } catch (error) {
      setChosen(`${file.name} could not be kept: ${(error as Error).message}`)
    }
  }

  const rows = [
    ...groundRows(terrain, original?.triangles ?? 0, filledShare),
    ...(original ? originalRows(original, source, held, gridAsRead) : keptRows(source)),
  ]
  const summary = original
    ? `${original.triangles ? `TIN of ${fmt(original.triangles)} triangles` : 'No TIN'} · ${
        held === 'held' ? 'file in this browser' : held === 'missing' ? 'file not in this browser' : 'checking file'
      }`
    : 'Kept parts only'
  return (
    <div className="-mx-2.5 -mb-2 mt-1.5" data-testid="road-roadeng-terrain-summary">
      <CollapsibleSection
        label="RoadEng terrain"
        summary={summary}
        summaryWhenCollapsedOnly
        className="border-b-0 border-t bg-transparent"
        contentClassName="px-2.5 pb-2"
      >
        <div className="flex items-start gap-1">
          <KeyValueRows
            variant="grid"
            className="min-w-0 flex-1"
            valueClassName="tabular-nums font-normal"
            rows={rows.map((row) => ({ key: row.label, label: row.label, value: row.value }))}
          />
          <InfoTip label="About this RoadEng terrain">
            Sections, the profile, quantities, drainage and the plan read RoadEng&apos;s TIN at its own triangles, so a
            cross section follows each facet as RoadEng draws it. The plan draws the TIN with its pixels sized from the
            ground the TIN covers, not its bounding box, and drainage routes flow on cells half the TIN&apos;s median
            edge over the ground within the upslope buffer of the road (not the road&apos;s whole box), coarser only
            where those cells would pass the drainage limit of 4,194,304 routed cells. Review and the reports state the
            TIN&apos;s point spacing. The kept grid covers the TIN&apos;s whole bounding box, so along a long road its
            cells are coarser than the TIN; it is what the export compares to know whether the terrain was changed, and
            what it writes when it was.
            <br />
            While the terrain grid is the one read from RoadEng and its file is in this browser, Save &amp; export →
            RoadEng project writes RoadEng&apos;s own Terrain1.ter back: its TIN, points and every feature as read, with
            only the features edited, removed or added here rewritten. Otherwise it writes the grid. The project file
            names the terrain file by checksum and does not hold it.
          </InfoTip>
        </div>
        {original && held === 'missing' && (
          <>
            <input
              ref={input}
              type="file"
              accept=".terx,.ter,.zip"
              className="hidden"
              data-testid="road-roadeng-terrain-file"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) void choose(file)
              }}
            />
            <Button variant="outline" size="sm" className="mt-1.5 w-full" onClick={() => input.current?.click()}>
              Choose its .terx
            </Button>
          </>
        )}
        {chosen && (
          <p role="status" className="mt-1 text-2xs leading-4 text-muted-foreground">
            {chosen}
          </p>
        )}
      </CollapsibleSection>
    </div>
  )
}

interface Row {
  label: string
  value: string
}

const counted = (n: number, noun: string) => `${fmt(n)} ${noun}${n === 1 ? '' : 's'}`

function keptParts(source: RoadEngTerrainSource): string[] {
  const parts: string[] = []
  const kept = roadEngKeptCounts(source)
  if (kept.loggingSystems) parts.push(counted(kept.loggingSystems, 'logging system'))
  if (kept.mapNotes) parts.push(counted(kept.mapNotes, 'map note'))
  if (kept.layouts) parts.push(counted(kept.layouts, 'window layout'))
  if (source.te1) parts.push('symbol library')
  if (source.tlt) parts.push('display settings')
  return parts
}

const metres = (m: number) => `${m >= 10 ? m.toFixed(0) : m.toFixed(1)} m`
const area = (m2: number) => (m2 >= 1e6 ? `${(m2 / 1e6).toFixed(2)} km²` : `${fmt(Math.round(m2 / 1e4))} ha`)

/** What the analysis reads as ground, the TIN's spacing, how the plan draws it and the grid kept. */
function groundRows(terrain: TerrainMetadata, fileTriangles: number, filledShare: number | null): Row[] {
  const facts = tinGroundFacts(terrain)
  const cell = Math.abs(terrain.raster?.pixelSize[0] ?? terrain.resolutionM)
  const share = filledShare === null ? '' : `, ${Math.round(filledShare * 100)}% holding ground`
  const grid: Row = { label: 'Plan grid', value: `${cell.toFixed(2)} m cells${share}` }
  if (facts) {
    // The plan, drainage and every section read the TIN; the grid over its box is kept for writing back.
    const drawn = planTerrainCellM(terrain)
    return [
      { label: 'Ground', value: "RoadEng's TIN, read at its facets" },
      { label: 'TIN spacing', value: `Median edge ${metres(facts.medianEdgeM)} over ${area(facts.areaM2)}` },
      ...(drawn === null ? [] : [{ label: 'Plan drawing', value: `About ${metres(drawn)} pixels over its ground` }]),
      { label: 'Drainage cell', value: `${metres(terrainGridCellM(terrain))} or coarser past 4,194,304 routed cells` },
      { label: 'Kept grid', value: `${cell.toFixed(2)} m cells over its box${share}` },
    ]
  }
  if (!fileTriangles) return []
  const past = fileTriangles > MAX_RETAINED_TIN_INDICES / 3
  return [
    {
      label: 'Ground',
      value:
        terrain.preparation && terrain.preparation.operation !== 'roadeng-tin'
          ? `The grid: ${terrain.preparation.method}`
          : past
            ? `The grid: the TIN is past the ${(MAX_RETAINED_TIN_INDICES / 3).toLocaleString('en-CA')} triangles or ${MAX_RETAINED_TIN_VERTICES.toLocaleString('en-CA')} points a project keeps`
            : 'The grid: this project was saved before its TIN was kept with it',
    },
    grid,
  ]
}

function originalRows(
  original: RoadEngOriginalTer,
  source: RoadEngTerrainSource,
  held: Held,
  gridAsRead: boolean,
): Row[] {
  const classes = ROADENG_FEATURE_CLASSES.filter((c) => original.classes[c]).map(
    (c) => `${fmt(original.classes[c]!)} ${roadEngClassLabel(c, original.classes[c]!)}`,
  )
  const layers = Object.keys(original.objects).length
  return [
    { label: 'TIN', value: original.triangles ? `${fmt(original.triangles)} triangles` : 'None' },
    { label: 'Features', value: `${fmt(original.features)}${classes.length ? `: ${classes.join(', ')}` : ''}` },
    { label: 'Project layers', value: `${fmt(layers)} made from its features` },
    { label: 'Kept with it', value: keptParts(source).join(', ') || 'Nothing else' },
    {
      label: 'Terrain1.ter',
      value:
        held === 'held'
          ? `In this browser, ${megabytes(original.size)}`
          : held === 'missing'
            ? `Not in this browser (${megabytes(original.size)})`
            : 'Checking this browser',
    },
    {
      label: 'Goes back as',
      value:
        original.unitM !== 1
          ? 'The grid: the terrain is in feet'
          : !gridAsRead
            ? 'The grid: the terrain changed since it was read'
            : held === 'held'
              ? "RoadEng's own terrain file"
              : 'The grid, until its file is in this browser',
    },
  ]
}

function keptRows(source: RoadEngTerrainSource): Row[] {
  return [
    { label: 'Kept with it', value: keptParts(source).join(', ') || 'Nothing else' },
    { label: 'Terrain1.ter', value: 'Not kept: open its .terx again to keep it' },
  ]
}
