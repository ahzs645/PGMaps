/**
 * A resolved VIA document as Markdown: the format and its sources, the images each viewpoint needs (the recipes),
 * then per viewpoint the figure on the format's own arithmetic beside the run's sightline figure, the tables, the
 * sentences the run fills, and a closing list of what the reviewer still has to complete. Every figure says which
 * rule made it. No DOM or network access.
 */
import type { RenderRecipe } from './formats'
import type { DocumentFacts, ResolvedDocument } from './resolve'

const cell = (value: string) => value.replace(/\|/g, '\\|').replace(/\n/g, ' ') || ' '

function table(columns: readonly string[], rows: ReadonlyArray<Record<string, string>>): string[] {
  if (!rows.length) return []
  return [
    `| ${columns.map(cell).join(' | ')} |`,
    `| ${columns.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${columns.map((column) => cell(row[column] ?? '')).join(' | ')} |`),
    '',
  ]
}

function recipeLine(recipe: RenderRecipe): string {
  const lens =
    recipe.camera.lens === 'photo'
      ? "the field photo's lens"
      : 'mm' in recipe.camera.lens
        ? `${recipe.camera.lens.mm} mm`
        : `${recipe.camera.lens.hfovDeg}° across`
  const framing =
    recipe.camera.framing === 'panorama'
      ? `panorama${recipe.camera.aspect ? ` about ${recipe.camera.aspect}:1` : ''}`
      : recipe.camera.framing === 'fixed'
        ? 'fixed frame'
        : 'framed on the landform'
  const scene = [
    recipe.scene.harvest === 'before' ? 'before harvest' : 'after harvest',
    recipe.scene.blockGround === 'painted'
      ? 'blocks painted as harvested ground'
      : recipe.scene.blockGround === 'outline'
        ? 'blocks outlined'
        : 'no blocks drawn',
    recipe.scene.privateLand === 'cleared' ? 'private land cleared' : 'private land standing',
    recipe.scene.trees === 'off' ? 'no trees' : 'trees drawn',
  ].join(', ')
  const style = recipe.style
    ? `; style ${recipe.style}${recipe.passes.includes('class') ? ' with class pass' : ''}`
    : ''
  return `- **${recipe.label}** — ${lens}, ${framing}; ${scene}${style}. Caption: "${recipe.caption}"`
}

/** The views of the package a document does not hold, each with why, as a closing Markdown section; '' when none. */
export function viewsLeftOutMarkdown(leftOut: ReadonlyArray<{ name: string; reason: string }>): string {
  if (!leftOut.length) return ''
  return [
    '',
    '## Views left out of this document',
    '',
    ...leftOut.map((view) => `- ${view.name}: ${view.reason.replace(/[.\s]*$/, '')}.`),
    '',
  ].join('\n')
}

export function documentMarkdown(doc: ResolvedDocument, facts: DocumentFacts): string {
  const { format } = doc
  const lines: string[] = [
    `# Visual Impact Assessment: ${facts.project}`,
    '',
    `**Format:** ${format.name} (structure of reference document${format.sources.length > 1 ? 's' : ''} ${format.sources.join(', ')}). ${format.purpose}`,
    '',
    `**Percent alteration:** ${format.rule.formula}, ${format.rule.basis}, ${format.rule.decimals} decimal${format.rule.decimals === 1 ? '' : 's'}${format.rule.rounding === 'truncate' ? ', truncated' : ''}; measured in pixels on PGMaps' class pass. Read against: ${format.percentScale.name} (${format.percentScale.printed}). Distance: ${format.distanceScale.name}.`,
    '',
    '## Images',
    '',
    ...format.recipes.map(recipeLine),
    '',
  ]
  doc.viewpoints.forEach((vp, index) => {
    const source = facts.viewpoints[index]
    lines.push(`## ${vp.name}`, '')
    const figure = vp.printed
      ? `${vp.printed.percent}% (${vp.printed.term}${vp.printed.classCode ? `, ${vp.printed.classCode}` : ''})`
      : 'no class pass'
    lines.push(
      `- Landform: ${source.landform}${source.objective ? `, objective ${source.objective}` : ''}`,
      `- Pixel figure (${format.rule.basis}): ${figure}`,
      `- Sightline figure (PGMaps run, the assessment's figure): ${source.sightlinePercent === null ? (source.sightlineWithheld ?? 'n/a') : `${source.sightlinePercent.toFixed(2)}%`}`,
      ...(source.existingBasis ? [`- Existing disturbance: ${source.existingBasis}`] : []),
      ...(vp.distance ? [`- Distance: ${vp.distance.km} km (${vp.distance.term})`] : []),
      ...(source.hfovDeg
        ? [`- Lens: ${Math.round(source.lensMm ?? 0)} mm equivalent, ${source.hfovDeg.toFixed(1)}° across`]
        : []),
      '',
    )
    for (const t of format.tables) {
      const rows = vp.rows[t.id]
      if (rows?.length) lines.push(`**${t.title}**`, '', ...table(t.columns, rows))
    }
    const written = vp.sentences.filter((s) => s.text)
    if (written.length) lines.push(written.map((s) => s.text).join(' '), '')
  })
  const summary = doc.summary.filter((s) => s.text)
  if (summary.length) lines.push('## Conclusion', '', summary.map((s) => s.text).join(' '), '')
  if (doc.toComplete.length) {
    lines.push('## Reviewer to complete', '')
    for (const item of doc.toComplete)
      lines.push(
        `- ${item.viewpoint ? `${item.viewpoint}: ` : ''}${item.about ? `${item.about}, ` : ''}${item.id} (needs ${item.missing.join(', ')})`,
      )
    lines.push('')
  }
  if (format.gaps.length) lines.push('## Not filled by PGMaps', '', ...format.gaps.map((gap) => `- ${gap}`), '')
  lines.push(
    "_Pixel figures count what each picture shows; the sightline figure is the run's and stays the assessment's._",
    '',
  )
  return lines.join('\n')
}
