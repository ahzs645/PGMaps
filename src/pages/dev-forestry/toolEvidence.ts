import { escapeHtml } from '@/lib/escapeHtml'
import type { FieldRecord, ToolsDocument, ToolRun } from './assessmentTools'
import { MASK_LABELS } from './assessmentMasks'

export function evidenceGaps(d: ToolsDocument): string[] {
  const missing: string[] = []
  if (!d.views.length) missing.push('No significant assessment viewpoints recorded.')
  if (!d.fields.some((f) => f.kind === 'map'))
    missing.push('Attach a topographic map showing numbered viewpoints, VQOs, proposed blocks and roads.')
  for (const v of d.views) {
    const files = d.fields.filter((f) => f.viewId === v.id)
    if (!files.some((f) => f.kind === 'photo')) missing.push(`${v.name}: reference field photograph missing.`)
    if (!files.some((f) => f.kind === 'simulation')) missing.push(`${v.name}: matching simulation image missing.`)
    if (!d.runs.some((r) => r.viewId === v.id && r.summary?.via?.rating && r.summary.via.rationaleWritten))
      missing.push(`${v.name}: completed assessment and rationale missing.`)
  }
  if (!d.fields.some((f) => f.kind === 'design' || f.annotations.length))
    missing.push('Attach visual-force/design analysis or annotate the reference photographs.')
  if (
    d.fields.some(
      (f) =>
        f.kind === 'photo' &&
        (!f.captured ||
          f.lng === null ||
          f.lat === null ||
          f.bearing === null ||
          f.hfov === null ||
          !f.alignmentChecked ||
          (f.altitude !== null && !f.verticalReference?.trim())),
    )
  )
    missing.push('Some reference photographs lack checked dates/camera records or alignment review.')
  if (d.runs.some((r) => r.error || !r.summary?.quality?.numericalReady))
    missing.push('Some saved runs failed or have provisional numerical results.')
  return missing
}
export function runLines(r: ToolRun): string[] {
  const s = r.summary,
    v = s?.via
  return [
    `Viewpoint: ${r.scene.viewpoint.name}; assessment year: ${r.scene.assessmentYear}`,
    `Objective: ${v?.objective.label ?? 'not assessed'}; active landform: ${r.scene.activeLandformId ?? 'not selected'}`,
    `Source coverage: terrain ${s?.quality?.terrain ?? 'unknown'}; vegetation ${s?.quality?.vegetation ?? 'unknown'}; existing disturbance ${s?.quality?.existingInventory ?? 'unknown'}; green-area basis ${s?.quality?.greenBasis ?? 'unknown'}`,
    `Numerical readiness: ${s?.quality?.numericalReady ? 'scenario estimates available' : 'provisional / withheld'}`,
    `${s?.quality?.numericalReady ? 'Scenario' : 'Provisional diagnostic'} perspective cumulative: ${s?.perspectiveAlteration?.cumulativePercent?.toFixed(2) ?? 'withheld'}%; planimetric cumulative: ${s?.planimetricAlteration?.cumulativePercent?.toFixed(2) ?? 'withheld'}% (different measurement scales)`,
    `Proposed block area: ${s?.blockAreaHa?.toFixed(2) ?? '?'} ha; visible block ground: ${s?.visibleHa?.toFixed(2) ?? '?'} ha (descriptive full block outlines, not the net alteration ledger)`,
    `Settings: eye ${r.scene.settings.observerHeightMeters} m; screening ${r.scene.settings.screeningEnabled ? 'enabled' : 'off'}; sampling budget ${r.scene.settings.sampleBudget}; green-up age assumption ${r.scene.settings.greenUpAgeYears} years`,
    `Measured X: ${v?.initialPercent == null ? 'withheld' : `${v.initialPercent.toFixed(2)}%`}; ocular class: ${v?.ocular?.classId ?? 'review required'}`,
    `Design total: ${v?.designTotal ?? 'not recorded'}; roads: ${v?.roads ?? 'not recorded'}; retention adjustment: ${v?.retentionFactor ?? 'not recorded'}`,
    `Y: ${v?.y ?? 'not recorded'}; adjusted X: ${v?.adjusted?.percent == null ? 'not available' : `${v.adjusted.percent.toFixed(2)}%`}; Table 7 rating: ${v?.rating?.label ?? 'not rated'}`,
    `Rationale: ${r.scene.viaReview?.rationale ?? 'not recorded'}`,
    `Generated: ${r.generatedAt}; DEM sampling: ${s?.demResolutionMeters?.toFixed(2) ?? '?'} m; sightlines: ${s?.actualSightlineCount ?? 'unknown'}`,
    ...(r.error ? [`Run failed: ${r.error}`] : []),
    ...(s?.quality?.warnings ?? []),
    ...(s?.sourceNotes ?? []),
    ...(r.scene.masks ?? []).map(
      (m) => `Assessment area: ${m.name}; ${MASK_LABELS[m.kind]}; source: ${m.source || 'not recorded'}`,
    ),
    ...Object.entries(r.scene.reportMetadata ?? {}).map(([k, value]) => `${k}: ${value}`),
  ]
}
export function buildEvidenceHtml(d: ToolsDocument): string {
  const e = escapeHtml,
    gaps = evidenceGaps(d)
  const camera = (f: FieldRecord) =>
    `Location ${f.lng ?? '?'}°, ${f.lat ?? '?'}°; camera elevation ${f.altitude ?? 'not recorded'} m (${f.verticalReference || 'vertical reference not recorded'}); true heading ${f.bearing ?? '?'}°; HFOV ${f.hfov ?? '?'}°; pitch ${f.pitch}°; roll ${f.roll}°; ${f.alignmentChecked ? 'reviewer checked alignment' : 'alignment not checked'}`
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Forestry VIA evidence package</title><style>body{font:15px/1.5 system-ui;color:#172534;max-width:1100px;margin:35px auto;padding:0 25px}h1,h2{line-height:1.2}section{break-before:page}img{max-width:100%;max-height:75vh;object-fit:contain}figure{margin:20px 0}.photo{position:relative;display:inline-block}svg{position:absolute;inset:0;width:100%;height:100%}.warning{border:1px solid #b7791f;background:#fffaf0;padding:16px}li{margin-bottom:5px}@media print{body{margin:0;max-width:none}button{display:none}img{max-height:210mm}@page{size:A4;margin:18mm}}</style><body><h1>Forestry visual impact assessment — evidence package</h1><p>2022 VIA workflow summary. This is a scenario and reviewer evidence record, distinct from the historical FS1252 effectiveness-evaluation form. Calculations remain screening estimates; the package checklist does not establish VQO achievement.</p><button onclick="window.print()">Print / save as PDF</button><div class="warning"><h2>Package checklist</h2>${gaps.length ? `<ul>${gaps.map((g) => `<li>${e(g)}</li>`).join('')}</ul>` : '<p>Expected evidence categories are present. The reviewer must check content, accuracy and adequacy.</p>'}</div><h2>Significant viewpoints</h2>${d.views.map((v, i) => `<p><strong>${i + 1}. ${e(v.name)}</strong> · ${e(v.viewpoint.mode)}<br>${e(v.notes || 'Significance not recorded')}<br>${e(JSON.stringify(v.viewpoint.coordinates))}</p>`).join('')}<h2>Recovery assumptions</h2><p>${e(d.growthSource || 'No supplied height–age curve; stated green-up-age scenario assumption applies.')}</p><p>${e(JSON.stringify(d.growthCurve))}</p>${d.runs
    .map(
      (r) =>
        `<section><h2>${e(r.name)}</h2><p>Saved independent run; changing the current scene does not update this record.</p>${runLines(
          r,
        )
          .map((line) => `<p>${e(line)}</p>`)
          .join('')}</section>`,
    )
    .join(
      '',
    )}${d.fields.map((f) => `<section><h2>${e(f.name)} — ${e(f.kind)}</h2><p>Viewpoint: ${e(d.views.find((v) => v.id === f.viewId)?.name ?? 'not linked')} · recorded date: ${e(f.captured || 'not recorded')}</p><figure><div class="photo"><img src="${f.image}" alt="${e(f.name)}"><svg viewBox="0 0 ${f.width} ${f.height}" xmlns="http://www.w3.org/2000/svg">${f.annotations.map((a) => `<g><circle cx="${a.x * f.width}" cy="${a.y * f.height}" r="5" fill="#fbbf24"/><text x="${a.x * f.width + 8}" y="${a.y * f.height}" font-size="22" fill="white" stroke="black" stroke-width="0.6">${e(a.label)}</text></g>`).join('')}</svg></div><figcaption>${e(camera(f))}</figcaption></figure><p>${e(f.notes)}</p><p>Evidence copy resized for this package. Original: ${e(f.originalName)}. Preserve original high-resolution files.</p></section>`).join('')}<section><h2>Sources and methods</h2><p>BC Visual Impact Assessment Handbook (May 2022), sections 3–4 and Appendices 4, 7, 8. <a href="https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/forestry/visual-resource-mgmt/visual_impact_assessment_handbook.pdf">Handbook</a></p><p>Map/simulation attribution: AWS Open Data terrain (SRTM/CDEM), CARTO and OpenStreetMap contributors where those layers are shown. Imported data retain their recorded sources. No completed field visit, signature or authorization is inferred.</p></section></body></html>`
}
export async function exportEvidencePdf(d: ToolsDocument) {
  const { jsPDF } = await import('jspdf'),
    pdf = new jsPDF({ unit: 'mm', format: 'a4' }),
    margin = 16,
    width = 178
  let y = 20
  const ascii = (s: string) => s.normalize('NFKD').replace(/[^\x20-\x7E\n]/g, ' ')
  const line = (text: string, size = 10) => {
    pdf.setFontSize(size)
    const lines = pdf.splitTextToSize(ascii(text), width) as string[]
    for (const l of lines) {
      if (y > 276) {
        pdf.addPage()
        y = 20
      }
      pdf.text(l, margin, y)
      y += size * 0.42 + 1
    }
    y += 2
  }
  line('Forestry VIA evidence package', 18)
  line(
    '2022 VIA workflow summary - scenario and reviewer evidence record. Screening estimates require field review. This report is distinct from the historical FS1252 monitoring form.',
  )
  line('Package checklist', 14)
  for (const g of evidenceGaps(d)) line(`Missing / review: ${g}`)
  if (!evidenceGaps(d).length)
    line('Expected evidence categories present. This checklist does not establish accuracy or VQO achievement.')
  for (const [i, v] of d.views.entries()) {
    line(`${i + 1}. ${v.name}`, 12)
    line(v.notes || 'Significance not recorded')
    line(JSON.stringify(v.viewpoint.coordinates))
  }
  line(`Height-age curve source: ${d.growthSource || 'none; stated age assumption'}`)
  line(JSON.stringify(d.growthCurve))
  for (const r of d.runs) {
    pdf.addPage()
    y = 20
    line(r.name, 16)
    for (const l of runLines(r)) line(l)
  }
  for (const f of d.fields) {
    pdf.addPage()
    y = 20
    line(`${f.name} - ${f.kind}`, 14)
    line(
      `Viewpoint: ${d.views.find((v) => v.id === f.viewId)?.name ?? 'not linked'}; date: ${f.captured || 'not recorded'}`,
    )
    const h = Math.min(185, (width * f.height) / f.width),
      w = (h * f.width) / f.height
    pdf.addImage(f.image, 'JPEG', margin, y, w, h)
    pdf.setFontSize(9)
    for (const a of f.annotations) {
      pdf.setTextColor(255, 190, 0)
      pdf.text(ascii(a.label), margin + a.x * w, y + a.y * h)
    }
    pdf.setTextColor(0)
    y += h + 8
    line(
      `Position: ${f.lng ?? 'unknown'}, ${f.lat ?? 'unknown'}; camera elevation: ${f.altitude ?? 'unknown'} m (${f.verticalReference || 'reference not recorded'}); true heading: ${f.bearing ?? 'unknown'} deg; HFOV: ${f.hfov ?? 'unknown'} deg; pitch: ${f.pitch}; roll: ${f.roll}. Alignment ${f.alignmentChecked ? 'reviewer checked' : 'not checked'}.`,
    )
    line(f.notes)
    line(`Resized evidence copy. Keep the original high-resolution file: ${f.originalName}`)
  }
  pdf.addPage()
  y = 20
  line('Sources and methods', 14)
  line(
    'BC Visual Impact Assessment Handbook, May 2022, sections 3-4 and Appendices 4, 7, 8. Individual job scene inputs, assumptions, source rasters and reviewer entries travel in the separate workspace JSON export.',
  )
  line(
    'Map/simulation attribution where applicable: AWS Open Data / SRTM / CDEM; CARTO; OpenStreetMap contributors. Imported data retain their recorded provenance.',
  )
  line('No field visit, signature, approval or legal VQO achievement is inferred by this export.')
  const pages = pdf.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i)
    pdf.setFontSize(8)
    pdf.setTextColor(100)
    pdf.text(`Forestry VIA evidence record - page ${i} of ${pages}`, margin, 289)
  }
  pdf.save('forestry-via-evidence.pdf')
}
