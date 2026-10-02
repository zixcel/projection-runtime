// Linux projection-local adapter. Kernel flock, not PID/TTL lock stealing.
// Generic runtime depends only on this adapter's method contract.
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'
import {bounds,check,fail,token} from './common.mjs'
const helper=fileURLToPath(new URL('./store-process.mjs',import.meta.url))
export class FileProjectionStore {
  #directory
  constructor(directory){this.#directory=path.resolve(directory)}
  static create(directory,limits={}){
    check(process.platform==='linux','ProjectionStoreUnsupported')
    const store=new FileProjectionStore(directory)
    // Caller supplies an existing private parent. Never implicitly initializes on read.
    fs.mkdirSync(store.#directory,{mode:0o700})
    const fd=fs.openSync(path.join(store.#directory,'lock'),'wx',0o600);fs.fsyncSync(fd);fs.closeSync(fd)
    // Fixed stripes bound physical lock files. Collisions return Busy, never steal
    // a live attempt by PID or wall-clock expiry. The parent retains the OFD lock.
    for(let n=0;n<16;n++){const fd=fs.openSync(path.join(store.#directory,`attempt-${n}`),'wx',0o600);fs.fsyncSync(fd);fs.closeSync(fd)}
    store.#call('create',{limits:bounds(limits)})
    return store
  }
  #call(operation,input,{deadline=null}={}){
    check(deadline===null||Number.isSafeInteger(deadline),'InvalidProjection')
    const remaining=deadline===null?10000:deadline-Date.now()
    check(remaining>0,'ProjectionExecutionTimeout')
    const lock=path.join(this.#directory,'lock')
    try{check(fs.lstatSync(this.#directory).isDirectory()&&fs.lstatSync(lock).isFile(),'ProjectionStoreCorrupt')}
    catch(e){if(e.code==='ENOENT')fail('ProjectionUnavailable');throw e}
    // Pass a pre-opened existing lock FD: flock can never create a missing file.
    const fd=fs.openSync(lock,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW)
    let result
    const mode=['read','inspect','repair','begin'].includes(operation)?'--shared':'--exclusive'
    // Short reads/publications serialize within a bounded kernel wait. Attempt
    // ownership remains nonblocking below; this never retries an effect or CAS.
    const waitSeconds=String(Math.min(250,remaining)/1000)
    try{result=spawnSync('/usr/bin/setpriv',['--pdeathsig','SIGKILL','--','/usr/bin/flock',mode,'--timeout',waitSeconds,'--no-fork','--conflict-exit-code','73','/proc/self/fd/3',process.execPath,helper,this.#directory,operation,String(process.pid)],
      {input:JSON.stringify(input),stdio:['pipe','pipe','pipe',fd],maxBuffer:13*1024*1024,timeout:Math.min(10000,remaining),killSignal:'SIGKILL'})}
    finally{fs.closeSync(fd)}
    if(result.status===73)fail('ProjectionStoreBusy')
    if(result.error?.code==='ETIMEDOUT'&&deadline!==null)fail('ProjectionExecutionTimeout')
    if(result.error||result.status!==0)fail('ProjectionUnavailable')
    let output;try{output=JSON.parse(result.stdout)}catch{fail('ProjectionStoreCorrupt')}
    if(output.error)fail(output.error)
    return output.value
  }
  inspect(){return this.#call('inspect',{})}
  // Hints only: readers validate the durable image under the existing lock.
  // Its mtime is touched only after publication/drop, never pending lease writes.
  // Neither this timestamp nor event delivery is a state/revision authority.
  watch(onChange){
    let timer,closed=false
    const notify=()=>{if(closed||timer)return;timer=setTimeout(()=>{timer=null;if(!closed)onChange()},20)}
    const watcher=fs.watch(this.#directory,(_event,name)=>{if(name===null||String(name)==='lock')notify()})
    watcher.on('error',notify)
    return ()=>{if(closed)return;closed=true;clearTimeout(timer);watcher.close()}
  }
  async withAttempt(id,operation){
    token(id);let stripe=0;for(const byte of Buffer.from(id))stripe=(stripe*31+byte)%16
    let fd
    try{fd=fs.openSync(path.join(this.#directory,`attempt-${stripe}`),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW)}
    catch(error){if(error.code==='ENOENT')fail('ProjectionUnavailable');throw error}
    try{
      check(fs.fstatSync(fd).isFile(),'ProjectionStoreCorrupt')
      const result=spawnSync('/usr/bin/flock',['--exclusive','--nonblock','--conflict-exit-code','73','3'],{stdio:['ignore','pipe','pipe',fd],timeout:1000})
      if(result.status===73)fail('ProjectionStoreBusy')
      check(!result.error&&result.status===0,'ProjectionUnavailable')
      return await operation()
    }finally{fs.closeSync(fd)}
  }
  begin(key,options){return this.#call('begin',{key:token(key)},options)}
  read(key,revision=null){return this.#call('read',{key:token(key),revision})}
  publish(ticket,snapshot,jobId,options){return this.#call('publish',{ticket,snapshot,jobId:token(jobId)},options)}
  pending(record,options={}){return this.#call('pending',{record,previousHolder:options.previousHolder??null},options)}
  repair(id){return this.#call('repair',{id:token(id)})}
  finish(id){return this.#call('finish',{id:token(id)})}
  dropSnapshots(key){return this.#call('drop',{key:token(key)})}
}
