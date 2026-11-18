import { useEffect, useMemo, useState } from 'react'
import { PrintedPreparer } from '@/branding/PreparerProfile'
import { MapSheetOutput } from '@/components/ui/map-sheet-output'
import { MapSheetSetup } from '@/components/ui/map-sheet-setup'
import { blockFacts } from '@/lib/forestry/blockSheet/blockFacts'
import { sheetSetupFields } from '@/lib/forestry/blockSheet/setupFields'
import {
  MAX_SHEET_COMMENTS_LENGTH,
  SHEET_KINDS,
  SHEET_PRESETS,
  type SheetFields,
} from '@/lib/forestry/blockSheet/sheets'
import { visualsSheetStyleChoices } from './mapStyleSamples'
import {
  changeVisualsSheetSettings,
  DEFAULT_VISUALS_SHEET,
  effectiveSheetFields,
  parseVisualsSheetSettings,
  SHEET_SYMBOLS_STYLE,
  visualsSheetBlocks,
  VISUALS_SHEET_FORMATS,
  visualsSeriesBlocks,
  visualsSheetLabel,
  visualsSheetOutputPlan,
  visualsSheetUnavailable,
  type VisualsSheetScene,
  type VisualsSheetSettings,
} from './visualsBlockSheet'

export const VISUALS_SHEET_STORAGE_KEY = 'pgmaps.forestryVisuals.blockSheet'

function stored(): VisualsSheetSettings {
  try {
    const text = window.localStorage.getItem(VISUALS_SHEET_STORAGE_KEY)
    return text ? parseVisualsSheetSettings(JSON.parse(text)) : DEFAULT_VISUALS_SHEET
  } catch {
    return DEFAULT_VISUALS_SHEET
  }
}

/**
 * The block map sheet's settings on the visual quality page: kept per browser, as the road designer
 * keeps its own, so the typed fields survive a reload. Only state: the export hook calls it on every
 * render of the page, so everything read from the scene waits for the dialog to be open.
 */
export function useVisualsSheetSettings() {
  const [settings, setSettings] = useState<VisualsSheetSettings>(stored)
  useEffect(() => {
    try {
      window.localStorage.setItem(VISUALS_SHEET_STORAGE_KEY, JSON.stringify(settings))
    } catch {
      // Storage may be blocked; the settings still apply for this tab.
    }
  }, [settings])
  return [settings, setSettings] as const
}

/**
 * The sheet's options in Save & export: which sheet, paper, scale and block, the map style, and the
 * fields it prints. A blank F.L., CP or Forest District shows and prints the FS1252 office field
 * (`office`); `settings.block` is the block in effect (`visualsSheetBlockId`). Under them, *File*
 * (`MapSheetOutput`): one sheet per block, which blocks and in what order, the file names in a ZIP,
 * and the mask outside the block. The format is the dialog's chips, so the form does not show it.
 */
export function VisualsBlockSheetForm({
  scene,
  office,
  settings,
  onChange,
  portalContainer,
}: {
  scene: VisualsSheetScene
  office: SheetFields
  settings: VisualsSheetSettings
  onChange: (settings: VisualsSheetSettings) => void
  portalContainer?: HTMLElement | null
}) {
  const blocks = useMemo(() => visualsSheetBlocks(scene), [scene])
  const seriesBlocks = useMemo(() => visualsSeriesBlocks(scene), [scene])
  // Ids chosen earlier that the scene no longer has are never ticked or printed; they are kept until the blocks are
  // ticked again (another scene opened in this browser may have them), and the form says how many.
  const plan = visualsSheetOutputPlan(scene, settings.output)
  const geometry = scene.targets.find((target) => target.id === settings.block && target.role === 'block')?.geometry
  const facts = useMemo(() => {
    try {
      return geometry ? blockFacts(geometry) : null
    } catch {
      return null
    }
  }, [geometry])
  const preset = SHEET_PRESETS[settings.kind]
  // What the form shows is what prints: a typed value, else the office field.
  const shownFields = effectiveSheetFields(settings.fields, office)
  return (
    <div className="grid gap-2" data-testid="visuals-block-sheet-setup">
      <MapSheetSetup
        value={{ ...settings, fields: shownFields as Record<string, string> }}
        onChange={(value) => {
          // A field still showing its office value stays the office's: only what was typed is kept.
          const typed = Object.fromEntries(
            Object.entries(value.fields).filter(([id, text]) => text !== (office as Record<string, string>)[id]),
          )
          onChange(
            changeVisualsSheetSettings(
              settings,
              parseVisualsSheetSettings({
                ...value,
                fields: typed,
                block: settings.block,
                style: settings.style,
                output: settings.output,
              }),
            ),
          )
        }}
        kinds={SHEET_KINDS.map((kind) => ({
          value: kind,
          label: visualsSheetLabel(kind),
          description: SHEET_PRESETS[kind].description,
          unavailable: visualsSheetUnavailable(kind),
        }))}
        areas={blocks.length ? blocks : [{ value: '', label: 'No block in the scene' }]}
        area={settings.block}
        onArea={(value) => onChange({ ...settings, block: value })}
        fields={sheetSetupFields(settings.kind, facts, 'read when the sheet is written')}
        styles={visualsSheetStyleChoices()}
        style={settings.style}
        onStyle={(style) => onChange({ ...settings, style })}
        styleHint={
          settings.style === SHEET_SYMBOLS_STYLE
            ? 'The block sheets’ own symbols. Choose a figure style to draw the landform, blocks, openings, private land and rock as that style’s analysis sheet does.'
            : 'The landform, blocks, openings, private land and rock draw with this figure style’s symbols where it has one, on the map and in the legend.'
        }
        commentsLabel={preset.comments ? 'Block access comments' : undefined}
        commentsMaxLength={MAX_SHEET_COMMENTS_LENGTH}
      />
      <div className="grid gap-1.5" data-testid="visuals-block-sheet-output">
        <h5 className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">File</h5>
        <MapSheetOutput
          value={settings.output}
          onChange={(output) => onChange({ ...settings, output })}
          blocks={seriesBlocks}
          formats={VISUALS_SHEET_FORMATS}
          showFormat={false}
        />
        {plan.series && plan.stale > 0 && (
          <p className="text-xs text-muted-foreground">
            {plan.stale === 1 ? 'A block' : `${plan.stale} blocks`} chosen earlier {plan.stale === 1 ? 'is' : 'are'} no
            longer in the scene and {plan.stale === 1 ? 'is' : 'are'} left out.
          </p>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        A blank F.L., CP or Forest District prints the FS1252 office field. In a series, the typed fields and comments
        take the same tokens as the file names, filled for each block. These settings, the format included, are kept in
        this browser.
      </p>
      <PrintedPreparer portalContainer={portalContainer} />
    </div>
  )
}
