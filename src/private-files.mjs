import fs from 'node:fs'
import {check} from './common.mjs'

/** Refuse shared state, symlinks and hard links before reading or truncating. */
export function privateDirectory(directory) {
  const stat = fs.lstatSync(directory)
  check(stat.isDirectory() && stat.uid === process.getuid()
    && (stat.mode & 0o077) === 0, 'ProjectionStoreCorrupt')
}

export function privateFile(stat) {
  check(stat.isFile() && stat.nlink === 1 && stat.uid === process.getuid()
    && (stat.mode & 0o077) === 0, 'ProjectionStoreCorrupt')
}

/** Remove only an owner-private stale file; exclusive creation prevents clobbering. */
export function removeStaleTemporary(filename) {
  try { privateFile(fs.lstatSync(filename)) }
  catch (error) { if (error.code === 'ENOENT') return; throw error }
  fs.unlinkSync(filename)
}
