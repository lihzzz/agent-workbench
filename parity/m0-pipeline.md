# M0 Pipeline

Status: `complete-with-open-gates`

Generated: 2026-07-10T13:24:48.395Z

| Result | Step | Command / Reason |
|---|---|---|
| pass | prepare source workspace | `/Users/lh/.nvm/versions/node/v24.13.0/bin/node /Users/lh/git/harnss/scripts/parity/prepare-source-workspace.mjs` |
| pass | import source freeze | `/Users/lh/.nvm/versions/node/v24.13.0/bin/node /Users/lh/git/harnss/scripts/parity/import-source-freeze.mjs --output-dir /Users/lh/git/harnss/parity/frozen/source` |
| pass | import source contract snapshots | `/Users/lh/.nvm/versions/node/v24.13.0/bin/node /Users/lh/git/harnss/scripts/parity/import-source-snapshots.mjs --output-dir /Users/lh/git/harnss/parity/snapshots/source` |
| pass | resolve source workspace | `/Users/lh/.nvm/versions/node/v24.13.0/bin/node /Users/lh/git/harnss/scripts/parity/resolve-source-workspace.mjs` |
| pass | freeze target workspace | `/Users/lh/.nvm/versions/node/v24.13.0/bin/node /Users/lh/git/harnss/scripts/parity/freeze-workspace.mjs --workspace /Users/lh/git/harnss --label target-current --output /Users/lh/git/harnss/parity/frozen/target-current` |
| skipped | freeze source workspace | no source workspace available from --source-bundle or --source-workspace, and no source freeze was imported |
| pass | collect M0 baseline | `/Users/lh/.nvm/versions/node/v24.13.0/bin/node /Users/lh/git/harnss/scripts/parity/collect-m0-baseline.mjs --target-workspace /Users/lh/git/harnss --output-dir /Users/lh/git/harnss/parity` |
| pass | collect target contract snapshots | `/Users/lh/.nvm/versions/node/v24.13.0/bin/node /Users/lh/git/harnss/scripts/parity/collect-contract-snapshots.mjs --workspace /Users/lh/git/harnss --target target` |
| skipped | collect source contract snapshots | source workspace unavailable |
| pass | compare contract snapshots | `/Users/lh/.nvm/versions/node/v24.13.0/bin/node /Users/lh/git/harnss/scripts/parity/compare-contract-snapshots.mjs` |
| pass | compare workspace freezes | `/Users/lh/.nvm/versions/node/v24.13.0/bin/node /Users/lh/git/harnss/scripts/parity/compare-freezes.mjs` |
| pass | index target diff | `/Users/lh/.nvm/versions/node/v24.13.0/bin/node /Users/lh/git/harnss/scripts/parity/index-target-diff.mjs` |
| pass | collect target ledger artifacts | `/Users/lh/.nvm/versions/node/v24.13.0/bin/node /Users/lh/git/harnss/scripts/parity/collect-ledger-artifacts.mjs --side target --output-dir /Users/lh/git/harnss/parity/artifacts --snapshot-dir /Users/lh/git/harnss/parity/snapshots/target --freeze-dir /Users/lh/git/harnss/parity/frozen/target-current` |
| skipped | collect source ledger artifacts | source workspace unavailable |
| pass | validate parity ledger | `/Users/lh/.nvm/versions/node/v24.13.0/bin/node /Users/lh/git/harnss/scripts/parity/validate-ledger.mjs --strict` |
| pass | validate M8 readiness | `/Users/lh/.nvm/versions/node/v24.13.0/bin/node /Users/lh/git/harnss/scripts/parity/validate-m8-readiness.mjs` |
| pass | generate draft final report | `/Users/lh/.nvm/versions/node/v24.13.0/bin/node /Users/lh/git/harnss/scripts/parity/generate-final-report.mjs --draft` |
| pass | validate M0 | `/Users/lh/.nvm/versions/node/v24.13.0/bin/node /Users/lh/git/harnss/scripts/parity/validate-m0.mjs` |
