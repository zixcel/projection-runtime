import {parentPort,workerData} from 'node:worker_threads'
import {produce,scene} from '@hathq/projection-contracts'
try{
  // A visible value alone exceeding the entire output ceiling is a resource
  // failure, before PP0's strict per-value serializer can classify its shape.
  const ceiling=workerData.request.limits.snapshotBytes??524288
  for(const source of workerData.sources)for(const item of source.items){
    if(item.visibility==='visible'&&Buffer.byteLength(JSON.stringify(item.value))>ceiling)throw Object.assign(new Error('ProjectionLimitExceeded'),{code:'ProjectionLimitExceeded'})
  }
  const data=produce(workerData.request,workerData.sources)
  const snapshot=workerData.entry.kind==='scene'?scene(data,workerData.entry.configuration):data
  parentPort.postMessage({snapshot})
}catch(e){parentPort.postMessage({error:e.code??'ProjectionProducerFailed'})}
parentPort.close()
