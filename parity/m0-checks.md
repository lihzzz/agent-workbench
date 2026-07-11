# M0 Check Results

Generated during the current target-side M0 baseline pass.

## Source Workspace

- Expected branch: `hy_dev`
- Expected head prefix: `0e1dab7`
- Local branch: missing
- Local commit object: missing
- Remote `hy_dev*` heads on `origin`: none returned
- Source bundle intake: no input provided
- Source freeze intake: no input provided
- Source snapshot intake: no input provided
- Source `pnpm test`: not run, source snapshot unavailable
- Source `pnpm build`: not run, source snapshot unavailable

## Target Workspace

- Branch: `hy_dev1`
- Head: `fffd46b3da457c65ebdd5a479e4350eb1c1cbe36`
- Node: `v24.13.0`
- pnpm: `10.26.0`

## Commands

| Command | Result | Notes |
|---|---|---|
| `git diff --check` | pass | Fixed one trailing blank line in `src/lib/engine/leaked-tool-parse.ts`. |
| `pnpm test` | pass | 53 test files, 330 tests. |
| `pnpm build` | pass | Vite reported large chunk warnings; build completed. |
| `node scripts/parity/prepare-source-workspace.mjs` | no input | Generated `parity/source-intake.json` and `.md` with `status: no-input`. Pass `--source-bundle /path/to/harnss-source.bundle` to prepare a source checkout without touching the target worktree. |
| `node scripts/parity/import-source-freeze.mjs` | no input | Generated `parity/source-freeze-intake.json` and `.md` with `status: no-input`. Pass `--source-freeze-dir /path/to/frozen/source` or `--source-freeze-archive /path/to/source-freeze.tar` to import externally captured source freeze evidence. |
| `node scripts/parity/import-source-snapshots.mjs` | no input | Generated `parity/source-snapshot-intake.json` and `.md` with `status: no-input`. Pass `--source-snapshot-dir /path/to/snapshots/source` or `--source-snapshot-archive /path/to/source-snapshots.tar` to import externally captured source contract snapshots. |
| `node scripts/parity/export-source-evidence.mjs --source-workspace /path/to/source-harnss --output-dir /path/to/source-evidence` | pending | Use this once a real source checkout is available. It exports `source.bundle`, `source-freeze.tar`, `source-snapshots.tar`, and `source-evidence-manifest.json`; import the directory with `node scripts/parity/run-m0-pipeline.mjs --source-evidence-dir /path/to/source-evidence --prepared-source-dir /path/to/prepared-source-harnss --force-source-freeze-import --force-source-snapshot-import`. |
| `node scripts/parity/resolve-source-workspace.mjs` | unavailable | Checked 21 local candidates without remote probing; no checkout currently matches `hy_dev` / `0e1dab7`. Pass `--source-workspace /path/to/source-harnss` when a source checkout is available. |
| `node scripts/parity/collect-m0-baseline.mjs --target-workspace /Users/lh/git/harnss --output-dir /Users/lh/git/harnss/parity` | pass | Generated target baseline, source availability record, file matrix, and ledger stub. Add `--source-workspace /path/to/source-harnss` once the frozen source checkout is available. |
| `node scripts/parity/collect-contract-snapshots.mjs --workspace /Users/lh/git/harnss --target target` | pass | Generated normalized target snapshots for preload API, IPC channels, settings defaults, shared types, and session serialization. The legacy positional `target` argument remains supported. |
| `node scripts/parity/compare-contract-snapshots.mjs` | not equal | Source snapshots are missing, so all eight snapshot comparisons are pending. |
| `node scripts/parity/freeze-workspace.mjs --workspace /Users/lh/git/harnss --label target-current --output /Users/lh/git/harnss/parity/frozen/target-current` | pass | Generated target HEAD archive, binary diff, status, untracked content, and manifest. |
| `node scripts/parity/compare-freezes.mjs` | missing input | Source freeze is missing, so file-level freeze comparison cannot run yet. |
| `node scripts/parity/validate-ledger.mjs` | pass | Structured ledger is valid with 10 open and 0 closed items. |
| `node scripts/parity/index-target-diff.mjs` | pass | 88 target runtime diff files are routed to candidate ledger IDs, with 0 unmapped. |
| `node scripts/parity/collect-ledger-artifacts.mjs --side target` | pass | Generated complete P01-P10 target-side artifact packages from the target freeze, target contract snapshots, and target diff index. These do not prove parity or close P items. |
| `node scripts/parity/run-m0-pipeline.mjs` | pass | Source workspace intake, source freeze intake, source snapshot intake, source workspace resolution, target freeze, target baseline, target snapshots, comparisons, diff index, target ledger artifacts, ledger validation, M0 validation, and M8 readiness ran in order. Source freeze, source baseline evidence, source snapshots, and source artifacts remain unavailable because no source workspace, source bundle, source freeze package, or source snapshot package was provided. With `--source-bundle`, the pipeline prepares a source checkout first; with `--source-workspace`, it uses an existing source checkout; with `--source-freeze-dir` or `--source-freeze-archive`, it imports externally captured freeze evidence into `parity/frozen/source`; with `--source-snapshot-dir` or `--source-snapshot-archive`, it imports source contract snapshots into `parity/snapshots/source`. |
| `node scripts/parity/validate-m0.mjs` | not ready | 7 checks pass, 4 checks fail because source baseline, source freeze, source/target freeze comparison, and source contract snapshots are missing or incomplete. |
| `node scripts/parity/validate-m0.mjs --strict` | fail | Correctly exits non-zero while M0 is not ready. |
| `node scripts/parity/validate-m8-readiness.mjs` | not ready | 2 checks pass, 6 checks fail: source baseline/freeze/contracts are missing, P01-P10 remain open, source ledger artifacts are missing, and formal final report is not generated. |
| `node scripts/parity/generate-final-report.mjs --draft` | pass | Generated `parity/final-report.draft.md`; this is not the formal final report and does not satisfy M8 readiness. |
| `node scripts/parity/generate-final-report.mjs --final` | fail | Correctly refuses to write `parity/final-report.md` while M8 readiness is `not-ready`. |

## Open M0 Gaps

- Frozen source HEAD archive is still missing.
- Source bundle, source workspace, source freeze input, or source snapshot input is still missing.
- Source binary diff, status, untracked list, and SHA-256 manifest are still missing.
- Source `electron/src/ipc/codex-sessions.ts` patch and patch SHA-256 are still missing.
- File matrix entries remain `source-pending` until the source snapshot is imported.
- P01-P10 parity ledger entries remain open.
- M8 contract comparison remains `not-equal` until `parity/snapshots/source/*.json` exists.
- Source workspace freeze remains pending until a source checkout/bundle/archive is available.
- Freeze comparison remains `missing-input` until `parity/frozen/source` exists.
- Target diff index is complete for the current 88 runtime diff files, but remains a routing aid only.
- Complete target-side P01-P10 artifacts exist under `parity/artifacts/*/target.json`; matching source artifacts are still missing.
- M0 strict validation remains failing until source baseline, source freeze, and source contract snapshots exist.
