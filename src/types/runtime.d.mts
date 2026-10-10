import type { ExactSource, ProjectionRequest, ProducerIdentity, SceneConfiguration, SourceRef, Snapshot, PublicationTicket, PublicationReceipt } from '@hathq/projection-contracts';
export interface RuntimeLimits { concurrent: number; queued: number; inputBytes: number; executionMs: number; keys: number; snapshots: number; repairs: number; attempts: number; repairMs: number }
export interface StoreOptions { deadline?: number | null; previousHolder?: string | null }
export interface RepairRecord {
  id: string; holder: string; previous: readonly { holder: string; leases: readonly string[] }[];
  ticket: PublicationTicket; request: ProjectionRequest; producer: ProducerIdentity;
  accessRef: string; expiresAt: number; attempts: number; failure: string | null; leases: readonly string[];
}
export interface StoreReceipt extends PublicationReceipt { readonly jobId: string }
export interface StoreInspection {
  keys: readonly { key: string; current: string | null; fence: string; snapshots: number }[];
  repairs: readonly RepairRecord[]; limits: Readonly<RuntimeLimits>;
}
export interface ProjectionStore {
  inspect(): StoreInspection;
  withAttempt<T>(id: string, operation: () => T | PromiseLike<T>): Promise<T>;
  begin(key: string, options?: StoreOptions): PublicationTicket;
  read(key: string, revision?: string | null): Snapshot | null;
  publish(ticket: PublicationTicket, snapshot: Snapshot, jobId: string, options?: StoreOptions): StoreReceipt;
  pending(record: RepairRecord, options?: StoreOptions): RepairRecord;
  repair(id: string): RepairRecord | null;
  finish(id: string): null;
}
export interface SourceReadOptions { accessRef: string; holder: string; until: number; deadline: number; signal: AbortSignal }
export interface SourceReader {
  acquireExact(refs: readonly SourceRef[], options: SourceReadOptions): Promise<{ sources: readonly ExactSource[]; leaseRefs: readonly string[] }>;
  release(leaseRefs: readonly string[], holder: string): void | Promise<void>;
}
/** Owner adapters retain authorization, durable leases and bounded/cancellable IO. */
export interface SourceAdapter {
  acquire(source: SourceRef, options: SourceReadOptions): string | Promise<string>;
  read(source: SourceRef, lease: string, options: SourceReadOptions): ExactSource | Promise<ExactSource>;
  release(lease: string, holder: string): void | Promise<void>;
  releaseHolder(holder: string): void | Promise<void>;
}
export interface SubmissionOptions { accessRef: string; signal?: AbortSignal; id?: string }
export type ProducerConfiguration = Readonly<Record<string, import('@hathq/projection-contracts').Json>> | SceneConfiguration;
