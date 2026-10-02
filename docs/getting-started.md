# Using @hathq/projection-runtime

Generate and maintain view projections from an explicitly supplied source.

## Before you start

A projection is a read model. It does not replace the source authority or certify a complete product deployment.

## First steps

Make the exact declared dependency artifacts available before installation. Local archives are excluded from Git; registry publication remains pending.

Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm test
```

## How to assess the result

- Produce snapshots with exact revision references.
- Track projection updates and readiness.

A passing source-level check establishes only what that check observes. Keep missing configuration, unavailable services and unverified deployment paths visible.

## Continue reading

[Repository overview](../README.md)
