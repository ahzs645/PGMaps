/**
 * Reuses a road's analysis when neither the road nor any project-wide input to it changed.
 *
 * A road's analysis depends only on the road itself and on inputs the whole project shares
 * (terrain, settings, context, standards and the like), never on the other roads. The workspace used
 * to re-analyse every road on every edit: on a seven-road project one culvert re-ran seven analyses,
 * and each run built new section points (about 1.3 million objects, ~93 MB). Every render the page
 * kept alive (memoized children hold the props of their last render, and with them that render's
 * closures) then pinned its own full set, so adding culverts grew the heap by ~93 MB each until the
 * tab ran out of memory. `shareUnchanged` keeps an untouched road the same object across edits, so
 * identity is the test. Free of DOM access.
 */
export interface AnalysisCache<A, R> {
  /** The project-wide inputs the cached analyses were made with, compared by identity. */
  shared: readonly unknown[]
  byId: ReadonlyMap<string, { alignment: A; analysis: R }>
}

export function reuseAnalyses<A extends { id: string }, R>(
  previous: AnalysisCache<A, R> | null,
  shared: readonly unknown[],
  alignments: readonly A[],
  analyse: (alignment: A) => R,
): { analyses: Map<string, R>; cache: AnalysisCache<A, R> } {
  const sameShared =
    !!previous && previous.shared.length === shared.length && previous.shared.every((v, i) => Object.is(v, shared[i]))
  const byId = new Map<string, { alignment: A; analysis: R }>()
  const analyses = new Map<string, R>()
  for (const alignment of alignments) {
    const kept = sameShared ? previous!.byId.get(alignment.id) : undefined
    const analysis = kept && kept.alignment === alignment ? kept.analysis : analyse(alignment)
    byId.set(alignment.id, { alignment, analysis })
    analyses.set(alignment.id, analysis)
  }
  return { analyses, cache: { shared, byId } }
}
