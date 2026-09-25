import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import type { ForestryScene } from './scene'
import type { AnalysisResult } from './types'
import { findSceneLandform } from './sceneInput'
import { resolveThreshold } from './integrity'
import { downloadFs1252, type FormMetadata, type FormReview } from './pdf/fs1252'
/**
 * `scope` is handbook 3.3.2 — which landform the run measures against and what
 * counts as its green area. `report` is 4.0 — the FS1252 draft package.
 * The stale-run notice is the headline's, not this panel's.
 * `viaReview` is the step 4 record for the assessment station; a station's own
 * inputs here override it.
 */
type Props={part:'scope'|'report';scene:ForestryScene;onChange:(scene:ForestryScene)=>void;result:AnalysisResult|null;stale:boolean;snapshot:ForestryScene|null;currentStation:number;viaReview?:FormReview|null}
const fields: Array<[keyof FormMetadata,string]>=[['district','Forest district'],['licensee','Licensee'],['licence','Licence number'],['cuttingPermit','Cutting permit'],['blockIds','Block identifiers'],['generalLocation','General location'],['resultsOpeningId','RESULTS opening ID'],['sampleCode','Sample code'],['vliPolygon','VLI polygon number'],['vsc','Visual sensitivity class'],['evc','Existing visual condition'],['recommendedVqc','Recommended VQC'],['sourceDocument','Objective source document'],['evaluator','Prepared/evaluated by (optional)']]
const designLabels=['Response to visual force lines','Borrows from natural character','Edge treatments incorporated','Distance from viewpoint','Position on landform']
export function AssessmentPanel({part,scene,onChange,result,stale,snapshot,currentStation,viaReview}:Props){
  const [selected,setSelected]=useState<number[]>([]),[pick,setPick]=useState(0)
  const [reviews,setReviews]=useState<Record<number,FormReview>>({}),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null)
  useEffect(()=>{setSelected(result?[result.assessmentStationIndex]:[]);setPick(result?.assessmentStationIndex??0);setReviews({});setError(null)},[result])
  const landform=findSceneLandform(scene),forms=scene.targets.filter(t=>t.role==='landscape')
  const meta=scene.reportMetadata??{}
  const changeMeta=(key:keyof FormMetadata,value:string)=>onChange({...scene,reportMetadata:{...meta,[key]:value}})
  const changeReview=(index:number,patch:Partial<FormReview>)=>setReviews(current=>({...current,[index]:{...current[index],...patch}}))
  const exportPdf=async()=>{
    if(!result||!snapshot||stale)return
    setBusy(true);setError(null)
    const merged={...(viaReview?{[result.assessmentStationIndex]:viaReview}:{}),...reviews}
    try{await downloadFs1252({result,targets:snapshot.targets,viewpointName:snapshot.viewpoint.name,stationIndices:selected,metadata:meta,reviews:merged,generatedAt:new Date().toISOString()})}
    catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}
  }
  if(part==='scope')return <section className="space-y-3 text-xs" aria-label="Assessment landform">
    <label className="block">Active landform
      <select aria-label="Active assessment landform" className="mt-1 w-full rounded border bg-background p-2" value={landform?.id??''} onChange={e=>onChange({...scene,activeLandformId:e.target.value||null})}>
        <option value="">{forms.length?'Select one landform':'Draw or adopt a candidate landform'}</option>
        {forms.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
    </label>
    <p className="text-muted-foreground">An inventory sensitivity unit is only a candidate. A landform is what one viewpoint sees as a single hillside, and a unit usually holds several; confirm the boundary from the assessment viewpoint. Other landforms are not pooled into its denominator.</p>
    <label className="flex items-center justify-between gap-3">Assessment year<input className="w-24 rounded border bg-background p-1" type="number" min="1900" max="2200" value={scene.assessmentYear??new Date().getFullYear()} onChange={e=>onChange({...scene,assessmentYear:Number(e.target.value)})}/></label>
    <label className="flex items-start gap-2"><input type="checkbox" checked={scene.settings.greenAreaConfirmed===true} onChange={e=>onChange({...scene,settings:{...scene.settings,greenAreaConfirmed:e.target.checked}})}/><span>Treat the entire active landform as assessable green area — an explicit scenario assumption, not a substitute for land-cover review.</span></label>
    <label className="flex items-start gap-2"><input type="checkbox" checked={scene.settings.existingDisturbanceConfirmed===true} onChange={e=>onChange({...scene,settings:{...scene.settings,existingDisturbanceConfirmed:e.target.checked}})}/><span>The included features represent the existing disturbance for this scenario. Unlisted disturbance is not being inferred from a failed lookup.</span></label>
    {landform&&<p className="text-muted-foreground">Planimetric planning allowance: {resolveThreshold(landform.objectiveId,'planimetric',scene.thresholds,landform.vac).value}%. {resolveThreshold(landform.objectiveId,'planimetric',scene.thresholds,landform.vac).note}</p>}
    <details><summary className="cursor-pointer font-medium">Existing-opening recovery overrides</summary><div className="mt-2 space-y-2">
      <p>Empty uses the stated green-up-age assumption. A percentage is a supplied recovery estimate, not an automatically observed value. An opening 70% greened up still counts 30% of its area (handbook 3.4.2).</p>
      {scene.targets.filter(t=>t.role==='harvested'&&!t.siteDisturbance).map(t=><label key={t.id} className="flex items-center justify-between gap-2"><span className="truncate">{t.name}</span><input className="w-20 rounded border bg-background p-1" aria-label={`Recovery percent for ${t.name}`} placeholder="Age" type="number" min="0" max="100" value={t.recoveryPercent??''} onChange={e=>onChange({...scene,targets:scene.targets.map(x=>x.id===t.id?{...x,recoveryPercent:e.target.value===''?null:Number(e.target.value)}:x)})}/></label>)}
    </div></details>
  </section>
  // One export action, then what goes into it: the readiness of the run, the
  // viewpoints the PDF carries, and the export itself stay in view; choosing
  // other viewpoints and the office fields are folded under it.
  return <section className="space-y-3 text-xs" aria-label="Assessment integrity and PDF export">
    <h3 className="text-sm font-semibold">FS1252 draft package</h3>
    {result&&<>
      <InlineAlert tone={result.quality?.numericalReady?'success':'warning'}>{result.quality?.numericalReady?'Numerical fields go into the PDF':'Numerical fields are withheld from the PDF: the run is provisional'}</InlineAlert>
      <p><span className="text-muted-foreground">Viewpoints in the PDF: </span>{selected.length?selected.map(index=>`Station ${index+1} · ${(result.stations[index].distanceAlongMeters/1000).toFixed(2)} km${index===result.assessmentStationIndex?' (the assessment station)':''}`).join('; '):'none chosen'}</p>
      <Button size="sm" className="w-full touch:h-10" disabled={busy||stale||!snapshot||!selected.length||selected.length>30} onClick={()=>void exportPdf()}>{busy?'Preparing PDF…':'Export filled FS1252 PDF'}</Button>
      <p className="text-muted-foreground">The PDF takes the ocular class and ratings you recorded in step 4; field photographs, the final decision and the signature are still the reviewer's to add.</p>
      <details data-forestry-disclosure="report-viewpoints"><summary className="cursor-pointer font-medium">Choose viewpoints for the PDF ({selected.length})</summary><div className="mt-2 space-y-2">
      <p>FS1252 2008/04 — simulation draft. One form per selected station; original reference pages and a scenario appendix follow. The form has five design rows; number, size and spacing stays on the step 4 record.</p>
      <div className="flex gap-2"><select className="min-w-0 flex-1 rounded border bg-background p-1" aria-label="Report viewpoint" value={pick} onChange={e=>setPick(Number(e.target.value))}>{result.stations.map((s,i)=><option value={i} key={i}>Station {i+1} · {(s.distanceAlongMeters/1000).toFixed(2)} km{result.assessmentStationIndex===i?' · highest estimated ratio':''}</option>)}</select><Button variant="outline" size="sm" className="touch:h-10" onClick={()=>setSelected(s=>s.includes(pick)?s:[...s,pick].sort((a,b)=>a-b))}>Add</Button></div>
      <Button variant="outline" size="sm" className="touch:h-10" onClick={()=>setSelected(s=>s.includes(currentStation)?s:[...s,currentStation].sort((a,b)=>a-b))}>Add current road-view station</Button>
      {selected.map(index=><div key={index} className="rounded border p-2">
        <div className="flex justify-between"><span>Station {index+1}</span><Button variant="ghost" size="sm" className="h-auto px-1 py-0 text-xs touch:h-10" onClick={()=>setSelected(s=>s.filter(i=>i!==index))}>Remove</Button></div>
        {index===result.assessmentStationIndex&&viaReview&&!reviews[index]&&<p className="mt-1 text-muted-foreground">Design, road and retention entries come from step 4 unless you set them below.</p>}
        <details className="mt-2"><summary className="cursor-pointer">Optional reviewer-supplied design inputs</summary>
          <p className="my-2 text-muted-foreground">These five judgements are not inferred by the model. They are labelled as supplied review inputs, not a field visit.</p>
          {designLabels.map((label,i)=><label className="my-1 flex items-center justify-between gap-2" key={label}><span>{label}</span><select className="rounded border bg-background" value={reviews[index]?.design?.[i]??''} onChange={e=>{const design=[...(reviews[index]?.design??Array(5).fill(null))];design[i]=e.target.value===''?null:Number(e.target.value);changeReview(index,{design:design as FormReview['design']})}}><option value="">Not assessed</option><option value="-1">Good (-1)</option><option value="0">Moderate (0)</option><option value="1">Poor (+1)</option></select></label>)}
          <label className="my-2 flex justify-between">Roads/sidecast within openings<select className="rounded border bg-background" value={reviews[index]?.roads??''} onChange={e=>changeReview(index,{roads:e.target.value===''?null:Number(e.target.value) as 0|1|2|3})}><option value="">Not assessed</option><option value="0">None (0)</option><option value="1">Subordinate (+1)</option><option value="2">Significant (+2)</option><option value="3">Dominant (+3)</option></select></label>
          <label className="my-2 flex justify-between">Dispersed retention<select className="rounded border bg-background" value={reviews[index]?.retention??''} onChange={e=>changeReview(index,{retention:e.target.value===''?null:Number(e.target.value) as -2|-1|0})}><option value="">Not assessed</option><option value="-2">High, over 22% (-2)</option><option value="-1">Moderate, 15–22% (-1)</option><option value="0">Low, under 15% (0)</option></select></label>
          <label className="flex gap-2"><input type="checkbox" checked={reviews[index]?.retentionAlreadyNetted===true} onChange={e=>changeReview(index,{retentionAlreadyNetted:e.target.checked})}/>Retained patches were already netted from the geometry</label>
          <textarea className="mt-2 w-full rounded border bg-background p-1" aria-label={`Review notes for station ${index+1}`} maxLength={4000} placeholder="Reviewer notes and evidence" value={reviews[index]?.notes??''} onChange={e=>changeReview(index,{notes:e.target.value})}/>
        </details>
      </div>)}
      </div></details>
      <details><summary className="cursor-pointer font-medium">Run diagnostics</summary><div className="mt-2 space-y-2">
        <p>Largest landform grid cell: {result.quality?.largestGroundCellPercent?.toFixed(2)??'—'}% of green map area. This is a resolution diagnostic, not an error bound.</p>
        {result.quality?.warnings.map((message,i)=><p key={i} className="text-muted-foreground">{message}</p>)}
        <p className="text-muted-foreground">Custom planning thresholds do not replace the form’s perspective class ranges.</p>
      </div></details>
    </>}
    <details><summary className="cursor-pointer font-medium">FS1252 office information</summary><div className="mt-2 space-y-2">
      <p>Unknown fields stay blank. Export time is not a field-evaluation date. The signature and final EE decision are never auto-filled.</p>
      {fields.map(([key,label])=><label className="block" key={key}>{label}<input className="mt-1 w-full rounded border bg-background p-1" maxLength={2000} value={meta[key]??''} onChange={e=>changeMeta(key,e.target.value)}/></label>)}
    </div></details>
    {error&&<p role="alert" className="rounded border border-red-500 p-2">{error}</p>}
  </section>
}
