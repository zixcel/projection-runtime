/** Browser-safe exact projection wire types; owner meaning remains external. */
export type * from './types/snapshot.mjs';
import type { DataProjection, SceneProjection } from './types/snapshot.mjs';
export function validateSnapshot(value: unknown): DataProjection | SceneProjection;
export function canonical(value: unknown, maximum?: number): string;
export function copy<T>(value: T): T;
export function frozen<T>(value: T): Readonly<T>;
export function shape(value: unknown, required: string[], optional?: string[]): void;
export function text(value: unknown, maximum?: number): string;
export const roles: readonly import('./types/snapshot.mjs').RegionRole[];
export const LIMITS: Readonly<import('./types/input.mjs').ProjectionLimits>;
export class ProjectionError extends Error { readonly code: string; constructor(code: string) }
