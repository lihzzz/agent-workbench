import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const OUTPUT_JSON = path.join("parity", "m8-readiness.json");
const OUTPUT_MD = path.join("parity", "m8-readiness.md");
const REQUIRED_LEDGER_IDS = ["P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08", "P09", "P10"];
const REQUIRED_CONTRACT_SNAPSHOTS = [
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

function check(name, passed, details = {}) {
  return {
    name,
    status: passed ? "pass" : "fail",
    details,
  };
}

function checkSourceBaseline() {
  const baseline = readJson("parity/source-baseline.json");
  if (!baseline) {
    return check("source baseline is available", false, {
      missing: ["parity/source-baseline.json"],
    });
  }

  return check("source baseline is available", baseline.status === "available", {
    status: baseline.status,
    missingM0Inputs: baseline.missingM0Inputs ?? [],
  });
}

function checkFreezeComparison() {
  const comparison = readJson("parity/freeze-comparison.json");
  if (!comparison) {
    return check("workspace freeze comparison has no runtime drift", false, {
      missing: ["parity/freeze-comparison.json"],
    });
  }

  return check("workspace freeze comparison has no runtime drift", comparison.status === "equal-runtime", {
    status: comparison.status,
    missing: comparison.missing ?? [],
    summary: comparison.summary ?? {},
  });
}

function checkContractSnapshots() {
  const diff = readJson("parity/snapshots/contract-diff.json");
  const targetMissing = REQUIRED_CONTRACT_SNAPSHOTS.filter((fileName) =>
    !existsSync(path.join("parity", "snapshots", "target", fileName)),
  );
  const sourceMissing = REQUIRED_CONTRACT_SNAPSHOTS.filter((fileName) =>
    !existsSync(path.join("parity", "snapshots", "source", fileName)),
  );

  return check("contract snapshots are equal", targetMissing.length === 0 && sourceMissing.length === 0 && diff?.status === "equal", {
    diffStatus: diff?.status ?? "missing",
    targetMissing,
    sourceMissing,
    comparedFiles: diff?.results?.length ?? 0,
  });
}

function checkLedgerClosed() {
  const ledger = readJson("parity/parity-ledger.json");
  const ledgerValidation = readJson("parity/parity-ledger-validation.json");
  if (!ledger) {
    return check("parity ledger P01-P10 are closed", false, {
      missing: ["parity/parity-ledger.json"],
    });
  }

  const items = Array.isArray(ledger.items) ? ledger.items : [];
  const itemById = new Map(items.map((item) => [item.id, item]));
  const missingIds = REQUIRED_LEDGER_IDS.filter((id) => !itemById.has(id));
  const openIds = REQUIRED_LEDGER_IDS.filter((id) => itemById.get(id)?.status !== "closed");
  const validationStatus = ledgerValidation?.status ?? "missing";

  return check("parity ledger P01-P10 are closed", missingIds.length === 0 && openIds.length === 0 && validationStatus === "valid", {
    missingIds,
    openIds,
    validationStatus,
  });
}

function checkLedgerClosureEvidence() {
  const ledger = readJson("parity/parity-ledger.json");
  if (!ledger) {
    return check("closed ledger items include closure evidence", false, {
      missing: ["parity/parity-ledger.json"],
    });
  }

  const items = Array.isArray(ledger.items) ? ledger.items : [];
  const incomplete = items.filter((item) => item.status === "closed").filter((item) => {
    return item.sourceEvidence?.status !== "recorded"
      || !item.implementation?.targetCommit
      || !Array.isArray(item.automatedTests) || item.automatedTests.length === 0
      || !Array.isArray(item.manualScenarios) || item.manualScenarios.length === 0
      || !item.ownerSignoff
      || Array.isArray(item.closeBlockers) && item.closeBlockers.length > 0;
  }).map((item) => item.id);

  return check("closed ledger items include closure evidence", incomplete.length === 0, {
    incomplete,
    closedCount: items.filter((item) => item.status === "closed").length,
  });
}

function checkPerLedgerArtifacts() {
  const missingBySide = {
    source: [],
    target: [],
  };
  const incompleteBySide = {
    source: [],
    target: [],
  };

  for (const id of REQUIRED_LEDGER_IDS) {
    for (const side of ["source", "target"]) {
      const filePath = path.join("parity", "artifacts", id, `${side}.json`);
      if (!existsSync(filePath)) {
        missingBySide[side].push(filePath);
        continue;
      }

      const artifact = readJson(filePath);
      if (!artifact?.completeness?.complete) {
        incompleteBySide[side].push({
          file: filePath,
          completeness: artifact?.completeness ?? null,
        });
      }
    }
  }

  const missing = [...missingBySide.source, ...missingBySide.target];
  const incomplete = [...incompleteBySide.source, ...incompleteBySide.target];

  return check("per-ledger source and target artifacts are complete", missing.length === 0 && incomplete.length === 0, {
    missingBySide,
    incompleteBySide,
    missingCount: missing.length,
    incompleteCount: incomplete.length,
  });
}

function checkTargetDiffIndex() {
  const index = readJson("parity/target-diff-index.json");
  if (!index) {
    return check("target diff index has no unmapped files", false, {
      missing: ["parity/target-diff-index.json"],
    });
  }

  const unmapped = index.summary?.unmappedContractReview ?? 0;
  return check("target diff index has no unmapped files", unmapped === 0, {
    total: index.summary?.total ?? 0,
    unmappedContractReview: unmapped,
  });
}

function checkFinalReport() {
  return check("final parity report exists", existsSync("parity/final-report.md"), {
    missing: existsSync("parity/final-report.md") ? [] : ["parity/final-report.md"],
  });
}

function buildReport() {
  const checks = [
    checkSourceBaseline(),
    checkFreezeComparison(),
    checkContractSnapshots(),
    checkLedgerClosed(),
    checkLedgerClosureEvidence(),
    checkPerLedgerArtifacts(),
    checkTargetDiffIndex(),
    checkFinalReport(),
  ];
  const failed = checks.filter((item) => item.status !== "pass");

  return {
    generatedAt: new Date().toISOString(),
    status: failed.length === 0 ? "ready" : "not-ready",
    passedCount: checks.length - failed.length,
    failedCount: failed.length,
    checks,
  };
}

function renderMarkdown(report) {
  const rows = report.checks
    .map((item) => `| ${item.status === "pass" ? "PASS" : "FAIL"} | ${item.name} | ${renderDetails(item)} |`)
    .join("\n");

  return `# M8 Readiness

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
  mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true });
  writeFileSync(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(OUTPUT_MD, renderMarkdown(report));
}

const args = parseArgs(process.argv.slice(2));
const report = buildReport();
writeReport(report);

console.log(`M8 readiness: ${report.status} (${report.passedCount} pass, ${report.failedCount} fail)`);

if (args.strict && report.status !== "ready") {
  process.exitCode = 1;
}
