import {createHash} from 'node:crypto'
import {canonical,ProjectionError} from '@hathq/projection-contracts'
export const fail=code=>{throw new ProjectionError(code)}
export const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
export const clone=value=>JSON.parse(canonical(value))
export function check(ok,code='InvalidProjection'){if(!ok)fail(code)}
export function shape(value,keys){check(value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k)))}
export function token(value){check(typeof value==='string'&&value.length>0&&Buffer.byteLength(value)<=512&&!/[\x00-\x1f\x7f]/u.test(value));return value}
export const ceilings=Object.freeze({concurrent:2,queued:16,inputBytes:2097152,executionMs:5000,keys:8,snapshots:2,repairs:16,attempts:3,repairMs:300000})
export function bounds(input={}){
  check(input&&Object.getPrototypeOf(input)===Object.prototype)
  const b={...ceilings,...input}
  for(const k of Object.keys(b))check(Object.hasOwn(ceilings,k)&&Number.isSafeInteger(b[k])&&b[k]>=1&&b[k]<=ceilings[k],'ProjectionLimitExceeded')
  return Object.freeze(b)
}
