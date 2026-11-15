import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { insetBox } from '@/components/ui/inset-box'
import { ToolDisclosure } from '@/components/ui/tool-section'
import { cn } from '@/lib/utils'
import { Field, OptionalNumberField, RoadSelect, roadFieldClass } from './Controls'
import { culvertFromMetres, culvertInMetres, type CulvertMetres } from './softreeCulvert'
import type { SoftreeStationExtras } from './softreeTraverse'
import type { SurveyBookSoftree } from './surveyInterchange'

/** A field-book station as the notes list names it. */
export interface FieldNoteStation {
  /** Field-book index (0 is the start). */
  index: number
  /** The station's id in the traverse CSV ('' for the start). */
  name: string
  /** Its field station, m. */
  fieldStation: number
}

const ORIENTATIONS = [
  { value: '', label: 'Not given' },
  { value: '0', label: 'Gradient and direction as given' },
  { value: '1', label: 'Downstream perpendicular right' },
  { value: '3', label: 'Downstream perpendicular left' },
  { value: '5', label: 'Downstream from the side shots' },
]
const EMPTY_CULVERT: CulvertMetres = {
  sizeYM: null,
  sizeXM: null,
  gradientPercent: null,
  azimuth: null,
  flag: null,
  sdM: null,
}
const two = (v: number) => v.toFixed(2)
const mm = (m: number | null) => (m === null ? null : Math.round(m * 1e6) / 1e3)

/** Whether a station's notes say anything. */
const hasNotes = (e: SoftreeStationExtras | undefined) =>
  !!e &&
  (!!e.label ||
    !!e.label2 ||
    !!e.ground?.some((g) => g.type || g.depth !== null) ||
    !!e.culvert ||
    e.hi != null ||
    e.ht != null ||
    e.backshot != null ||
    !!e.sideShots?.length ||
    !!e.extensionSlope)

/**
 * The field notes a traverse file carried beyond legs and side shots, station by station: labels,
 * culverts, ground layers and HI/HT, editable where a field note is corrected, with side-shot depths,
 * slopes beyond the last shot and located points shown as read. Lengths are in the file's unit;
 * culvert sizes in millimetres. Edits change the panel's field book only; saving it stores them.
 */
export function SurveyFieldNotes({
  details,
  stations,
  onChange,
  onHeights,
}: {
  details: SurveyBookSoftree
  stations: readonly FieldNoteStation[]
  onChange: (next: SurveyBookSoftree) => void
  /** HI or HT changed at a station: the caller moves the leg's rise with them, then stores the notes. */
  onHeights: (station: number, hi: number | null, ht: number | null) => void
}) {
  const [open, setOpen] = useState<number | null>(null)
  const unit = Math.abs(details.unitM - 1) < 1e-9 ? 'm' : 'ft'
  const culvertFormat = details.sourceFormat
  const byStation = new Map(details.extras.map((e) => [e.station, e]))
  // Stations of the notes the traverse CSV no longer lists are still shown, by number.
  const listed = new Map(stations.map((s) => [s.index, s]))
  for (const e of details.extras)
    if (!listed.has(e.station))
      listed.set(e.station, { index: e.station, name: `Station ${e.station}`, fieldStation: NaN })
  const all = [...listed.values()].sort((a, b) => a.index - b.index)
  const noted = all.filter((s) => hasNotes(byStation.get(s.index)) || open === s.index)
  const culverts = details.extras.filter((e) => e.culvert).length
  const nameOf = (s: FieldNoteStation) => (s.index === 0 ? 'Start' : s.name || `Station ${s.index}`)
  const put = (index: number, change: (e: SoftreeStationExtras) => SoftreeStationExtras) => {
    const current = byStation.get(index) ?? { station: index }
    const next = change({ ...current })
    const extras = [...details.extras.filter((e) => e.station !== index), next].sort((a, b) => a.station - b.station)
    onChange({ ...details, extras })
  }
  const summary = [
    `${noted.length} station${noted.length === 1 ? '' : 's'}`,
    culverts ? `${culverts} culvert${culverts === 1 ? '' : 's'}` : '',
    details.points.length ? `${details.points.length} located point${details.points.length === 1 ? '' : 's'}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <ToolDisclosure
      label="Field notes"
      summary={summary}
      defaultOpen
      toggleProps={{ 'data-testid': 'road-survey-field-notes-toggle' }}
      help={
        <>
          What the traverse file held beyond legs and side shots, by station. Every traverse file format written from
          this field book carries the notes it has a field for, and the export notice names the rest. Lengths are in the
          file&apos;s unit ({unit}); culvert sizes in millimetres.
        </>
      }
    >
      <div className="space-y-2" data-testid="road-survey-field-notes">
        {noted.length ? (
          <ul className={cn(insetBox({ padding: 'none', hoverRows: true }), 'divide-y')}>
            {noted.map((s) => {
              const e = byStation.get(s.index)
              const expanded = open === s.index
              return (
                <li key={s.index} data-testid={`road-survey-field-note-${s.index}`}>
                  <button
                    type="button"
                    className="flex w-full flex-wrap items-center gap-1 px-2 py-1.5 text-left text-xs"
                    aria-expanded={expanded}
                    aria-label={`Field notes at station ${nameOf(s)}`}
                    onClick={() => setOpen(expanded ? null : s.index)}
                  >
                    <span className="mr-1 font-medium tabular-nums">{nameOf(s)}</span>
                    {s.index === 0 && Number.isFinite(s.fieldStation) && (
                      <span className="mr-1 tabular-nums text-muted-foreground">{two(s.fieldStation)}</span>
                    )}
                    <NoteBadges
                      notes={e}
                      unit={unit}
                      culvertMm={e?.culvert ? culvertMm(e, culvertFormat, details.unitM) : null}
                    />
                  </button>
                  {expanded && (
                    <StationNotes
                      station={s}
                      notes={e ?? { station: s.index }}
                      unit={unit}
                      showLabel2={culvertFormat === 'asc' || culvertFormat === 'ipd' || !!e?.label2}
                      culvert={e?.culvert ? culvertInMetres(e.culvert, culvertFormat, details.unitM) : null}
                      onChange={(change) => put(s.index, change)}
                      onCulvert={(m) =>
                        put(s.index, (x) => {
                          if (!m) {
                            delete x.culvert
                            return x
                          }
                          const c = culvertFromMetres(m, culvertFormat, details.unitM)
                          return { ...x, culvert: c }
                        })
                      }
                      onHeights={(hi, ht) => onHeights(s.index, hi, ht)}
                      onRemove={() => {
                        setOpen(null)
                        onChange({ ...details, extras: details.extras.filter((x) => x.station !== s.index) })
                      }}
                    />
                  )}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-2xs text-muted-foreground">No station has field notes.</p>
        )}
        <Field label="Add field notes at">
          <RoadSelect
            ariaLabel="Add field notes at"
            className={roadFieldClass}
            value=""
            placeholder="Choose a station"
            searchable
            onValueChange={(value) => setOpen(Number(value))}
            options={all
              .filter((s) => !hasNotes(byStation.get(s.index)) && Number.isFinite(s.fieldStation))
              .map((s) => ({ value: String(s.index), label: nameOf(s) }))}
          />
        </Field>
        {!!details.points.length && (
          <div className="space-y-1" data-testid="road-survey-located-points">
            <p className="text-xs font-medium">Located points</p>
            <ul className={cn(insetBox({ padding: 'none' }), 'divide-y text-2xs')}>
              {details.points.map((p, i) => (
                <li key={i} className="flex flex-wrap gap-x-2 px-2 py-1">
                  <span className="font-medium">{p.id}</span>
                  <span className="text-muted-foreground">from {p.from}</span>
                  <span className="tabular-nums">
                    E {two(p.coordinate[0])} · N {two(p.coordinate[1])} · Z {two(p.coordinate[2])} m
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </ToolDisclosure>
  )
}

const culvertMm = (e: SoftreeStationExtras, format: SurveyBookSoftree['sourceFormat'], unitM: number) => {
  const m = culvertInMetres(e.culvert!, format, unitM)
  return { y: mm(m.sizeYM), x: mm(m.sizeXM) }
}

/** One row's notes at a glance. */
function NoteBadges({
  notes,
  unit,
  culvertMm: size,
}: {
  notes: SoftreeStationExtras | undefined
  unit: string
  culvertMm: { y: number | null; x: number | null } | null
}) {
  if (!notes) return null
  const ground = (notes.ground ?? []).filter((g) => g.type || g.depth !== null)
  const sideDepths = notes.sideShots?.filter((s) => s.depths.some((d) => d !== null)).length ?? 0
  return (
    <>
      {notes.label && (
        <Badge variant="outline" size="xs">
          {notes.label}
        </Badge>
      )}
      {size && (
        <Badge tone="cyan" size="xs">
          Culvert {size.x === null ? `${size.y ?? '?'} mm` : `${size.x ?? '?'} × ${size.y ?? '?'} mm`}
        </Badge>
      )}
      {!!ground.length && (
        <Badge size="xs">
          {ground.map((g) => `${g.type || '—'}${g.depth === null ? '' : ` ${two(g.depth)}`}`).join(' / ')}
        </Badge>
      )}
      {(notes.hi != null || notes.ht != null) && (
        <Badge size="xs">
          HI {notes.hi == null ? '—' : two(notes.hi)} · HT {notes.ht == null ? '—' : two(notes.ht)} {unit}
        </Badge>
      )}
      {!!sideDepths && (
        <Badge variant="outline" size="xs">
          {sideDepths} side-shot depth{sideDepths === 1 ? '' : 's'}
        </Badge>
      )}
    </>
  )
}

/** One station's notes, open for correction. */
function StationNotes({
  station,
  notes,
  unit,
  showLabel2,
  culvert,
  onChange,
  onCulvert,
  onHeights,
  onRemove,
}: {
  station: FieldNoteStation
  notes: SoftreeStationExtras
  unit: string
  showLabel2: boolean
  culvert: CulvertMetres | null
  onChange: (change: (e: SoftreeStationExtras) => SoftreeStationExtras) => void
  onCulvert: (m: CulvertMetres | null) => void
  onHeights: (hi: number | null, ht: number | null) => void
  onRemove: () => void
}) {
  const at = `at ${station.index === 0 ? 'the start' : station.name}`
  const text = (key: 'label' | 'label2', value: string) =>
    onChange((e) => {
      if (value) e[key] = value
      else delete e[key]
      return e
    })
  const ground = [0, 1, 2].map((k) => notes.ground?.[k] ?? { type: '', depth: null })
  const setGround = (k: number, layer: { type: string; depth: number | null }) =>
    onChange((e) => {
      const next = [...ground]
      next[k] = layer
      while (next.length && !next[next.length - 1].type && next[next.length - 1].depth === null) next.pop()
      if (next.length) e.ground = next
      else delete e.ground
      return e
    })
  const sideDepths = (notes.sideShots ?? []).filter((s) => s.depths.some((d) => d !== null))
  const beyond = notes.extensionSlope
  return (
    <div className="space-y-2 border-t px-2 pb-2 pt-2" data-testid="road-survey-station-notes">
      <Field label="Label">
        <input
          className={roadFieldClass}
          aria-label={`Label ${at}`}
          value={notes.label ?? ''}
          maxLength={200}
          onChange={(event) => text('label', event.target.value)}
        />
      </Field>
      {showLabel2 && (
        <Field label="Between-station label" hint="Softree ASCII's second label, kept for older files.">
          <input
            className={roadFieldClass}
            aria-label={`Between-station label ${at}`}
            value={notes.label2 ?? ''}
            maxLength={200}
            onChange={(event) => text('label2', event.target.value)}
          />
        </Field>
      )}
      <Field
        label="Ground layers"
        hint={`From the top: a two-character type and the layer's depth at the centreline, in ${unit === 'm' ? 'metres' : 'feet'}. The third layer has no depth.`}
      >
        <div className="space-y-1">
          {ground.map((layer, k) => (
            <div key={k} className="grid grid-cols-[4rem_1fr] items-end gap-2">
              <input
                className={roadFieldClass}
                aria-label={`Layer ${k + 1} type ${at}`}
                value={layer.type}
                maxLength={20}
                placeholder={`Layer ${k + 1}`}
                onChange={(event) => setGround(k, { ...layer, type: event.target.value.toUpperCase() })}
              />
              {k < 2 ? (
                <OptionalNumberField
                  label={`Layer ${k + 1} depth (${unit})`}
                  hideLabel
                  value={layer.depth}
                  min={0}
                  max={1000}
                  step={0.05}
                  placeholder="no depth"
                  onChange={(depth) => setGround(k, { ...layer, depth })}
                />
              ) : (
                <span />
              )}
            </div>
          ))}
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        {(['hi', 'ht'] as const).map((key) => (
          <OptionalNumberField
            key={key}
            label={`${key === 'hi' ? 'HI' : 'HT'} (${unit})`}
            value={notes[key] ?? null}
            min={-100}
            max={100}
            step={0.01}
            placeholder="none"
            hint={
              key === 'hi'
                ? "Height of instrument and of target on the foreshot from this station. The leg's rise is the slope reading plus HI minus HT, so changing either moves the leg's grade and keeps the reading as taken."
                : undefined
            }
            onChange={(value) =>
              onHeights(key === 'hi' ? value : (notes.hi ?? null), key === 'ht' ? value : (notes.ht ?? null))
            }
          />
        ))}
      </div>
      {culvert ? (
        <div className={cn(insetBox({ padding: 'sm', tone: 'muted' }), 'space-y-2')} data-testid="road-survey-culvert">
          <div className="grid grid-cols-2 gap-2">
            <OptionalNumberField
              label="Diameter or height (mm)"
              value={mm(culvert.sizeYM)}
              min={0}
              max={20000}
              step={50}
              placeholder="not given"
              onChange={(v) => onCulvert({ ...culvert, sizeYM: v === null ? null : v / 1000 })}
            />
            <OptionalNumberField
              label="Box width (mm)"
              value={mm(culvert.sizeXM)}
              min={0}
              max={20000}
              step={50}
              placeholder="pipe"
              hint="Blank for a pipe. A box culvert has a width and a height."
              onChange={(v) => onCulvert({ ...culvert, sizeXM: v === null ? null : v / 1000 })}
            />
            <OptionalNumberField
              label="Gradient (%)"
              value={culvert.gradientPercent}
              min={-100}
              max={100}
              step={0.5}
              placeholder="not given"
              onChange={(v) => onCulvert({ ...culvert, gradientPercent: v })}
            />
            <OptionalNumberField
              label="Downstream azimuth (°)"
              value={culvert.azimuth}
              min={0}
              max={360}
              step={1}
              placeholder="not given"
              onChange={(v) => onCulvert({ ...culvert, azimuth: v })}
            />
          </div>
          <Field label="Downstream direction">
            <RoadSelect
              ariaLabel={`Culvert direction ${at}`}
              className={roadFieldClass}
              value={culvert.flag === null ? '' : String(culvert.flag)}
              onValueChange={(v) => onCulvert({ ...culvert, flag: v === '' ? null : Number(v) })}
              options={
                culvert.flag !== null && !ORIENTATIONS.some((o) => o.value === String(culvert.flag))
                  ? [...ORIENTATIONS, { value: String(culvert.flag), label: `Code ${culvert.flag}` }]
                  : ORIENTATIONS
              }
            />
          </Field>
          <Button size="xs" variant="ghost" onClick={() => onCulvert(null)}>
            Remove culvert
          </Button>
        </div>
      ) : (
        <Button size="xs" variant="outline" className="w-full" onClick={() => onCulvert({ ...EMPTY_CULVERT })}>
          Add culvert
        </Button>
      )}
      {(sideDepths.length > 0 || beyond || notes.backshot != null) && (
        <p className="text-2xs text-muted-foreground">
          {[
            sideDepths.length
              ? `Side-shot depths (${unit}): ${sideDepths
                  .map(
                    (s) =>
                      `${s.side === 'left' ? 'L' : 'R'}${s.n} ${s.depths.map((d) => (d === null ? '—' : two(d))).join(' / ')}`,
                  )
                  .join(', ')}.`
              : '',
            beyond
              ? `Ground beyond the last side shot: ${[
                  beyond.left !== undefined ? `${beyond.left}% left` : '',
                  beyond.right !== undefined ? `${beyond.right}% right` : '',
                ]
                  .filter(Boolean)
                  .join(', ')}.`
              : '',
            notes.backshot != null ? `Backshot ${notes.backshot}°.` : '',
          ]
            .filter(Boolean)
            .join(' ')}
        </p>
      )}
      <Button size="xs" variant="ghost" onClick={onRemove}>
        Remove notes {at}
      </Button>
    </div>
  )
}
