import { DEFAULT_ANALYSIS_SETTINGS } from '../types'
import { metersPerDegree } from '../visibility'
const scale=metersPerDegree(54)
export const ll=(x,y)=>[-122+x/scale.lng,54+y/scale.lat]
export const box=(x,y,w,h)=>({type:'Polygon',coordinates:[[ll(x,y),ll(x+w,y),ll(x+w,y+h),ll(x,y+h),ll(x,y)]]})
export const target=(id,role,g,extra={})=>({id,name:id,role,geometry:g,harvestYear:null,clearcutPercent:null,objectiveId:'partial-retention',vac:'medium',source:'Synthetic validation scenario',...extra})
export const plane={elevationAt(lng,lat){return 500+(lat-54)*scale.lat*.2}}
export const flat={elevationAt(){return 500}}
export const terrain={tileCount:1,missingTileCount:0,resolutionMeters:10}
export function input(targets,extra={}){return{viewpoint:{mode:'spot',coordinates:[ll(0,0)]},targets,settings:{...DEFAULT_ANALYSIS_SETTINGS,sampleBudget:900,greenAreaConfirmed:true,existingDisturbanceConfirmed:true},assessmentYear:2026,...extra}}
export function demoInput(){
 return input([
  target('Synthetic landform','landscape',box(-600,1200,1200,1200)),
  target('Proposal A','block',box(-160,1420,320,260)),
  target('Existing opening','harvested',box(300,1900,160,160),{harvestYear:2018,clearcutPercent:100,recoveryPercent:30}),
  target('Model road outside openings','harvested',box(-500,1650,40,550),{siteDisturbance:true,clearcutPercent:100}),
 ],{viewpoint:{mode:'corridor',coordinates:[ll(-400,0),ll(0,0),ll(0,200),ll(400,200)]},activeLandformId:'Synthetic landform'})
}
