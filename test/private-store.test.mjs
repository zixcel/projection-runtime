import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {FileProjectionStore} from '../src/store.mjs'

function fixture() {
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),'projection-private-'))
  const directory=path.join(parent,'store')
  const store=FileProjectionStore.create(directory)
  return {parent,directory,store}
}

test('shared parent and shared lock or image are rejected before access',()=>{
  const f=fixture()
  try {
    for(const filename of ['lock','projection.json']) {
      const file=path.join(f.directory,filename)
      fs.chmodSync(file,0o640)
      assert.throws(()=>f.store.inspect(),e=>e.code==='ProjectionStoreCorrupt')
      fs.chmodSync(file,0o600)
    }
    fs.chmodSync(f.parent,0o755)
    assert.throws(()=>FileProjectionStore.create(path.join(f.parent,'new')),e=>e.code==='ProjectionStoreCorrupt')
    assert.equal(fs.existsSync(path.join(f.parent,'new')),false)
  } finally {fs.rmSync(f.parent,{recursive:true})}
})

test('a hard-linked temporary file cannot truncate an unrelated file',()=>{
  const f=fixture(),outside=path.join(f.parent,'untouched')
  try {
    fs.writeFileSync(outside,'never-overwrite',{mode:0o600})
    fs.linkSync(outside,path.join(f.directory,'projection.next'))
    assert.throws(()=>f.store.finish('example'),e=>e.code==='ProjectionStoreCorrupt')
    assert.equal(fs.readFileSync(outside,'utf8'),'never-overwrite')
    assert.equal(f.store.inspect().keys.length,0)
  } finally {fs.rmSync(f.parent,{recursive:true})}
})

test('a private stale temporary file is replaced with a fresh exclusive inode',()=>{
  const f=fixture()
  try {
    fs.writeFileSync(path.join(f.directory,'projection.next'),'interrupted',{mode:0o600})
    f.store.finish('example')
    assert.equal(fs.existsSync(path.join(f.directory,'projection.next')),false)
    assert.equal(f.store.inspect().keys.length,0)
  } finally {fs.rmSync(f.parent,{recursive:true})}
})
