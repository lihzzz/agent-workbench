# M8 Contract Snapshot Status

These artifacts support the final zero-difference contract gate from the implementation plan.
They are normalized snapshots, not source evidence by themselves.

## Commands

```bash
node scripts/parity/export-source-evidence.mjs --source-workspace /path/to/source-harnss --output-dir /path/to/source-evidence --strict-expected
node scripts/parity/run-m0-pipeline.mjs --source-evidence-dir /path/to/source-evidence --prepared-source-dir /path/to/prepared-source-harnss --force-source-freeze-import --force-source-snapshot-import
node scripts/parity/collect-contract-snapshots.mjs --workspace /Users/lh/git/harnss --target target
node scripts/parity/collect-contract-snapshots.mjs --workspace /path/to/source-harnss --target source
node scripts/parity/compare-contract-snapshots.mjs
```

The old positional form, for example `node scripts/parity/collect-contract-snapshots.mjs target`,
is still supported for target-side snapshots. Use `--output-dir` only when snapshots should be written
outside `parity/snapshots/<target>`.

When the source is delivered as an exported evidence directory, run the M0 pipeline with source intake enabled:

```bash
node scripts/parity/run-m0-pipeline.mjs \
  --source-evidence-dir /path/to/source-evidence \
  --prepared-source-dir /path/to/prepared-source-harnss \
  --force-source-freeze-import \
  --force-source-snapshot-import
```

For a standalone Git bundle, run:

```bash
node scripts/parity/run-m0-pipeline.mjs \
  --source-bundle /path/to/harnss-source.bundle \
  --prepared-source-dir /path/to/prepared-source-harnss
```

That flow writes `parity/source-intake.json` and `.md`, prepares the source checkout, freezes it,
collects source contract snapshots, compares source/target snapshots, and generates source-side
ledger artifact packages when the bundle contains the expected `hy_dev` / `0e1dab7` state.

When only externally captured freeze artifacts are available, import them with:

```bash
node scripts/parity/run-m0-pipeline.mjs \
  --source-freeze-dir /path/to/frozen/source
```

or:

```bash
node scripts/parity/run-m0-pipeline.mjs \
  --source-freeze-archive /path/to/source-freeze.tar
```

This writes `parity/source-freeze-intake.json` and `.md` and copies the freeze into
`parity/frozen/source`. It can satisfy the source freeze evidence gate, but source contract
snapshots still require a source checkout because they are extracted from source files.

If the source contract snapshots were generated elsewhere, import them directly:

```bash
node scripts/parity/run-m0-pipeline.mjs \
  --source-snapshot-dir /path/to/snapshots/source
```

or:

```bash
node scripts/parity/run-m0-pipeline.mjs \
  --source-snapshot-archive /path/to/source-snapshots.tar
```

This writes `parity/source-snapshot-intake.json` and `.md` and copies the eight required snapshot
JSON files into `parity/snapshots/source` before `compare-contract-snapshots.mjs` runs.

`compare-contract-snapshots.mjs` writes both `parity/snapshots/contract-diff.json` and
`parity/snapshots/contract-diff.md`. For unequal snapshots, the JSON report includes a `diffCount`
and up to 50 JSON Pointer sample differences per file so source/target contract drift can be traced
without manually opening both snapshots first.

The final close gate is checked by:

```bash
node scripts/parity/validate-m8-readiness.mjs
```

It writes `parity/m8-readiness.json` and `parity/m8-readiness.md`, combining source baseline,
freeze comparison, contract snapshot equality, P01-P10 ledger closure, per-ledger source/target
artifacts, target diff coverage, and the final report requirement.

A draft final report can be generated at any time with:

```bash
node scripts/parity/generate-final-report.mjs --draft
```

The formal `parity/final-report.md` is only written by:

```bash
node scripts/parity/generate-final-report.mjs --final
```

That command refuses to write the final report unless `parity/m8-readiness.json` is `ready`.

Target-side P01-P10 artifact packages can be regenerated with:

```bash
node scripts/parity/collect-ledger-artifacts.mjs --side target
```

These files live at `parity/artifacts/<id>/target.json`. They are one-sided evidence packages only;
matching `source.json` files and ledger closure evidence are still required before any P item can close.
Each artifact includes a `completeness` object; M8 readiness requires both source and target artifacts
to have their freeze and all eight contract snapshot files present.

Current target artifact index:

- `parity/artifacts/target-index.md`
- `parity/artifacts/P01/target.json` through `parity/artifacts/P10/target.json`

Current source artifact status: `parity/artifacts/P01/source.json` through
`parity/artifacts/P10/source.json` are still missing until the source workspace is imported.

## Target Snapshot

Current target artifacts:

- `parity/snapshots/target/preload-api.json`
- `parity/snapshots/target/ipc-channels.json`
- `parity/snapshots/target/settings-defaults.json`
- `parity/snapshots/target/shared-types.json`
- `parity/snapshots/target/session-serialization.json`
- `parity/snapshots/target/package-dependencies.json`
- `parity/snapshots/target/build-config.json`
- `parity/snapshots/target/default-surface.json`
- `parity/snapshots/contract-diff.json`
- `parity/snapshots/contract-diff.md`

Current target counts:

| Snapshot | Count |
|---|---:|
| preload API paths | 192 |
| preload API IPC calls | 212 |
| preload renderer channels | 212 |
| registered IPC modules | 18 |
| main IPC channels | 172 |
| main emitted events | 20 |
| shared type declarations | 107 |
| session serialization declarations | 13 |
| package dependencies | 21 |
| package dev dependencies | 34 |
| build config files tracked | 4 |
| build config files present | 3 |
| build config files missing | 1 (`tsup.config.ts`) |
| default surface files tracked | 13 |
| default surface files present | 13 |
| default surface exported symbols | 29 |
| built-in agent declarations | 2 |
| engine icon maps | 1 |
| engine accent maps | 1 |
| default surface JSX strings | 58 |
| default surface keyword strings | 28 |

## Current Comparison

`parity/snapshots/contract-diff.json` is `not-equal` because the source snapshot directory does not exist yet.
This is expected until the frozen source workspace is imported and `collect-contract-snapshots.mjs`
is run with `--workspace <source> --target source` from the equivalent source state.
