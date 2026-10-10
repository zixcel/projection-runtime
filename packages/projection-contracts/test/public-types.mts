import { produce, scene, ProjectionSlot, pendingRepair, repair, recovery, type ProjectionRequest, type ExactSource } from '@hathq/projection-contracts';
import { validateSnapshot } from '@hathq/projection-contracts/client';
const ref = { owner: 'example', ref: 'selected', revision: 'revision-1', kind: 'example' };
const request: ProjectionRequest = { key: 'example', producer: { id: 'builtin', version: '0.10.0', contract: 'projection/0.10.0', configuration: 'reviewed' }, sources: [ref], focus: 'example', purpose: 'review', visibilityRef: 'owner-authorized', limits: {} };
const source: ExactSource = { source: ref, items: [], relations: [], unresolved: [], truncated: false };
const data = produce(request, [source]);
const view = scene(data, { key: 'scene', focus: 'example', purpose: 'review', regions: [], actions: [] });
validateSnapshot(view);
const slot = new ProjectionSlot('example');
const ticket = slot.begin();
const pending = pendingRepair(ticket, request, 'ProjectionUnavailable');
repair(slot, pending, () => source);
recovery(data, null);
// @ts-expect-error An asynchronous source read cannot satisfy synchronous rebuild.
repair(slot, pending, async () => source);
