// Hatter 2026: declared exact temporal binding, never date/name inference.
import test from 'node:test'
import assert from 'node:assert/strict'
import {produce,scene,validateSnapshot} from '../src/producer.mjs'
const source={owner:'fixture',ref:'events',revision:'one',kind:'subject'}
const request={key:'data',producer:{id:'fixture',version:'0.10.0',contract:'projection/0.10.0',configuration:'one'},sources:[source],focus:'events',purpose:'events',visibilityRef:'fixture',limits:{}}
const item=(id,at,visibility='visible')=>({id,semanticRef:null,group:{kind:'structural',ref:'events'},value:{at},evidence:[],provenance:[],resolutionRefs:[],visibility})
const data=items=>produce(request,[{source,items,relations:[],unresolved:[],truncated:false}])
const binding=itemId=>({itemId,valuePath:['at'],format:'utcInstant'})
const configuration={key:'scene',focus:'events',purpose:'Events',regions:[],actions:[],temporal:{label:'Declared event time',items:[binding('a'),binding('b')]}}
test('temporal projection binds exact visible data, roundtrips, sorts, and rejects fabricated or hidden instants',()=>{
 const a=item('a','2026-09-16T09:00:00.000Z'),b=item('b','2026-09-15T09:00:00.000Z'),base=data([a,b])
 const projected=scene(base,configuration)
 assert.deepEqual(projected.data.temporal.items,[{itemId:'b',at:b.value.at},{itemId:'a',at:a.value.at}])
 assert.deepEqual(validateSnapshot(JSON.parse(JSON.stringify(projected))),projected)
 assert.equal(Object.hasOwn(scene(base,{key:'plain',focus:'events',purpose:'Events',regions:[],actions:[]}).data,'temporal'),false)
 for(const bad of ['tomorrow','2026-02-30T00:00:00.000Z',42,null])assert.throws(()=>scene(data([item('a',bad),b]),configuration),{code:'InvalidProjection'})
 for(const visibility of ['redacted','omitted'])assert.throws(()=>scene(data([{...a,visibility},b]),configuration),{code:'InvalidProjection'})
 for(const binding of [{itemId:'absent',valuePath:['at'],format:'utcInstant'},{itemId:'a',valuePath:['constructor'],format:'utcInstant'},{itemId:'a',valuePath:['missing'],format:'utcInstant'}]){
  assert.throws(()=>scene(base,{...configuration,temporal:{label:'Time',items:[binding]}}),{code:'InvalidProjection'})
 }
 assert.deepEqual(base.data.items.map(i=>i.value),[a.value,b.value])
 const numeric=scene(data([item('a',0)]),{...configuration,temporal:{label:'Requested time',items:[{...binding('a'),format:'unixMilliseconds'}]}})
 assert.equal(numeric.data.temporal.items[0].at,'1970-01-01T00:00:00.000Z')
 assert.throws(()=>scene(data([item('a','0')]),{...configuration,temporal:{label:'Time',items:[{...binding('a'),format:'unixMilliseconds'}]}}),{code:'InvalidProjection'})
 const declared={...configuration,presentation:[{itemId:'a',titlePath:['at'],summaryPath:['at']}]}
 const labeled=scene(base,declared)
 assert.deepEqual(labeled.data.presentation,[{itemId:'a',title:a.value.at,summary:a.value.at}])
 assert.deepEqual(validateSnapshot(labeled),labeled);assert.deepEqual(labeled.data.items,base.data.items)
 const fields=scene(base,{...configuration,presentation:[{itemId:'a',title:'Event',symbol:'clock',fields:[{label:'When',valuePath:['at']}]}]})
 assert.deepEqual(fields.data.presentation,[{itemId:'a',title:'Event',symbol:'clock',fields:[{label:'When',value:a.value.at}]}])
 assert.deepEqual(validateSnapshot(fields),fields)
 for(const binding of [{itemId:'missing',title:'Event'},{itemId:'a',title:'Event',titlePath:['at']},{itemId:'a',title:'Event',fields:[{label:'Unknown',valuePath:['missing']}]},{itemId:'a',title:'Event',fields:[{label:'Nested',valuePath:[]}]}])
  assert.throws(()=>scene(base,{...configuration,presentation:[binding]}),{code:'InvalidProjection'})
 assert.throws(()=>scene(data([{...a,visibility:'redacted'},b]),{...configuration,temporal:{label:'Time',items:[binding('b')]},presentation:[{itemId:'a',title:'Hidden'}]}),{code:'InvalidProjection'})
 const forged=structuredClone(labeled);forged.data.presentation[0].title='invented'
 assert.throws(()=>validateSnapshot(forged),{code:'InvalidProjection'})
 for(const presentation of [[{itemId:'missing',titlePath:['at']}],[{itemId:'a',titlePath:['missing']}],[{itemId:'a',titlePath:['at'],html:'<script>'}],Array(2).fill(declared.presentation[0])]){
  assert.throws(()=>scene(base,{...configuration,presentation}),{code:'InvalidProjection'})
 }
 assert.throws(()=>scene(data([{...a,visibility:'redacted'},b]),declared),{code:'InvalidProjection'})
})
