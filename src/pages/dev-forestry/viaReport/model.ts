/**
 * A VIA report as content, before it is laid out: headings, prose built from sentence templates, form fields, tables,
 * matrices with a marked cell, scale bars with a mark, tick-box choices, figures and a signature block. The renderers
 * (`html.ts`, `markdown.ts`) only draw these; every value comes from a part (`parts.ts`, `matrices.ts`) filling it from
 * the assessment, and says where it came from. A value nobody has given prints blank, never a guess. No DOM or network
 * access.
 */
import type { Sentence } from '../viaDocument/wording'

/** Where a printed value came from: the run, the reviewer, the scene, a public table, or the format's fixed text. */
export type Provenance = 'run' | 'reviewer' | 'scene' | 'table' | 'fixed'

export interface FieldRow {
  label: string
  /** Null prints a blank line to be filled by hand. */
  value: string | null
  source: Provenance
}

export interface ReportFigure {
  /** The saved view it was drawn from. */
  view: string
  caption: string
  dataUrl: string
  width: number
  height: number
  /** A map's legend, scale and north arrow, when the picture is a map (`htmlFigures.ts` prints them beside it). */
  map?: MapFurniture
  /**
   * Where each block lies in the picture, as shares of its width and height, with what the run's samples saw of it
   * (`figureCallouts.ts`). A part draws a marker from them, never an outline.
   */
  marks?: ReadonlyArray<{ x: number; y: number; label: string; status: string }>
  /** The landform's rows in the picture, pixels, when a framed render knows them: what a panorama slot centres on. */
  landformRows?: { y: number; height: number }
}

/** What a map picture carries beside the picture itself. Nothing is drawn for what is absent. */
export interface MapFurniture {
  /** Legend rows in the map's own order. */
  legend?: ReadonlyArray<{ label: string; color: string; kind?: 'area' | 'line' | 'point' }>
  /** The scale as the map states it ("1:50,000", or "Scale bar: 1 km"). */
  scale?: string
  /** The map is drawn north-up: a north arrow is printed on it. */
  northUp?: boolean
  /** The picture already prints its own legend, scale and north arrow: nothing is added over or beside it. */
  inPicture?: boolean
}

/**
 * One picture place on a figure layout: its label, the picture, or a placeholder saying what goes there when nobody
 * has given it.
 */
export interface FigureSlot {
  label: string
  figure: ReportFigure | null
  /** What goes here, printed in the empty box. */
  placeholder: string
  /** A line under the picture: where it came from ("Field photograph, lined up with the view"). */
  note?: string
  /**
   * Which of the picture's block `marks` to draw: `unseen`, a marker where a block lies but is only glimpsed or not
   * seen (26); `all`, an arrow and label to every block (05/06's labelled simulations). None when absent.
   */
  markBlocks?: 'unseen' | 'all'
  /**
   * Show the picture as a panorama at least this many times as wide as tall, a band round its `landformRows`
   * (`panoramaBand`), as 26's Figure 2 prints them. The picture itself is unchanged; without rows it shows whole.
   */
  panorama?: number
}

export type ReportBlock =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  /** Sentences the run or the reviewer filled; unfilled ones are left out here and listed in `toComplete`. */
  | { kind: 'paragraph'; sentences: Sentence[] }
  /** Fixed or public text: regulation, handbook, the format's own method statement. */
  | { kind: 'text'; text: string; source: Provenance }
  | { kind: 'list'; items: string[]; ordered?: boolean; source: Provenance }
  | { kind: 'fields'; title?: string; rows: FieldRow[] }
  | { kind: 'table'; title?: string; columns: string[]; rows: string[][]; note?: string; source: Provenance }
  | {
      kind: 'matrix'
      title: string
      /** What the rows and the columns are. */
      rowHeader: string
      columnHeader: string
      rows: string[]
      columns: string[]
      cells: string[][]
      /** Background per cell (a class colour), or null. */
      tint?: (string | null)[][]
      /** The cells the assessment reads (one per row for a rating table); empty when it reads none. */
      marks: Array<{ row: number; column: number }>
      markSource?: Provenance
      note?: string
      /**
       * How it is drawn: `form` (default), a ruled form table with a shaded header; `class-grid`, the alteration
       * guide's grid of solid class colours with each cell's class letter and its own value as secondary text.
       */
      style?: 'form' | 'class-grid'
      /** The class letter each cell reads as (`class-grid`); a change of letter draws a boundary between cells. */
      letters?: (string | null)[][]
      /**
       * The reading as an X at a position between cells (`class-grid`): fractional row and column indices, so 10%
       * removed at 27.5 m sits on row 0 halfway between the 25 and 30 m columns, as 01 marks the poster.
       */
      point?: { row: number; column: number }
      /** Whether each cell prints its own value under the letter (`class-grid`); the poster prints letters only. */
      cellValues?: boolean
      /** A colour key beside the grid, e.g. the guide's harvest types. */
      legend?: { title: string; items: Array<{ label: string; color: string }> }
      /** A colour strip on each row's or column's header: the class, or the scale from least to most altered. */
      rowColors?: (string | null)[]
      columnColors?: (string | null)[]
    }
  | {
      kind: 'scale'
      title: string
      /** Bands along the bar, left to right, with their labels; `name` and `range` print in a guide's rows. */
      bands: Array<{ from: number; to: number; label: string; color?: string; name?: string; range?: string }>
      ticks: Array<{ at: number; label: string }>
      /** The value marked on the bar, or null. */
      mark: number | null
      markLabel?: string
      markSource?: Provenance
      note?: string
      /**
       * How it is drawn: `bar` (default), boxes along a bar; `arrow-axis`, the forms' axis with an arrowhead, the class
       * labels above it in their colours, a light band per class and the reading as an arrow pointing down; `guide`,
       * the alteration guide's one bar per class on a shared percent axis, the reading as a line across them.
       */
      style?: 'bar' | 'arrow-axis' | 'guide'
      /** The band the reading falls in, by the scale's own rule (a figure on a boundary reads as its document says). */
      markBand?: number | null
      /** Printed before the tick labels, e.g. the handbook form's "%alt:". */
      axisLabel?: string
    }
  | {
      kind: 'choices'
      label: string
      options: string[]
      chosen: string | null
      source: Provenance
      /** A one-line answer printed under the question in bold (the boxed summary's justification); blank when null. */
      answer?: string | null
      /** Drawn as a ruled box with the tick boxes on the right, as the boxed VIA summary prints each question. */
      boxed?: boolean
    }
  | { kind: 'figure'; figure: ReportFigure | null; caption: string; placeholder?: string }
  | { kind: 'signature'; lines: string[] }
  | { kind: 'pageBreak' }
  /**
   * A figure page on its own landscape page (26): a title box and a box of project facts over the maps in a narrow
   * left column, the before and after pictures stacked on the right, each place under a header bar.
   */
  | {
      kind: 'figurePage'
      /** "Figure 2". */
      number: string
      /** "Visualization from {viewpoint}". */
      title: string
      /** Project number and date, under the title box. */
      facts: FieldRow[]
      /** Left column, under the facts: the location map, the regional map. */
      side: FigureSlot[]
      /** Right column: before, then after. */
      main: FigureSlot[]
    }
  /**
   * Pictures of one view stacked one over the other (photograph over simulation, existing over proposed), on a page
   * of their own. `inset` prints each label in the picture's top-left corner (05, 06), `caption` under it (01).
   */
  | {
      kind: 'figurePair'
      title?: string
      slots: FigureSlot[]
      placement: 'inset' | 'caption'
      /** Printed on a landscape page of its own, each picture across its width (02's simulation pages). */
      landscape?: boolean
    }
  /** A map across the page, its legend, scale and north arrow (`ReportFigure.map`), and its caption. */
  | {
      kind: 'mapFigure'
      slot: FigureSlot
      caption: string
      /** Shares its page with the figures after it (01's overhead over its obliques): drawn at most about 4 in tall. */
      compact?: boolean
    }
  /** Pictures side by side in `columns` columns, each with its label under it, and one caption for them all. */
  | {
      kind: 'figureGrid'
      slots: FigureSlot[]
      columns: 1 | 2 | 3
      caption: string
      /** Printed on a landscape page of its own (02's oblique simulations). */
      landscape?: boolean
    }

export interface ReportItemToComplete {
  part: string
  what: string
}

export interface AssembledReport {
  id: string
  title: string
  subtitle: string
  /** Reference documents whose structure the report follows, by number. */
  sources: readonly string[]
  blocks: ReportBlock[]
  toComplete: ReportItemToComplete[]
  /** One line for the footer: what the report is and is not. */
  footer: string
  layout: ReportLayout
}

/**
 * How a report is printed, from its recipe: the paper, a cover page and a table of contents. Wide tables print on
 * landscape pages and analysis sheets on their own 11 × 17 landscape pages whatever the paper (`html.ts`).
 */
export interface ReportLayout {
  paper: 'letter' | 'legal'
  cover: boolean
  contents: boolean
}

export const heading = (text: string, level: 1 | 2 | 3 = 2): ReportBlock => ({ kind: 'heading', level, text })
export const text = (value: string, source: Provenance = 'fixed'): ReportBlock => ({
  kind: 'text',
  text: value,
  source,
})
export const fields = (rows: FieldRow[], title?: string): ReportBlock => ({ kind: 'fields', rows, title })
export const field = (label: string, value: string | null | undefined, source: Provenance): FieldRow => ({
  label,
  value: value === undefined || value === '' ? null : value,
  source,
})
