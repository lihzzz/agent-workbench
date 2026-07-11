# M0 Validation

Status: `not-ready`

| Result | Check | Details |
|---|---|---|
| PASS | required M0 files exist | `{"missing":[]}` |
| PASS | source intake recorded | `{"status":"no-input","sourceBundle":null,"preparedWorkspace":null,"failureReason":null}` |
| PASS | source freeze intake recorded | `{"status":"no-input","sourceFreezeDir":null,"sourceFreezeArchive":null,"importedHead":null,"failureReason":null}` |
| PASS | source snapshot intake recorded | `{"status":"no-input","sourceSnapshotDir":null,"sourceSnapshotArchive":null,"importedFileCount":null,"failureReason":null}` |
| FAIL | source baseline available | `{"status":"source-unavailable","missingM0Inputs":["source HEAD archive","source git diff --binary HEAD","source untracked file list","source git status --porcelain=v1","source SHA-256 manifest","electron/src/ipc/codex-sessions.ts source patch and patch SHA-256"],"evidence":{"localBranchCommit":null,"expectedCommitAvailable":false,"remoteHeads":[],"sourceWorkspace":null,"importedSourceFreeze":null,"sourceCandidates":[{"path":"/Users/lihzz/PycharmProjects/code/harnss","exists":false,"git":false}]}}` |
| PASS | target baseline complete | `{"branch":"hy_dev1","head":"fffd46b3da457c65ebdd5a479e4350eb1c1cbe36","statusCount":92,"runtimeDiffCount":88,"manifestCount":960}` |
| PASS | target workspace freeze complete | `{"branch":"hy_dev1","head":"fffd46b3da457c65ebdd5a479e4350eb1c1cbe36","statusCount":92,"manifestCount":1153,"copiedUntracked":70,"missing":[],"hashMismatches":[]}` |
| FAIL | source workspace freeze exists | `{"missing":["parity/frozen/source/freeze-summary.json"]}` |
| PASS | file matrix matches target diff | `{"entries":88,"expectedCount":88,"sourcePending":88,"sourceStatus":"source-pending"}` |
| PASS | target diff index covers file matrix | `{"total":88,"expectedCount":88,"unmappedContractReview":0,"byLedgerId":{"P01":0,"P02":1,"P03":6,"P04":32,"P05":4,"P06":0,"P07":0,"P08":0,"P09":6,"P10":84}}` |
| FAIL | freeze comparison has no open runtime differences | `{"status":"missing-input","missing":["parity/frozen/source/freeze-summary.json","parity/frozen/source/manifest.json"],"summary":{"total":0,"sourceOnly":0,"targetOnly":0,"bothModified":0,"identical":0,"runtimeOpen":0}}` |
| PASS | parity ledger has valid open P01-P10 | `{"missingIds":[],"closedIds":[],"validationStatus":"valid"}` |
| FAIL | contract snapshots ready for comparison | `{"targetMissing":[],"sourceMissing":["preload-api.json","ipc-channels.json","settings-defaults.json","shared-types.json","session-serialization.json","package-dependencies.json","build-config.json","default-surface.json"],"diffStatus":"not-equal"}` |
| PASS | target command results recorded | `{"missing":[]}` |
