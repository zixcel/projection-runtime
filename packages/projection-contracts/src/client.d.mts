/** Browser-safe exact projection wire types; owner meaning remains external. */
export type Json = null | boolean | number | string | readonly Json[] | {readonly [key:string]:Json}
export interface SourceRef {readonly owner:string;readonly ref:string;readonly revision:string;readonly kind:string}
export interface Item {readonly id:string;readonly semanticRef:string|null;readonly group:{readonly kind:string;readonly ref:string};readonly value:Json;readonly evidence:readonly string[];readonly provenance:readonly string[];readonly resolutionRefs:readonly string[];readonly visibility:string;readonly sourceRefs:readonly SourceRef[]}
export interface Unresolved {readonly id:string;readonly reason:string;readonly evidence:readonly string[];readonly contextRefs:readonly string[];readonly actionRefs:readonly string[];readonly sourceRefs:readonly SourceRef[]}
export interface Region {readonly id:string;readonly role:string;readonly itemIds:readonly string[]}
export interface ProjectedInteraction {readonly ref:string;readonly generation:string;readonly inputContractRef:string;readonly input:import('@zixcel/interaction/input').InputDeclaration}
export interface Action {readonly id:string;readonly targetOwner:string;readonly commandRef:string;readonly label:string;readonly contextRefs:readonly string[];readonly sourceRefs:readonly SourceRef[];readonly interaction?:ProjectedInteraction}
export interface ProjectionIdentity {readonly key:string;readonly revision:string;readonly lineage:Json}
export interface Relation {readonly id:string;readonly from:string;readonly to:string;readonly relationRef:string;readonly sourceRefs:readonly SourceRef[]}
export interface ProjectionData {readonly items:readonly Item[];readonly unresolved:readonly Unresolved[];readonly relations:readonly Relation[];readonly truncated:boolean;readonly omittedByPolicy:number}
export interface DataProjection extends ProjectionIdentity {readonly contract:'projection/0.10.0';readonly kind:'Data';readonly data:ProjectionData}
export interface SceneProjection extends ProjectionIdentity {readonly contract:'projection/0.10.0';readonly kind:'Scene';readonly data:ProjectionData & {readonly regions:readonly Region[];readonly actions:readonly Action[];readonly focus:string;readonly purpose:string}}
export function validateSnapshot(value:unknown):DataProjection|SceneProjection
export function canonical(value:unknown,maximum?:number):string
export function copy<T>(value:T):T
export function frozen<T>(value:T):Readonly<T>
export function shape(value:unknown,required:string[],optional?:string[]):void
export function text(value:unknown,maximum?:number):string
export const roles:readonly string[]
export const LIMITS:Readonly<Record<string,number>>
export class ProjectionError extends Error {readonly code:string;constructor(code:string)}
