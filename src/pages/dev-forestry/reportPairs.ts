/**
 * The VIA report's before/after pictures for one viewpoint, chosen so a pair never compares two renderers. When an
 * engine drew the figures, the before picture is that engine's own render of the view before harvest (a background
 * render, `BackgroundRenders.tsx`); without one, the pair falls back to PGMaps for both pictures and says why. A field
 * photograph is not a render and pairs with whichever simulation. No DOM or network access.
 */

import type { ReportFigure } from './viaReport/model'

type Picture = { dataUrl: string; width: number; height: number }

/** A block callout as a figure keeps it: its anchor in the figure's picture, pixels. */
type Callout = { anchor: readonly [number, number] | number[]; title: string; status: string; secondary?: boolean }

export type BeforePicture = ReportFigure & { source: 'photo' | 'render' }

/**
 * A view's plain simulation (its framed capture, else its screenshot) as an "after" picture, with where each block
 * lies in it: the callouts' anchors, which are in this picture's pixels.
 */
export function simulationPicture(
  name: string,
  figure: { frameImage?: Picture; callouts: readonly Callout[]; hidden?: readonly Callout[] },
  screenshot: Picture,
): ReportFigure {
  const picture = figure.frameImage ?? screenshot
  return {
    view: name,
    caption: `${name}: simulation`,
    dataUrl: picture.dataUrl,
    width: picture.width,
    height: picture.height,
    marks: [...figure.callouts.filter((c) => !c.secondary), ...(figure.hidden ?? [])]
      .filter((c) => c.anchor[0] >= 0 && c.anchor[1] >= 0)
      .map((c) => ({
        x: c.anchor[0] / picture.width,
        y: c.anchor[1] / picture.height,
        label: c.title,
        status: c.status,
      }))
      .filter((m) => m.x <= 1 && m.y <= 1),
  }
}

export interface PairInput {
  /** The viewpoint's name in the report. */
  name: string
  /** The after picture as the figures are drawn: the engine's when it drew them. */
  after: ReportFigure
  /** The engine that drew `after`, by label; null when PGMaps did. */
  afterRenderer: string | null
  /** PGMaps' own after picture (the view's figure as saved), for the fallback. */
  ownAfter: ReportFigure | null
  /** The before picture the page captured: a lined-up field photograph, or PGMaps' own render. */
  before: BeforePicture | null
  /** The engine's render of the view before harvest, in the same framing as `after`, when it drew one. */
  engineBefore: Picture | null
  /** Why the engine has no before picture ("the render failed: …"), for the fallback's note. */
  engineBeforeMissing?: string | null
}

/** One viewpoint's before and after, from the same renderer, each naming who drew it. */
export function pairPictures(input: PairInput): { before: BeforePicture | null; after: ReportFigure } {
  const { name, after, afterRenderer, before } = input
  const pgmaps = (picture: BeforePicture | null) =>
    picture && picture.source === 'render' ? { ...picture, renderer: picture.renderer ?? 'PGMaps' } : picture
  // PGMaps drew the figures, or the before is a photograph: nothing to match.
  if (!afterRenderer) return { before: pgmaps(before), after: { ...after, renderer: after.renderer ?? 'PGMaps' } }
  const engineAfter = { ...after, renderer: afterRenderer }
  if (before?.source === 'photo') return { before, after: engineAfter }
  if (input.engineBefore)
    return {
      before: {
        view: name,
        caption: `Before harvest: ${afterRenderer}'s render from ${name}, framed as its simulation, the proposed blocks still forested.`,
        dataUrl: input.engineBefore.dataUrl,
        width: input.engineBefore.width,
        height: input.engineBefore.height,
        source: 'render',
        renderer: afterRenderer,
      },
      after: engineAfter,
    }
  // No before by the engine: PGMaps draws both, rather than pair its before with the engine's after.
  if (before && input.ownAfter)
    return {
      before: pgmaps(before),
      after: {
        ...input.ownAfter,
        renderer: 'PGMaps',
        note: `Drawn by PGMaps, as the picture before it: ${afterRenderer} drew no before picture of this view${
          input.engineBeforeMissing ? ` (${input.engineBeforeMissing})` : ''
        }.`,
      },
    }
  // No before picture by either renderer to pair with: the after stands alone, by the engine.
  return { before: null, after: engineAfter }
}
