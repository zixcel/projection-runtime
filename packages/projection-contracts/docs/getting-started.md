# Using @hathq/projection-contracts

Share a precise contract for view snapshots, revisions and interactions between a producer and a renderer.

## Before you start

The producer owns application meaning and authority; these contracts describe display data and interaction references.

## First steps

Make the exact declared dependency artifacts available before installation. Local archives are excluded from Git; registry publication remains pending.

Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm test
```

## How to assess the result

- Validate a bounded view snapshot.
- Keep action references tied to the accepted source revision.

A passing source-level check establishes only what that check observes. Keep missing configuration, unavailable services and unverified deployment paths visible.

## Continue reading

[Repository overview](../README.md)
