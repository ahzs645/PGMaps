import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert } from '@/components/ui/map-panels'
import { insetBox } from '@/components/ui/inset-box'
import { cn } from '@/lib/utils'
import { Field, NumberField, OptionalNumberField, roadFieldClass, RoadSelect } from './Controls'
import { createEngineeringDesign, type Culvert } from './engineeringTypes'
import { nearestStation, offsetCoordinate } from './engine'
import proj4 from 'proj4'
import { projectedCrsDefinition } from '@/lib/geo/projectedCrs'
import { gridToLonLat } from './landXmlImport'
import { LOCAL_PLANE_EPSG, localPlaneProjection } from './localPlane'
import { projectOntoRoad } from './pointQuery'
import {
  culvertsFromTraverse,
  ROADENG_CULVERT_MATCH_M,
  ROADENG_CULVERT_REPLACE_M,
  traverseCulverts,
  traverseWithRoadCulverts,
} from './roadEngCulverts'
import type { SurveyBookRecord } from './surveyInterchange'
import { base64ToBytes, ROADENG_UNITS } from './roadEngImport'
import { readPlacedCulvert, readRoadEngCulvertRecords, roadEngNumber } from './roadEngPlacedCulverts'
import type { Coordinate } from './types'
import type { RoadWorkspace } from './useRoadWorkspace'

/**
 * RoadEng's culverts for the active road: those placed in the RoadEng design it was read from
 * (`roadEngPlacedCulverts.ts`, a line saying how many and that the design export writes them back),
 * and those of a survey field book's P-line traverse (`roadEngCulverts.ts`), read as RoadEng's
 * *Culverts Re-Import* does and written back into the book, so its traverse export carries them to
 * RoadEng. Each button is one undo step.
 */
export function RoadEngCulvertsPanel({ workspace: w }: { workspace: RoadWorkspace }) {
  const books = (w.project.surveyBooks ?? []).filter((b) => b.softree || b.input.legs.length)
  return (
    <>
      <RoadEngDesignCulvertsLine workspace={w} />
      {books.length > 0 && <TraverseCulverts workspace={w} books={books} />}
    </>
  )
}

/**
 * What the RoadEng design the road was read from holds of its culverts (`roadEngPlacedCulverts.ts`):
 * how many sit on the road, and that a RoadEng export writes them back.
 */
function RoadEngDesignCulvertsLine({ workspace: w }: { workspace: RoadWorkspace }) {
  const source = w.alignment.roadEngSource
  if (!source) return null
  const culverts = w.alignment.engineering?.culverts ?? []
  const fromDesign = culverts.filter((c) => c.roadEngDesign).length
  const unitM = ROADENG_UNITS[source.unitCode] ?? 1
  const records = source.ds1 ? readRoadEngCulvertRecords(base64ToBytes(source.ds1)) : []
  const offRoad = source.culvertsRead && records ? Math.max(0, records.length - fromDesign) : 0
  const part = `${source.part ?? 'Location1'}.ds1`
  return (
    <p className="mt-2 flex items-start gap-1 text-2xs text-muted-foreground" data-testid="roadeng-design-culverts">
      <span>
        {culverts.length || records?.length
          ? `${fromDesign} of this road’s ${culverts.length} culvert${culverts.length === 1 ? ' is' : 's are'} from its RoadEng design (${part}${unitM !== 1 ? ', in feet' : ''}); the RoadEng design export writes ${culverts.length === 1 ? 'it' : 'all of them'} back into it.`
          : `Its RoadEng design (${part}) holds no culverts; a culvert added here is written into it.`}
        {offRoad > 0 &&
          ` ${offRoad} more in the design ${offRoad === 1 ? 'lies' : 'lie'} off the road and ${offRoad === 1 ? 'goes' : 'go'} back as written.`}
      </span>
      <InfoTip label="About culverts in a RoadEng design">
        RoadEng keeps a design&rsquo;s placed culverts in its .ds1. Each one is read at the road station of its L-line
        station, with its class (stream or cross drain), diameter, skew (RoadEng&rsquo;s angle clockwise from the L-line
        ahead, 90° square) and its lengths left and right summed into the barrel span. Its gradient, depth,
        vertical-position option and template override are kept with it and written back. An unedited culvert goes back
        as it was read; an edited one changes only the fields edited, and a skew, length or gradient edited here goes
        back with RoadEng&rsquo;s Auto for it off, so RoadEng keeps the value; a culvert added here is written from the
        design&rsquo;s default culvert of its kind; a deleted one is removed from the design.
      </InfoTip>
    </p>
  )
}

function TraverseCulverts({ workspace: w, books }: { workspace: RoadWorkspace; books: SurveyBookRecord[] }) {
  const { project, alignment, analysis } = w
  const [bookId, setBookId] = useState<string>('')
  const [fromM, setFromM] = useState<number | null>(null)
  const [toM, setToM] = useState<number | null>(null)
  const [replaceM, setReplaceM] = useState(ROADENG_CULVERT_REPLACE_M)
  const [removeAll, setRemoveAll] = useState(false)
  const [message, setMessage] = useState<{ tone: 'info' | 'warning'; text: string } | null>(null)
  const book = books.find((b) => b.id === bookId) ?? books[0]
  let held = 0
  try {
    held = traverseCulverts(book).length
  } catch {
    held = 0
  }
  /** The book's grid both ways: its EPSG code, or the project's local plane. */
  const gridOf = (b: SurveyBookRecord) => {
    if (b.epsg === LOCAL_PLANE_EPSG) {
      const plane = localPlaneProjection(project.terrain.localPlane?.offsetM ?? [0, 0])
      return { toLonLat: plane.toLonLat, toGrid: plane.toFile }
    }
    const definition = projectedCrsDefinition(b.epsg)
    if (!definition) throw Error(`EPSG:${b.epsg} is not a projected coordinate system this workspace converts.`)
    const forward = proj4('EPSG:4326', definition)
    return { toLonLat: gridToLonLat(b.epsg), toGrid: (c: Coordinate) => forward.forward([...c]) as [number, number] }
  }
  const toLonLatFor = (b: SurveyBookRecord): ((xy: [number, number]) => Coordinate) => gridOf(b).toLonLat
  /** The road against a point, its direction as an azimuth on the book's grid (as a traverse's are). */
  const locate = (point: Coordinate) => {
    const at = projectOntoRoad(alignment, point)
    if (!at) return null
    const { toGrid } = gridOf(book)
    const [x0, y0] = toGrid(at.centre)
    const [x1, y1] = toGrid(offsetCoordinate(at.centre, at.bearing, 10))
    return { ...at, bearing: ((Math.atan2(x1 - x0, y1 - y0) * 180) / Math.PI + 360) % 360 }
  }
  const culverts = alignment.engineering?.culverts ?? []
  const read = () => {
    try {
      const result = culvertsFromTraverse(book, culverts, {
        fromM: fromM ?? undefined,
        toM: toM ?? undefined,
        replaceWithinM: replaceM,
        removeAll,
        locate,
        toLonLat: toLonLatFor(book),
        newId: () => crypto.randomUUID(),
        make: (chainage) => {
          const station = nearestStation(analysis.stations, chainage)
          return {
            lengthM: Math.max(12, (station?.leftWidth ?? 3) + (station?.rightWidth ?? 3) + 4),
            minCoverM: 0.6,
            unitCost: 0,
            fixedCost: 0,
            diameterM: 0.8,
          }
        },
      })
      if (result.added || result.removed)
        w.updateAlignment((a) => ({
          ...a,
          engineering: { ...(a.engineering ?? createEngineeringDesign()), culverts: result.culverts },
        }))
      setMessage({
        tone: result.notes.length ? 'warning' : 'info',
        text: [
          `${result.added} culvert${result.added === 1 ? '' : 's'} read from ${book.name}; ${result.removed} removed.`,
          ...result.notes,
        ].join(' '),
      })
    } catch (e) {
      setMessage({ tone: 'warning', text: e instanceof Error ? e.message : String(e) })
    }
  }
  const write = () => {
    try {
      const result = traverseWithRoadCulverts(book, culverts, {
        locate,
        toLonLat: toLonLatFor(book),
        lengthM: analysis.length,
      })
      w.update((p) => ({
        ...p,
        surveyBooks: (p.surveyBooks ?? []).map((b) => (b.id === book.id ? result.book : b)),
      }))
      setMessage({
        tone: result.notWritten.length ? 'warning' : 'info',
        text: [
          `${result.written} culvert${result.written === 1 ? '' : 's'} written to ${book.name}; ${result.removed} it held along the road removed.`,
          result.notWritten.length ? `Not written: ${result.notWritten.join('; ')}.` : '',
        ]
          .filter(Boolean)
          .join(' '),
      })
    } catch (e) {
      setMessage({ tone: 'warning', text: e instanceof Error ? e.message : String(e) })
    }
  }
  return (
    <div className={cn(insetBox(), 'mt-2 space-y-2')} data-testid="roadeng-culverts">
      <div className="flex items-center gap-1 text-xs font-medium">
        RoadEng culverts
        <InfoTip label="About RoadEng culverts">
          RoadEng reads culverts from the P-line traverse (Culverts Re-Import). Read takes the field book&rsquo;s
          culverts onto this road at the station square to each traverse station, replacing culverts within the
          tolerance (or all of them). Write puts this road&rsquo;s culverts into the field book at the traverse station
          nearest each, within {ROADENG_CULVERT_MATCH_M} m, so its Softree ASCII, IPD or Polycorder export carries them
          to RoadEng. A culvert read from the book and unchanged goes back as written.
        </InfoTip>
      </div>
      <Field label="Field book">
        <RoadSelect ariaLabel="Culvert field book" className={roadFieldClass} value={book.id} onValueChange={setBookId}>
          {books.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </RoadSelect>
      </Field>
      <p className="text-2xs text-muted-foreground">
        {held} culvert{held === 1 ? '' : 's'} in {book.name}.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <OptionalNumberField
          label="From P-station (m)"
          placeholder="start"
          value={fromM}
          min={-1e7}
          max={1e7}
          onChange={setFromM}
        />
        <OptionalNumberField
          label="To P-station (m)"
          placeholder="end"
          value={toM}
          min={-1e7}
          max={1e7}
          onChange={setToM}
        />
        <NumberField label="Replace within (m)" value={replaceM} min={0} max={1000} onChange={setReplaceM} />
        <label className="flex items-end gap-1 pb-2 text-xs">
          <input type="checkbox" checked={removeAll} onChange={(e) => setRemoveAll(e.target.checked)} />
          Remove all first
        </label>
      </div>
      <div className="grid grid-cols-2 gap-1">
        <Button size="xs" variant="outline" disabled={!held} onClick={read}>
          Read from book
        </Button>
        <Button size="xs" variant="outline" onClick={write}>
          Write to book
        </Button>
      </div>
      {message && <InlineAlert tone={message.tone}>{message.text}</InlineAlert>}
    </div>
  )
}

/** One line on what a culvert placed in a RoadEng design holds beside PGMaps' fields. */
export function roadEngDesignCulvertFacts(c: Culvert): string | null {
  const r = c.roadEngDesign
  if (!r) return null
  const f = readPlacedCulvert(r.raw, r.unitM)
  if (!f) return null
  const feet = Math.abs(r.unitM - 0.3048) < 1e-9
  const length = (m: number | null) =>
    m === null ? 'none' : feet ? `${(m / r.unitM).toFixed(2)} ft (${m.toFixed(2)} m)` : `${m.toFixed(2)} m`
  return [
    `RoadEng design culvert ${r.index + 1}`,
    f.stationM !== null ? `L-station ${(f.stationM / r.unitM).toFixed(3)} ${feet ? 'ft' : 'm'}` : null,
    f.skewFromLineDeg !== null
      ? `skew ${roadEngNumber(Number(f.skewFromLineDeg.toFixed(2)))}° clockwise from the L-line`
      : null,
    `${length(f.leftM)} left and ${length(f.rightM)} right of it`,
    `depth ${length(f.depthM)}`,
    f.auto
      ? (() => {
          const own = [f.auto.skew && 'skew', f.auto.gradient && 'gradient', f.auto.length && 'length'].filter(Boolean)
          return own.length ? `RoadEng computes its ${own.join(', ').replace(/, ([^,]*)$/, ' and $1')} (Auto)` : null
        })()
      : null,
    f.override?.on
      ? `template override: ditch ${length(f.override.ditchWidthM)} wide and ${length(f.override.ditchDepthM)} deep, held ${length(f.override.offsetM)}, tapered over ${length(f.override.taperM)}`
      : null,
    f.flags !== null ? `option flags ${f.flags}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

/** A RoadEng design culvert's gradient, which PGMaps has no field for: kept with its record and written back. */
export function RoadEngDesignCulvertGradient({
  culvert: c,
  label,
  onChange,
}: {
  culvert: Culvert
  label: string
  onChange: (record: NonNullable<Culvert['roadEngDesign']>) => void
}) {
  const r = c.roadEngDesign
  const read = r ? (readPlacedCulvert(r.raw, r.unitM)?.gradientPercent ?? null) : null
  if (!r) return null
  return (
    <NumberField
      label={label}
      value={r.gradientPercent ?? read ?? 0}
      min={-100}
      max={100}
      step={0.5}
      hint={
        readPlacedCulvert(r.raw, r.unitM)?.auto?.gradient
          ? "The culvert's gradient in the RoadEng design, which RoadEng computes (Auto); a gradient typed here is written back with Auto off. PGMaps' own pipe grade comes from the inverts."
          : "The culvert's gradient in the RoadEng design, written back with it. PGMaps' own pipe grade comes from the inverts."
      }
      onChange={(gradient) => {
        const { gradientPercent: _was, ...rest } = r
        void _was
        onChange(read !== null && Math.abs(gradient - read) < 1e-9 ? rest : { ...rest, gradientPercent: gradient })
      }}
    />
  )
}

/** One line on what a culvert read from a RoadEng traverse holds beside PGMaps' fields. */
export function roadEngCulvertFacts(c: Culvert, bookName?: string): string | null {
  const r = c.roadEng
  if (!r) return null
  return [
    `From ${bookName ?? 'a field book'}, traverse station ${r.traverseStation}, P-station ${r.pStationM.toFixed(1)} m`,
    r.boxWidthM !== undefined ? `box ${r.boxWidthM.toFixed(2)} m wide` : null,
    r.gradientPercent !== undefined ? `surveyed gradient ${r.gradientPercent}%` : null,
    r.azimuthDeg !== undefined ? `downstream azimuth ${r.azimuthDeg}°` : null,
    r.flag === 1
      ? 'downstream square right'
      : r.flag === 3
        ? 'downstream square left'
        : r.flag === 5
          ? 'direction from side shots'
          : null,
  ]
    .filter(Boolean)
    .join(' · ')
}
