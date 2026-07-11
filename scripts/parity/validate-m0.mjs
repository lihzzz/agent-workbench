import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const DEFAULT_OUTPUT_JSON = path.join("parity", "m0-validation.json");
const DEFAULT_OUTPUT_MD = path.join("parity", "m0-validation.md");
const REQUIRED_LEDGER_IDS = ["P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08", "P09", "P10"];
const REQUIRED_TARGET_SNAPSHOTS = [
  "preload-api.json",
  "ipc-channels.json",
  "settings-defaults.json",
  "shared-types.json",
  "session-serialization.json",
  "package-dependencies.json",
  "build-config.json",
  "default-surface.json",
];

function parseArgs(argv) {
  return {
    strict: argv.includes("--strict"),
  };
}

function readJson(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }

  return JSON.parse(readFileSync(filePath, "utf8"));
}

function readText(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }

  return readFileSync(filePath, "utf8");
}

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function check(name, passed, details = {}) {
  return {
    name,
    status: passed ? "pass" : "fail",
    details,
  };
}

function checkRequiredFiles() {
  const files = [
    "功能对齐实施计划.md",
    "1.md",
    "parity/source-baseline.json",
    "parity/source-intake.json",
    "parity/source-intake.md",
    "parity/source-freeze-intake.json",
    "parity/source-freeze-intake.md",
    "parity/source-snapshot-intake.json",
    "parity/source-snapshot-intake.md",
    "parity/source-workspace-resolution.json",
    "parity/source-workspace-resolution.md",
    "parity/target-baseline.json",
    "parity/file-matrix.json",
    "parity/freeze-comparison.json",
    "parity/freeze-comparison.md",
    "parity/target-diff-index.json",
    "parity/target-diff-index.md",
    "parity/parity-ledger.md",
    "parity/parity-ledger.json",
    "parity/parity-ledger-validation.json",
    "parity/function-index.md",
    "parity/final-report.draft.md",
    "parity/m0-checks.md",
    "parity/m0-pipeline.json",
    "parity/m0-pipeline.md",
    "parity/m8-readiness.json",
    "parity/m8-readiness.md",
    "parity/snapshots/contract-diff.md",
    "parity/workspace-freeze.md",
    "scripts/parity/collect-m0-baseline.mjs",
    "scripts/parity/freeze-workspace.mjs",
    "scripts/parity/export-source-evidence.mjs",
    "scripts/parity/generate-final-report.mjs",
    "scripts/parity/compare-freezes.mjs",
    "scripts/parity/collect-ledger-artifacts.mjs",
    "scripts/parity/index-target-diff.mjs",
    "scripts/parity/collect-contract-snapshots.mjs",
    "scripts/parity/compare-contract-snapshots.mjs",
    "scripts/parity/validate-ledger.mjs",
    "scripts/parity/validate-m8-readiness.mjs",
    "scripts/parity/run-m0-pipeline.mjs",
    "scripts/parity/prepare-source-workspace.mjs",
    "scripts/parity/import-source-freeze.mjs",
    "scripts/parity/import-source-snapshots.mjs",
    "scripts/parity/resolve-source-workspace.mjs",
  ];
  const missing = files.filter((filePath) => !existsSync(filePath));
  return check("required M0 files exist", missing.length === 0, { missing });
}

function checkSourceIntake() {
  const intake = readJson("parity/source-intake.json");
  if (!intake) {
    return check("source intake recorded", false);
  }

  const acceptedStatuses = new Set(["no-input", "prepared"]);
  return check("source intake recorded", acceptedStatuses.has(intake.status), {
    status: intake.status,
    sourceBundle: intake.input?.sourceBundle ?? null,
    preparedWorkspace: intake.preparedWorkspace?.repoRoot ?? null,
    failureReason: intake.failureReason ?? null,
  });
}

function checkSourceFreezeIntake() {
  const intake = readJson("parity/source-freeze-intake.json");
  if (!intake) {
    return check("source freeze intake recorded", false);
  }

  const acceptedStatuses = new Set(["no-input", "imported"]);
  return check("source freeze intake recorded", acceptedStatuses.has(intake.status), {
    status: intake.status,
    sourceFreezeDir: intake.input?.sourceFreezeDir ?? null,
    sourceFreezeArchive: intake.input?.sourceFreezeArchive ?? null,
    importedHead: intake.importedFreeze?.head ?? null,
    failureReason: intake.failureReason ?? null,
  });
}

function checkSourceSnapshotIntake() {
  const intake = readJson("parity/source-snapshot-intake.json");
  if (!intake) {
    return check("source snapshot intake recorded", false);
  }

  const acceptedStatuses = new Set(["no-input", "imported"]);
  return check("source snapshot intake recorded", acceptedStatuses.has(intake.status), {
    status: intake.status,
    sourceSnapshotDir: intake.input?.sourceSnapshotDir ?? null,
    sourceSnapshotArchive: intake.input?.sourceSnapshotArchive ?? null,
    importedFileCount: intake.importedSnapshots?.fileCount ?? null,
    failureReason: intake.failureReason ?? null,
  });
}

function checkSourceBaseline() {
  const source = readJson("parity/source-baseline.json");
  if (!source) {
    return check("source baseline exists", false);
  }

  return check("source baseline available", source.status === "available", {
    status: source.status,
    missingM0Inputs: source.missingM0Inputs ?? [],
    evidence: source.evidence ?? {},
  });
}

function checkTargetBaseline() {
  const target = readJson("parity/target-baseline.json");
  if (!target) {
    return check("target baseline exists", false);
  }

  const hasHead = typeof target.head === "string" && target.head.length === 40;
  const hasManifest = Array.isArray(target.manifest) && target.manifest.length > 0;
  const hasDiffStatus = Array.isArray(target.diffNameStatus);

  return check("target baseline complete", hasHead && hasManifest && hasDiffStatus, {
    branch: target.branch,
    head: target.head,
    statusCount: target.statusPorcelain?.length ?? 0,
    runtimeDiffCount: target.diffNameStatus?.length ?? 0,
    manifestCount: target.manifest?.length ?? 0,
  });
}

function checkTargetFreeze() {
  const summary = readJson("parity/frozen/target-current/freeze-summary.json");
  if (!summary) {
    return check("target workspace freeze exists", false);
  }

  const artifacts = summary.artifacts ?? {};
  const artifactEntries = Object.entries(artifacts).filter(([, artifact]) => artifact && artifact.path);
  const missing = [];
  const hashMismatches = [];

  for (const [name, artifact] of artifactEntries) {
    if (!existsSync(artifact.path)) {
      missing.push(name);
      continue;
    }

    const actual = sha256File(artifact.path);
    if (actual !== artifact.sha256) {
      hashMismatches.push({ name, expected: artifact.sha256, actual });
    }
  }

  return check("target workspace freeze complete", missing.length === 0 && hashMismatches.length === 0, {
    branch: summary.branch,
    head: summary.head,
    statusCount: summary.statusCount,
    manifestCount: summary.manifestCount,
    copiedUntracked: summary.untrackedContent?.copied ?? null,
    missing,
    hashMismatches,
  });
}

function checkSourceFreeze() {
  const summary = readJson("parity/frozen/source/freeze-summary.json");
  if (!summary) {
    return check("source workspace freeze exists", false, {
      missing: ["parity/frozen/source/freeze-summary.json"],
    });
  }

  const codexPatch = summary.artifacts?.codexSessionsPatch;
  return check("source workspace freeze complete", Boolean(summary.artifacts?.headArchive && summary.artifacts?.binaryDiff), {
    branch: summary.branch,
    head: summary.head,
    statusCount: summary.statusCount,
    manifestCount: summary.manifestCount,
    codexSessionsPatch: codexPatch ? codexPatch.sha256 : null,
  });
}

function checkFileMatrix() {
  const matrix = readJson("parity/file-matrix.json");
  const target = readJson("parity/target-baseline.json");
  if (!matrix || !target) {
    return check("file matrix exists", false);
  }

  const entries = Array.isArray(matrix.entries) ? matrix.entries : [];
  const expectedCount = Array.isArray(target.diffNameStatus) ? target.diffNameStatus.length : null;
  const pending = entries.filter((entry) => entry.matrixClass === "source-pending").length;

  return check("file matrix matches target diff", entries.length === expectedCount, {
    entries: entries.length,
    expectedCount,
    sourcePending: pending,
    sourceStatus: matrix.sourceStatus,
  });
}

function checkFreezeComparison() {
  const comparison = readJson("parity/freeze-comparison.json");
  if (!comparison) {
    return check("freeze comparison exists", false);
  }

  return check("freeze comparison has no open runtime differences", comparison.status === "equal-runtime", {
    status: comparison.status,
    missing: comparison.missing ?? [],
    summary: comparison.summary ?? {},
  });
}

function checkTargetDiffIndex() {
  const index = readJson("parity/target-diff-index.json");
  const matrix = readJson("parity/file-matrix.json");
  if (!index || !matrix) {
    return check("target diff index exists", false);
  }

  const expectedCount = Array.isArray(matrix.entries) ? matrix.entries.length : null;
  const total = index.summary?.total ?? 0;
  const unmapped = index.summary?.unmappedContractReview ?? 0;

  return check("target diff index covers file matrix", total === expectedCount && unmapped === 0, {
    total,
    expectedCount,
    unmappedContractReview: unmapped,
    byLedgerId: index.summary?.byLedgerId ?? {},
  });
}

function checkLedger() {
  const ledger = readJson("parity/parity-ledger.json");
  const ledgerValidation = readJson("parity/parity-ledger-validation.json");
  if (!ledger) {
    return check("structured parity ledger exists", false);
  }

  const items = Array.isArray(ledger.items) ? ledger.items : [];
  const itemById = new Map(items.map((item) => [item.id, item]));
  const missingIds = REQUIRED_LEDGER_IDS.filter((id) => !itemById.has(id));
  const closedIds = REQUIRED_LEDGER_IDS.filter((id) => itemById.get(id)?.status === "closed");
  const validationStatus = ledgerValidation?.status ?? "missing";

  return check("parity ledger has valid open P01-P10", missingIds.length === 0 && closedIds.length === 0 && validationStatus === "valid", {
    missingIds,
    closedIds,
    validationStatus,
  });
}

function checkContractSnapshots() {
  const targetMissing = REQUIRED_TARGET_SNAPSHOTS.filter((fileName) =>
    !existsSync(path.join("parity", "snapshots", "target", fileName)),
  );
  const sourceMissing = REQUIRED_TARGET_SNAPSHOTS.filter((fileName) =>
    !existsSync(path.join("parity", "snapshots", "source", fileName)),
  );
  const diff = readJson("parity/snapshots/contract-diff.json");

  return check("contract snapshots ready for comparison", targetMissing.length === 0 && sourceMissing.length === 0 && diff?.status === "equal", {
    targetMissing,
    sourceMissing,
    diffStatus: diff?.status ?? "missing",
  });
}

function checkRecordedCommands() {
  const checks = readText("parity/m0-checks.md") ?? "";
  const requiredSnippets = [
    "| `git diff --check` | pass |",
    "| `pnpm test` | pass |",
    "| `pnpm build` | pass |",
    "| `node scripts/parity/prepare-source-workspace.mjs` | no input |",
    "| `node scripts/parity/import-source-freeze.mjs` | no input |",
    "| `node scripts/parity/import-source-snapshots.mjs` | no input |",
    "| `node scripts/parity/collect-m0-baseline.mjs --target-workspace /Users/lh/git/harnss --output-dir /Users/lh/git/harnss/parity` | pass |",
    "| `node scripts/parity/collect-contract-snapshots.mjs --workspace /Users/lh/git/harnss --target target` | pass |",
    "| `node scripts/parity/freeze-workspace.mjs",
    "| `node scripts/parity/validate-ledger.mjs` | pass |",
    "| `node scripts/parity/index-target-diff.mjs` | pass |",
    "| `node scripts/parity/collect-ledger-artifacts.mjs --side target` | pass |",
    "| `node scripts/parity/run-m0-pipeline.mjs` | pass |",
    "| `node scripts/parity/validate-m8-readiness.mjs` | not ready |",
    "| `node scripts/parity/generate-final-report.mjs --draft` | pass |",
    "| `node scripts/parity/resolve-source-workspace.mjs` | unavailable |",
  ];
  const missing = requiredSnippets.filter((snippet) => !checks.includes(snippet));

  return check("target command results recorded", missing.length === 0, { missing });
}

function buildReport() {
  const checks = [
    checkRequiredFiles(),
    checkSourceIntake(),
    checkSourceFreezeIntake(),
    checkSourceSnapshotIntake(),
    checkSourceBaseline(),
    checkTargetBaseline(),
    checkTargetFreeze(),
    checkSourceFreeze(),
    checkFileMatrix(),
    checkTargetDiffIndex(),
    checkFreezeComparison(),
    checkLedger(),
    checkContractSnapshots(),
    checkRecordedCommands(),
  ];
  const failed = checks.filter((item) => item.status !== "pass");

  return {
    generatedAt: new Date().toISOString(),
    status: failed.length === 0 ? "ready" : "not-ready",
    failedCount: failed.length,
    passedCount: checks.length - failed.length,
    checks,
  };
}

function renderMarkdown(report) {
  const rows = report.checks
    .map((item) => `| ${item.status === "pass" ? "PASS" : "FAIL"} | ${item.name} | ${renderDetails(item)} |`)
    .join("\n");

  return `# M0 Validation

Status: \`${report.status}\`

| Result | Check | Details |
|---|---|---|
${rows}
`;
}

function renderDetails(item) {
  const details = item.details ?? {};

  if (Object.keys(details).length === 0) {
    return "";
  }

  return `\`${JSON.stringify(details).replaceAll("|", "\\|")}\``;
}

function writeReport(report) {
  mkdirSync(path.dirname(DEFAULT_OUTPUT_JSON), { recursive: true });
  writeFileSync(DEFAULT_OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(DEFAULT_OUTPUT_MD, renderMarkdown(report));
}

const args = parseArgs(process.argv.slice(2));
const report = buildReport();
writeReport(report);

console.log(`M0 validation: ${report.status} (${report.passedCount} pass, ${report.failedCount} fail)`);

if (args.strict && report.status !== "ready") {
  process.exitCode = 1;
}
