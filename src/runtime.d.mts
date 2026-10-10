import type { ProducerIdentity, ProjectionRequest, Snapshot } from '@hathq/projection-contracts';
import type { RuntimeLimits, ProjectionStore, SourceAdapter, SourceReadOptions, SourceReader, ProducerConfiguration, SubmissionOptions, StoreReceipt, StoreInspection } from './types/runtime.mjs';
export type * from './types/runtime.mjs';
/** Register installed built-in producers; requests cannot supply executable code. */
export class ProducerRegistry {
  register(definition: { id: string; kind: 'data' | 'scene'; configuration?: ProducerConfiguration }): ProducerIdentity;
  exact(identity: ProducerIdentity): Readonly<{ identity: ProducerIdentity; kind: 'data' | 'scene'; configuration: ProducerConfiguration }>;
  unregister(identity: ProducerIdentity): void;
  readonly artifactDigest: string;
}
export class ExactSourceReader implements SourceReader {
  constructor(owners: Map<string, SourceAdapter>);
  acquireExact(refs: readonly import('@hathq/projection-contracts').SourceRef[], options: SourceReadOptions): ReturnType<SourceReader['acquireExact']>;
  release(leaseRefs: readonly string[], holder: string): Promise<void>;
}
/** Bounded isolated execution with explicit source ownership and publication fencing. */
export class ProjectionRuntime {
  constructor(options: { store: ProjectionStore; registry: ProducerRegistry; reader: SourceReader; limits?: Partial<RuntimeLimits> });
  inspect(): { active: number; queued: number; closed: boolean; limits: Readonly<RuntimeLimits>; store: StoreInspection };
  submit(request: ProjectionRequest, options: SubmissionOptions): Promise<{ snapshot: Snapshot; receipt: StoreReceipt }>;
  retry(id: string, options?: Omit<SubmissionOptions, 'accessRef' | 'id'>): ReturnType<ProjectionRuntime['submit']>;
  expire(id: string): Promise<void>;
  recoverState(input: { key: string; revision?: string | null }):
    { kind: 'RecoveryUnavailable'; reason: string } |
    { kind: 'NoChange'; revision: string } |
    { kind: 'Snapshot'; revision: string; payload: Uint8Array };
  close(): Promise<void>;
}
