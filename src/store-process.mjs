// One short-lived process per transaction, protected by inherited kernel lock.
// One atomic bounded image; no DAG, source data, general journal or commit theory.
import fs from 'node:fs'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {validateSnapshot,canonical,produce} from '@hathq/projection-contracts'
import {bounds,check,clone,hash,shape,token} from './common.mjs'
const directory=process.argv[2],operation=process.argv[3],image=path.join(directory,'projection.json'),temporary=path.join(directory,'projection.next')
const MAX=12*1024*1024
function readBounded(file,max){
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW)
  try{check(fs.fstatSync(fd).isFile()&&fs.fstatSync(fd).size<=max,'ProjectionStoreCorrupt');const bytes=Buffer.alloc(max+1);const n=fs.readSync(fd,bytes,0,max+1,0);check(n<=max,'ProjectionLimitExceeded');return bytes.subarray(0,n)}finally{fs.closeSync(fd)}
}
function load(){
  const envelope=JSON.parse(readBounded(image,MAX));shape(envelope,['digest','state'])
  check(hash(JSON.stringify(envelope.state))===envelope.digest,'ProjectionStoreCorrupt')
  const s=envelope.state;shape(s,['format','instance','limits','keys','repairs']);check(s.format==='projection-runtime/0.10.0','ProjectionStoreCorrupt');token(s.instance);bounds(s.limits)
  check(Array.isArray(s.keys)&&s.keys.length<=s.limits.keys&&Array.isArray(s.repairs)&&s.repairs.length<=s.limits.repairs,'ProjectionStoreCorrupt')
  check(new Set(s.keys.map(k=>k.key)).size===s.keys.length&&new Set(s.repairs.map(r=>r.id)).size===s.repairs.length,'ProjectionStoreCorrupt')
  for(const k of s.keys){shape(k,['key','fence','current','snapshots','receipts']);token(k.key);token(k.fence);check(k.current===null||typeof k.current==='string','ProjectionStoreCorrupt');check(k.snapshots.length<=s.limits.snapshots&&k.receipts.length<=s.limits.snapshots,'ProjectionStoreCorrupt')}
  for(const r of s.repairs)record(r)
  return s
}
function save(s){
  const bytes=JSON.stringify({digest:hash(JSON.stringify(s)),state:s});check(Buffer.byteLength(bytes)<=MAX,'ProjectionLimitExceeded')
  // Same lock covers stale temp cleanup, write/fsync/rename and directory fsync.
  const fd=fs.openSync(temporary,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_TRUNC|fs.constants.O_NOFOLLOW,0o600)
  try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
  fs.renameSync(temporary,image);const dir=fs.openSync(directory,'r');try{fs.fsyncSync(dir)}finally{fs.closeSync(dir)}
}
function record(r){
  shape(r,['id','holder','previous','ticket','request','producer','accessRef','expiresAt','attempts','failure','leases'])
  canonical(r,65536);token(r.id);token(r.holder);token(r.accessRef);shape(r.ticket,['key','expected']);token(r.ticket.key);token(r.ticket.expected)
  check(r.request.key===r.ticket.key&&Number.isSafeInteger(r.expiresAt)&&r.expiresAt>0&&Number.isSafeInteger(r.attempts)&&r.attempts>=0,'InvalidProjection')
  check(Array.isArray(r.request.sources)&&r.request.sources.length<=8&&Array.isArray(r.leases)&&r.leases.length<=8,'ProjectionLimitExceeded')
  produce(r.request,r.request.sources.map(source=>({source,items:[],relations:[],unresolved:[],truncated:false})))
  check(canonical(r.producer)===canonical(r.request.producer))
  for(const ref of r.request.sources)shape(ref,['owner','ref','revision','kind'])
  for(const ref of r.leases)token(ref)
  check(Array.isArray(r.previous)&&r.previous.length<=2,'ProjectionLimitExceeded')
  for(const old of r.previous){shape(old,['holder','leases']);token(old.holder);check(old.holder!==r.holder&&Array.isArray(old.leases)&&old.leases.length<=8);old.leases.forEach(token)}
  check(new Set(r.previous.map(p=>p.holder)).size===r.previous.length)
  return r
}
try{
  // setpriv installed PDEATHSIG before exec. If the caller died before that
  // installation, its exact parent identity must still reject BEFORE any IO.
  check(Number(process.argv[4])===process.ppid&&process.ppid>1,'ProjectionUnavailable')
  // The parent bounds all requests; limit stdin independently for adapter callers.
  const chunks=[];let n=0;for await(const b of process.stdin){n+=b.length;check(n<=MAX,'ProjectionLimitExceeded');chunks.push(b)}
  const input=JSON.parse(Buffer.concat(chunks));let s
  if(operation==='create'){check(!fs.existsSync(image),'ProjectionStoreExists');s={format:'projection-runtime/0.10.0',instance:randomUUID(),limits:bounds(input.limits),keys:[],repairs:[]};save(s)}
  else s=load()
  let value=null,changed=false
  const find=key=>s.keys.find(k=>k.key===key)
  const initial=key=>hash(s.instance+'\0'+token(key))
  switch(operation){
    case 'create':break
    case 'inspect':value={keys:s.keys.map(({key,current,fence,snapshots})=>({key,current,fence,snapshots:snapshots.length})),repairs:clone(s.repairs),limits:s.limits};break
    case 'begin':value={key:input.key,expected:find(input.key)?.fence??initial(input.key)};break
    case 'read':{const k=find(input.key);const rev=input.revision??k?.current;value=k?.snapshots.find(p=>p.revision===rev)??null;if(value)validateSnapshot(value);break}
    case 'publish':{
      const {ticket,snapshot,jobId}=input;shape(ticket,['key','expected']);token(jobId);validateSnapshot(snapshot);check(snapshot.key===ticket.key)
      let k=find(ticket.key);const prior=k?.receipts.find(r=>r.jobId===jobId)
      if(prior){
        check(prior.revision===snapshot.revision,'ProjectionIdentityConflict');value=prior
        if(!k.snapshots.some(p=>p.revision===snapshot.revision)){k.snapshots.push(snapshot);k.snapshots=k.snapshots.slice(-s.limits.snapshots);changed=true}
        if(s.repairs.some(r=>r.id===jobId)){s.repairs=s.repairs.filter(r=>r.id!==jobId);changed=true}
        break
      }
      check((k?.fence??initial(ticket.key))===ticket.expected,'StaleProjectionPublication')
      if(!k){check(s.keys.length<s.limits.keys,'ProjectionLimitExceeded');k={key:ticket.key,fence:ticket.expected,current:null,snapshots:[],receipts:[]};s.keys.push(k)}
      if(!k.snapshots.some(p=>p.revision===snapshot.revision))k.snapshots.push(snapshot)
      k.snapshots=k.snapshots.slice(-s.limits.snapshots);k.fence=randomUUID();k.current=snapshot.revision
      value={key:k.key,expected:ticket.expected,publication:k.fence,revision:k.current,jobId}
      k.receipts.push(value);k.receipts=k.receipts.slice(-s.limits.snapshots)
      // Result and removal of pending repair have one durable boundary.
      s.repairs=s.repairs.filter(r=>r.id!==jobId);changed=true;break
    }
    case 'pending':{
      const r=record(input.record),prior=s.repairs.find(p=>p.id===r.id)
      if(prior){
        check(canonical({...prior,holder:null,previous:[],attempts:0,failure:null,leases:[]})===canonical({...r,holder:null,previous:[],attempts:0,failure:null,leases:[]}),'ProjectionIdentityConflict')
        check(prior.holder===r.holder||input.previousHolder===prior.holder,'ProjectionAttemptConflict')
        check(r.attempts===prior.attempts+(prior.holder===r.holder?0:1),'ProjectionAttemptConflict')
        prior.holder=r.holder;prior.previous=r.previous;prior.attempts=r.attempts;prior.failure=r.failure;prior.leases=r.leases
      }
      else{check(s.repairs.length<s.limits.repairs,'ProjectionLimitExceeded');s.repairs.push(r)}
      changed=true;value=r;break
    }
    case 'repair':value=s.repairs.find(r=>r.id===input.id)??null;break
    case 'finish':s.repairs=s.repairs.filter(r=>r.id!==input.id);changed=true;break
    case 'drop':{const k=find(input.key);if(k){k.snapshots=[];changed=true}break}
    default:check(false)
  }
  if(changed)save(s)
  // No extra durable notification store. This existing file's metadata is only
  // a wakeup hint after the atomic publication, never a cursor or receipt.
  if(changed&&['publish','drop'].includes(operation))fs.utimesSync(path.join(directory,'lock'),new Date(),new Date())
  process.stdout.write(JSON.stringify({value}))
}catch(error){process.stdout.write(JSON.stringify({error:error.code?.startsWith('Projection')||['InvalidProjection','StaleProjectionPublication'].includes(error.code)?error.code:error.code==='ENOENT'?'ProjectionUnavailable':'ProjectionStoreCorrupt'}))}
