import { useEffect, useState, type ReactNode } from 'react'
import { PAPER_SIZES, type PaperId } from '@/lib/mapSheet/layout'
import { formatScale, MAX_SHEET_SCALE } from '@/lib/mapSheet/scale'
import { Field, NumberField, roadFieldClass, RoadSelect } from './Controls'
import {
  DEFAULT_MAP_PDF,
  isAsShown,
  MAP_PDF_FRAMES,
  MAP_PDF_MARGINS,
  MAP_PDF_ORIENTATIONS,
  MAP_PDF_SCALE_PRESETS,
  MIN_MAP_PDF_SCALE,
  parseMapPdfSettings,
  type MapPdfFrame,
  type MapPdfOrientation,
  type MapPdfSettings,
} from './mapPdfFrame'

const STORAGE_KEY = 'pgmaps.forestryRoads.mapPdf'
/** A typed scale's first value when *Type a scale* is picked from fit. */
const FIRST_TYPED_SCALE = 15000

function stored(): MapPdfSettings {
  try {
    const text = window.localStorage.getItem(STORAGE_KEY)
    return text ? parseMapPdfSettings(JSON.parse(text)) : DEFAULT_MAP_PDF
  } catch {
    return DEFAULT_MAP_PDF
  }
}

/** The Map PDF's options, kept in this browser like the block sheet's; never in the project. */
export function useMapPdfSettings() {
  const [settings, setSettings] = useState<MapPdfSettings>(stored)
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch {
      // Storage may be blocked; the settings still apply for this tab.
    }
  }, [settings])
  return [settings, setSettings] as const
}

/**
 * Save & export → Map PDF → **Options**: the paper, what the page frames and at what scale. The
 * default (A4, the plan as shown) prints the plan as it always did; anything else prints a north-up,
 * georeferenced frame at a stated scale (`mapPdfFrame.ts`). `roadColouring` is the page's own road
 * colour controls (`RoadColouringFields`): the PDF prints the plan, so they change both.
 */
export function MapPdfOptions({
  value,
  onChange,
  blocks,
  roadColouring,
}: {
  value: MapPdfSettings
  onChange: (value: MapPdfSettings) => void
  /** The block sheet's own block list. */
  blocks: readonly { value: string; label: string }[]
  roadColouring?: ReactNode
}) {
  const set = (patch: Partial<MapPdfSettings>) => onChange({ ...value, ...patch })
  const asShown = isAsShown(value)
  const view = value.frame === 'view'
  const scaleChoice =
    value.scale === 'fit' ? 'fit' : MAP_PDF_SCALE_PRESETS.includes(value.scale) ? String(value.scale) : 'typed'
  const block = blocks.some((entry) => entry.value === value.block) ? value.block : (blocks[0]?.value ?? '')
  return (
    <div className="grid gap-3" data-testid="road-map-pdf-options">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Frames">
          <RoadSelect
            ariaLabel="Frames"
            className={roadFieldClass}
            value={value.frame}
            onValueChange={(frame) => set({ frame: frame as MapPdfFrame })}
            options={MAP_PDF_FRAMES.map((entry) => ({
              value: entry.value,
              label: entry.label,
              disabled: entry.value === 'block' && !blocks.length,
            }))}
          />
        </Field>
        {value.frame === 'block' && (
          <Field label="Block" hint="The block sheet’s own list: harvest areas and imported reference areas.">
            <RoadSelect
              ariaLabel="Block"
              className={roadFieldClass}
              value={block}
              onValueChange={(chosen) => set({ block: chosen })}
              options={blocks.map((entry) => ({ value: entry.value, label: entry.label }))}
            />
          </Field>
        )}
        <Field label="Paper">
          <RoadSelect
            ariaLabel="Paper"
            className={roadFieldClass}
            value={value.paper}
            onValueChange={(paper) => set({ paper: paper as PaperId })}
            options={(Object.keys(PAPER_SIZES) as PaperId[]).map((paper) => ({
              value: paper,
              label: PAPER_SIZES[paper].label,
            }))}
          />
        </Field>
        <Field label="Orientation">
          <RoadSelect
            ariaLabel="Orientation"
            className={roadFieldClass}
            value={value.orientation}
            onValueChange={(orientation) => set({ orientation: orientation as MapPdfOrientation })}
            options={MAP_PDF_ORIENTATIONS}
          />
        </Field>
        <Field label="Scale">
          <RoadSelect
            ariaLabel="Scale"
            className={roadFieldClass}
            value={scaleChoice}
            onValueChange={(choice) =>
              set({
                scale:
                  choice === 'fit'
                    ? 'fit'
                    : choice === 'typed'
                      ? value.scale === 'fit'
                        ? FIRST_TYPED_SCALE
                        : value.scale
                      : Number(choice),
              })
            }
            options={[
              { value: 'fit', label: view ? 'The plan’s own zoom' : 'Fit to the frame' },
              ...MAP_PDF_SCALE_PRESETS.map((scale) => ({ value: String(scale), label: formatScale(scale) })),
              { value: 'typed', label: 'Type a scale…' },
            ]}
          />
        </Field>
        {scaleChoice === 'typed' && value.scale !== 'fit' && (
          <NumberField
            label="Scale 1:"
            value={value.scale}
            min={MIN_MAP_PDF_SCALE}
            max={MAX_SHEET_SCALE}
            step={1}
            updateOn="commit"
            hint={`From ${formatScale(MIN_MAP_PDF_SCALE)} to ${formatScale(MAX_SHEET_SCALE)}, true at the frame’s centre latitude.`}
            onChange={(scale) => set({ scale: Math.round(scale) })}
          />
        )}
        {!view && value.scale === 'fit' && (
          <Field label="Margin" hint="Clear space round what is framed, on every side of the map.">
            <RoadSelect
              ariaLabel="Margin"
              className={roadFieldClass}
              value={String(value.marginPercent)}
              onValueChange={(margin) => set({ marginPercent: Number(margin) })}
              options={MAP_PDF_MARGINS.map((margin) => ({ value: String(margin), label: `${margin} %` }))}
            />
          </Field>
        )}
      </div>
      {roadColouring && (
        <fieldset className="grid gap-2 border-t pt-3" data-testid="road-map-pdf-road-colours">
          <legend className="sr-only">Road colours</legend>
          {roadColouring}
        </fieldset>
      )}
      <p className="text-xs text-muted-foreground" data-testid="road-map-pdf-options-summary">
        {asShown
          ? 'The plan as it is shown now, turned and tilted as it is, fitted to the page. It is georeferenced only when the plan is north-up and flat, without 3D terrain.'
          : `The plan turns north-up and flat, moves to ${
              view ? 'the same centre' : 'the frame'
            } and draws at the stated scale while the PDF is made, then is put back. The page prints the scale and a scale bar and is georeferenced in Web Mercator, so Avenza and QGIS place it. The map prints at the plan’s detail: a larger plan panel prints sharper.`}
      </p>
    </div>
  )
}
