import type { Item, SourceRef, Unresolved, Relation, Region, Action } from './snapshot.mjs';
/** Exact producer identity: no request-provided code or implicit latest revision. */
export interface ProducerIdentity { readonly id: string; readonly version: string; readonly contract: string; readonly configuration: string }
export interface ProjectionLimits { sources: number; items: number; relations: number; provenance: number; unresolved: number; regions: number; actions: number; snapshotBytes: number }
export interface ProjectionRequest {
  readonly key: string; readonly producer: ProducerIdentity; readonly sources: readonly SourceRef[];
  readonly focus: string; readonly purpose: string; readonly visibilityRef: string; readonly limits: Partial<ProjectionLimits>;
}
export interface ExactSource {
  readonly source: SourceRef; readonly items: readonly (Omit<Item, 'sourceRefs' | 'visibility'> & { readonly visibility: 'visible' | 'redacted' | 'omitted' })[];
  readonly unresolved: readonly Omit<Unresolved, 'sourceRefs'>[];
  readonly relations: readonly Omit<Relation, 'sourceRefs'>[]; readonly truncated: boolean;
}
export interface SceneConfiguration {
  readonly key: string; readonly focus: string; readonly purpose: string;
  readonly regions: readonly Region[]; readonly actions: readonly Action[];
  readonly temporal?: { readonly label: string; readonly items: readonly { readonly itemId: string; readonly valuePath: readonly string[]; readonly format: 'utcInstant' | 'unixMilliseconds' }[] };
  readonly presentation?: readonly {
    readonly itemId: string; readonly title?: string; readonly titlePath?: readonly string[];
    readonly summaryPath?: readonly string[]; readonly symbol?: string;
    readonly fields?: readonly { readonly label: string; readonly valuePath: readonly string[] }[];
  }[];
}
export type ReadExact = (source: SourceRef) => ExactSource | null;
