import { test } from 'vitest'
import assert from 'node:assert/strict'
import {buildReport} from '../report'
import {sceneFingerprint,buildSceneInput,findSceneLandform} from '../sceneInput'
import {resolvedThresholds} from '../integrity'
import {computeAnalysis} from '../analysis'
import {DEFAULT_VISUAL_QUALITY_THRESHOLDS} from '../vqo'
import {demoInput,plane,terrain} from './scenario.mjs'
const a=demoInput()
const scene={...a,viewpoint:{...a.viewpoint,id:'vp',name:'Synthetic road'},thresholds:structuredClone(DEFAULT_VISUAL_QUALITY_THRESHOLDS)}
const make=()=>{const result=computeAnalysis(plane,a,terrain);return {result,targets:a.targets,thresholds:scene.thresholds,viewpointName:'Synthetic road',generatedAt:new Date('2026-09-18T18:00:00Z')}}
test('report leaves unsupported partial cutting quantities blank',()=>{const text=buildReport(make());assert.match(text,/actual volume removed ______/);assert.match(text,/green-up height is not residual-tree height/);assert.match(text,/Signature: ______/)})
test('provisional report withholds numerical classification',()=>{const input=make();input.result.quality.numericalReady=false;const text=buildReport(input);assert.match(text,/WITHHELD/);assert.match(text,/Undetermined/);assert.doesNotMatch(text,/\*\*Within\*\*/)})
test('form metadata edits do not invalidate geometry calculations',()=>{assert.equal(sceneFingerprint(scene),sceneFingerprint({...scene,reportMetadata:{licensee:'Example'}}))})
test('objective and active landform changes invalidate the report snapshot',()=>{const changed=structuredClone(scene);changed.targets[0].objectiveId='retention';assert.notEqual(sceneFingerprint(scene),sceneFingerprint(changed));assert.notEqual(sceneFingerprint(scene),sceneFingerprint({...scene,activeLandformId:'other'}))})
test('scene input survives JSON serialization without changing optional fields',()=>assert.deepEqual(JSON.parse(JSON.stringify(buildSceneInput(scene))),JSON.parse(JSON.stringify(buildSceneInput(JSON.parse(JSON.stringify(scene)))))))
test('invalid selected landform is not silently replaced',()=>assert.equal(findSceneLandform({...scene,activeLandformId:'gone'}),null))
test('all planning class boundaries use the same VAC scale',()=>{const thresholds=resolvedThresholds('retention','planimetric',scene.thresholds,'low');assert.equal(thresholds.planimetric.retention,1.1);assert.equal(thresholds.planimetric['partial-retention'],5.1);assert.equal(thresholds.planimetric.modification,15.1)})
