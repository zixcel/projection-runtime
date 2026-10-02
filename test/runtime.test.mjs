import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawn,spawnSync} from 'node:child_process'
import {once} from 'node:events'
import {canonical,produce,adoptSnapshot} from '@hathq/projection-contracts'
import {FileProjectionStore} from '../src/store.mjs'
import {ProducerRegistry,ProjectionRuntime,ExactSourceReader} from '../src/runtime.mjs'
const code=expected=>e=>e.code===expected

test('durable publication hints survive atomic replacement and release watcher/timer on disposal',async()=>{
  const f=fixture();let hints=0,observed
  const stop=f.store.watch(()=>{hints++;observed=f.store.read('test')})
  try{
    const p=await f.runtime.submit(f.request,{accessRef:'local-owner',id:'watch-publication'})
    const until=Date.now()+2000
    while(!hints&&Date.now()<until)await new Promise(r=>setTimeout(r,20))
    assert.ok(hints>0);assert.deepEqual(observed,p.snapshot)
    stop();stop();const before=hints
    await f.runtime.submit(f.request,{accessRef:'local-owner',id:'watch-after-close'})
    await new Promise(r=>setTimeout(r,50));assert.equal(hints,before)
  }finally{stop();await f.runtime.close();fs.rmSync(f.parent,{recursive:true})}
})

test('simultaneous exact readers share the lock while all image mutations remain exclusively fenced',async()=>{
  const f=fixture(),fd=fs.openSync(path.join(f.directory,'lock'),'r')
  try{
    assert.equal(spawnSync('/usr/bin/flock',['--shared','--nonblock','3'],{stdio:['ignore','pipe','pipe',fd]}).status,0)
    assert.equal(f.store.read('test'),null)
    assert.equal(f.store.begin('test').key,'test')
    const start=Date.now()
    assert.throws(()=>f.store.dropSnapshots('test'),code('ProjectionStoreBusy'))
    assert.ok(Date.now()-start>=200);assert.ok(Date.now()-start<2000)
  }finally{fs.closeSync(fd);await f.runtime.close();fs.rmSync(f.parent,{recursive:true})}
  const g=fixture()
  const child=spawn('/usr/bin/flock',['--shared',path.join(g.directory,'lock'),process.execPath,'-e',"process.stdout.write('ready');setTimeout(()=>{},80)"],{stdio:['ignore','pipe','pipe']})
  const closed=once(child,'close')
  try{
    await once(child.stdout,'data')
    // A normal short reader is allowed to drain; no retry loop or new attempt.
    g.store.dropSnapshots('test');assert.equal(g.store.read('test'),null)
    await closed;assert.equal(child.exitCode,0)
  }finally{if(child.exitCode===null)child.kill('SIGKILL');await closed;await g.runtime.close();fs.rmSync(g.parent,{recursive:true})}
})

test('transient producer definitions release capacity without accepting stale identities',()=>{
  const registry=new ProducerRegistry()
  for(let n=0;n<32;n++){
    const definition={id:'transient',kind:'data',configuration:{n}},identity=registry.register(definition)
    assert.throws(()=>registry.unregister({...identity,configuration:'old'}),code('ProjectionProducerUnavailable'))
    assert.deepEqual(registry.exact(identity).identity,identity)
    registry.unregister(identity)
    assert.throws(()=>registry.exact(identity),code('ProjectionProducerUnavailable'))
    assert.deepEqual(registry.register(definition),identity)
    registry.unregister(identity)
  }
})

test('attempt lock rejects another process, kernel releases after death, and retry holders cannot overwrite a newer generation',async()=>{
  const f=fixture(),url=JSON.stringify(new URL('../src/store.mjs',import.meta.url).href)
  const child=spawn(process.execPath,['--input-type=module','-e',`import {FileProjectionStore} from ${url};await new FileProjectionStore(${JSON.stringify(f.directory)}).withAttempt('fenced',async()=>{process.stdout.write('locked');await new Promise(()=>{setInterval(()=>{},1000)})})`],{stdio:['ignore','pipe','pipe']})
  const closed=once(child,'close')
  try{
    await once(child.stdout,'data')
    await assert.rejects(f.store.withAttempt('fenced',async()=>assert.fail('two active owners')),code('ProjectionStoreBusy'))
    child.kill('SIGKILL');await closed
    await f.store.withAttempt('fenced',async()=>{
      const r={id:'fenced',holder:'attempt-one',previous:[],ticket:f.store.begin('test'),request:f.request,producer:f.identity,accessRef:'local-owner',expiresAt:Date.now()+60000,attempts:1,failure:null,leases:[]}
      f.store.pending(r)
      const next={...r,holder:'attempt-two',attempts:2}
      f.store.pending(next,{previousHolder:r.holder})
      assert.throws(()=>f.store.pending(r),code('ProjectionAttemptConflict'))
      assert.deepEqual(f.store.repair(r.id),next)
      assert.throws(()=>f.store.pending({...next,request:{...next.request,sources:[{...f.ref,revision:'other'}]}}),code('ProjectionIdentityConflict'))
      f.store.finish(r.id)
    })
    assert.equal(fs.readdirSync(f.directory).filter(n=>n.startsWith('attempt-')).length,16)
  }finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await closed;await f.runtime.close();fs.rmSync(f.parent,{recursive:true})}
})

test('owner-neutral acquisition orders all leases before reads, drains partial/lost responses and retries every cleanup owner',async()=>{
  const calls=[],held=new Set(),controller=new AbortController()
  let failure=false,cleanupFailure=false
  const adapter=owner=>({
    async acquire(ref,{holder}){calls.push('acquire:'+owner);held.add(owner+holder);if(failure&&owner==='B')throw Object.assign(Error('lost'),{code:'SourceUnavailable'});return 'lease:'+ref.ref},
    async read(ref){calls.push('read:'+owner);return {source:ref,items:[],relations:[],unresolved:[],truncated:false}},
    async release(lease,holder){assert.equal(lease,'lease:one');calls.push('release-exact:'+owner);held.delete(owner+holder)},
    async releaseHolder(holder){calls.push('release:'+owner);held.delete(owner+holder);if(cleanupFailure&&owner==='A')throw Object.assign(Error('busy'),{code:'ProjectionStoreBusy'})},
  })
  const reader=new ExactSourceReader(new Map([['B',adapter('B')],['A',adapter('A')]]))
  const sources=['B','A'].map(owner=>({owner,ref:'one',revision:'exact',kind:'control'}))
  const options={accessRef:'visible',holder:'job',until:Date.now()+60000,deadline:Date.now()+5000,signal:controller.signal}
  const result=await reader.acquireExact(sources,options)
  assert.deepEqual(calls,['acquire:A','acquire:B','read:A','read:B']);assert.equal(result.leaseRefs.length,2)
  await reader.release(result.leaseRefs,'job');assert.equal(held.size,0)
  calls.length=0;failure=true
  await assert.rejects(reader.acquireExact(sources,options),code('SourceUnavailable'))
  assert.deepEqual(calls,['acquire:A','acquire:B','release:A','release:B']);assert.equal(held.size,0)
  failure=false;cleanupFailure=true;calls.length=0
  await assert.rejects(reader.release([],'job'),code('ProjectionStoreBusy'))
  assert.deepEqual(calls,['release:A','release:B'])
  cleanupFailure=false;calls.length=0;controller.abort()
  await assert.rejects(reader.acquireExact(sources,options),code('ProjectionCancelled'))
  assert.deepEqual(calls,['release:A','release:B']);assert.equal(held.size,0)
})

test('whole-job deadline cancels source acquisition, waits for owner drain and releases partial holds',async()=>{
  const f=fixture();let drained=false,releaseBeforeDrain=false,publishes=0
  const reader={
    async acquireExact(refs,{holder,signal,deadline}){
      assert.ok(Number.isSafeInteger(deadline));f.holds.set(holder,deadline)
      await new Promise((resolve,reject)=>{
        signal.addEventListener('abort',()=>{
          // Owner acknowledges cancellation only after its pending IO is drained.
          setTimeout(()=>{drained=true;reject(signal.reason)},5)
        },{once:true})
      })
      assert.fail('cancelled source must not return data')
    },
    async release(refs,holder){releaseBeforeDrain||=!drained;await f.reader.release(refs,holder)},
  }
  const store=new Proxy(f.store,{get(t,k){if(k==='publish')return (...args)=>{publishes++;return t.publish(...args)};return typeof t[k]==='function'?t[k].bind(t):t[k]}})
  // Real fsync must finish before this case exercises the acquisition boundary.
  // The separate 1 ms case below covers expiry during earlier phases.
  const runtime=new ProjectionRuntime({store,registry:f.registry,reader,limits:{executionMs:5000}})
  try{
    await assert.rejects(runtime.submit(f.request,{accessRef:'local-owner',id:'source-timeout'}),code('ProjectionExecutionTimeout'))
    assert.equal(drained,true);assert.equal(releaseBeforeDrain,false);assert.equal(publishes,0)
    assert.equal(f.holds.size,0);assert.equal(f.store.repair('source-timeout'),null)
    assert.equal(runtime.inspect().active,0);assert.equal(f.store.read('test'),null)
  }finally{await runtime.close();await f.runtime.close();fs.rmSync(f.parent,{recursive:true})}
})
function fixture(limits={}){
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),'pp1-test-')),directory=path.join(parent,'derived'),store=FileProjectionStore.create(directory,limits)
  const registry=new ProducerRegistry(),identity=registry.register({id:'neutral',kind:'data'})
  const ref={owner:'source-owner',ref:'exact-source',revision:'opaque/1',kind:'application'}
  const source={source:ref,items:[{id:'one',semanticRef:null,group:{kind:'structural',ref:'/not-meaning'},value:'original',evidence:['evidence:1'],provenance:['source:1'],resolutionRefs:[],visibility:'visible'}],relations:[],unresolved:[],truncated:false}
  const request={key:'test',producer:identity,sources:[ref],focus:'subject',purpose:'review',visibilityRef:'owner-local',limits:{}}
  const holds=new Map(),sources=new Map([[canonical(ref),source]])
  const reader={async acquireExact(refs,{accessRef,holder,until,signal}){
    assert.equal(accessRef,'local-owner');assert.equal(signal.aborted,false)
    const selected=refs.map(r=>{const s=sources.get(canonical(r));if(!s)throw Object.assign(new Error('SourceNotRetained'),{code:'SourceNotRetained'});return s})
    holds.set(holder,until);return {sources:selected,leaseRefs:[holder]}
  },async release(refs,holder){for(const r of refs)holds.delete(r);if(holder)holds.delete(holder)}}
  const runtime=new ProjectionRuntime({store,registry,reader,limits})
  return {parent,directory,store,registry,identity,ref,source,request,holds,sources,reader,runtime}
}
test('durable deterministic publication, receipt replay, bounded retention, exact restart, source-only cache rebuild and corrupt rejection',async()=>{
  const f=fixture();const before=canonical(f.source)
  try{
    const first=await f.runtime.submit(f.request,{accessRef:'local-owner',id:'first'})
    assert.deepEqual(first.snapshot,produce(f.request,[f.source]));assert.equal(f.holds.size,0)
    assert.deepEqual(f.store.read('test'),first.snapshot)
    assert.deepEqual((await f.runtime.submit(f.request,{accessRef:'local-owner',id:'first'})).receipt,first.receipt)
    const child=spawnSync(process.execPath,['--input-type=module','-e',`import {FileProjectionStore} from ${JSON.stringify(new URL('../src/store.mjs',import.meta.url).href)};console.log(JSON.stringify(new FileProjectionStore(${JSON.stringify(f.directory)}).read('test')))`],{encoding:'utf8',timeout:10000})
    assert.equal(child.status,0,child.stderr);assert.deepEqual(JSON.parse(child.stdout),first.snapshot)
    f.store.dropSnapshots('test');assert.equal(f.store.read('test'),null)
    const replay=await f.runtime.submit(f.request,{accessRef:'local-owner',id:'first'});assert.deepEqual(replay.receipt,first.receipt);assert.deepEqual(replay.snapshot,first.snapshot)
    assert.equal(f.runtime.recoverState({key:'test',revision:first.snapshot.revision}).kind,'NoChange')
    assert.equal(adoptSnapshot(first.snapshot,{key:'test',revision:first.snapshot.revision}).revision,first.snapshot.revision)
    const saved=fs.readFileSync(path.join(f.directory,'projection.json'));fs.writeFileSync(path.join(f.directory,'projection.json'),'corrupt')
    assert.throws(()=>f.store.read('test'),code('ProjectionStoreCorrupt'));fs.writeFileSync(path.join(f.directory,'projection.json'),saved)
    for(let n=2;n<=5;n++){const s=structuredClone(f.source);s.source.revision='opaque/'+n;s.items[0].value='value/'+n;f.sources.set(canonical(s.source),s);await f.runtime.submit({...f.request,sources:[s.source]},{accessRef:'local-owner',id:'job/'+n})}
    assert.equal(f.store.inspect().keys[0].snapshots,2);assert.equal(f.store.inspect().repairs.length,0)
    assert.equal(canonical(f.source),before)
    assert.throws(()=>new FileProjectionStore(path.join(f.parent,'missing')).read('test'),code('ProjectionUnavailable'));assert.equal(fs.existsSync(path.join(f.parent,'missing')),false)
  }finally{await f.runtime.close();fs.rmSync(f.parent,{recursive:true})}
})
test('failed publish durable repair, lost response original receipt, old repair cannot regress newer head and source disappearance never follows latest',async()=>{
  const f=fixture();let fail=true
  const store=new Proxy(f.store,{get(target,key){if(key==='publish')return (...args)=>{if(fail){fail=false;throw Object.assign(new Error('fixture'),{code:'ProjectionUnavailable'})}return target.publish(...args)};return typeof target[key]==='function'?target[key].bind(target):target[key]}})
  const runtime=new ProjectionRuntime({store,registry:f.registry,reader:f.reader})
  try{
    await assert.rejects(runtime.submit(f.request,{accessRef:'local-owner',id:'repair'}),code('ProjectionUnavailable'))
    assert.equal(f.store.read('test'),null);assert.equal(f.store.repair('repair').attempts,1);assert.equal(f.holds.size,1)
    const next=structuredClone(f.source);next.source.revision='new';next.items[0].value='new';f.sources.set(canonical(next.source),next)
    const p2=await runtime.submit({...f.request,sources:[next.source]},{accessRef:'local-owner',id:'new'})
    await assert.rejects(runtime.retry('repair'),code('StaleProjectionPublication'));assert.deepEqual(f.store.read('test'),p2.snapshot);assert.equal(f.holds.size,0)
    fail=true;await assert.rejects(runtime.submit(f.request,{accessRef:'local-owner',id:'disappear'}),code('ProjectionUnavailable'))
    f.sources.delete(canonical(f.ref));await assert.rejects(runtime.retry('disappear'),code('SourceNotRetained'));assert.equal(f.store.repair('disappear'),null);assert.equal(f.holds.size,0)
    f.sources.set(canonical(f.ref),f.source)
    // Fail after underlying durable publication, not before it.
    let lose=true;const lost=new Proxy(f.store,{get(t,k){if(k==='publish')return (...a)=>{const r=t.publish(...a);if(lose){lose=false;throw Object.assign(new Error('lost'),{code:'ProjectionUnavailable'})}return r};return typeof t[k]==='function'?t[k].bind(t):t[k]}})
    const recovering=new ProjectionRuntime({store:lost,registry:f.registry,reader:f.reader})
    try{await assert.rejects(recovering.submit(f.request,{accessRef:'local-owner',id:'lost'}),code('ProjectionUnavailable'));const head=f.store.inspect().keys[0];const retry=await recovering.retry('lost');assert.equal(retry.receipt.publication,head.fence);assert.equal(f.holds.size,0)}finally{await recovering.close()}
  }finally{await runtime.close();await f.runtime.close();fs.rmSync(f.parent,{recursive:true})}
})
test('bounded queue, cancelled and timed-out workers publish nothing; oversized/invalid outputs and immutable producer identity reject',async()=>{
  const f=fixture({concurrent:1,queued:1});let release
  const gate=new Promise(r=>{release=r}),reader={...f.reader,async acquireExact(...a){await gate;return f.reader.acquireExact(...a)}}
  const r=new ProjectionRuntime({store:f.store,registry:f.registry,reader,limits:{concurrent:1,queued:1,executionMs:1}})
  try{
    const first=r.submit(f.request,{accessRef:'local-owner',id:'timeout'});const timeout=assert.rejects(first,code('ProjectionExecutionTimeout'))
    const c=new AbortController(),second=r.submit(f.request,{accessRef:'local-owner',signal:c.signal,id:'queued'});const cancelled=assert.rejects(second,code('ProjectionCancelled'))
    assert.throws(()=>r.submit(f.request,{accessRef:'local-owner',id:'excess'}),code('ProjectionQueueFull'))
    c.abort();release();await Promise.all([timeout,cancelled]);assert.equal(f.store.read('test'),null);assert.equal(r.inspect().active,0)
    await r.expire('timeout');assert.equal(f.holds.size,0)
    assert.throws(()=>r.submit({...f.request,producer:{...f.identity,configuration:'substituted'}},{accessRef:'local-owner'}),code('ProjectionProducerUnavailable'))
    const source=structuredClone(f.source);source.items[0].value='x'.repeat(530000);f.sources.set(canonical(f.ref),source)
    await assert.rejects(f.runtime.submit(f.request,{accessRef:'local-owner',id:'oversize'}),code('ProjectionLimitExceeded'));assert.equal(f.store.read('test'),null)
    await f.runtime.expire('oversize');assert.equal(f.holds.size,0)
  }finally{release();await r.close();await f.runtime.close();fs.rmSync(f.parent,{recursive:true})}
})
