import { test } from 'vitest';import assert from 'node:assert/strict';import fs from 'node:fs/promises'
import {exportFs1252,reviewAdjustment,formClass} from '../pdf/fs1252'
import {computeAnalysis} from '../analysis'
import {demoInput,plane,terrain} from './scenario.mjs'
const input=demoInput(),result=computeAnalysis(plane,input,terrain)
const template=new Uint8Array(await fs.readFile(new URL('../../../../public/forms/fs1252-2008-04.pdf',import.meta.url)))
const request={result,targets:input.targets,viewpointName:'Synthetic road - validation example',stationIndices:[0,result.assessmentStationIndex].filter((n,i,a)=>a.indexOf(n)===i),generatedAt:'2026-09-18T18:00:00Z',metadata:{district:'Synthetic validation only',generalLocation:'Constructed sloping plane - not a real site',sampleCode:'DEMO - NOT FIELD DATA',blockIds:'Proposal A'},template}
test('missing design observations withhold adjusted number',()=>assert.equal(reviewAdjustment(5,{}),null))
test('all five observations plus road and retention ratings calculate adjustment',()=>{const a=reviewAdjustment(5,{design:[-1,0,1,0,0],roads:1,retention:-1});assert.equal(a.adjusted,5)})
test('retention already netted cannot receive a second discount',()=>{const a=reviewAdjustment(5,{design:[0,0,0,0,0],roads:0,retention:-2,retentionAlreadyNetted:true});assert.equal(a.adjusted,5)})
test('FS1252 numerical class uses perspective thresholds',()=>{assert.equal(formClass(12),'M');assert.equal(formClass(NaN),'');assert.equal(formClass(-1),'')})
test('writer rejects wrong template version before modifying bytes',async()=>{const broken=template.slice();broken[100]^=1;await assert.rejects(()=>exportFs1252({...request,template:broken}),/does not match/)})
test('writer rejects modified immutable input record',async()=>{const altered=structuredClone(result);altered.inputSnapshot.assessmentYear++;await assert.rejects(()=>exportFs1252({...request,result:altered}),/has changed/)})
test('writer rejects invalid and empty station selections',async()=>{await assert.rejects(()=>exportFs1252({...request,stationIndices:[]}),/Choose/);await assert.rejects(()=>exportFs1252({...request,stationIndices:[900]}),/Choose/)})
test('actual PDF export retains original bytes, contains draft marker and embedded scenario',async()=>{const bytes=await exportFs1252(request);assert.deepEqual(bytes.subarray(0,template.length),template);const added=new TextDecoder().decode(bytes.subarray(template.length));assert.ok(added.includes('SIMULATION DRAFT'));assert.ok(added.includes('pgmaps-scenario.json'));assert.ok(!added.includes('(Signature)'));assert.ok(bytes.length > template.length)})
test('unverified data still exports metadata draft but not a bogus numeric zero',async()=>{const partial=structuredClone(result);partial.quality.numericalReady=false;const bytes=await exportFs1252({...request,result:partial,stationIndices:[0]});const added=new TextDecoder().decode(bytes.subarray(template.length));assert.ok(added.includes('Numerical fields withheld'));assert.ok(bytes.length > template.length)})
