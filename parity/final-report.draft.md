# Harnss Parity Final Report Draft

Generated: 2026-07-10T13:24:48.364Z

Mode: `draft`

Status: `not-ready`

> Draft only. This file is not the formal final report and cannot close parity.


## Baselines

| Side | Status | Branch | HEAD | Package | Status entries | Manifest entries |
|---|---|---|---|---|---:|---:|
| Source | source-unavailable |  |  |  |  |  |
| Target | available | hy_dev1 | fffd46b3da457c65ebdd5a479e4350eb1c1cbe36 | 0.22.0-beta.2 | 92 | 960 |

## Freeze Artifacts

| Side | Available | HEAD archive | Binary diff | Manifest | Codex patch |
|---|---|---|---|---|---|
| Source | no |  |  |  |  |
| Target | yes | 4f5690b9bedb2d437fa83bb0e31cb2bd697cd8ee544f03cf421878a0e53458d7 | c4c3e8349ab41a26daabcc0a4673c91d83622beccd73436dac6a4c58e9c1758b | c4db765c2c39977c61f80490a49dcde70e27afc142b6fef1ee35f7d956ff430a |  |

## Gate Status

| Gate | Status | Detail |
|---|---|---|
| M0 validation | not-ready | 10 pass, 4 fail |
| M8 readiness | not-ready | 2 pass, 6 fail |
| Freeze comparison | missing-input | runtime open: 0 |
| Contract snapshots | not-equal | compared files: 8 |
| Ledger validation | valid | 10 open, 0 closed |
| Target diff index | available | 88 files, 0 unmapped |

## Ledger

| ID | Status | Contract | Source evidence | Target commit | Signoff |
|---|---|---|---|---|---|
| P01 | open | Logging governance | missing |  |  |
| P02 | open | File read/write and File Preview | missing |  |  |
| P03 | open | Input history and archived preview | missing |  |  |
| P04 | open | Session restore and persistence | missing |  |  |
| P05 | open | Todo / Checklist | missing |  |  |
| P06 | open | Long-session virtualization | missing |  |  |
| P07 | open | OpenCode engine | missing |  |  |
| P08 | open | Relay collaboration | missing |  |  |
| P09 | open | Codex configured model fallback | missing |  |  |
| P10 | open | Defaults and contracts | missing |  |  |

## Artifacts

| ID | Source artifact | Source complete | Target artifact | Target complete | Target files |
|---|---|---|---|---|---:|
| P01 | no | no | yes | yes | 0 |
| P02 | no | no | yes | yes | 1 |
| P03 | no | no | yes | yes | 6 |
| P04 | no | no | yes | yes | 32 |
| P05 | no | no | yes | yes | 4 |
| P06 | no | no | yes | yes | 0 |
| P07 | no | no | yes | yes | 0 |
| P08 | no | no | yes | yes | 0 |
| P09 | no | no | yes | yes | 6 |
| P10 | no | no | yes | yes | 84 |

## Pipeline Commands

| Status | Step | Command / Reason |
|---|---|---|
| pass | prepare source workspace | `/Users/lh/.nvm/versions/node/v24.13.0/bin/node /Users/lh/git/harnss/scripts/parity/prepare-source-workspace.mjs` |
| pass | import source freeze | `/Users/lh/.nvm/versions/node/v24.13.0/bin/node /Users/lh/git/harnss/scripts/parity/import-source-freeze.mjs --output-dir /Users/lh/git/harnss/parity/frozen/source` |
| pass | import source contract snapshots | `/Users/lh/.nvm/versions/node/v24.13.0/bin/node /Users/lh/git/harnss/scripts/parity/import-source-snapshots.mjs --output-dir /Users/lh/git/harnss/parity/snapshots/source` |
| pass | resolve source workspace | `/Users/lh/.nvm/versions/node/v24.13.0/bin/node /Users/lh/git/harnss/scripts/parity/resolve-source-workspace.mjs` |
| pass | freeze target workspace | `/Users/lh/.nvm/versions/node/v24.13.0/bin/node /Users/lh/git/harnss/scripts/parity/freeze-workspace.mjs --workspace /Users/lh/git/harnss --label target-current --output /Users/lh/git/harnss/parity/frozen/target-current` |
| skipped | freeze source workspace | `no source workspace available from --source-bundle or --source-workspace, and no source freeze was imported` |
| pass | collect M0 baseline | `/Users/lh/.nvm/versions/node/v24.13.0/bin/node /Users/lh/git/harnss/scripts/parity/collect-m0-baseline.mjs --target-workspace /Users/lh/git/harnss --output-dir /Users/lh/git/harnss/parity` |
| pass | collect target contract snapshots | `/Users/lh/.nvm/versions/node/v24.13.0/bin/node /Users/lh/git/harnss/scripts/parity/collect-contract-snapshots.mjs --workspace /Users/lh/git/harnss --target target` |
| skipped | collect source contract snapshots | `source workspace unavailable` |
| pass | compare contract snapshots | `/Users/lh/.nvm/versions/node/v24.13.0/bin/node /Users/lh/git/harnss/scripts/parity/compare-contract-snapshots.mjs` |
| pass | compare workspace freezes | `/Users/lh/.nvm/versions/node/v24.13.0/bin/node /Users/lh/git/harnss/scripts/parity/compare-freezes.mjs` |
| pass | index target diff | `/Users/lh/.nvm/versions/node/v24.13.0/bin/node /Users/lh/git/harnss/scripts/parity/index-target-diff.mjs` |
| pass | collect target ledger artifacts | `/Users/lh/.nvm/versions/node/v24.13.0/bin/node /Users/lh/git/harnss/scripts/parity/collect-ledger-artifacts.mjs --side target --output-dir /Users/lh/git/harnss/parity/artifacts --snapshot-dir /Users/lh/git/harnss/parity/snapshots/target --freeze-dir /Users/lh/git/harnss/parity/frozen/target-current` |
| skipped | collect source ledger artifacts | `source workspace unavailable` |
| pass | validate parity ledger | `/Users/lh/.nvm/versions/node/v24.13.0/bin/node /Users/lh/git/harnss/scripts/parity/validate-ledger.mjs --strict` |
| pass | validate M8 readiness | `/Users/lh/.nvm/versions/node/v24.13.0/bin/node /Users/lh/git/harnss/scripts/parity/validate-m8-readiness.mjs` |
| pass | generate draft final report | `/Users/lh/.nvm/versions/node/v24.13.0/bin/node /Users/lh/git/harnss/scripts/parity/generate-final-report.mjs --draft` |
| pass | validate M0 | `/Users/lh/.nvm/versions/node/v24.13.0/bin/node /Users/lh/git/harnss/scripts/parity/validate-m0.mjs` |

## Report Hashes

| Artifact | SHA-256 |
|---|---|
| sourceBaseline | 8993d04dab7c2163cca64694ca7c349679e246d4c31ff8ea19408fac65293135 |
| targetBaseline | 4111677096fc990bd57710222277ebb67a96945c0c0fba026073e9d722bbc7a2 |
| fileMatrix | 91bf0eaabb0a94e17229bedb7fa3f9bd72ce4a4b45bc37296bc6dd5e8b6b8f68 |
| freezeComparison | bfc7261affaeea2b43c3371e1598a58091bab995c5b9131790ff0840a75ee3f7 |
| contractDiff | 05bbc9698029f3546f878029b7747f6015de40927845094c4171420bc3458298 |
| ledger | e7d1e15f595ee9fbe8e67849986a37b7acb5d4faf880d2cb66f319377d294072 |
| m0Validation | 92f32cbeeaefd8c9b91e900ddb4911522e78ecbbaa52284afeb0f6b050d5a083 |
| m8Readiness | 7f04984b7e0a44e9620bd271294f2c720225fe30b354c2faadf84db781479024 |

## Open Blockers

- source baseline is available: `{"status":"source-unavailable","missingM0Inputs":["source HEAD archive","source git diff --binary HEAD","source untracked file list","source git status --porcelain=v1","source SHA-256 manifest","electron/src/ipc/codex-sessions.ts source patch and patch SHA-256"]}`
- workspace freeze comparison has no runtime drift: `{"status":"missing-input","missing":["parity/frozen/source/freeze-summary.json","parity/frozen/source/manifest.json"],"summary":{"total":0,"sourceOnly":0,"targetOnly":0,"bothModified":0,"identical":0,"runtimeOpen":0}}`
- contract snapshots are equal: `{"diffStatus":"not-equal","targetMissing":[],"sourceMissing":["preload-api.json","ipc-channels.json","settings-defaults.json","shared-types.json","session-serialization.json","package-dependencies.json","build-config.json","default-surface.json"],"comparedFiles":8}`
- parity ledger P01-P10 are closed: `{"missingIds":[],"openIds":["P01","P02","P03","P04","P05","P06","P07","P08","P09","P10"],"validationStatus":"valid"}`
- per-ledger source and target artifacts are complete: `{"missingBySide":{"source":["parity/artifacts/P01/source.json","parity/artifacts/P02/source.json","parity/artifacts/P03/source.json","parity/artifacts/P04/source.json","parity/artifacts/P05/source.json","parity/artifacts/P06/source.json","parity/artifacts/P07/source.json","parity/artifacts/P08/source.json","parity/artifacts/P09/source.json","parity/artifacts/P10/source.json"],"target":[]},"incompleteBySide":{"source":[],"target":[]},"missingCount":10,"incompleteCount":0}`
- final parity report exists: `{"missing":["parity/final-report.md"]}`

## Approved Deviations

_None recorded._

## Signoff

Owner signoff: missing for P01, P02, P03, P04, P05, P06, P07, P08, P09, P10
