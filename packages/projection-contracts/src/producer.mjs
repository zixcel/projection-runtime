// Hatter 2026: temporal presentation reads only explicit paths in exact visible items.
import {canonical,copy,digest,fail,frozen,limits,list,refs,request,roles,shape,sourceKey,sourceRef,text,unique} from './contract.mjs'
import {validateInputDeclaration} from '@zixcel/interaction/input'
function item(v,source){
  shape(v,['id','semanticRef','group','value','evidence','provenance','resolutionRefs','visibility'])
  text(v.id);if(v.semanticRef!==null)text(v.semanticRef)
  shape(v.group,['kind','ref']);if(!['semantic','structural','presentation'].includes(v.group.kind))fail('InvalidProjection');text(v.group.ref)
  if(v.group.kind==='semantic'&&v.group.ref!==v.semanticRef)fail('InvalidProjection')
  if(!['visible','redacted','omitted'].includes(v.visibility))fail('InvalidProjection')
  refs(v.evidence);refs(v.provenance);refs(v.resolutionRefs)
  if(v.visibility==='omitted')return null
  if(v.visibility==='redacted')return {id:v.id,semanticRef:null,group:{kind:'presentation',ref:'redacted'},value:null,evidence:[],provenance:[],resolutionRefs:[],visibility:'redacted',sourceRefs:[source]}
  return {...copy(v),sourceRefs:[source]}
}
function unresolved(v,source){
  shape(v,['id','reason','evidence','contextRefs','actionRefs']);text(v.id);text(v.reason);refs(v.evidence);refs(v.contextRefs);refs(v.actionRefs)
  return {...copy(v),sourceRefs:[source]}
}
function seal(kind,key,lineage,data,maximum){
  const body={contract:'projection/0.10.0',kind,key,lineage,data}
  const revision='pp:'+digest(body),snapshot={...body,revision}
  canonical(snapshot,maximum);return frozen(snapshot)
}
export function produce(input,exactSources){
  const r=request(input),l=r.limits
  canonical(exactSources);list(exactSources,l.sources)
  if(exactSources.length!==r.sources.length)fail('SourceUnavailable')
  const sources=new Map()
  for(const s of exactSources){
    shape(s,['source','items','relations','unresolved','truncated']);sourceRef(s.source)
    if(typeof s.truncated!=='boolean')fail('InvalidProjection')
    const key=sourceKey(s.source);if(sources.has(key))fail('InvalidSourceRevision');sources.set(key,s)
  }
  const items=[],relations=[],unresolvedItems=[];let truncated=false,omitted=0
  for(const ref of r.sources){
    const s=sources.get(sourceKey(ref));if(!s)fail('InvalidSourceRevision')
    for(const v of list(s.items,l.items)){const next=item(v,ref);if(next)items.push(next);else omitted++}
    for(const v of list(s.unresolved,l.unresolved))unresolvedItems.push(unresolved(v,ref))
    for(const v of list(s.relations,l.relations)){
      shape(v,['id','from','to','relationRef']);Object.values(v).forEach(x=>text(x));relations.push({...copy(v),sourceRefs:[ref]})
    }
    truncated ||= s.truncated
  }
  list(items,l.items);list(relations,l.relations);list(unresolvedItems,l.unresolved)
  unique([...items,...unresolvedItems],v=>v.id);unique(relations,v=>v.id)
  const ids=new Set(items.filter(v=>v.visibility==='visible').map(v=>v.id))
  // Owners must remove relationships to omitted/redacted data in their visibility view.
  for(const v of relations)if(!ids.has(v.from)||!ids.has(v.to))fail('InvalidProjection')
  const count=items.reduce((n,v)=>n+v.provenance.length,0)+unresolvedItems.reduce((n,v)=>n+v.evidence.length,0)
  if(count>l.provenance)fail('ProjectionLimitExceeded')
  for(const values of [items,relations,unresolvedItems])values.sort((a,b)=>a.id<b.id?-1:1)
  return seal('Data',r.key,{sources:r.sources,producer:r.producer,request:r},
    {items,relations,unresolved:unresolvedItems,truncated,omittedByPolicy:omitted},l.snapshotBytes)
}
export function validateSnapshot(v){
  canonical(v,524288);shape(v,['contract','kind','key','lineage','data','revision'])
  if(v.contract!=='projection/0.10.0'||!['Data','Scene'].includes(v.kind))fail('InvalidProjection')
  const {revision,...body}=v;if(revision!=='pp:'+digest(body))fail('InvalidProjection')
  // Wire objects originate from the closed producer contract. Re-run structure
  // validation through its exact input contract; content hash alone is not enough.
  shape(v.lineage,['sources','producer','request'],v.kind==='Scene'?['dataProjection','sceneConfiguration']:[])
  const r=request(v.lineage.request),l=r.limits;text(v.key);canonical(v,l.snapshotBytes)
  if(canonical(v.lineage.sources)!==canonical(v.lineage.request.sources)||canonical(v.lineage.producer)!==canonical(v.lineage.request.producer))fail('InvalidProjection')
  const d=v.data
  shape(d,['items','relations','unresolved','truncated','omittedByPolicy'],v.kind==='Scene'?['focus','purpose','regions','actions','temporal','presentation']:[])
  if(typeof d.truncated!=='boolean'||!Number.isSafeInteger(d.omittedByPolicy)||d.omittedByPolicy<0||d.omittedByPolicy>l.sources*l.items)fail('InvalidProjection')
  const known=new Set(r.sources.map(sourceKey))
  const checkSource=x=>{list(x.sourceRefs,1);if(x.sourceRefs.length!==1||!known.has(sourceKey(x.sourceRefs[0])))fail('InvalidSourceRevision')}
  for(const x of list(d.items,l.items)){
    checkSource(x);const {sourceRefs,...body}=x
    if(canonical(item(body,sourceRefs[0]))!==canonical(x))fail('InvalidProjection')
  }
  for(const x of list(d.unresolved,l.unresolved)){
    checkSource(x);const {sourceRefs,...body}=x;unresolved(body,sourceRefs[0])
  }
  unique([...d.items,...d.unresolved],x=>x.id);unique(list(d.relations,l.relations),x=>x.id)
  const ids=new Set(d.items.filter(x=>x.visibility==='visible').map(x=>x.id))
  for(const x of d.relations){shape(x,['id','from','to','relationRef','sourceRefs']);checkSource(x)
    for(const key of ['id','from','to','relationRef'])text(x[key]);if(!ids.has(x.from)||!ids.has(x.to))fail('InvalidProjection')}
  if(d.items.reduce((n,x)=>n+x.provenance.length,0)+d.unresolved.reduce((n,x)=>n+x.evidence.length,0)>l.provenance)fail('ProjectionLimitExceeded')
  if(v.kind==='Data'){if(v.key!==r.key)fail('InvalidProjection')}
  else{
    shape(v.lineage.dataProjection,['key','revision'])
    const base=seal('Data',r.key,{sources:r.sources,producer:r.producer,request:r},
      {items:d.items,relations:d.relations,unresolved:d.unresolved,truncated:d.truncated,omittedByPolicy:d.omittedByPolicy},l.snapshotBytes)
    if(base.key!==v.lineage.dataProjection.key||base.revision!==v.lineage.dataProjection.revision)fail('InvalidProjection')
    const rebuilt=scene(base,v.lineage.sceneConfiguration)
    if(canonical(rebuilt)!==canonical(v))fail('InvalidProjection')
  }
  return v
}
export function scene(data,configuration){
  validateSnapshot(data);if(data.kind!=='Data')fail('InvalidProjection')
  canonical(configuration);shape(configuration,['key','focus','purpose','regions','actions'],['temporal','presentation'])
  text(configuration.key);text(configuration.focus);text(configuration.purpose)
  const l=limits(data.lineage.request.limits),ids=new Set([...data.data.items,...data.data.unresolved].map(x=>x.id))
  const regions=unique(list(configuration.regions,l.regions).map(v=>{
    shape(v,['id','role','itemIds']);text(v.id);if(!roles.includes(v.role))fail('InvalidProjection')
    unique(refs(v.itemIds,l.items));if(v.itemIds.some(id=>!ids.has(id)))fail('InvalidProjection');return copy(v)
  }),v=>v.id)
  const actions=unique(list(configuration.actions,l.actions).map(v=>{
    shape(v,['id','targetOwner','commandRef','contextRefs','sourceRefs','label'],['interaction'])
    text(v.id);text(v.targetOwner);text(v.commandRef);text(v.label,1024);refs(v.contextRefs)
    const expected=new Set(data.lineage.sources.map(sourceKey));list(v.sourceRefs,l.sources).forEach(s=>{if(!expected.has(sourceKey(s)))fail('InvalidSourceRevision')})
    if(!v.sourceRefs.length)fail('InvalidSourceRevision')
    if(v.interaction!==undefined){
      const i=v.interaction
      shape(i,['ref','generation','inputContractRef','input'])
      text(i.ref);text(i.generation);text(i.inputContractRef)
      if(validateInputDeclaration(i.input).length)fail('InvalidProjection')
      if(i.input.action.contract_revision!==i.inputContractRef||i.input.action.operation_id!==v.commandRef)fail('InvalidProjection')
    }
    return copy(v)
  }),v=>v.id)
  const lineage={...copy(data.lineage),dataProjection:{key:data.key,revision:data.revision},sceneConfiguration:copy(configuration)}
  const visibleValue=(itemId,valuePath)=>{
    text(itemId);list(valuePath,16).forEach(key=>text(key,256))
    const item=data.data.items.find(item=>item.id===itemId&&item.visibility==='visible')
    if(!item)fail('InvalidProjection')
    let value=item.value
    for(const key of valuePath){if(value===null||typeof value!=='object'||!Object.hasOwn(value,key))fail('InvalidProjection');value=value[key]}
    return value
  }
  let presentation
  if(configuration.presentation!==undefined)presentation=unique(list(configuration.presentation,l.items).map(binding=>{
    shape(binding,['itemId'],['titlePath','title','summaryPath','fields','symbol']);visibleValue(binding.itemId,[])
    if(Object.hasOwn(binding,'title')===Object.hasOwn(binding,'titlePath'))fail('InvalidProjection')
    const title=Object.hasOwn(binding,'titlePath')?visibleValue(binding.itemId,binding.titlePath):binding.title;text(title,1024)
    // Presentation labels never become semantics or permission. Field values are exact visible source paths.
    const fields=binding.fields===undefined?undefined:list(binding.fields,16).map(field=>{
      shape(field,['label','valuePath']);text(field.label,256)
      const value=visibleValue(binding.itemId,field.valuePath)
      if(value!==null&&!['string','boolean','number'].includes(typeof value))fail('InvalidProjection')
      if(typeof value==='string'&&value.length>4096)fail('ProjectionLimitExceeded')
      return {label:field.label,value}
    })
    if(binding.symbol!==undefined)text(binding.symbol,64)
    const summary=binding.summaryPath===undefined?undefined:visibleValue(binding.itemId,binding.summaryPath)
    if(summary!==undefined)text(summary,2048)
    return {itemId:binding.itemId,title,...(summary===undefined?{}:{summary}),...(fields===undefined?{}:{fields}),...(binding.symbol===undefined?{}:{symbol:binding.symbol})}
  }),item=>item.itemId)
  let temporal
  if(configuration.temporal!==undefined){
    const declaration=configuration.temporal;shape(declaration,['label','items']);text(declaration.label,256)
    const items=unique(list(declaration.items,l.items).map(binding=>{
      shape(binding,['itemId','valuePath','format']);text(binding.itemId);list(binding.valuePath,16).forEach(key=>text(key,256))
      if(!['utcInstant','unixMilliseconds'].includes(binding.format))fail('InvalidProjection')
      let at=visibleValue(binding.itemId,binding.valuePath)
      if(binding.format==='unixMilliseconds'){
        if(!Number.isSafeInteger(at)||at<0||at>253402300799999)fail('InvalidProjection')
        at=new Date(at).toISOString()
      }
      // Declared encodings only: no field-name heuristic, coercion or inferred date.
      if(typeof at!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(at)||!Number.isFinite(Date.parse(at))||new Date(at).toISOString()!==at)fail('InvalidProjection')
      return {itemId:binding.itemId,at}
    }),item=>item.itemId).sort((a,b)=>a.at===b.at?(a.itemId<b.itemId?-1:1):(a.at<b.at?-1:1))
    temporal={label:declaration.label,items}
  }
  return seal('Scene',configuration.key,lineage,{...copy(data.data),focus:configuration.focus,purpose:configuration.purpose,regions,actions,...(temporal?{temporal}:{}),...(presentation?{presentation}:{})},l.snapshotBytes)
}
export function rebuild(input,readExact){
  const r=request(input)
  const sources=r.sources.map(ref=>{
    let value;try{value=readExact(ref)}catch{fail('ProjectionRebuildUnavailable')}
    if(value?.then){Promise.resolve(value).catch(()=>{});fail('ProjectionRebuildUnavailable')}
    if(value==null)fail('ProjectionRebuildUnavailable');return value
  })
  return produce(r,sources)
}
export function recovery(snapshot,receiverRevision){
  validateSnapshot(snapshot)
  if(receiverRevision!==null)text(receiverRevision)
  if(receiverRevision===snapshot.revision)return {kind:'NoChange',revision:snapshot.revision}
  return {kind:'Snapshot',revision:snapshot.revision,payload:Buffer.from(canonical(snapshot,524288))}
}
export function adoptSnapshot(snapshot,expected){
  shape(expected,['key','revision']);text(expected.key);text(expected.revision);validateSnapshot(snapshot)
  if(snapshot.key!==expected.key||snapshot.revision!==expected.revision)fail('InvalidSourceRevision')
  return frozen(copy(snapshot))
}
