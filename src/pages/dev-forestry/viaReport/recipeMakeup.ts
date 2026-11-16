/**
 * What a VIA report recipe is made of, in words, for Save & export's draft and the package's recipe: the document
 * format whose arithmetic, scales and wording it reads, the figure style its pictures are drawn in, its paper, cover
 * and contents, its options, its oblique renders and overview sheet, and its parts in order with the reference
 * documents each comes from. Read from the recipe and the catalogues it names; never a copied value. No DOM or network
 * access.
 */
import { VIA_STYLE_PRESETS } from '@/lib/forestry/viaFigure/presets'

import { DEFAULT_OVERVIEW_SHEET_STYLE, OVERVIEW_SHEET_STYLES } from '../reportMaps'
import { VIA_DOCUMENT_FORMATS } from '../viaDocument/formats'
import { DEFAULT_OBLIQUE_PITCH, REPORT_RECIPES, type ReportRecipe } from './recipes'
import { REPORT_PARTS } from './registry'
import { RECIPE_OPTION_FIELDS } from './userRecipes'

const WORDING_NAMES: Record<string, string> = {
  'perspective-report': 'Consultant perspective report (22, 23)',
  'form-2001': '2001 guidebook form (01, 03, 05)',
  'appendix-1': 'Handbook Appendix 1 (06, 07)',
  referral: 'Referral memo (26)',
  'comparison-strip': 'Board comparison (21)',
  'district-summary': 'District summary table (02)',
  'calculation-on-photo': 'Calculation on the photograph',
}

export type MakeupRow = { label: string; value: string }

/** The recipe's whole makeup as labelled rows: format, arithmetic, scales, wording, figure style, layout, options. */
export function recipeMakeup(recipe: ReportRecipe): MakeupRow[] {
  const format = VIA_DOCUMENT_FORMATS.find((entry) => entry.id === recipe.format)
  const styleId = recipe.figureStyle ?? format?.style ?? null
  const style = styleId ? VIA_STYLE_PRESETS.find((preset) => preset.id === styleId) : null
  const layout = { paper: 'letter', cover: false, contents: false, ...recipe.layout }
  const basedOn = recipe.own?.basedOn ? REPORT_RECIPES.find((entry) => entry.id === recipe.own!.basedOn) : null
  const options = RECIPE_OPTION_FIELDS.flatMap((field) => {
    const value = recipe.options?.[field.key]
    if (value === undefined) return []
    if (field.kind === 'flag') return value === field.whenAbsent ? [] : [`${field.label}: ${value ? 'on' : 'off'}`]
    if (field.kind === 'choice')
      return value === field.whenAbsent
        ? []
        : [`${field.label}: ${field.choices.find((choice) => choice.value === value)?.label ?? String(value)}`]
    return [`${field.label}: ${String(value)}`]
  })
  const sheet = OVERVIEW_SHEET_STYLES.find(
    (entry) => entry.id === (recipe.overviewSheetStyle ?? DEFAULT_OVERVIEW_SHEET_STYLE),
  )
  return [
    ...(recipe.own
      ? [
          {
            label: 'Recipe',
            value: `Your own${basedOn ? `, copied from ${basedOn.name} (${basedOn.sources.join(', ')})` : ''}`,
          },
        ]
      : [
          {
            label: 'Follows',
            value: `Reference document${recipe.sources.length > 1 ? 's' : ''} ${recipe.sources.join(', ')}`,
          },
        ]),
    {
      label: 'Document format',
      value: format ? `${format.name} (${format.sources.join(', ')})` : `Unknown: ${recipe.format}`,
    },
    ...(format
      ? [
          {
            label: 'Percent alteration',
            value: `${format.rule.formula}, on the ${format.rule.basis}, ${format.rule.decimals} dp`,
          },
          { label: 'Scales', value: `${format.percentScale.name}; ${format.distanceScale.name}` },
          { label: 'Wording', value: WORDING_NAMES[format.wording] ?? format.wording },
        ]
      : []),
    {
      label: 'Figure style',
      value: style ? `${style.name}${recipe.figureStyle ? '' : ', the format’s'}` : 'PGMaps’ default',
    },
    {
      label: 'Paper',
      value: `${layout.paper === 'legal' ? 'Legal' : 'Letter'}${layout.cover ? ', cover' : ''}${layout.contents ? ', contents' : ''}`,
    },
    ...(recipe.parts.includes('overhead-renders')
      ? [{ label: 'Oblique renders', value: `${recipe.obliquePitch ?? DEFAULT_OBLIQUE_PITCH}° map pitch` }]
      : []),
    ...(recipe.parts.includes('overview-sheet') ? [{ label: 'Overview sheet', value: sheet?.label ?? '' }] : []),
    ...(options.length ? [{ label: 'Options', value: options.join('; ') }] : []),
  ]
}

/** Every shared part, for the editor's Add list: its title and the references it comes from, by title. */
export function partCatalogue(): Array<{ id: string; title: string; sources: readonly string[] }> {
  return REPORT_PARTS.map((part) => ({ id: part.id, title: part.title, sources: part.sources })).sort(
    (a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
  )
}

/** A part's name for a list: its title, with its id when another part shares the title. */
export function partLabel(id: string): string {
  const part = REPORT_PARTS.find((entry) => entry.id === id)
  if (!part) return id
  const shared = REPORT_PARTS.filter((entry) => entry.title === part.title).length > 1
  return shared ? `${part.title} (${id})` : part.title
}
