import type { InputDeclaration } from '@zixcel/interaction/input';
import type { ProducerIdentity, ProjectionRequest, SceneConfiguration } from './input.mjs';
export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };
export interface SourceRef { readonly owner: string; readonly ref: string; readonly revision: string; readonly kind: string }
export interface Item {
  readonly id: string; readonly semanticRef: string | null;
  readonly group: { readonly kind: 'semantic' | 'structural' | 'presentation'; readonly ref: string };
  readonly value: Json; readonly evidence: readonly string[]; readonly provenance: readonly string[];
  readonly resolutionRefs: readonly string[]; readonly visibility: 'visible' | 'redacted'; readonly sourceRefs: readonly SourceRef[];
}
export interface Unresolved {
  readonly id: string; readonly reason: string; readonly evidence: readonly string[];
  readonly contextRefs: readonly string[]; readonly actionRefs: readonly string[]; readonly sourceRefs: readonly SourceRef[];
}
export type RegionRole = 'Primary' | 'Context' | 'Interpretation' | 'Evidence' | 'Provenance' | 'Resolution' | 'Inspector' | 'Actions' | 'Activity';
export interface Region { readonly id: string; readonly role: RegionRole; readonly itemIds: readonly string[] }
export interface ProjectedInteraction {
  readonly ref: string; readonly generation: string; readonly inputContractRef: string; readonly input: InputDeclaration;
}
export interface Action {
  readonly id: string; readonly targetOwner: string; readonly commandRef: string; readonly label: string;
  readonly contextRefs: readonly string[]; readonly sourceRefs: readonly SourceRef[]; readonly interaction?: ProjectedInteraction;
}
export interface Relation { readonly id: string; readonly from: string; readonly to: string; readonly relationRef: string; readonly sourceRefs: readonly SourceRef[] }
export interface SourceLineage { readonly sources: readonly SourceRef[]; readonly producer: ProducerIdentity; readonly request: ProjectionRequest }
export interface ProjectionIdentity { readonly key: string; readonly revision: string; readonly lineage: SourceLineage }
export interface ProjectionData {
  readonly items: readonly Item[]; readonly unresolved: readonly Unresolved[]; readonly relations: readonly Relation[];
  readonly truncated: boolean; readonly omittedByPolicy: number;
}
export interface DataProjection extends ProjectionIdentity { readonly contract: 'projection/0.10.0'; readonly kind: 'Data'; readonly data: ProjectionData }
export interface SceneProjection extends ProjectionIdentity {
  readonly contract: 'projection/0.10.0'; readonly kind: 'Scene';
  readonly lineage: SourceLineage & { readonly dataProjection: { readonly key: string; readonly revision: string }; readonly sceneConfiguration: SceneConfiguration };
  readonly data: ProjectionData & {
    readonly regions: readonly Region[]; readonly actions: readonly Action[]; readonly focus: string; readonly purpose: string;
    readonly temporal?: { readonly label: string; readonly items: readonly { readonly itemId: string; readonly at: string }[] };
    readonly presentation?: readonly {
      readonly itemId: string; readonly title: string; readonly summary?: string; readonly symbol?: string;
      readonly fields?: readonly { readonly label: string; readonly value: string | number | boolean | null }[];
    }[];
  };
}
