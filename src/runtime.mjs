import fs from 'node:fs'
import {Worker} from 'node:worker_threads'
import {randomUUID} from 'node:crypto'
import {canonical,produce,recovery,validateSnapshot} from '@hathq/projection-contracts'
import {bounds,check,clone,fail,hash,shape,token} from './common.mjs'
export {ExactSourceReader} from './exact-sources.mjs'

const workerUrl=new URL('./producer-worker.mjs',import.meta.url)
const implementation=hash(Buffer.concat([
  fs.readFileSync(workerUrl),fs.readFileSync(import.meta.filename),
  fs.readFileSync(new URL('./common.mjs',import.meta.url)),
  ...['index.mjs','contract.mjs','producer.mjs','publication.mjs','hash-node.mjs','../package.json'].map(name=>fs.readFileSync(new URL(name,import.meta.resolve('@hathq/projection-contracts')))),
]))
// Explicit installed built-ins only. No request-supplied path/module/code is loaded.
export class ProducerRegistry {
  #entries=new Map()
  register({id,kind,configuration={}}){
    token(id);check(['data','scene'].includes(kind));check(this.#entries.size<8,'ProjectionLimitExceeded');check(!this.#entries.has(id),'ProjectionIdentityConflict')
    canonical(configuration,16384)
    const identity={id,version:'0.10.0',contract:'projection/0.10.0',configuration:hash(canonical({implementation,kind,configuration}))}
    const entry=Object.freeze({identity:Object.freeze(identity),kind,configuration:clone(configuration)})
    this.#entries.set(id,entry);return clone(identity)
  }
  exact(identity){const entry=this.#entries.get(identity?.id);check(entry&&canonical(entry.identity)===canonical(identity),'ProjectionProducerUnavailable');return clone(entry)}
  // Unregister only the exact installed definition. Submitted jobs already own
  // an immutable copy; stale cleanup cannot remove a different configuration.
  unregister(identity){this.exact(identity);this.#entries.delete(identity.id)}
  get artifactDigest(){return implementation}
}

function validatedRequest(r){
  // Reuse PP0 validation, without exposing an implicit reader or duplicating schema.
  return produce(r,r.sources.map(source=>({source,items:[],relations:[],unresolved:[],truncated:false}))).lineage.request
}
function execute(entry,request,sources,signal,ms){
  return new Promise((resolve,reject)=>{
    let settled=false
    const worker=new Worker(workerUrl,{workerData:{entry,request,sources},resourceLimits:{maxOldGenerationSizeMb:32,maxYoungGenerationSizeMb:8,stackSizeMb:2}})
    const finish=async(error,value)=>{
      if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',aborted)
      // Await termination before releasing slot/source holds, including timeout.
      try{await worker.terminate()}catch(e){error??=e}
      if(error)reject(error);else resolve(value)
    }
    const error=code=>Object.assign(new Error(code),{code})
    const aborted=()=>void finish(error(signal.reason?.code==='ProjectionExecutionTimeout'?'ProjectionExecutionTimeout':'ProjectionCancelled'))
    const timer=setTimeout(()=>void finish(error('ProjectionExecutionTimeout')),ms)
    worker.once('error',e=>void finish(error(e.code==='ERR_WORKER_OUT_OF_MEMORY'?'ProjectionLimitExceeded':'ProjectionProducerFailed')))
    worker.once('message',m=>void finish(m.error?error(m.error):null,m.snapshot))
    worker.once('exit',code=>{if(!settled)void finish(error('ProjectionProducerFailed'))})
    signal.addEventListener('abort',aborted,{once:true});if(signal.aborted)aborted()
  })
}

// Reader contract: acquireExact(refs, {accessRef, holder, until, signal}) returns
// {sources, leaseRefs}; release(leaseRefs) is idempotent; holds survive process exit
// until explicit release/owner expiry. Reader must bound/cancel its own IO and never
// invoke canonical creation, latest, provider refresh or source-body restoration.
export class ProjectionRuntime {
  #store;#registry;#reader;#limits;#active=new Map();#queue=[];#closed=false
  constructor({store,registry,reader,limits={}}){
    check(store&&registry instanceof ProducerRegistry&&typeof reader?.acquireExact==='function'&&typeof reader.release==='function')
    this.#store=store;this.#registry=registry;this.#reader=reader;this.#limits=bounds(limits)
  }
  inspect(){return {active:this.#active.size,queued:this.#queue.length,closed:this.#closed,limits:this.#limits,store:this.#store.inspect()}}
  submit(input,{accessRef,signal=new AbortController().signal,id=randomUUID()}={}){
    check(!this.#closed,'ProjectionRuntimeClosed');token(accessRef);token(id)
    const request=clone(input);validatedRequest(request);const entry=this.#registry.exact(request.producer)
    check(entry.kind==='data'||entry.configuration.key===request.key)
    if(this.#active.size>=this.#limits.concurrent&&this.#queue.length>=this.#limits.queued)fail('ProjectionQueueFull')
    check(!this.#active.has(id)&&!this.#queue.some(j=>j.id===id),'ProjectionIdentityConflict')
    const pending=this.#store.repair(id)
    if(pending){check(canonical(pending.request)===canonical(request)&&pending.accessRef===accessRef,'ProjectionIdentityConflict')}
    const job={id,request,entry,accessRef,controller:new AbortController(),pending,signal}
    return new Promise((resolve,reject)=>{
      job.resolve=resolve;job.reject=reject
      job.abort=()=>{job.controller.abort();const index=this.#queue.indexOf(job);if(index>=0){this.#queue.splice(index,1);job.signal.removeEventListener('abort',job.abort);reject(Object.assign(new Error('ProjectionCancelled'),{code:'ProjectionCancelled'}))}}
      signal.addEventListener('abort',job.abort,{once:true})
      if(signal.aborted){signal.removeEventListener('abort',job.abort);reject(Object.assign(new Error('ProjectionCancelled'),{code:'ProjectionCancelled'}));return}
      this.#queue.push(job);this.#pump()
    })
  }
  retry(id,options={}){
    const r=this.#store.repair(token(id));check(r,'ProjectionRepairUnavailable')
    return this.submit(r.request,{...options,accessRef:r.accessRef,id})
  }
  async expire(id){
    check(!this.#active.has(id)&&!this.#queue.some(j=>j.id===id),'ProjectionStoreBusy')
    const r=this.#store.repair(token(id));if(!r)return
    await this.#store.withAttempt(id,async()=>{
      const current=this.#store.repair(id);if(!current)return
      await this.#cleanup([{holder:current.holder,leases:current.leases},...current.previous]);this.#store.finish(id)
    })
  }
  #pump(){
    while(!this.#closed&&this.#active.size<this.#limits.concurrent&&this.#queue.length){
      const j=this.#queue.shift();this.#active.set(j.id,j)
      const finished=()=>{
        this.#active.delete(j.id);j.signal.removeEventListener('abort',j.abort);this.#pump()
      }
      j.done=this.#store.withAttempt(j.id,()=>this.#run(j)).then(value=>{finished();j.resolve(value)},error=>{finished();j.reject(error)})
    }
  }
  async #cleanup(sets){
    let failure
    for(const {holder,leases} of sets){try{await this.#reader.release(leases,holder)}catch(error){failure??=error}}
    if(failure)throw failure
  }
  async #run(j){
    // Re-read after acquiring the process-wide attempt fence, not before queueing.
    const signal=j.controller.signal,now=Date.now(),p=this.#store.repair(j.id),holder=randomUUID()
    if(p)check(canonical(p.request)===canonical(j.request)&&p.accessRef===j.accessRef,'ProjectionIdentityConflict')
    let ticket=p?.ticket
    const expiresAt=p?.expiresAt??now+this.#limits.repairMs,attempts=(p?.attempts??0)+1
    if(expiresAt<=now||attempts>this.#limits.attempts){if(p)await this.#cleanup([{holder:p.holder,leases:p.leases},...p.previous]);this.#store.finish(j.id);fail('ProjectionRepairExpired')}
    // One deadline covers source acquisition/read, producer and publication.
    // Abort is cooperative: await actual owner IO/worker termination, never race
    // away from an acquisition which could still create a durable hold later.
    const deadline=Math.min(now+this.#limits.executionMs,expiresAt)
    const timeout=()=>j.controller.abort(Object.assign(new Error('ProjectionExecutionTimeout'),{code:'ProjectionExecutionTimeout'}))
    const timer=setTimeout(timeout,Math.max(1,deadline-Date.now()))
    const running=()=>{
      if(Date.now()>=deadline&&!signal.aborted)timeout()
      check(!signal.aborted,signal.reason?.code==='ProjectionExecutionTimeout'?'ProjectionExecutionTimeout':'ProjectionCancelled')
    }
    let leases=[],previous=p?[...p.previous,{holder:p.holder,leases:p.leases}]:[],saved=false,published=false,cleaned=false
    try{
      running();ticket??=this.#store.begin(j.request.key,{deadline});running()
      // Exact hold metadata is recorded BEFORE acquisition so interrupted readers
      // can be reconciled by deterministic holder identity, never source bodies.
      const base={id:j.id,holder,previous,ticket,request:j.request,producer:j.entry.identity,accessRef:j.accessRef,expiresAt,attempts,failure:null,leases}
      this.#store.pending(base,{deadline,previousHolder:p?.holder});saved=true;running()
      const result=await this.#reader.acquireExact(j.request.sources,{accessRef:j.accessRef,holder,until:expiresAt,deadline,signal})
      shape(result,['sources','leaseRefs']);check(Array.isArray(result.leaseRefs)&&result.leaseRefs.length<=8,'ProjectionLimitExceeded');result.leaseRefs.forEach(token)
      leases=result.leaseRefs;this.#store.pending({...base,leases},{deadline})
      // Transfer physical protection only AFTER replacement exact leases are
      // durable. A crash preserves both generations for idempotent cleanup.
      await this.#cleanup(previous);previous=[]
      this.#store.pending({...base,leases,previous},{deadline})
      running();canonical(result.sources,this.#limits.inputBytes);running()
      const snapshot=await execute(j.entry,j.request,result.sources,signal,Math.max(1,deadline-Date.now()))
      running();validateSnapshot(snapshot)
      check(canonical(snapshot.lineage.sources)===canonical(produce(j.request,result.sources).lineage.sources),'SourceRevisionMismatch')
      running();const receipt=this.#store.publish(ticket,snapshot,j.id,{deadline});published=true
      running()
      return {snapshot,receipt}
    }catch(error){
      if(signal.aborted&&signal.reason?.code==='ProjectionExecutionTimeout')error=signal.reason
      if(saved){
        const terminal=attempts>=this.#limits.attempts||['ProjectionCancelled','ProjectionExecutionTimeout','StaleProjectionPublication','SourceNotRetained','VisibilityDenied','SourceRevisionMismatch','SourceCorrupt'].includes(error.code)
        if(terminal){await this.#cleanup([{holder,leases},...previous]);cleaned=true;this.#store.finish(j.id);saved=false}
        else this.#store.pending({id:j.id,holder,previous,ticket,request:j.request,producer:j.entry.identity,accessRef:j.accessRef,expiresAt,attempts,failure:error.code??'ProjectionProducerFailed',leases})
      }
      throw error
    }finally{
      clearTimeout(timer)
      if(!cleaned&&(published||!saved))await this.#cleanup([{holder,leases},...previous])
    }
  }
  recoverState({key,revision=null}){
    try{const snapshot=this.#store.read(token(key));return snapshot?recovery(snapshot,revision):{kind:'RecoveryUnavailable',reason:'ProjectionUnavailable'}}
    catch(error){return {kind:'RecoveryUnavailable',reason:error.code??'ProjectionUnavailable'}}
  }
  async close(){
    this.#closed=true;for(const j of [...this.#queue])j.abort();for(const j of this.#active.values())j.controller.abort()
    await Promise.all([...this.#active.values()].map(j=>j.done))
  }
}
