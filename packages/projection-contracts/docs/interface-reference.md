# projection-contracts interface reference

Use the [usage guide](getting-started.md) for the first steps. This reference preserves the current interface details and operational limits. Run command examples from the repository root, after preparing the exact declared dependencies and registered configuration.

## Boundary and input

`produce(request, exactSources)` receives owner-provided, visibility-filtered data.
Request pins the full `{owner,ref,revision,kind}` tuple for every source, the producer
identity/version/contract/configuration, focus, purpose, visibility decision ref and
resource limits. An external source adapter supplies neutral items, relations and
unresolved records. It preserves adopted semantic refs and original evidence, not
names reinterpreted as meaning. SubjectProjection remains an upstream read-only
source; this package has no fixed profile fields or Hatter-specific codec.

Every item/relation/unresolved record retains exact source lineage. Semantic groups
use explicit adopted refs. Source-path groups are structural only. Conflicting
values remain distinct observations; PP does not select a winner. Text values and
labels are plain data and must never be rendered as executable HTML.

`scene(data, configuration)` defines focus/purpose, abstract regions and action
descriptors. Profile, Resolution and Operation are specimen configurations, not
fixed application pages. Regions preserve author ordering. The client chooses its
Scene in separate PresentationState. Renderer state is never part of the contract.
Actions identify an owner command and required context; availability grants nothing.

## Revision and recovery

ProjectionRevision is a domain-separated content digest over exact sources,
producer/request/configuration and derived content. It is neither a semantic or
Graph revision nor a transport sequence. Lineage is derivation evidence, not
canonical restoration history. Changing source tuple or configuration changes it.

`rebuild(request, readExact)` reads only pinned snapshots. Missing/reclaimed input
returns ProjectionRebuildUnavailable. No cache or latest-source fallback. A rebuild
guarantee lasts only while owners retain each exact input. C4 already has explicit
Retained/InFlight roots; actual lease wiring and durable publication belong to PP1.
No new Graph capability or fixed retention duration is assumed here.

`ProjectionSlot` is an executable in-memory CAS/publication contract for acceptance.
It holds one snapshot and receipt per explicit key, no global map or scheduler.
`pendingRepair(ticket, request, failure)` retains the original fence and exact refs;
`repair(slot, pending, readExact)` rebuilds, then publishes. Older repair cannot move
a newer head backwards. `dropCache()` discards data but not the live slot fence.
Process restart creates a new slot and explicitly rebuilds. This is not durable
publication, replay history, semantic storage or a replacement for Graph CAS.

`recovery(snapshot, confirmedRevision)` returns Crowsi-compatible Snapshot/NoChange.
It performs no IO. Delta is a reserved contract only. The package does not import
Crowsi; a consumer connects the owner callback to its current immutable transport.
Peer ACK confirms delivery, not canonical adoption, rendered output or perception.

`adoptSnapshot(snapshot, {key,revision})` validates exact SSR/hydration content and
lineage. It never fetches or silently accepts a newer projection. Source changes
enter through explicit owner recovery. This pure helper is not a browser runtime.

## Bounds and validation

See `contract.json`. Defaults: 8 sources, 256 items, 512 relations/provenance entries,
64 unresolved records/actions, 16 regions and 512 KiB serialized snapshot. Neutral
input JSON is capped at 2 MiB/32,768 nodes/16 levels; all limits can only decrease.
Excess is typed, not silently truncated; upstream `truncated` remains visible.
Large STATE-metadata plus BULK delivery is future runtime work, not implicit fallback.
Pure computation is synchronous; exact-source callbacks must return immediately.

Visibility is an owner decision, not a new access-control layer. Owners must provide
safe source refs and remove relationships disclosing hidden items. Redaction strips
values and semantic/evidence/provenance refs. Digests do not authenticate the owner;
transport trust and source admission remain external.

Run `node --test test/*.test.mjs`. Independent acceptance extracts the immutable npm
archive and verifies actual Hatter SubjectProjection + current Crowsi delivery.
The product Console remains TEMPORARY_PRESENTATION_ADAPTER until PP runtime replaces
it. No renderer, production subscription, model runtime or release is claimed.
