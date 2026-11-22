/**
 * What a report part defined in JSON reads (`recipeJson/components/`): one plain data object built from the
 * `ReportContext` the part is given, holding only what those parts print. The JSON components read it as
 * `{{ facts.… }}` and say each value's provenance themselves (`source` on the row or block, as the code parts did);
 * where a value's provenance depends on the assessment, the fact is a pair `{ value, source }` and the component
 * prints both. A value nobody gave is `null`, never a guess: the component prints it blank and lists it to complete
 * in the same words a code part used. No DOM or network access.
 */
import { harvestYearLine, systemsLine } from './formLines'
import type { Provenance } from './model'
import { blank, generalLocationRow, preparerText, proposedBlocks, type ReportContext } from './parts'
import wording from './recipeJson/wording.json'

/** A value with where it came from, when that depends on the assessment. */
export interface Sourced {
  value: string | null
  source: Provenance
}

export interface ReportFacts {
  /** The FS1252 office information, trimmed; null when not given (scene). */
  office: {
    licensee: string | null
    licence: string | null
    cuttingPermit: string | null
    district: string | null
    /** A historical reference the reviewer read, printed only in the references: never the objective's authority. */
    referenceDocument: string | null
  }
  /** The evaluator as a sign-off names them: "Name, designation, organisation" (`preparerText`), scene. */
  preparer: string | null
  evaluator: {
    /** The evaluator's name alone, scene. */
    name: string | null
    /** Their designation, scene; a seal applied by hand is the reviewer's when none is given. */
    designation: Sourced
  }
  blocks: {
    /** The cover's block line: the office's block ids as given, else the proposed blocks' names (scene). */
    listed: string | null
    /** The forms' block line: the office's block ids, else every block's name (scene). */
    all: string | null
    /** The proposed silvicultural systems, each with its blocks when they differ (`systemsLine`, scene). */
    systems: string | null
    /** The proposed blocks' planned harvest years (`harvestYearLine`, scene); null when any is not recorded. */
    harvestYears: string | null
    /** Whether any block is proposed in this report (not another sale's). */
    proposed: boolean
  }
  /** The general location: the office field, else the named places read round the blocks (run). */
  generalLocation: Sourced
  /** The report's date, ISO (run). */
  date: string
  /** How the pictures were drawn, in words (run). */
  method: { terrain: string; vegetation: string }
  /** The visual inventory was read live for this report. */
  inventoryRead: boolean
  /** What the recipe being assembled prints that a part's wording depends on. */
  recipe: {
    /** The 2001 summary form's notes are printed: its header asks the year and type of operation. */
    summaryForm: boolean
  }
  /** Fixed wording several parts share, code and JSON alike (`recipeJson/wording.json`). */
  wording: typeof wording
}

/** The facts a JSON part reads, from the context it is built with. */
export function reportFacts(ctx: ReportContext): ReportFacts {
  const office = ctx.office
  const proposed = proposedBlocks(ctx)
  const designation = blank(office.evaluatorDesignation)
  const location = generalLocationRow(ctx)
  const text = (value: string | null | undefined) => (value === undefined || value === '' ? null : value)
  return {
    office: {
      licensee: blank(office.licensee),
      licence: blank(office.licence),
      cuttingPermit: blank(office.cuttingPermit),
      district: blank(office.district),
      referenceDocument: blank(office.referenceDocument),
    },
    preparer: preparerText(office, true),
    evaluator: {
      name: blank(office.evaluator),
      designation: { value: designation, source: designation ? 'scene' : 'reviewer' },
    },
    blocks: {
      listed: text(office.blockIds || proposed.map((block) => block.name).join(', ')),
      all: text(blank(office.blockIds) ?? ctx.blocks.map((block) => block.name).join(', ')),
      systems: systemsLine(ctx.blocks),
      harvestYears: harvestYearLine(proposed),
      proposed: proposed.length > 0,
    },
    generalLocation: { value: location.value, source: location.source },
    date: ctx.date.toISOString().slice(0, 10),
    method: { terrain: ctx.method.terrain, vegetation: ctx.method.vegetation },
    inventoryRead: ctx.inventoryRead,
    recipe: { summaryForm: !!ctx.recipeParts?.includes('notes-2001') },
    wording,
  }
}
