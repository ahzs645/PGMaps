import { useMemo, useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { InlineAlert } from '@/components/ui/map-panels'
import { Field, NumberField, OptionalNumberField, roadFieldClass, RoadSelect } from './Controls'
import { RoadSection } from './SidebarParts'
import {
  compareFieldProfile,
  FIELD_DIFFERENCE_FLAG_M,
  FIELD_PROFILE_CORRIDOR_M,
  fieldProfileErrors,
  MAX_FIELD_NOTE,
  MAX_FIELD_SHOTS,
  parseFieldRows,
  type CableFieldProfile,
} from './dline/fieldProfile'
import { dLineFrame } from './dline/frame'
import type { CableLine, TerrainSource } from './types'

type Method = CableFieldProfile['method']
const n1 = (v: number | null) => (v === null ? '–' : v.toFixed(1))
const n2 = (v: number | null) => (v === null ? '–' : v.toFixed(2))
const signed = (v: number | null) => (v === null ? '–' : `${v > 0 ? '+' : ''}${v.toFixed(2)}`)

/** The rows as the text box shows them. */
function rowsText(profile: CableFieldProfile | undefined) {
  if (!profile) return ''
  return profile.method === 'slope'
    ? profile.legs.map((l) => `${l.slopeDistanceM}, ${l.slopePercent}`).join('\n')
    : profile.shots.map((s) => `${s.stationM}, ${s.elevationM}`).join('\n')
}

/**
 * A field-measured ground profile for one D-line: shots typed, pasted or imported as station and
 * elevation, or as slope distance and slope % from a start, used in place of the terrain along the
 * line while it is on, with each shot's difference to the terrain.
 */
export function CableFieldProfileSection({
  line,
  terrain,
  onEdit,
}: {
  line: CableLine
  /** The terrain itself, which the shots are compared with. */
  terrain: TerrainSource
  onEdit: (change: (line: CableLine) => CableLine) => void
}) {
  const saved = line.fieldProfile
  const [method, setMethod] = useState<Method>(saved?.method ?? 'station-elevation')
  const [text, setText] = useState(() => rowsText(saved))
  const [startStation, setStartStation] = useState(saved?.method === 'slope' ? saved.startStationM : 0)
  const [startElevation, setStartElevation] = useState<number | null>(
    saved?.method === 'slope' ? saved.startElevationM : null,
  )
  const [note, setNote] = useState(saved?.note ?? '')
  const [error, setError] = useState('')
  const file = useRef<HTMLInputElement>(null)
  const frame = dLineFrame(line)
  const comparison = useMemo(() => compareFieldProfile(line, terrain), [line, terrain])

  const terrainAtStart = () => {
    if (!frame) return
    const z = terrain.elevationAt(...frame.at(startStation))
    if (Number.isFinite(z)) setStartElevation(Math.round(z * 100) / 100)
    else setError('The terrain is unknown at the start station; type its elevation.')
  }
  const apply = () => {
    try {
      const rows = parseFieldRows(text)
      const base = { use: saved?.use ?? true, ...(note.trim() ? { note: note.trim().slice(0, MAX_FIELD_NOTE) } : {}) }
      const profile: CableFieldProfile =
        method === 'slope'
          ? {
              ...base,
              method,
              startStationM: startStation,
              startElevationM: startElevation ?? NaN,
              legs: rows.map(([slopeDistanceM, slopePercent]) => ({ slopeDistanceM, slopePercent })),
            }
          : { ...base, method, shots: rows.map(([stationM, elevationM]) => ({ stationM, elevationM })) }
      if (method === 'slope' && startElevation === null)
        throw Error('Enter the start elevation, or take it from the terrain.')
      const errors = fieldProfileErrors(profile)
      if (errors.length) throw Error(errors[0])
      setError('')
      onEdit((l) => ({ ...l, fieldProfile: profile }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read the field shots.')
    }
  }
  const importFile = async (chosen: File | undefined) => {
    if (!chosen) return
    if (chosen.size > 1_000_000) return setError('Choose a field file under 1 MB.')
    setText(await chosen.text())
    setError('')
  }
  const used = !!saved?.use && !!comparison
  const summary = !saved
    ? 'terrain'
    : `${comparison?.rows.length ?? 0} shots · ${used ? 'used' : 'off'}${
        comparison?.largestDifferenceM !== null && comparison
          ? ` · largest Δ ${signed(comparison.largestDifferenceM)} m`
          : ''
      }`

  return (
    <RoadSection
      title="Field-measured ground"
      summary={summary}
      data-testid="cable-field-profile"
      help={
        <>
          Shots a layout crew takes along the skyline, stationed horizontally from the yarder. While on, the D-line
          profile, its supports, its exports and its sheet read the shots (straight between them) instead of the terrain
          within {FIELD_PROFILE_CORRIDOR_M} m of the line; before the first and after the last shot the terrain is read.
          Slope legs are reduced to horizontal distance and rise from the start. Shots more than{' '}
          {FIELD_DIFFERENCE_FLAG_M} m from the terrain are flagged.
        </>
      }
    >
      <div className="grid grid-cols-2 gap-1">
        <Field label="Shots as">
          <RoadSelect
            ariaLabel="Field shots as"
            className={roadFieldClass}
            value={method}
            onValueChange={(value) => setMethod(value as Method)}
          >
            <option value="station-elevation">Station, elevation</option>
            <option value="slope">Slope distance, slope %</option>
          </RoadSelect>
        </Field>
        <Field label="Note" hint="Instrument, date, crew: printed with the profile.">
          <input
            className={roadFieldClass}
            aria-label="Field profile note"
            value={note}
            maxLength={MAX_FIELD_NOTE}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        {method === 'slope' && (
          <>
            <NumberField
              label="Start station (m)"
              value={startStation}
              min={-200}
              max={3000}
              step={1}
              onChange={setStartStation}
            />
            <div className="flex items-end gap-1">
              <div className="min-w-0 flex-1">
                <OptionalNumberField
                  label="Start elevation (m)"
                  value={startElevation}
                  min={-500}
                  max={9000}
                  step={0.1}
                  placeholder="enter"
                  onChange={setStartElevation}
                />
              </div>
              <Button size="sm" variant="outline" className="h-8 px-2 text-xs" onClick={terrainAtStart}>
                Terrain
              </Button>
            </div>
          </>
        )}
      </div>
      <Field
        label={
          method === 'slope' ? 'Legs: slope distance (m), slope (%)' : 'Shots: station from yarder (m), elevation (m)'
        }
        hint={`One per line, up to ${MAX_FIELD_SHOTS}; commas, tabs or spaces between. Slope is positive uphill going out from the yarder.`}
      >
        <textarea
          className={`${roadFieldClass} h-24 font-mono`}
          aria-label="Field shots"
          value={text}
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-1">
        <Button size="sm" onClick={apply} disabled={!text.trim()}>
          Apply shots
        </Button>
        <Button size="sm" variant="outline" onClick={() => file.current?.click()}>
          <Upload className="size-3" /> Import CSV or text
        </Button>
        <input
          ref={file}
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          className="hidden"
          aria-label="Import field shots"
          onChange={(e) => {
            void importFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        {saved && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              onEdit((l) => {
                const next = { ...l }
                delete next.fieldProfile
                return next
              })
            }
          >
            Remove
          </Button>
        )}
      </div>
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      {saved && (
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={saved.use}
            onChange={(e) => {
              const use = e.target.checked
              onEdit((l) => (l.fieldProfile ? { ...l, fieldProfile: { ...l.fieldProfile, use } } : l))
            }}
          />
          Use instead of the terrain along this D-line
        </label>
      )}
      {comparison && (
        <div className="space-y-1" data-testid="cable-field-comparison">
          <p role="status" className="text-2xs">
            Field − terrain over {comparison.compared} of {comparison.rows.length} shots: mean{' '}
            {signed(comparison.meanDifferenceM)} m · RMS {n2(comparison.rmsDifferenceM)} m · largest{' '}
            {signed(comparison.largestDifferenceM)} m at {n1(comparison.largestAtM)} m
            {comparison.flagged ? ` · ${comparison.flagged} over ${FIELD_DIFFERENCE_FLAG_M} m` : ''}.
          </p>
          {!comparison.coversLine && (
            <p className="text-2xs text-amber-700 dark:text-amber-400">
              Shots cover {n1(comparison.coveredFromM)}–{n1(comparison.coveredToM)} m of the {n1(comparison.lengthM)} m
              line; the terrain is read outside them.
            </p>
          )}
          <div className="max-h-40 overflow-auto overscroll-none rounded border">
            <EngineeringTable compact data-testid="cable-field-table">
              <thead className="sticky top-0">
                <tr>
                  <ColumnHeader label="Station" unit="m" className="text-left" />
                  <ColumnHeader label="Field" unit="m" />
                  <ColumnHeader label="Terrain" unit="m" />
                  <ColumnHeader label="Δ" unit="m" title="Field minus terrain" />
                </tr>
              </thead>
              <tbody>
                {comparison.rows.map((row, i) => (
                  <tr key={i} aria-selected={row.flagged}>
                    <td className="text-left">{n1(row.stationM)}</td>
                    <td>{n2(row.elevationM)}</td>
                    <td>{row.terrainM === null ? 'unknown' : n2(row.terrainM)}</td>
                    <td>{signed(row.differenceM)}</td>
                  </tr>
                ))}
              </tbody>
            </EngineeringTable>
          </div>
        </div>
      )}
    </RoadSection>
  )
}
