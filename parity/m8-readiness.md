# M8 Readiness

Status: `not-ready`

| Result | Check | Details |
|---|---|---|
| FAIL | source baseline is available | `{"status":"source-unavailable","missingM0Inputs":["source HEAD archive","source git diff --binary HEAD","source untracked file list","source git status --porcelain=v1","source SHA-256 manifest","electron/src/ipc/codex-sessions.ts source patch and patch SHA-256"]}` |
| FAIL | workspace freeze comparison has no runtime drift | `{"status":"missing-input","missing":["parity/frozen/source/freeze-summary.json","parity/frozen/source/manifest.json"],"summary":{"total":0,"sourceOnly":0,"targetOnly":0,"bothModified":0,"identical":0,"runtimeOpen":0}}` |
| FAIL | contract snapshots are equal | `{"diffStatus":"not-equal","targetMissing":[],"sourceMissing":["preload-api.json","ipc-channels.json","settings-defaults.json","shared-types.json","session-serialization.json","package-dependencies.json","build-config.json","default-surface.json"],"comparedFiles":8}` |
| FAIL | parity ledger P01-P10 are closed | `{"missingIds":[],"openIds":["P01","P02","P03","P04","P05","P06","P07","P08","P09","P10"],"validationStatus":"valid"}` |
| PASS | closed ledger items include closure evidence | `{"incomplete":[],"closedCount":0}` |
| FAIL | per-ledger source and target artifacts are complete | `{"missingBySide":{"source":["parity/artifacts/P01/source.json","parity/artifacts/P02/source.json","parity/artifacts/P03/source.json","parity/artifacts/P04/source.json","parity/artifacts/P05/source.json","parity/artifacts/P06/source.json","parity/artifacts/P07/source.json","parity/artifacts/P08/source.json","parity/artifacts/P09/source.json","parity/artifacts/P10/source.json"],"target":[]},"incompleteBySide":{"source":[],"target":[]},"missingCount":10,"incompleteCount":0}` |
| PASS | target diff index has no unmapped files | `{"total":88,"unmappedContractReview":0}` |
| FAIL | final parity report exists | `{"missing":["parity/final-report.md"]}` |
