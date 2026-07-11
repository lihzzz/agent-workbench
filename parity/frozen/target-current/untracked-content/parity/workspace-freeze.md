# Workspace Freeze Artifacts

The freeze script captures a Git worktree state for M0 baseline evidence.

## Command

```bash
node scripts/parity/freeze-workspace.mjs \
  --workspace /path/to/harnss \
  --label source \
  --output /path/to/harnss/parity/frozen/source
```

Use `--label target-current` for the target worktree. The script writes:

- `head.tar` from `git archive HEAD`
- `worktree.diff` from `git diff --binary HEAD`
- `status-porcelain.txt`
- `untracked-files.txt`
- `untracked-content/` copied from the untracked file list
- `manifest.json` with SHA-256 entries for tracked and untracked worktree files
- `codex-sessions.diff` when `electron/src/ipc/codex-sessions.ts` has a worktree diff
- `freeze-summary.json`

`parity/frozen/**` is excluded from future freezes to avoid recursively capturing generated archives.
The full target-side sequence can also be regenerated with:

```bash
node scripts/parity/run-m0-pipeline.mjs
```

Pass `--source-workspace /path/to/source-harnss` when the frozen source checkout is already available.
The recommended one-shot export from a source checkout is:

```bash
node scripts/parity/export-source-evidence.mjs \
  --source-workspace /path/to/source-harnss \
  --output-dir /path/to/source-evidence \
  --strict-expected
```

It writes:

- `source.bundle`
- `source-freeze.tar`
- `source-snapshots.tar`
- `source-evidence-manifest.json`
- `README.md` with the matching import command

The exported directory can be imported with:

```bash
node scripts/parity/run-m0-pipeline.mjs \
  --source-evidence-dir /path/to/source-evidence \
  --prepared-source-dir /path/to/prepared-source-harnss \
  --force-source-freeze-import \
  --force-source-snapshot-import
```

If the source is provided as a standalone Git bundle, use:

```bash
node scripts/parity/run-m0-pipeline.mjs \
  --source-bundle /path/to/harnss-source.bundle \
  --prepared-source-dir /path/to/prepared-source-harnss
```

If the source has already been frozen elsewhere with this script, import that evidence directly:

```bash
node scripts/parity/run-m0-pipeline.mjs \
  --source-freeze-dir /path/to/frozen/source
```

or:

```bash
node scripts/parity/run-m0-pipeline.mjs \
  --source-freeze-archive /path/to/source-freeze.tar
```

The pipeline first runs `prepare-source-workspace.mjs`, which records the source intake state in
`parity/source-intake.json` and `.md`. With `--source-bundle`, it verifies the bundle and prepares
a source checkout at the requested directory before source freeze and contract snapshot collection.
Without a bundle it records `status: no-input` and falls back to `--source-workspace` when provided.

The pipeline also runs `import-source-freeze.mjs`, which records source freeze intake in
`parity/source-freeze-intake.json` and `.md`. Imported freeze evidence is copied into
`parity/frozen/source` and can satisfy the source freeze portion of M0, but it cannot generate source
contract snapshots unless a real source checkout is also provided.

The pipeline also accepts externally captured source contract snapshots:

```bash
node scripts/parity/run-m0-pipeline.mjs \
  --source-snapshot-dir /path/to/snapshots/source
```

or:

```bash
node scripts/parity/run-m0-pipeline.mjs \
  --source-snapshot-archive /path/to/source-snapshots.tar
```

`import-source-snapshots.mjs` records this in `parity/source-snapshot-intake.json` and `.md`, then
copies the eight normalized contract snapshot files into `parity/snapshots/source`.

The pipeline then runs `resolve-source-workspace.mjs`, which records local source discovery state in
`parity/source-workspace-resolution.json` and `.md`.

## Current Target Freeze

Generated with:

```bash
node scripts/parity/freeze-workspace.mjs \
  --workspace /Users/lh/git/harnss \
  --label target-current \
  --output /Users/lh/git/harnss/parity/frozen/target-current
```

Summary:

| Artifact | Value |
|---|---|
| Branch | `hy_dev1` |
| HEAD | `fffd46b3da457c65ebdd5a479e4350eb1c1cbe36` |
| Status entries | 92 |
| Manifest entries | 1153 |
| Copied untracked files | 70 |
| `head.tar` SHA-256 | `4f5690b9bedb2d437fa83bb0e31cb2bd697cd8ee544f03cf421878a0e53458d7` |
| `worktree.diff` SHA-256 | `c4c3e8349ab41a26daabcc0a4673c91d83622beccd73436dac6a4c58e9c1758b` |
| `manifest.json` SHA-256 | `e12dd2300954a3d67ad4b66e23c32fd3be41ef9935caeb7da03f75b0d575d9bf` |
| `codex-sessions.diff` | Not present for target-current |

The source freeze remains pending because the source workspace/branch is not accessible in this environment.
