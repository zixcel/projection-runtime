import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {produce,scene,validateSnapshot,rebuild,recovery,adoptSnapshot,ProjectionSlot,pendingRepair,repair,canonical} from '../src/index.mjs'

export function fixture(){
  const a={owner:'semantic-owner',ref:'subject-snapshot',revision:'z-revision',kind:'semantic'},b={owner:'control-owner',ref:'control-snapshot',revision:'a-seven',kind:'control'}
  const value=(id,v,semantic='exact-adopted-relation')=>({id,semanticRef:semantic,group:{kind:semantic?'semantic':'structural',ref:semantic??'/source/group'},value:v,
    evidence:['evidence:'+id],provenance:['provenance:'+id],resolutionRefs:[],visibility:'visible'})
  const sources=[{source:a,items:[value('one','A'),value('two','B')],relations:[{id:'conflict-link',from:'one',to:'two',relationRef:'owner-explicit-conflict'}],
    unresolved:[{id:'unknown',reason:'NeedsResolution',evidence:['unresolved-evidence'],contextRefs:['owner-context'],actionRefs:['owner-resolve']}],truncated:false},
    {source:b,items:[value('status','not-authorized',null)],relations:[],unresolved:[],truncated:false}]
  const request={key:'subject-view',producer:{id:'neutral-projector',version:'0.10.0',contract:'closed-contract',configuration:'configuration-A'},sources:[a,b],
    focus:'person',purpose:'review',visibilityRef:'owner-visibility-decision',limits:{}}
  const config={key:'scene',focus:'person',purpose:'review',regions:[{id:'main',role:'Primary',itemIds:['one','two']},{id:'resolve',role:'Resolution',itemIds:['unknown']}],
    actions:[{id:'resolve',targetOwner:'semantic-owner',commandRef:'owner-resolve',contextRefs:['unknown'],sourceRefs:[a],label:'Resolve'}]}
  return {sources,request,config}
}
const error=code=>e=>e.code===code
test('Scene projects owner-declared inputs unchanged, fences identity, rejects private bindings/code/defaults and never infers editable data',()=>{
  const f=fixture(),p=produce(f.request,f.sources)
  const interaction={ref:'owner:interaction',generation:'generation:1',inputContractRef:'input:1',input:{
    action:{operation_id:'owner-resolve',target:'owner:interaction',contract_revision:'input:1',availability:{state:'available'},expected_revision_required:true,
      input_schema:{type:'object',fields:{choice:{type:'string',min_length:1,max_length:64,choices:['owner:option:1','owner:option:2']}},required:['choice']}},
    fields:{choice:{label:'Select',sensitive:false,choices:[{value:'owner:option:1',label:'Same label'},{value:'owner:option:2',label:'Same label'}]}}}}
  const configured={...f.config,actions:[{...f.config.actions[0],interaction}]}
  const s=scene(p,configured);validateSnapshot(JSON.parse(canonical(s)))
  assert.deepEqual(s.data.actions[0].interaction,interaction)
  const next=structuredClone(configured);next.actions[0].interaction.generation='generation:2'
  assert.notEqual(scene(p,next).revision,s.revision)
  for(const mutate of [
    v=>{v.inputContractRef='wrong'},v=>{v.input.action.operation_id='other'},
    v=>{v.input.fields.choice.sourcePath='/private'},v=>{v.input.fields.choice.component='remote'},
    v=>{v.input.fields.choice.initial='secret'},v=>{v.input.fields.choice.choices[0].value='Same label'},
    v=>{v.input.action.input_schema.fields.choice.type='unrestricted-json'},v=>{v.control={revision:1}},
  ]){
    const invalid=structuredClone(configured);mutate(invalid.actions[0].interaction)
    assert.throws(()=>scene(p,invalid),error('InvalidProjection'))
  }
  assert.equal(scene(p,f.config).data.actions[0].interaction,undefined)
})
test('exact multi-owner input produces deterministic read-only data and three renderer-neutral Scenes; unresolved/conflict/visibility preserved',()=>{
  const f=fixture(),before=canonical(f),p=produce(f.request,f.sources)
  assert.equal(p.revision,produce(f.request,[...f.sources].reverse()).revision)
  assert.equal(canonical(f),before);assert.notEqual(p.revision,f.sources[0].source.revision)
  assert.deepEqual(p.data.items.slice(0,2).map(x=>x.value),['A','not-authorized'])
  assert.equal(p.data.items.filter(x=>x.group.ref==='exact-adopted-relation').length,2)
  assert.equal(p.data.unresolved[0].id,'unknown');assert.equal(p.data.relations[0].relationRef,'owner-explicit-conflict')
  for(const [focus,purpose]of [['person','profile'],['unknown','resolution'],['status','operation']]){
    const s=scene(p,{...f.config,focus,purpose});validateSnapshot(JSON.parse(canonical(s)))
    assert.deepEqual(s.lineage.sources,p.lineage.sources);assert.equal(s.lineage.dataProjection.revision,p.revision)
    assert.equal(s.data.actions[0].commandRef,'owner-resolve');assert.ok(!('authorized' in s.data.actions[0]))
  }
  const next=structuredClone(f);next.sources[0].source.revision='a-new';next.request.sources[0].revision='a-new'
  assert.notEqual(produce(next.request,next.sources).revision,p.revision);assert.equal(p.lineage.sources[1].revision,'z-revision')
  const privateInput=fixture();privateInput.sources[1].items[0].visibility='redacted'
  const redacted=produce(privateInput.request,privateInput.sources)
  assert.equal(redacted.data.items.find(x=>x.id==='status').value,null);assert.ok(!canonical(redacted).includes('not-authorized'))
  validateSnapshot(redacted)
})
test('disposable cache, missing/corrupt projections, exact rebuild and pending repair never mutate canonical sources or regress a newer publication',()=>{
  const f=fixture(),original=canonical(f.sources),read=ref=>f.sources.find(s=>canonical(s.source)===canonical(ref))
  const p=rebuild(f.request,read),slot=new ProjectionSlot(p.key),ticket=slot.begin()
  const pending=pendingRepair(ticket,f.request,'ProjectionUnavailable')
  assert.equal(slot.read(),null);assert.equal(canonical(f.sources),original)
  const receipt=repair(slot,pending,read);assert.equal(repair(slot,pending,read),receipt)
  slot.dropCache();assert.equal(slot.read(),null)
  assert.equal(repair(slot,pending,read),receipt);assert.deepEqual(slot.read(),p)
  slot.dropCache()
  const again=rebuild(f.request,read);assert.deepEqual(again,p);slot.publish(slot.begin(),again)
  const corrupt=structuredClone(p);corrupt.data.items[0].value='corrupt'
  assert.throws(()=>validateSnapshot(corrupt),error('InvalidProjection'));assert.deepEqual(rebuild(f.request,read),p)
  assert.throws(()=>rebuild(f.request,()=>null),error('ProjectionRebuildUnavailable'))
  assert.throws(()=>rebuild(f.request,()=>({...f.sources[0],source:{...f.sources[0].source,revision:'latest'}})),e=>['InvalidSourceRevision','SourceUnavailable'].includes(e.code))
  const olderTicket=slot.begin(),older=pendingRepair(olderTicket,f.request,'ProjectionUnavailable')
  const next=fixture();next.request.sources[0].revision='R2';next.sources[0].source.revision='R2'
  const newer=produce(next.request,next.sources);slot.publish(slot.begin(),newer)
  assert.throws(()=>repair(slot,older,read),error('StaleProjectionPublication'))
  assert.equal(slot.read().revision,newer.revision);assert.equal(canonical(f.sources),original)
  const restart=new ProjectionSlot(p.key);assert.equal(restart.read(),null);restart.publish(restart.begin(),rebuild(f.request,read));assert.equal(restart.read().revision,p.revision)
})
test('closed contracts reject UI injection, foreign lineage, oversized data and forged snapshots; SSR recovery never silently selects latest',()=>{
  const f=fixture(),p=produce(f.request,f.sources)
  for(const field of ['html','vueComponent','callback','panelExpanded','scrollPosition']){
    assert.throws(()=>produce({...f.request,[field]:'injected'},f.sources),error('InvalidProjection'))
    assert.throws(()=>scene(p,{...f.config,[field]:'injected'}),error('InvalidProjection'))
  }
  const selfHashed=structuredClone(p);selfHashed.data.html='<script/>'
  const {revision,...body}=selfHashed;selfHashed.revision='pp:'+createHash('sha256').update(canonical(body)).digest('hex')
  assert.throws(()=>validateSnapshot(selfHashed),error('InvalidProjection'))
  const excessive=fixture();excessive.sources[0].items=Array.from({length:257},(_,i)=>({...excessive.sources[0].items[0],id:String(i)}))
  assert.throws(()=>produce(excessive.request,excessive.sources),error('ProjectionLimitExceeded'))
  assert.throws(()=>produce({...f.request,limits:{snapshotBytes:20}},f.sources),error('ProjectionLimitExceeded'))
  const large=fixture();large.sources[0].items[0].value='x'.repeat(500000)
  const full=produce(large.request,large.sources);assert.ok(Buffer.byteLength(canonical(full))<524288)
  large.sources[0].items[0].value='x'.repeat(524288)
  assert.throws(()=>produce(large.request,large.sources),error('ProjectionLimitExceeded'))
  for(const [field,count]of [['relations',513],['unresolved',65]]){
    const over=fixture();over.sources[0][field]=Array.from({length:count},(_,i)=>({...over.sources[0][field][0],id:String(i)}))
    assert.throws(()=>produce(over.request,over.sources),error('ProjectionLimitExceeded'))
  }
  const provenance=fixture();provenance.sources[0].relations=[]
  provenance.sources[0].items=Array.from({length:17},(_,i)=>({...provenance.sources[0].items[0],id:String(i),provenance:Array(32).fill('ref')}))
  assert.throws(()=>produce(provenance.request,provenance.sources),error('ProjectionLimitExceeded'))
  assert.throws(()=>scene(p,{...f.config,regions:Array(17).fill(f.config.regions[0])}),error('ProjectionLimitExceeded'))
  const truncated=fixture();truncated.sources[0].truncated=true;assert.equal(produce(truncated.request,truncated.sources).data.truncated,true)
  assert.deepEqual(recovery(p,p.revision),{kind:'NoChange',revision:p.revision})
  assert.deepEqual(JSON.parse(recovery(p,null).payload),p)
  const ssr=JSON.parse(canonical(p));validateSnapshot(ssr);assert.equal(ssr.revision,p.revision)
  const newer=produce({...f.request,producer:{...f.request.producer,configuration:'B'}},f.sources)
  assert.equal(ssr.revision,p.revision);assert.equal(recovery(newer,p.revision).kind,'Snapshot')
  assert.equal(adoptSnapshot(ssr,{key:p.key,revision:p.revision}).revision,p.revision)
  assert.throws(()=>adoptSnapshot(newer,{key:p.key,revision:p.revision}),error('InvalidSourceRevision'))
  assert.ok(!canonical(newer).includes('hover'))
})
