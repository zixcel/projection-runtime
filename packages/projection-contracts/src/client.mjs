// Shared validation, not a browser-specific schema or a canonical source reader.
export {validateSnapshot} from './producer.mjs'
export {canonical,copy,frozen,shape,text,roles,ProjectionError,LIMITS} from './contract.mjs'
