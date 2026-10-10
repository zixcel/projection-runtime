# @hathq/projection-contracts

Validate and seal bounded, renderer-neutral Data and Scene snapshots from explicitly
selected owner-visible source revisions. Deterministic lineage and publication
fences keep presentation tied to the accepted source without owning its meaning.

```sh
npm install @hathq/projection-contracts@0.10.0
```

```ts
import { produce, scene, ProjectionSlot } from '@hathq/projection-contracts'

const source = { owner: 'example', ref: 'selected', revision: 'revision-1', kind: 'example' }
const data = produce({
  key: 'review', producer: { id: 'builtin', version: '0.10.0',
    contract: 'projection/0.10.0', configuration: 'reviewed' },
  sources: [source], focus: 'resources', purpose: 'review',
  visibilityRef: 'owner-authorized', limits: {}
}, [{ source, items: [], relations: [], unresolved: [], truncated: false }])
const slot = new ProjectionSlot('review')
const receipt = slot.publish(slot.begin(), data)
const view = scene(data, { key: 'scene', focus: 'resources', purpose: 'review',
  regions: [], actions: [] })
console.log(receipt.revision, view.revision)
```

`@hathq/projection-contracts/client` exposes browser-safe validation helpers.
Node/browser hashing uses identical SHA-256 bytes; the dependency on
`@zixcel/interaction/input` validates explicit interaction declarations.

The producer owns authorization, visible data and exact source selection. Scene
labels and regions do not grant permissions. `ProjectionSlot` is an in-memory,
disposable fence: it does not promise durability across restart. Use
`@hathq/projection-runtime` for bounded execution and durable publication.

## Development

Run the repository workspace install, type checks and behavioral tests described
in the root README. Public dependencies resolve from npm; no vendor archive or
private registry is required. [License](LICENSE) · [Notices](NOTICE).
