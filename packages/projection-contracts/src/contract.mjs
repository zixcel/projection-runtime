import {sha256} from '#hash'
const encoder=new TextEncoder()
const byteLength=value=>encoder.encode(value).length
export class ProjectionError extends Error {constructor(code){super(code);this.code=code}}
export const fail=code=>{throw new ProjectionError(code)}
export const LIMITS=Object.freeze({sources:8,items:256,relations:512,provenance:512,unresolved:64,regions:16,actions:64,snapshotBytes:524288})
export function limits(input={}){
  shape(input,[],Object.keys(LIMITS));const result={...LIMITS,...input}
  for(const key in result)if(!Number.isSafeInteger(result[key])||result[key]<1||result[key]>LIMITS[key])fail('ProjectionLimitExceeded')
  return Object.freeze(result)
}
export function shape(v,required,optional=[]){
  if(!v||Object.getPrototypeOf(v)!==Object.prototype||required.some(k=>!Object.hasOwn(v,k)))fail('InvalidProjection')
  for(const k of Object.getOwnPropertyNames(v)){
    const d=Object.getOwnPropertyDescriptor(v,k)
    if(!d.enumerable||d.get||d.set||(!required.includes(k)&&!optional.includes(k)))fail('InvalidProjection')
  }
  if(Object.getOwnPropertySymbols(v).length)fail('InvalidProjection')
}
export function text(v,max=512){if(typeof v!=='string'||!v.length||v.length>max||byteLength(v)>max||!v.isWellFormed()||/[\x00-\x1f\x7f]/u.test(v))fail('InvalidProjection');return v}
export function list(v,max){if(!Array.isArray(v)||v.length>max)fail('ProjectionLimitExceeded');return v}
export function refs(v,max=32){return list(v,max).map(x=>text(x))}
// Bounded plain JSON only. No callbacks, toJSON, prototypes or renderer execution.
export function canonical(value,maximum=2097152){
  let bytes=0,nodes=0
  const add=n=>{bytes+=n;if(bytes>maximum)fail('ProjectionLimitExceeded')}
  function walk(v,depth){
    if(++nodes>32768||depth>16)fail('ProjectionLimitExceeded')
    if(v===null||typeof v==='boolean'){add(5);return v}
    if(typeof v==='number'){if(!Number.isSafeInteger(v))fail('InvalidProjection');add(24);return v}
    if(typeof v==='string'){if(v.length>maximum)fail('ProjectionLimitExceeded');if(!v.isWellFormed())fail('InvalidProjection');add(byteLength(v)+2);return v}
    if(Array.isArray(v)){add(v.length+2);if(v.length>4096)fail('ProjectionLimitExceeded');return v.map(x=>walk(x,depth+1))}
    if(!v||Object.getPrototypeOf(v)!==Object.prototype)fail('InvalidProjection')
    const keys=Object.getOwnPropertyNames(v);if(keys.length>1024||Object.getOwnPropertySymbols(v).length)fail('ProjectionLimitExceeded')
    const out={};add(keys.length+2)
    for(const k of keys.sort()){
      const d=Object.getOwnPropertyDescriptor(v,k)
      if(!d.enumerable||d.get||d.set||['__proto__','constructor','prototype','toJSON'].includes(k))fail('InvalidProjection')
      text(k,512);add(byteLength(k)+3);out[k]=walk(v[k],depth+1)
    }
    return out
  }
  const encoded=JSON.stringify(walk(value,0));if(byteLength(encoded)>maximum)fail('ProjectionLimitExceeded');return encoded
}
export const digest=value=>sha256(canonical(value))
export function frozen(v){if(v&&typeof v==='object'){Object.values(v).forEach(frozen);Object.freeze(v)}return v}
export function copy(v){return JSON.parse(canonical(v))}
export function sourceRef(v){shape(v,['owner','ref','revision','kind']);for(const k of ['owner','ref','revision','kind'])text(v[k]);return copy(v)}
export const sourceKey=v=>canonical(sourceRef(v))
export function unique(values,key=x=>x){const ids=new Set();for(const v of values){const id=key(v);if(ids.has(id))fail('InvalidProjection');ids.add(id)}return values}
export const roles=Object.freeze(['Primary','Context','Interpretation','Evidence','Provenance','Resolution','Inspector','Actions','Activity'])
export function request(v){
  canonical(v);shape(v,['key','producer','sources','focus','purpose','visibilityRef','limits'])
  text(v.key);text(v.focus);text(v.purpose);text(v.visibilityRef)
  shape(v.producer,['id','version','contract','configuration']);text(v.producer.id);text(v.producer.version);text(v.producer.contract);text(v.producer.configuration)
  const l=limits(v.limits),sources=unique(list(v.sources,l.sources).map(sourceRef),s=>canonical([s.owner,s.ref])).sort((a,b)=>sourceKey(a)<sourceKey(b)?-1:1)
  if(!sources.length)fail('SourceUnavailable')
  return frozen({...copy(v),sources,limits:l})
}
