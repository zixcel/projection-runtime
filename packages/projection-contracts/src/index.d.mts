export { ProjectionError, LIMITS, canonical } from './client.mjs';
export type * from './client.mjs';
export type * from './types/input.mjs';
import type { DataProjection, SceneProjection } from './client.mjs';
import type { ProjectionRequest, ExactSource, SceneConfiguration, ReadExact } from './types/input.mjs';
export type Snapshot = DataProjection | SceneProjection;
export interface PublicationTicket { readonly key: string; readonly expected: string }
export interface PublicationReceipt extends PublicationTicket { readonly publication: string; readonly revision: string }
export interface PendingRepair { readonly ticket: PublicationTicket; readonly request: ProjectionRequest; readonly failure: 'ProjectionUnavailable' | 'ProjectionLimitExceeded' }
/** Validate and deterministically seal explicitly selected owner-visible data. */
export function produce(input: ProjectionRequest, exactSources: readonly ExactSource[]): DataProjection;
export function scene(data: DataProjection, configuration: SceneConfiguration): SceneProjection;
export function validateSnapshot(value: unknown): Snapshot;
export function rebuild(input: ProjectionRequest, readExact: ReadExact): DataProjection;
export function recovery(snapshot: Snapshot, receiverRevision: string | null):
  { kind: 'NoChange'; revision: string } | { kind: 'Snapshot'; revision: string; payload: Uint8Array };
export function adoptSnapshot(snapshot: Snapshot, expected: { key: string; revision: string }): Readonly<Snapshot>;
/** Disposable in-memory publication fence; it does not survive process restart. */
export class ProjectionSlot {
  constructor(key: string);
  begin(): Readonly<PublicationTicket>;
  publish(ticket: PublicationTicket, snapshot: Snapshot): Readonly<PublicationReceipt>;
  read(): Readonly<Snapshot> | null;
  dropCache(): void;
}
export function pendingRepair(ticket: PublicationTicket, input: ProjectionRequest, code: PendingRepair['failure']): Readonly<PendingRepair>;
export function repair(slot: ProjectionSlot, pending: PendingRepair, readExact: ReadExact): Readonly<PublicationReceipt>;
