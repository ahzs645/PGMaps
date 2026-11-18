import { useEffect, useMemo, useState } from 'react'
import { PrintedPreparer } from '@/branding/PreparerProfile'
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
  visualsSheetLabel,
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
 * (`office`); `settings.block` is the block in effect (`visualsSheetBlockId`).
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
              parseVisualsSheetSettings({ ...value, fields: typed, block: settings.block, style: settings.style }),
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
      <p className="text-xs text-muted-foreground">
        A blank F.L., CP or Forest District prints the FS1252 office field. These settings are kept in this browser.
      </p>
      <PrintedPreparer portalContainer={portalContainer} />
    </div>
  )
}
