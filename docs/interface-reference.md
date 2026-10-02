# projection-runtime interface reference

Use the [usage guide](getting-started.md) for the first steps. This reference preserves the current interface details and operational limits. Run command examples from the repository root, after preparing the exact declared dependencies and registered configuration.

## Required source adapter

The trusted owner adapter supplies:

* `acquireExact(refs, {accessRef, holder, until, signal}) → {sources, leaseRefs}`
* `release(leaseRefs, holder?)` — idempotent, including incomplete acquisition.

The adapter must validate current read visibility, exact source revisions and
read integrity, and atomically acquire bounded owner holds. Holder identity is
recorded before acquisition, so interrupted acquisition can be reconciled after
restart. It must independently bound IO, honor AbortSignal, and clean partial
acquisition. Sources are PP0 neutral inputs, not an alternate semantic store.
Only the owner can decide visibility; accessRef is not a new authorization system.

Source failure codes include SourceUnavailable, SourceNotRetained,
SourceRevisionMismatch, VisibilityDenied and SourceCorrupt. No missing source
creation or repair from cached projection bodies is permitted. Pending records
contain refs and request configuration only, never source bodies. Actual durable
Hatter/sem-lang hold registration is a prerequisite; an in-memory map is solely
a test fixture, not an acceptable product adapter.

## Resources and cancellation

Hard maximums (caller may lower): 2 producer workers, 16 queued jobs, 8 source refs,
2 MiB input, 512 KiB output, 5 s whole-job execution, 32 MiB old/8 MiB young worker
heap, 8 stored keys, 2 snapshots and 2 receipts per key, 16 pending repairs,
3 attempts, 300 s pending-repair lifetime. PP0 item/provenance bounds still apply.
These are projection bounds, **not process RSS, total disk or semantic memory TTL**.

The `executionMs` budget starts when a queued job is admitted and covers source
acquisition/read, producer execution and publication. The adapter receives an
absolute `deadline` as well as `signal`; owner lease duration remains independent.
Deadline expiry fences further phases, requests cancellation and drains owner IO.
Synchronous store calls receive the same absolute deadline; their private helper
is killed and reaped when the remaining budget expires, then the deadline is
rechecked. A
commit completed during that interval remains durable and replayable even when
the caller receives a timeout. No late result is reported as timely success.

Worker termination is awaited before result/cancellation and slot release. Queued
cancellation never starts a worker. Source IO bounds belong to the supplied owner
adapter; this package cannot preempt arbitrary adapter code in its parent process.
No general application scheduler or periodic retry thread is started. Repair
expiry is explicit via `expire`; a service must reconcile pending records/holder
expiry on startup and within its bounded maintenance cycle. Owner leases must
expire independently if the entire projection service is absent.

## Linux durable store adapter

`FileProjectionStore.create(directory, limits)` explicitly creates a new private
derived directory below an existing parent. `new FileProjectionStore(directory)`
is noncreating; inspect/read do not create or repair missing files.

This optional adapter requires Linux `/usr/bin/flock` and `/usr/bin/setpriv` (util-linux), `/proc` and
Node. Each bounded store transaction invokes one short-lived static helper under
kernel flock with `--no-fork`. Lock contention is typed ProjectionStoreBusy; there
is no PID/TTL lock stealing. No network, shell interpolation or dynamic executable
input. A killed transaction releases the OS lock. The helper is killed on its
10 s deadline. A parent-death signal also kills it when its caller crashes; the
helper verifies the expected parent before IO to close the guard-installation
race. No privilege, identity or namespace settings change. Writes use fsync, atomic rename, directory fsync and an integrity
envelope. Snapshot/current/receipt/repair completion share one transaction. One
12 MiB image and one 12 MiB replaceable temp file bound adapter-owned growth.

An admitted attempt also holds one of 16 fixed kernel lock stripes across owner
acquisition, worker execution, publication and cleanup. Another process contending
for that stripe receives `ProjectionStoreBusy`; elapsed lease time cannot steal a
live process lock. Process exit releases the lock without PID recovery. Each retry
persists a new holder and monotonically advanced attempt number under that fence.
Replacement leases are acquired and recorded before releasing the prior attempt's
holds. At most two prior acquisition sets remain in the bounded repair record.
Metadata from a stale holder cannot replace the current attempt. These physical
fences and holders are neither source revisions nor permission to read a source.

Source revisions are opaque. CAS uses the independent persisted instance/fence,
never numeric revision ordering. Older pending repair cannot overwrite a newer
head. Same publication retry returns the original receipt while retained. Receipt
replay is bounded by two retained receipts per key; callers must not infer eternal
idempotence or reuse retired job IDs. Snapshot eviction does not reclaim sources.
`dropSnapshots` affects disposable bodies, not source state or publication fencing.

Store corruption is rejected. A service must explicitly replace the damaged
derived store and rebuild from retained exact sources; no silent reset occurs.
Read of a missing cached body returns null. `recoverState` returns Snapshot,
NoChange or RecoveryUnavailable; transport ACK cannot change publication state.
Delta/BULK algorithms, browser hydration, durable owner lease adapters and production
service lifecycle integration are separate work, not implied by helper tests.
# Exact owner acquisition

`ExactSourceReader` accepts a bounded explicit map of owner adapters. Each exposes
`acquire(source, options) -> opaqueLease`, `read(source, lease, options)`,
`release(lease, holder)` and `releaseHolder(holder)`. Owners enforce visibility,
lease bounds and independent expiry; an empty dependency closure is valid.
All leases are acquired in owner/source order before any read or producer starts.
Known leases release by exact generation. Lost-response cleanup uses the durable
holder, which must identify one fenced attempt and never unrelated/reused work.
Every cleanup owner is attempted even if another refuses. Owner IO must acknowledge
cancellation only after it has drained; timeout does not abandon a live acquire.
This generic component is not a production sem-lang/Hatter transport adapter.
Actual acceptance and remaining cross-process attempt fencing are reported by the
product owner; importing this class alone is not PP1 closure.
