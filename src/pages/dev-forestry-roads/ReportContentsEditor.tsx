import { useState, type ReactNode } from 'react'
import { DocumentContents } from '@/components/ui/document-contents'
import { SelectField } from '@/components/ui/form-field'
import { useSavedContents } from '@/components/ui/use-saved-contents'
import { ON_OFF, partPrints } from '@/lib/documentContents/contents'
import {
  applySavedContents,
  matchingSavedContents,
  savedContentsPresets,
  type SavedContents,
} from '@/lib/documentContents/savedContents'
import {
  ALWAYS_PRINTED_SECTIONS,
  matchingReportPreset,
  omittedFromStates,
  REPORT_CONTENTS_PRESETS,
  reportContentsFromSaved,
  reportContentsParts,
  storedSectionOrder,
  type ReportSectionsUnavailable,
} from './reportContents'
import { createRoadReportSettings, parseRoadReportSettings, type RoadReportSettings } from './reportSettings'

/** The browser's saved presets for the report's sections (`useSavedContents`). */
const REPORT_SECTIONS_LIST_ID = 'road-report-sections'

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * The report's contents (`DocumentContents`): the parts that open every report locked in their
 * places, then each section in print order, on or off, with its reason when this road gives it
 * nothing to print. Rows move by drag, Alt and an arrow, or their menu; presets are built in or the
 * person's own (saved in this browser). Saved with the project's report settings (`omittedSections`,
 * `sectionOrder`). `preview` is drawn beside the list; `focus` rings one row, e.g. after its heading
 * was clicked in the preview.
 */
export function ReportContentsEditor({
  value,
  onChange,
  focus,
  baselineRoads,
  unavailable,
  preview,
  selected,
  onSelect,
}: {
  /** Roads that may hold the issued design for the record of changes; none hides the choice. */
  baselineRoads?: { id: string; name: string }[]
  value?: RoadReportSettings
  onChange: (settings: RoadReportSettings) => void
  focus?: string
  /** Why a section has nothing to print for this road (`reportSectionsUnavailable`). */
  unavailable?: ReportSectionsUnavailable
  /** The report's preview, drawn beside the list. */
  preview?: ReactNode
  /** The row whose part the preview shows. */
  selected?: string | null
  onSelect?: (key: string | null) => void
}) {
  const settings = value ?? createRoadReportSettings()
  const omitted = settings.omittedSections ?? []
  const store = useSavedContents(REPORT_SECTIONS_LIST_ID)
  // The preset last chosen here, so a later change reads as "modified" and Reset goes back to it.
  const [chosen, setChosen] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const parts = reportContentsParts(settings, unavailable)
  const write = (changes: Pick<RoadReportSettings, 'omittedSections' | 'sectionOrder'>) => {
    const next: RoadReportSettings = { ...settings, ...changes }
    if (!next.omittedSections?.length) delete next.omittedSections
    if (!next.sectionOrder) delete next.sectionOrder
    onChange(parseRoadReportSettings(next))
  }
  const setStates = (changes: Record<string, string>) =>
    write({ omittedSections: omittedFromStates(omitted, changes), sectionOrder: settings.sectionOrder })
  const builtIn = REPORT_CONTENTS_PRESETS.map((preset) => ({ id: preset.id, label: preset.label }))
  const savedPresets = savedContentsPresets(store.saved)
  const match =
    matchingReportPreset(omitted, settings.sectionOrder) ?? matchingSavedContents(store.saved, parts, ON_OFF)
  const chosenExists = !!chosen && [...builtIn, ...savedPresets].some((preset) => preset.id === chosen)
  const apply = (id: string) => {
    const own = REPORT_CONTENTS_PRESETS.find((preset) => preset.id === id)
    if (own) {
      setNote(null)
      write({ omittedSections: [...own.omitted], sectionOrder: undefined })
      return
    }
    const saved: SavedContents | undefined = store.saved.find((preset) => preset.id === id)
    if (!saved) return
    const applied = applySavedContents(saved, parts, ON_OFF)
    setNote(
      applied.unknown.length
        ? `This preset names ${plural(applied.unknown.length, 'part')} this version does not have (${applied.unknown.join(', ')}); left as they are.`
        : null,
    )
    write(reportContentsFromSaved({ states: applied.states, order: applied.order }, settings))
  }
  const sections = parts.filter((part) => !part.locked)
  const printing = sections.filter((part) => partPrints(part, ON_OFF)).length
  const empty = sections.filter((part) => part.unavailable).length
  const summary = `${printing === sections.length ? 'Every section prints' : `${printing} of ${sections.length} sections print`}${
    empty ? `; ${plural(empty, 'section has', 'sections have')} nothing to print for this road` : ''
  }.`
  return (
    <DocumentContents
      data-testid="road-report-contents"
      subject="the report"
      className="h-full"
      parts={parts}
      onState={(key, state) => setStates({ [key]: state })}
      onStates={setStates}
      onMove={(_key, _to, order) =>
        write({ omittedSections: settings.omittedSections, sectionOrder: storedSectionOrder(order) })
      }
      onResetOrder={
        settings.sectionOrder
          ? () => write({ omittedSections: settings.omittedSections, sectionOrder: undefined })
          : undefined
      }
      presets={{
        options: [...builtIn, ...savedPresets],
        value: match ?? (chosenExists ? chosen : null),
        modified: !match && chosenExists,
        onChoose: (id) => {
          setChosen(id)
          apply(id)
        },
        onReset: () => (chosenExists ? apply(chosen!) : apply(REPORT_CONTENTS_PRESETS[0].id)),
        onSaveAs: (name) => {
          const states = Object.fromEntries(sections.map((part) => [part.key, part.state]))
          const result = store.save(
            name,
            states,
            parts.map((part) => part.key),
          )
          if ('error' in result) setNote(result.error)
          else {
            setNote(null)
            setChosen(result.preset.id)
          }
        },
        onDelete: (id) => {
          store.remove(id)
          if (chosen === id) setChosen(null)
        },
      }}
      selected={selected}
      onSelect={onSelect}
      preview={preview}
      previewLabel="Whole report"
      focusKey={focus}
      summary={summary}
      help={
        <>
          Saved with the project and used by the HTML and PDF report, in this order. A print that leaves sections out
          lists them under its status line. Always printed: {ALWAYS_PRINTED_SECTIONS.join('; ')}. The first four open
          the report; the quantity basis and limitations may be moved. Your own presets are kept in this browser.
        </>
      }
      beside={
        <>
          {(note ?? store.writeError) && <p className="text-2xs text-warning">{note ?? store.writeError}</p>}
          {baselineRoads && baselineRoads.length > 0 && (
            <SelectField
              label="Issued design for the record of changes"
              hint="Keep the design as issued as a copy of the road (Duplicate road), edit the road to the field record, then choose the copy here."
              value={
                settings.recordBaselineId && baselineRoads.some((road) => road.id === settings.recordBaselineId)
                  ? settings.recordBaselineId
                  : ''
              }
              onChange={(event) => {
                const id = event.target.value
                const next: RoadReportSettings = { ...settings, recordBaselineId: id }
                if (!id) delete next.recordBaselineId
                onChange(parseRoadReportSettings(next))
              }}
            >
              <option value="">None: no comparison</option>
              {baselineRoads.map((road) => (
                <option key={road.id} value={road.id}>
                  {road.name}
                </option>
              ))}
            </SelectField>
          )}
        </>
      }
    />
  )
}
