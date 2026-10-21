/** Preliminary curvature-aware, sketch-guided forestry road search; NOT an engineered alignment. */
import type { ContextFeature, Coordinate, RoadSettings, TerrainSource } from './types'
export type RoadOptimizationObjective = 'shortest' | 'balanced' | 'contour'
export interface RoadOptimizationOptions { objective: RoadOptimizationObjective; corridorHalfWidthM: number }
export interface RoadOptimizationResult {
  coordinates: Coordinate[]; lengthM: number; directM: number; explored: number
  maxSampledGroundPitchPercent: number; groundAscentM: number; groundDescentM: number
  nominalTurnRadiusM: number; message: string
}
type XY=[number,number]
type Pose={ xy:XY; heading:number; cost:number; parent:number; length:number; rise:number; fall:number }
const R=6371008.8, RAD=Math.PI/180, BINS=16, TURN=2*Math.PI/BINS
const weights:Record<RoadOptimizationObjective,{grade:number;turn:number;guide:number}>={
  shortest:{grade:0.2,turn:0.4,guide:0.15},
  balanced:{grade:2.3,turn:1.2,guide:0.18},
  contour:{grade:7,turn:1.6,guide:0.14},
}
class Queue {
  private a:Array<{id:number;f:number;tie:number}>=[]
  push(p:{id:number;f:number;tie:number}) {
    let i=this.a.length;this.a.push(p)
    while(i) {const j=(i-1)>>1, q=this.a[j];if(q.f<p.f || (q.f===p.f && q.tie<=p.tie))break;this.a[i]=q;i=j}
    this.a[i]=p
  }
  pop() {
    const first=this.a[0],last=this.a.pop();if(!last || !this.a.length)return first
    let i=0;while(i*2+1<this.a.length) {
      let j=i*2+1
      if(j+1<this.a.length && (this.a[j+1].f<this.a[j].f || (this.a[j+1].f===this.a[j].f && this.a[j+1].tie<this.a[j].tie)))j++
      const child=this.a[j]
      if(last.f<child.f || (last.f===child.f && last.tie<=child.tie))break
      this.a[i]=child;i=j
    }
    this.a[i]=last;return first
  }
  get length(){return this.a.length}
}
function segDist(p:XY,a:XY,b:XY) {
  const vx=b[0]-a[0],vy=b[1]-a[1]
  const t=Math.max(0,Math.min(1,((p[0]-a[0])*vx+(p[1]-a[1])*vy)/Math.max(1e-12,vx*vx+vy*vy)))
  return Math.hypot(p[0]-a[0]-t*vx,p[1]-a[1]-t*vy)
}
function inside(p:XY,ring:XY[]) {
  let result=false
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[i],b=ring[j]
    if(segDist(p,a,b)<0.01)return true
    if((a[1]>p[1])!==(b[1]>p[1]) && p[0]<((b[0]-a[0])*(p[1]-a[1]))/(b[1]-a[1])+a[0])result=!result
  }
  return result
}
function crosses(a:XY,b:XY,c:XY,d:XY){
  const o=(p:XY,q:XY,r:XY)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0])
  return ((o(a,b,c)>0)!==(o(a,b,d)>0))&&((o(c,d,a)>0)!==(o(c,d,b)>0))
}
export function optimizeRoadCorridor(
  guide:Coordinate[],terrain:TerrainSource,settings:RoadSettings,context:ContextFeature[],opts:RoadOptimizationOptions,
):RoadOptimizationResult {
  if(guide.length<2 || guide.length>100 || guide.some(p=>p.length!==2 || !p.every(Number.isFinite)||Math.abs(p[0])>180||Math.abs(p[1])>=85))
    throw Error('Sketch between 2 and 100 valid road points.')
  if(!Object.hasOwn(weights,opts.objective))throw Error('Invalid optimization objective.')
  const width=opts.corridorHalfWidthM
  if(!Number.isFinite(width)||width<25||width>1000)throw Error('Corridor half-width must be 25–1,000 metres.')
  if(!Number.isFinite(settings.maxGradePercent)||settings.maxGradePercent<1||settings.maxGradePercent>30)
    throw Error('Choose a ground-grade screening setting between 1% and 30%.')
  if(!Number.isFinite(settings.minRadius)||settings.minRadius<5||settings.minRadius>1000)
    throw Error('Minimum radius must be 5–1,000 metres.')
  const origin=guide[0],cos=Math.cos(((origin[1]+guide[guide.length-1][1])/2)*RAD)
  const toXY=(c:Coordinate):XY=>[(c[0]-origin[0])*RAD*R*cos,(c[1]-origin[1])*RAD*R]
  const fromXY=(p:XY):Coordinate=>[origin[0]+p[0]/(RAD*R*cos),origin[1]+p[1]/(RAD*R)]
  const sketch=guide.map(toXY),target=sketch[sketch.length-1]
  const direct=Math.hypot(...target)
  if(direct<10||direct>5000)throw Error('Optimize a road between 10 metres and 5 km.')
  const minX=Math.min(...sketch.map(p=>p[0]))-width-25,maxX=Math.max(...sketch.map(p=>p[0]))+width+25
  const minY=Math.min(...sketch.map(p=>p[1]))-width-25,maxY=Math.max(...sketch.map(p=>p[1]))+width+25
  const cell=Math.max(5,(maxX-minX)/90,(maxY-minY)/90),cols=Math.ceil((maxX-minX)/cell)+1,rows=Math.ceil((maxY-minY)/cell)+1
  const step=Math.max(15,cell*1.5),delta=Math.min(TURN,step/settings.minRadius),radius=step/delta
  const polys:XY[][][]=[],streams:Array<[XY,XY]>=[],barriers:Array<[XY,XY]>=[]
  let featureVertices=0
  for(const f of context) {
    if(f.kind!=='stream'&&f.kind!=='avoid')continue
    const paths=f.geometry.type==='Polygon'?f.geometry.coordinates:[f.geometry.coordinates]
    featureVertices+=paths.reduce((s,p)=>s+p.length,0)
    if(featureVertices>20000)throw Error('Crop constraint features to the corridor (20,000-vertex maximum).')
    const local=paths.map(path=>path.map(p=>toXY([p[0],p[1]])))
    if(f.kind==='avoid'&&f.geometry.type==='Polygon')polys.push(local)
    for(const path of local)for(let i=1;i<path.length;i++)
      (f.kind==='stream'?streams:barriers).push([path[i-1],path[i]])
  }
  const offset=(p:XY)=>Math.min(...sketch.slice(1).map((next,i)=>segDist(p,sketch[i],next)))
  const permitted=(p:XY)=>{
    if(p[0]<minX||p[0]>maxX||p[1]<minY||p[1]>maxY||offset(p)>width+1e-6)return false
    return !polys.some(poly=>inside(p,poly[0])&&!poly.slice(1).some(hole=>inside(p,hole)))
  }
  let calls=0
  const elevation=(p:XY)=>{if(++calls>900000)throw Error('Exceeded the terrain sampling budget; narrow the corridor.');return terrain.elevationAt(...fromXY(p))}
  if(!permitted([0,0])||!permitted(target))throw Error('An endpoint is outside the corridor or in an exclusion polygon.')
  const zStart=elevation([0,0]),zEnd=elevation(target)
  if(!Number.isFinite(zStart)||!Number.isFinite(zEnd))throw Error('Both road endpoints need native terrain elevations.')
  const index=(p:XY,heading:number)=>{
    const c=Math.round((p[0]-minX)/cell),r=Math.round((p[1]-minY)/cell)
    if(c<0||r<0||c>=cols||r>=rows)return -1
    return ((r*cols+c)*BINS+((Math.round(heading/TURN)%BINS+BINS)%BINS))
  }
  const arc=(p:Pose,steer:number,t:number):XY=>{
    const a=steer*t,L=step*t
    const k=Math.abs(a)<1e-9?1:Math.sin(a/2)/(a/2)
    return [p.xy[0]+L*k*Math.cos(p.heading+a/2),p.xy[1]+L*k*Math.sin(p.heading+a/2)]
  }
  const pq=new Queue(),pose=new Map<number,Pose>(),done=new Set<number>()
  let serial=0,explored=0,finalId=-1
  for(let h=0;h<BINS;h++) {
    const id=index([0,0],h*TURN)
    pose.set(id,{xy:[0,0],heading:h*TURN,cost:0,parent:-1,length:0,rise:0,fall:0})
    pq.push({id,f:direct,tie:serial++})
  }
  const tuning=weights[opts.objective]
  while(pq.length){
    const top=pq.pop();if(!top||done.has(top.id))continue
    const p=pose.get(top.id)!;done.add(top.id)
    if(++explored>70000)throw Error('Corridor search reached its node budget; narrow the guide or split the road.')
    const remaining=Math.hypot(target[0]-p.xy[0],target[1]-p.xy[1])
    if(remaining<step*0.7){
      const angle=Math.atan2(target[1]-p.xy[1],target[0]-p.xy[0])
      const headingDelta=Math.abs(((angle-p.heading+3*Math.PI)%(2*Math.PI))-Math.PI)
      if(remaining<1e-5||headingDelta<=Math.min(delta*1.3,remaining/settings.minRadius+0.15)){
        let clear=true,prev=p.xy
        for(let k=1;k<=Math.max(1,Math.ceil(remaining/3));k++){
          const n=Math.max(1,Math.ceil(remaining/3)),at:XY=[p.xy[0]+(target[0]-p.xy[0])*k/n,p.xy[1]+(target[1]-p.xy[1])*k/n]
          if(!permitted(at)||!Number.isFinite(elevation(at))||barriers.some(([a,b])=>crosses(prev,at,a,b))){clear=false;break}
          prev=at
        }
        if(clear){finalId=top.id;break}
      }
    }
    const z=elevation(p.xy)
    if(!Number.isFinite(z))continue
    for(const steering of [-delta,0,delta]){
      const dest=arc(p,steering,1),nextId=index(dest,p.heading+steering)
      if(nextId<0||done.has(nextId)||!permitted(dest))continue
      const subdivisions=Math.max(4,Math.ceil(step/5))
      let previous=p.xy,zBefore=z,up=0,down=0,maxPitch=0,streamCrossings=0,ok=true
      for(let k=1;k<=subdivisions;k++){
        const at=arc(p,steering,k/subdivisions)
        if(!permitted(at)||barriers.some(([a,b])=>crosses(previous,at,a,b))){ok=false;break}
        const nextZ=elevation(at)
        if(!Number.isFinite(nextZ)){ok=false;break}
        const dZ=nextZ-zBefore
        maxPitch=Math.max(maxPitch,Math.abs(dZ)/(step/subdivisions)*100)
        up+=Math.max(0,dZ);down+=Math.max(0,-dZ)
        streamCrossings+=streams.filter(([a,b])=>crosses(previous,at,a,b)).length
        previous=at;zBefore=nextZ
      }
      if(!ok||maxPitch>settings.maxGradePercent*2.1)continue
      const groundGrade=(zBefore-z)/step*100
      const score=p.cost+step*(1+tuning.grade*(groundGrade/settings.maxGradePercent)**2+
        tuning.turn*(steering/TURN)**2+tuning.guide*(offset(dest)/width)**2)+streamCrossings*130
      if((pose.get(nextId)?.cost??Infinity)<=score)continue
      pose.set(nextId,{xy:dest,heading:(p.heading+steering+2*Math.PI)%(2*Math.PI),
        cost,parent:top.id,length:p.length+step,rise:p.rise+up,fall:p.fall+down})
      pq.push({id:nextId,f:score+Math.hypot(target[0]-dest[0],target[1]-dest[1]),tie:serial++})
    }
  }
  if(finalId<0)throw Error('No corridor candidate found. Widen the corridor or inspect terrain gaps, exclusions and grade constraints.')
  const reversed:XY[]=[],last=pose.get(finalId)!
  for(let k=finalId;k>=0;){
    const p=pose.get(k)
    if(!p)throw Error('Optimizer parent reference is missing.')
    reversed.push(p.xy);k=p.parent
    if(reversed.length>2000)throw Error('Candidate exceeded the maximum road-point count.')
  }
  reversed.reverse()
  const gap=Math.hypot(last.xy[0]-target[0],last.xy[1]-target[1])
  if(gap>0.001)reversed.push(target)
  if(reversed.length<2)throw Error('Candidate has insufficient road points.')
  const coordinates=reversed.map(fromXY)
  coordinates[0]=[...guide[0]];coordinates[coordinates.length-1]=[...guide[guide.length-1]]
  let peak=0,up=0,down=0
  // Re-sample the returned chords independently, not all edges explored.
  for(let i=1;i<reversed.length;i++){
    const a=reversed[i-1],b=reversed[i],distance=Math.hypot(a[0]-b[0],a[1]-b[1])
    const count=Math.max(1,Math.ceil(distance/2.5))
    let zPrior=elevation(a)
    for(let j=1;j<=count;j++){
      const at:XY=[a[0]+(b[0]-a[0])*j/count,a[1]+(b[1]-a[1])*j/count]
      const now=elevation(at),deltaZ=now-zPrior
      if(!Number.isFinite(now)||!permitted(at))throw Error('Candidate left terrain coverage or the corridor after sampling.')
      peak=Math.max(peak,Math.abs(deltaZ)/(distance/count)*100)
      up+=Math.max(0,deltaZ);down+=Math.max(0,-deltaZ);zPrior=now
    }
  }
  const length=last.length+gap
  let warning=' Arc primitives are sampled into control points; design PIs, vertical curves, cuts/fills, crossings and stability need review.'
  if(Math.abs(zEnd-zStart)/length*100>settings.maxGradePercent)
    warning+=' Endpoint rise exceeds the configured grade over the candidate length.'
  return {coordinates,lengthM:length,directM:direct,explored,maxSampledGroundPitchPercent:peak,
    groundAscentM:up,groundDescentM:down,nominalTurnRadiusM:radius,
    message:'Sketched corridor · '+opts.objective+': '+Math.round(length)+' m, '+peak.toFixed(1)+'% maximum sampled ground pitch, nominal search radius '+radius.toFixed(0)+' m, '+explored+' states.'+warning}
}
