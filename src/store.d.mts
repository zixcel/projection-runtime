import type { Snapshot, PublicationTicket } from '@hathq/projection-contracts';
import type { RuntimeLimits, ProjectionStore, StoreOptions, StoreInspection, StoreReceipt, RepairRecord } from './types/runtime.mjs';
/** Linux/WSL kernel-flock adapter. Call create once inside an existing private parent. */
export class FileProjectionStore implements ProjectionStore {
  constructor(directory: string);
  static create(directory: string, limits?: Partial<RuntimeLimits>): FileProjectionStore;
  inspect(): StoreInspection;
  watch(onChange: () => void): () => void;
  withAttempt<T>(id: string, operation: () => T | PromiseLike<T>): Promise<T>;
  begin(key: string, options?: StoreOptions): PublicationTicket;
  read(key: string, revision?: string | null): Snapshot | null;
  publish(ticket: PublicationTicket, snapshot: Snapshot, jobId: string, options?: StoreOptions): StoreReceipt;
  pending(record: RepairRecord, options?: StoreOptions): RepairRecord;
  repair(id: string): RepairRecord | null;
  finish(id: string): null;
  dropSnapshots(key: string): null;
}
