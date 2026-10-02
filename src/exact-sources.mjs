import {canonical,produce} from '@hathq/projection-contracts'
import {check,clone,token} from './common.mjs'

// Generic lifecycle orchestration only. Owners decide visibility, exact payload,
// closure (including []), physical protection and expiry. No Graph/sem-lang API.
// Adapter IO must honor deadline/signal and drain before resolving/rejecting.
// releaseHolder must be independently bounded and work after a lost response.
// A holder identifies one durable, fenced job attempt; owners must never reuse
// it for unrelated work. Exact release must reject/subsume stale generations.
export class ExactSourceReader {
  #owners
  constructor(owners){
    check(owners instanceof Map&&owners.size>0&&owners.size<=8,'ProjectionLimitExceeded')
    this.#owners=new Map()
    for(const [id,adapter] of owners){
      token(id)
      check(['acquire','read','release','releaseHolder'].every(k=>typeof adapter?.[k]==='function'))
      this.#owners.set(id,Object.freeze(Object.fromEntries(['acquire','read','release','releaseHolder'].map(k=>[k,adapter[k].bind(adapter)]))))
    }
  }
  async acquireExact(refs,options){
    const {holder,accessRef,until,deadline,signal}=options
    token(holder);token(accessRef)
    check(Number.isSafeInteger(until)&&Number.isSafeInteger(deadline)&&deadline<=until&&signal instanceof AbortSignal)
    check(Array.isArray(refs)&&refs.length>0&&refs.length<=8,'ProjectionLimitExceeded')
    // PP0 owns source contract validation and uniqueness; never duplicate it here.
    const request={key:'source-validation',producer:{id:'source-validation',version:'0.10.0',contract:'projection/0.10.0',configuration:'source-validation'},sources:refs,focus:'source',purpose:'read',visibilityRef:accessRef,limits:{}}
    const ordered=produce(request,refs.map(source=>({source,items:[],relations:[],unresolved:[],truncated:false}))).lineage.sources
      .toSorted((a,b)=>{const x=canonical([a.owner,a.ref,a.revision,a.kind]),y=canonical([b.owner,b.ref,b.revision,b.kind]);return x<y?-1:x>y?1:0})
    ordered.forEach(r=>check(this.#owners.has(r.owner),'SourceUnavailable'))
    const running=()=>{
      check(!signal.aborted,signal.reason?.code==='ProjectionExecutionTimeout'?'ProjectionExecutionTimeout':'ProjectionCancelled')
      check(Date.now()<deadline,'ProjectionExecutionTimeout')
    }
    const acquired=[]
    try{
      for(const source of ordered){
        running()
        const lease=token(await this.#owners.get(source.owner).acquire(clone(source),options))
        acquired.push({source,lease});running()
      }
      const sources=[]
      for(const {source,lease} of acquired){
        running()
        const value=await this.#owners.get(source.owner).read(clone(source),lease,options)
        running();check(canonical(value?.source)===canonical(source),'SourceRevisionMismatch')
        sources.push(value)
      }
      // The isolated producer validates payload contracts; do not build a second
      // projection here just to discard it. Bound bytes before handing them off.
      canonical(sources)
      return {sources,leaseRefs:acquired.map(({source,lease})=>token(canonical([source.owner,lease])))}
    }catch(error){
      // Include the owner whose acquire response was lost. Do not release only
      // the leases successfully returned to this process.
      await this.release([],holder)
      throw error
    }
  }
  async release(leaseRefs,holder){
    token(holder);check(Array.isArray(leaseRefs)&&leaseRefs.length<=8,'ProjectionLimitExceeded')
    // Known generations are released exactly; holder cleanup is only the recovery
    // path when acquisition responses were not durably recorded. No ABA release.
    let failure
    if(leaseRefs.length){
      const selected=leaseRefs.map(ref=>{
        token(ref);let value
        try{value=JSON.parse(ref)}catch{check(false)}
        check(Array.isArray(value)&&value.length===2);value.forEach(token)
        check(this.#owners.has(value[0]),'SourceUnavailable');return value
      })
      for(const [owner,lease] of selected.reverse()){
        try{await this.#owners.get(owner).release(lease,holder)}catch(error){failure??=error}
      }
      if(failure)throw failure
      return
    }
    // Try every owner even if one fails. PP retains its repair intent on failure.
    for(const [,owner] of [...this.#owners].sort(([a],[b])=>a<b?-1:a>b?1:0)){
      try{await owner.releaseHolder(holder)}catch(error){failure??=error}
    }
    if(failure)throw failure
  }
}
