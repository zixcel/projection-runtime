# Using @hathq/projection-contracts

Install the published npm package and import producer APIs from the root, or
browser validation from `@hathq/projection-contracts/client`. See the
[typed producer and Scene example](../README.md).

The application supplies exact owner-visible revisions and accepted access
references. Projection data never grants authority, chooses a latest revision
or mutates canonical sources. Keep missing source and unavailable rebuild
results explicit.

For development, install and test from the consolidated repository root:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm -r --include-workspace-root typecheck
pnpm -r --include-workspace-root test
```

The root and contract manifests use public registry versions; numeric workspace
linking is solely a development convenience. Legal documents stay alongside the
package. CI, repository identity and disclosure policy belong to the repository
root.
