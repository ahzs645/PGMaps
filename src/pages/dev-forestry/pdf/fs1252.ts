/**
 * FS1252 2008/04 export. This is a PINNED-TEMPLATE writer, not a general PDF parser.
 * It appends standard PDF objects/xref sections to the normalized supplied form.
 * Original vector text and the three reference pages are retained. No OCR,
 * image tracing, third-party fonts, server upload or runtime PDF dependency.
 */
import { canonicalInput } from '../integrity'
import { templateManifest as m } from './templateManifest'
import type { AnalysisResult, TargetPolygon } from '../types'
import { bearingDegrees, haversineMeters, polygonBounds } from '../visibility'
export type FormMetadata = {
  district?: string; licensee?: string; licence?: string; cuttingPermit?: string; blockIds?: string
  generalLocation?: string; resultsOpeningId?: string; sampleCode?: string
  vliPolygon?: string; vsc?: string; evc?: string; recommendedVqc?: string; sourceDocument?: string
  evaluator?: string
}
/** Five items because the supplied 2008 form is not the six-item 2022 VIA form. */
export type FormReview = {
  design?: Array<-1 | 0 | 1 | null>
  roads?: 0 | 1 | 2 | 3 | null
  retention?: -2 | -1 | 0 | null
  retentionAlreadyNetted?: boolean
  notes?: string
}
export type ExportRequest = {
  result: AnalysisResult; targets: TargetPolygon[]; viewpointName: string
  stationIndices: number[]; metadata?: FormMetadata; reviews?: Record<number, FormReview>
  generatedAt: string; template: Uint8Array
}
const encoder = new TextEncoder()
function ascii(value: unknown): string {
  const s = String(value ?? '').replace(/[–—−]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...').replace(/°/g, ' deg').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  // Anything outside printable ASCII would be written raw into a PDF string.
  // eslint-disable-next-line no-control-regex
  if (/[^\x09\x0a\x0d\x20-\x7e]/.test(s)) throw new Error('The PDF fields currently support Latin text only. Use Latin text for form metadata; the embedded scenario JSON retains the original data.')
  return s
}
function escape(s: string) { return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)') }
function width(s: string, size: number) { return [...s].reduce((n, c) => n + (m.fontWidths[c.charCodeAt(0) - 32] ?? 0.6) * size, 0) }
function text(value: unknown, x: number, top: number, maximumWidth = 468, size = 8): string {
  let s = ascii(value).replace(/[\r\n\t]+/g, ' '), fontSize = size
  while (fontSize > 6 && width(s, fontSize) > maximumWidth) fontSize -= 0.2
  if (width(s, fontSize) > maximumWidth) { while (s.length && width(s + '...', fontSize) > maximumWidth) s = s.slice(0, -1); s += '...' }
  return `BT /FPG ${fontSize.toFixed(2)} Tf 0.05 0.16 0.27 rg 1 0 0 1 ${x} ${792 - top} Tm (${escape(s)}) Tj ET\n`
}

const number = (n: number | null | undefined, digits = 1) => n != null && Number.isFinite(n) ? n.toFixed(digits) : ''
export function formClass(percent: number | null): string {
  if (percent === null || !Number.isFinite(percent) || percent < 0) return ''
  return percent <= 0 ? 'P' : percent <= 1.5 ? 'R' : percent <= 7 ? 'PR' : percent <= 18 ? 'M' : percent <= 30 ? 'MM' : '> MM range'
}
export function reviewAdjustment(x: number | null, review?: FormReview) {
  if (x === null || !Number.isFinite(x) || x < 0 || !review?.design || review.design.length !== 5 || review.design.some((v) => v === null || ![-1,0,1].includes(v))) return null
  if (review.roads == null || ![0,1,2,3].includes(review.roads) || review.retention == null || ![-2,-1,0].includes(review.retention)) return null
  const design = review.design.reduce<number>((sum, n) => sum + (n ?? 0), 0)
  const retention = review.retentionAlreadyNetted ? 0 : review.retention
  const y = design + review.roads + retention
  return { design, roads: review.roads, retention, y, adjusted: x * (1 + 0.14 * y) }
}
export async function sha256(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(data).buffer)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
function entries(dictionary: string) { return dictionary.trim().slice(2, -2).trim() }
function contentsRefs(value: string) { const s = value.trim(); return s.startsWith('[') ? s.slice(1, -1).trim() : s }
function numericFields(request: ExportRequest, station: number) {
  const value = request.result.perspectiveByStation[station]
  return request.result.quality?.numericalReady && value && Object.values(value).every(Number.isFinite) ? value : null
}
function formStream(request: ExportRequest, stationIndex: number, ordinal: number, count: number): string {
  const station = request.result.stations[stationIndex], metadata = request.metadata ?? {}, landform = request.targets.find((t) => t.id === request.result.activeLandformId)
  const unit = landform ? polygonBounds(landform.geometry) : null
  const center = unit ? { lng: (unit[0] + unit[2]) / 2, lat: (unit[1] + unit[3]) / 2 } : null
  let s = 'q\n'
  s += text(`SIMULATION DRAFT - viewpoint ${ordinal} of ${count} - NOT A FIELD EVALUATION`, 72, 20, 468, 9)
  const put = (v: unknown, x: number, y: number, w: number, size = 7.4) => { if (v != null && v !== '') s += text(v, x, y, w, size) }
  put(metadata.district,132,113,162); put(metadata.licensee,113,125,181); put(metadata.licence,125,137,77); put(metadata.cuttingPermit,237,137,57)
  put(metadata.sampleCode,382,113,133); put(metadata.blockIds,355,137,107)
  put(metadata.generalLocation || landform?.name,151,149,143); put(metadata.resultsOpeningId,403,149,112)
  put(metadata.vliPolygon,127,197,106); put(landform?.vac,264,185,86); put(metadata.vsc,264,197,86)
  put(landform?.objectiveId ? ({ preservation:'P',retention:'R','partial-retention':'PR',modification:'M','maximum-modification':'MM' })[landform.objectiveId] + ' (scenario)' : '',425,185,89)
  put(metadata.evc,101,209,106); put(metadata.recommendedVqc,292,209,57); put(metadata.sourceDocument,439,209,76)
  put(`${ordinal}/${count} (station ${stationIndex + 1})`,132,245,95); put(number(station.lat,6),289,245,85); put(number(station.lng,6),137,257,90)
  put(number(station.groundElevationMeters),288,257,87); put(center ? number(bearingDegrees(station,center)) + ' deg' : '',450,245,64)
  put(center ? number(haversineMeters(station,center)/1000,2) + ' km' : '',449,257,65)
  put(request.viewpointName,305,305,78)
  // No field date, photo IDs, ocular class, EE decision, override or signature is inferred.
  put('MODELLED VIEW; ocular review outstanding.',368,350,163,7)
  const values = numericFields(request,stationIndex)
  if (values) {
    put(number(values.proposedPercent),273,515,24); put(number(values.disturbancePercent),273,529,24); put(number(values.existingPercent),273,543,24)
    put(number(values.cumulativePercent),138,555,27); put(formClass(values.cumulativePercent),273,555,25)
  } else put('Numerical fields withheld: see appendix.',368,360,163,7)
  const review = request.reviews?.[stationIndex]
  if (review?.design?.length === 5) review.design.forEach((value,i) => { if (value !== null) put('X',value === -1 ? 205 : value === 0 ? 242 : 278,409 + i*13.45,10) })
  const adjustment = reviewAdjustment(values?.cumulativePercent ?? null,review)
  if (adjustment) {
    put(number(adjustment.roads,0),263,598,23); put(number(adjustment.retention,0),263,642,23); put(number(adjustment.design,0),263,656,23)
    put(number(adjustment.y,0),263,670,23); put(number(adjustment.adjusted),263,683,23)
    put(formClass(adjustment.adjusted),291,704,13,6)
    // Individual signed contributions, rather than an invented field observation total.
    for (const score of [-1,0,1]) put(String(review!.design!.filter((v)=>v===score).length * score),score===-1?204:score===0?241:277,477,14)
  }
  put(metadata.evaluator,127,733,160)
  s += text('All entered coordinates and numerical values are scenario-derived unless identified in the appendix.',72,782,468,7)
  return s + 'Q\n'
}
function appendixStreams(request: ExportRequest, inputDigest: string): string[] {
  const streams: string[] = []; let stream = '', y = 0
  const newPage = (heading = 'PGMaps | Scenario export record') => { if (stream) streams.push(stream); stream = text(heading,54,53,500,17); y=80 }
  const add = (value: string, bold = false) => {
    const size=bold?10:9,leading=bold?15:13
    const words=ascii(value).split(/\s+/);let line=''
    const emit=()=>{if(y+leading>730)newPage();stream+=text(line,54,y,504,size);y+=leading;line=''}
    for(const word of words){if(line&&width(line+' '+word,size)>504)emit();line+=(line?' ':'')+word}
    if(line)emit();y+=7
  }
  newPage()
  add('SIMULATION DRAFT. The four-page source template is FS1252 2008/04, a historical Visual Quality Effectiveness Evaluation monitoring form. It is not the 2022 prospective VIA summary form.',true)
  add(`Generated: ${request.generatedAt}. Export date is not a field-evaluation date.`)
  add(`Input SHA-256: ${inputDigest}`)
  add('The embedded pgmaps-scenario.json contains the exact numerical input, selected viewpoints and form entries. No upload to a reporting service is performed.')
  add('Scenario numerical entries: a = proposed incremental apparent alteration; b = road/site disturbance outside openings; c = existing non-recovered alteration. The form labels a as recent openings; this draft uses that field for the scenario proposal, not an observation of completed harvest.')
  add('Method: shared landform sampling ledger, terrain sightlines and surface-area/solid-angle weighting. This is an estimated apparent-area screening result, not a calibrated photograph or a professional determination of VQO achievement.')
  add(`Assessment year: ${request.result.inputSnapshot?.assessmentYear ?? 'not available'}. Observer height: ${request.result.settings.observerHeightMeters} m. Display/analysis exaggeration: 1x. DEM sample spacing: ${number(request.result.demResolutionMeters)} m (not a claim of native DEM accuracy).`)
  add(`Green denominator: ${request.result.quality?.greenBasis ?? 'unverified'}. Existing disturbance evidence: ${request.result.quality?.existingInventory ?? 'unverified'}. Vegetation query: ${request.result.quality?.vegetation ?? 'unverified'}.`)
  for (const warning of request.result.quality?.warnings ?? ['No quality record. Numerical fields were withheld.']) add(warning)
  add('Manual review outstanding: significant-public-viewpoint selection, landform delineation, field photographs and camera parameters, ocular class, field date, final EE rating and signature. A numeric class is not an ocular assessment. Foreground views under 1 km require additional interpretation in the 2022 handbook.')
  add('Source separation: 1998 timber-supply planimetric/VAC tables are not used to classify the FS1252 perspective values. The 2003 plan-to-perspective modelling ratios are not applied to a directly modelled perspective figure. The Robson Valley merchantable-volume study is not a volume estimator for this scenario.')
  const metadata=request.metadata ?? {}
  for (const [key,value] of Object.entries(metadata)) if (value) add(`${key}: ${value}`)
  newPage('PGMaps | Viewpoint calculations and review')
  for (const index of request.stationIndices) {
    const station=request.result.stations[index], values=numericFields(request,index), review=request.reviews?.[index]
    add(`VIEWPOINT / STATION ${index+1} - ${number(station.distanceAlongMeters)} m along the route`,true)
    add(`Model coordinates: ${number(station.lng,6)}, ${number(station.lat,6)}. Ground elevation: ${number(station.groundElevationMeters)} m. Bearing and distance on the form are to the bounding-box centre of the selected landform; confirm the assessment centre in review.`)
    add(values ? `Estimated perspective: proposed ${number(values.proposedPercent,3)}%; outside site disturbance ${number(values.disturbancePercent,3)}%; existing ${number(values.existingPercent,3)}%; total ${number(values.cumulativePercent,3)}%. Initial numerical class ${formClass(values.cumulativePercent)}.` : 'No complete supported numerical value for this station. The form intentionally leaves numerical fields blank.')
    const adj=reviewAdjustment(values?.cumulativePercent??null,review)
    add(adj ? `Explicit reviewer-supplied FS1252 five-factor adjustment: design ${adj.design}; roads ${adj.roads}; retention ${adj.retention}; Y=${adj.y}; adjusted ${number(adj.adjusted,3)}%. No final EE rating inferred.` : 'Adjusted numerical class withheld because a complete set of five design ratings, road-impact rating and retention rating was not supplied.')
    if (review?.retentionAlreadyNetted) add('Retention was already netted out of the alteration geometry; no second retention adjustment was applied.')
    if (review?.notes) add(`Reviewer notes: ${review.notes}`)
  }
  if (stream) streams.push(stream)
  return streams
}
function planStream(request: ExportRequest) {
  const input = request.result.inputSnapshot
  if (!input) return null
  const polygons=input.targets.filter(t=>t.role!=='landscape'||t.id===request.result.activeLandformId)
  const bounds=polygons.map(t=>polygonBounds(t.geometry))
  input.viewpoint.coordinates.forEach(([x,y])=>bounds.push([x,y,x,y]))
  if (!bounds.length) return null
  const minX=Math.min(...bounds.map(b=>b[0])),maxX=Math.max(...bounds.map(b=>b[2])),minY=Math.min(...bounds.map(b=>b[1])),maxY=Math.max(...bounds.map(b=>b[3]))
  const cos=Math.cos((minY+maxY)/2*Math.PI/180),scale=Math.min(480/Math.max(1e-6,(maxX-minX)*cos),470/Math.max(1e-6,maxY-minY))
  const xy=([x,y]:number[])=>[66+(x-minX)*cos*scale,150+(y-minY)*scale]
  let s=text('Scenario geometry | Plan-view diagram',54,54,504,17)+text('Not a surveyed/topographic map. Basemap, roads outside the input, and field photos are not included.',54,77,504,8)
  for(const target of [...polygons].sort((a,b)=>(a.role==='landscape'?-1:0)-(b.role==='landscape'?-1:0))) {
    const rings=target.geometry.type==='Polygon'?[target.geometry.coordinates]:target.geometry.coordinates
    s+='q '+(target.role==='landscape'?'0.15 0.45 0.65':target.role==='block'?'0.75 0.18 0.15':'0.45 0.4 0.25')+' RG 1 w\n'
    for(const polygon of rings) for(const ring of polygon){ const coords=ring.map(xy); coords.forEach(([x,y],i)=>{s+=`${x.toFixed(2)} ${y.toFixed(2)} ${i?'l':'m'}\n`});s+='h S\n' }
    s+='Q\n'
  }
  s+='q 0.1 0.2 0.6 RG 2 w\n'
  input.viewpoint.coordinates.map(xy).forEach(([x,y],i)=>{s+=`${x.toFixed(2)} ${y.toFixed(2)} ${i?'l':'m'}\n`});s+='S Q\n'
  request.stationIndices.forEach((i)=>{const p=request.result.stations[i],[x,y]=xy([p.lng,p.lat]);s+=`q 0 0 0 rg ${x-2} ${y-2} 4 4 re f Q\n`+text(`S${i+1}`,x+4,792-y,80,8)})
  s+=text('Blue outline: active landform. Red: proposed blocks. Brown: existing alteration. Blue line: viewing route.',54,698,504,8)
  s+=text('North is up. Approximate local longitude scaling; geometry is supplied WGS84, not a cadastral boundary.',54,718,504,8)
  return s
}
export async function exportFs1252(request: ExportRequest): Promise<Uint8Array> {
  if (request.template.byteLength!==m.byteLength || await sha256(request.template)!==m.sha256) throw new Error('The FS1252 template does not match the verified 2008/04 template. Export stopped rather than filling the wrong form.')
  if (!request.result.inputSignature || !request.result.inputSnapshot) throw new Error('Rerun this scenario before exporting: the saved result has no immutable input record.')
  if (canonicalInput(request.result.inputSnapshot) !== request.result.inputSignature) throw new Error('The analysis input record has changed since the run. Export stopped.')
  const indices=[...new Set(request.stationIndices)]
  if (!indices.length || indices.length>30 || indices.some(i=>!Number.isInteger(i)||i<0||i>=request.result.stations.length)) throw new Error('Choose 1-30 valid assessment stations.')
  if (!Number.isFinite(Date.parse(request.generatedAt))) throw new Error('Invalid export date.')
  request={...request,stationIndices:indices}
  const inputDigest=await sha256(encoder.encode(request.result.inputSignature))
  const appended:Array<{id:number;bytes:Uint8Array}>=[]; let next=m.size
  const add=(body:string|Uint8Array)=>{const id=next++;appended.push({id,bytes:typeof body==='string'?encoder.encode(body):body});return id}
  const stream=(content:Uint8Array,extra='')=>{const head=encoder.encode(`<< /Length ${content.length} ${extra} >>\nstream\n`),tail=encoder.encode('\nendstream');const out=new Uint8Array(head.length+content.length+tail.length);out.set(head);out.set(content,head.length);out.set(tail,head.length+content.length);return add(out)}
  const font=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  const resources=add(`<< ${entries(m.resources)} /Font << ${entries(m.fonts)} /FPG ${font} 0 R >> >>`)
  const pageIds=indices.map((index,ordinal)=>{
    const content=stream(encoder.encode(formStream(request,index,ordinal+1,indices.length)))
    return add(`<< ${entries(m.pageAttributes)} /Parent ${m.pagesId} 0 R /Resources ${resources} 0 R /Contents [ ${contentsRefs(m.contents)} ${content} 0 R ] >>`)
  })
  const extra=[...appendixStreams(request,inputDigest),planStream(request)].filter((s):s is string=>s!==null)
  const extraPages=extra.map((s)=>{const content=stream(encoder.encode(s));return add(`<< /Type /Page /MediaBox [0 0 612 792] /Parent ${m.pagesId} 0 R /Resources << /Font << /FPG ${font} 0 R >> >> /Contents ${content} 0 R >>`)})
  const attachment=encoder.encode(JSON.stringify({schema:'pgmaps-fs1252-draft-v1',generatedAt:request.generatedAt,inputSha256:inputDigest,input:request.result.inputSnapshot,targets:request.targets,viewpointName:request.viewpointName,stationIndices:indices,metadata:request.metadata??{},reviews:request.reviews??{},quality:request.result.quality,perspectiveByStation:indices.map(i=>({station:i,...request.result.perspectiveByStation[i]}))},null,2))
  const embedded=stream(attachment,'/Type /EmbeddedFile /Subtype /application#2Fjson')
  const fileSpec=add(`<< /Type /Filespec /F (pgmaps-scenario.json) /UF (pgmaps-scenario.json) /EF << /F ${embedded} 0 R >> /Desc (Immutable PGMaps simulation inputs and export record) >>`)
  const kids=[...pageIds,...m.referencePageIds,...extraPages]
  appended.push({id:m.pagesId,bytes:encoder.encode(`<< /Type /Pages /Kids [${kids.map(id=>`${id} 0 R`).join(' ')}] /Count ${kids.length} >>`)})
  appended.push({id:m.rootId,bytes:encoder.encode(`<< /Type /Catalog /Pages ${m.pagesId} 0 R /Names << /EmbeddedFiles << /Names [(pgmaps-scenario.json) ${fileSpec} 0 R] >> >> >>`)})
  const pieces=[request.template,encoder.encode('\n')],offsets=new Map<number,number>();let length=request.template.length+1
  for(const item of appended){offsets.set(item.id,length);const head=encoder.encode(`${item.id} 0 obj\n`),tail=encoder.encode('\nendobj\n');pieces.push(head,item.bytes,tail);length+=head.length+item.bytes.length+tail.length}
  const xref=length
  let ending='xref\n0 1\n0000000000 65535 f \n'
  for(const [id,offset] of [...offsets].sort(([a],[b])=>a-b)) ending+=`${id} 1\n${String(offset).padStart(10,'0')} 00000 n \n`
  ending+=`trailer\n<< /Size ${next} /Root ${m.rootId} 0 R /Prev ${m.startxref} >>\nstartxref\n${xref}\n%%EOF\n`
  const tail=encoder.encode(ending);pieces.push(tail);length+=tail.length
  const output=new Uint8Array(length);let at=0;for(const p of pieces){output.set(p,at);at+=p.length}
  return output
}
/** Browser entry point, local template, no remote PDF service. */
export async function downloadFs1252(request: Omit<ExportRequest,'template'>): Promise<void> {
  const response=await fetch(`${import.meta.env.BASE_URL}forms/fs1252-2008-04.pdf`)
  if(!response.ok) throw new Error(`Could not load the local FS1252 template (${response.status}).`)
  const bytes=await exportFs1252({...request,template:new Uint8Array(await response.arrayBuffer())})
  const blob=new Blob([new Uint8Array(bytes).buffer],{type:'application/pdf'}),url=URL.createObjectURL(blob),a=document.createElement('a')
  a.href=url;a.download=`FS1252-simulation-${request.generatedAt.slice(0,10)}.pdf`;document.body.append(a);a.click();a.remove()
  window.setTimeout(()=>URL.revokeObjectURL(url),60000)
}
