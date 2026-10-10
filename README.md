# @hathq/projection-runtime

Execute explicitly registered projection producers in bounded Node.js workers and
publish disposable read-only snapshots with durable fencing and exact owner leases.
The runtime never chooses a latest source, loads request-supplied code or owns
application authorization. Owner adapters decide visibility and retention.

## Install and use

```sh
npm install @hathq/projection-runtime@0.10.0
```

```ts
import { ProducerRegistry, ProjectionRuntime, ExactSourceReader } from '@hathq/projection-runtime'
import { FileProjectionStore } from '@hathq/projection-runtime/store'

const registry = new ProducerRegistry()
const producer = registry.register({ id: 'review', kind: 'data' })
// Provision this existing parent as mode 0700 before creating the store once.
const store = FileProjectionStore.create('/private/application/projections')
// adapters is a Map of owner IDs to bounded acquire/read/release/releaseHolder APIs.
const reader = new ExactSourceReader(adapters)
const runtime = new ProjectionRuntime({ store, registry, reader })
try {
  const { snapshot } = await runtime.submit({
    key: 'review', producer, sources: exactOwnerReferences,
    focus: 'selected-resources', purpose: 'review', visibilityRef: acceptedVisibility,
    limits: {}
  }, { accessRef: acceptedOwnerAccess })
  console.log(snapshot.revision)
} finally {
  await runtime.close()
}
```

The application supplies `adapters`, `exactOwnerReferences`, `acceptedVisibility`
and `acceptedOwnerAccess`; these are explicit authorization bindings, not defaults.
A producer must be registered before requests can reference its returned identity.

## Boundaries and operating environment

The file store requires Linux/WSL, Node.js 22 or newer, `/usr/bin/flock` and
`/usr/bin/setpriv`. It rejects non-private directories, foreign ownership, symbolic
links and hard-linked state files. It runs local transaction helpers and built-in
producer workers; it does not execute arbitrary owner commands. It does not provide
an OS sandbox against another process running as the same user.

Store hints are wakeups, not revision authorities. Read/inspect never initializes
state. Repair leases preserve exact source identity, and cancelled or timed-out
work must drain before protection is released. Owner IO must honor its deadline
and AbortSignal, including independently bounded lost-response cleanup.

`@hathq/projection-contracts` owns wire validation and deterministic sealing;
projection-client owns disposable browser adoption; dom-renderer owns presentation.
This package owns execution/publication and no product-specific meaning.

## Development

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm -r --include-workspace-root typecheck
pnpm -r --include-workspace-root test
pnpm audit --audit-level=low
```

Production manifests use registry versions. Numeric workspace linking is only a
local development convenience. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
