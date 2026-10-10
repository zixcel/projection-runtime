// Same SHA-256 UTF-8 bytes and hexadecimal identity as the Node contract.
// Reuse the already selected unjs primitive, never a second projection algorithm.
import {digest} from 'ohash/crypto'
export const sha256=value=>Array.from(atob(digest(value).replaceAll('-','+').replaceAll('_','/')+'='),
  c=>c.charCodeAt(0).toString(16).padStart(2,'0')).join('')
