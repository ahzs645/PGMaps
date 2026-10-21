import { describe, expect, it } from 'vitest'
import { optimizeRoadCorridor } from './corridorOptimizer'
import type { ContextFeature, Coordinate, RoadSettings, TerrainSource } from './types'

const R = 6371008.8, RAD = Math.PI / 180, base:Coordinate = [-122.72,53.89]
const point = (x:number,y:number):Coordinate => [
  base[0]+x/(R*RAD*Math.cos(base[1]*RAD)),base[1]+y/(R*RAD),
]
const xy = (p:Coordinate):[number,number] => [
  (p[0]-base[0])*R*RAD*Math.cos(base[1]*RAD),(p[1]-base[1])*R*RAD,
]
const ground = (fn:(x:number,y:number)=>number):TerrainSource => ({
  elevationAt:(lon,lat)=>{const p=xy([lon,lat]);return fn(...p)},
})
const settings:RoadSettings={
  stationInterval:10,crossSectionHalfWidth:30,maxGradePercent:8,minRadius:35,
  cutRate:1,fillRate:1,surfacingRate:1,clearingRate:1,shrinkFactor:1,
}
const opts = { objective:'balanced' as const, corridorHalfWidthM:100 }
const box = (x0:number,y0:number,x1:number,y1:number):ContextFeature => ({
  id:'blocked',name:'Protected',kind:'avoid',geometry:{type:'Polygon',coordinates:[[
    point(x0,y0),point(x1,y0),point(x1,y1),point(x0,y1),point(x0,y0),
  ]]},
})
function sketchDistance(p:Coordinate,guide:Coordinate[]) {
  const [x,y]=xy(p)
  let distance=Infinity
  for(let i=1;i<guide.length;i++){
    const a=xy(guide[i-1]),b=xy(guide[i]),vx=b[0]-a[0],vy=b[1]-a[1]
    const f=Math.max(0,Math.min(1,((x-a[0])*vx+(y-a[1])*vy)/(vx*vx+vy*vy)))
    distance=Math.min(distance,Math.hypot(x-a[0]-f*vx,y-a[1]-f*vy))
  }
  return distance
}
describe('sketch-guided, heading-aware road optimization',()=>{
  it('keeps the exact endpoints, remains in the sketched corridor and is deterministic',()=>{
    const source=ground((x,y)=>700+0.008*x+0.006*y)
    const guide=[point(0,0),point(110,65),point(270,35)]
    const a=optimizeRoadCorridor(guide,source,settings,[],opts)
    const b=optimizeRoadCorridor(guide,source,settings,[],opts)
    expect(a).toEqual(b)
    expect(a.coordinates[0]).toEqual(guide[0])
    expect(a.coordinates[a.coordinates.length-1]).toEqual(guide[guide.length-1])
    expect(a.coordinates.every(p=>sketchDistance(p,guide)<=opts.corridorHalfWidthM+0.1)).toBe(true)
    expect(a.nominalTurnRadiusM).toBeGreaterThanOrEqual(settings.minRadius)
    expect(a.lengthM).toBeGreaterThanOrEqual(a.directM-0.2)
    expect(a.explored).toBeLessThan(70000)
    expect(a.message).toContain('design PIs')
  })
  it('goes around a mapped exclusion rather than taking a shortcut through it',()=>{
    const source=ground(()=>700)
    const guide=[point(0,0),point(140,90),point(300,0)]
    const result=optimizeRoadCorridor(guide,source,settings,[box(90,-20,210,20)],{...opts,corridorHalfWidthM:120})
    for(const p of result.coordinates) {
      const [x,y]=xy(p)
      expect(x>90.05&&x<209.95&&y>-19.95&&y<19.95).toBe(false)
    }
  })
  it('never treats no-data as level ground and screens invalid endpoints',()=>{
    expect(()=>optimizeRoadCorridor([point(0,0),point(250,0)],ground(()=>NaN),settings,[],opts)).toThrow(/terrain elevations/)
    const source=ground(x=>x>100&&x<140?NaN:700)
    expect(()=>optimizeRoadCorridor([point(0,0),point(250,0)],source,settings,[],opts)).toThrow(/No corridor candidate|budget/)
  })
  it('checks input dimensions and minimum radius assumptions',()=>{
    const flat=ground(()=>700),guide=[point(0,0),point(200,0)]
    expect(()=>optimizeRoadCorridor(guide,flat,settings,[],{...opts,corridorHalfWidthM:0})).toThrow(/half-width/)
    expect(()=>optimizeRoadCorridor(guide,flat,{...settings,minRadius:0},[],opts)).toThrow(/Minimum radius/)
  })
})
