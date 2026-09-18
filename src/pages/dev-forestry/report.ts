/** Markdown companion to the exact-template FS1252 PDF, based only on the saved run. */
import type { AnalysisResult, TargetPolygon } from './types'
import type { VisualQualityThresholds } from './vqo'
import { resolveThreshold } from './integrity'
import { formClass } from './pdf/fs1252'
export type ReportInventoryUnit={polygonNumber:string;vsc:string|null;scenicArea:boolean}
export type ReportInput={result:AnalysisResult;targets:TargetPolygon[];thresholds:VisualQualityThresholds;viewpointName:string;generatedAt:Date;inventorySource?:string|null;inventoryUnit?:ReportInventoryUnit|null}
const escape=(s:unknown)=>String(s??'').replace(/\|/g,'\\|').replace(/[\r\n]+/g,' ')
const n=(v:number|null|undefined,d=2)=>v!=null&&Number.isFinite(v)?v.toFixed(d):'Not available'
export function buildReport({result,targets,thresholds,viewpointName,generatedAt,inventorySource,inventoryUnit}:ReportInput):string{
 const landform=targets.find(t=>t.id===result.activeLandformId),quality=result.quality
 const lines=[`# Visual Quality Effectiveness Evaluation — simulation draft`, '',
  '**FS1252 2008/04. Not a field evaluation, a completed VIA, or a final determination of VQO achievement.**','',
  `Generated: ${generatedAt.toISOString()}. This is not a field-evaluation date.`,
  `Viewpoint/corridor: ${escape(viewpointName)}. Active landform: ${escape(landform?.name??'None')}.`,
  `Assessment year: ${result.inputSnapshot?.assessmentYear??'Not recorded'}.`,
  `Assessment station: ${result.assessmentStationIndex+1} (highest available estimated cumulative perspective ratio).`,
  `Station with most proposed ground visible: ${(result.largestVisibleAreaStationIndex??result.assessmentStationIndex)+1}.`,'',
  '## Evidence and model status','',
  `Numerical form fields: ${quality?.numericalReady?'available as modelled scenario estimates':'WITHHELD pending missing evidence / resolution checks'}.`,
  `Green denominator: ${quality?.greenBasis??'unverified'}. Existing disturbance: ${quality?.existingInventory??'unverified'}.`,
  `Terrain: ${quality?.terrain??'unverified'}; vegetation inventory: ${quality?.vegetation??'unverified'}.`,
  `DEM sampling interval: ${n(result.demResolutionMeters,1)} m; this is not the native accuracy of the source.`,
  `Largest landform grid cell: ${n(quality?.largestGroundCellPercent)}% of green map area, a resolution diagnostic rather than an error bound.`,
  ...(quality?.warnings??['No quality record. Rerun the scenario.']).map(w=>`> ${w}`),'',
  '## 2.1.2–2.1.3 Office information','',
  'Forest district / licensee / licence / CP / sample code / field date: ______ (not inferred).',
  `VLI polygon: ${escape(inventoryUnit?.polygonNumber??'______')}; VSC: ${escape(inventoryUnit?.vsc??'______')}.`,
  `Inventory source: ${escape(inventorySource??'Not supplied')}.`,
  `Scenario objective: ${landform?.objectiveId??'not selected'}; VAC: ${landform?.vac??'not supplied'}. A selected objective is not proof of legal establishment.`,'',
  '## 2.2.1 Viewpoints and 2.3.2 Initial numerical VQC','',
  'Percentages are estimated apparent alteration in perspective, NOT planimetric percentages. a is used for the proposal in this simulation draft; the historical form labels it recent openings.',
  '| Station | Longitude | Latitude | Ground elevation (m) | a proposed % | b outside disturbance % | c existing % | X total % | Initial numerical VQC |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
 ]
 result.stations.forEach((s,i)=>{const a=quality?.numericalReady?result.perspectiveByStation[i]:null;lines.push(`| ${i+1} | ${n(s.lng,6)} | ${n(s.lat,6)} | ${n(s.groundElevationMeters,1)} | ${a?n(a.proposedPercent):'Withheld'} | ${a?n(a.disturbancePercent):'Withheld'} | ${a?n(a.existingPercent):'Withheld'} | ${a?n(a.cumulativePercent):'Withheld'} | ${a?formClass(a.cumulativePercent):'Undetermined'} |`)})
 lines.push('', '## Field observations and adjusted/final ratings','',
  '2.2.2 Photography: photo IDs, field of view, camera information, viewpoint importance and field description ______.',
  '2.2.3 Basic VQC (ocular): ______. Not inferred from the numerical class.',
  '2.2.4 Five design observations: force lines ______; natural character ______; edge treatments ______; distance ______; position ______.',
  '2.3.3 Roads/sidecast within openings d ______; retention e ______; design total f ______; Y=d+e+f ______; adjusted X*(1+0.14*Y) ______.',
  '2.3.4 Partial cutting: actual volume removed ______; actual mean residual-tree height ______; clearcut equivalent ______. PERCENT_CLEARCUT is not volume removed, and green-up height is not residual-tree height. Neither is substituted.',
  '2.3.6 Final EE rating: ______. 2.3.7 Override and rationale: ______. Evaluator: ______. Signature: ______.','',
  '## Planimetric timber-supply context — not FS1252 numerical fields','')
 if(landform&&result.planimetricAlteration){const allowance=resolveThreshold(landform.objectiveId,'planimetric',thresholds,landform.vac);lines.push(`Scenario map-area alteration: ${n(result.planimetricAlteration.cumulativePercent)}%. Planning allowance: ${allowance.value}%. ${allowance.note}`,quality?.numericalReady?'These are planning comparisons only, not a final compliance verdict.':'The map-area figure is provisional; no within-range verdict is assigned.')}
 else lines.push('No active-landform planimetric result.')
 lines.push('', '## Reproduction and references','',
  'Use the scene JSON export for inputs and the PDF’s embedded pgmaps-scenario.json for the exact form export record. Existing and proposed overlaps are reduced on a shared landform ledger; per-block visible hectares are not additive.',
  'Source template: FS1252 2008/04, pages 1–4. Supporting context: Visual Impact Assessment Handbook (May 2022), numerical assessment and simulation guidance. The 2022 summary has six design elements; this historical FS1252 has five.',
  '1998 Procedures and the 2003 modelling bulletin supply separate timber-supply context. Their plan-to-perspective ratios are not applied again to this directly modelled apparent-area estimate.',
  'No timber volume is inferred from visibility; the Robson Valley merchantable-volume report requires stand and operability information this scene does not supply.','')
 return lines.join('\n')
}
