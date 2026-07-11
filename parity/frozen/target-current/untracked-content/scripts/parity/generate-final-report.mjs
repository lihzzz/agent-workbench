import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_DRAFT_OUTPUT = path.join("parity", "final-report.draft.md");
const DEFAULT_FINAL_OUTPUT = path.join("parity", "final-report.md");
const REQUIRED_LEDGER_IDS = ["P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08", "P09", "P10"];

function parseArgs(argv) {
  const args = {
    final: false,
    output: null,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];

    if (arg === "--final") {
      args.final = true;
      continue;
    }

    if (arg === "--draft") {
      args.final = false;
      continue;
    }

    if (arg === "--output") {
      args.output = readArgValue(argv, ++index, arg);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    ...args,
    output: args.output ?? (args.final ? DEFAULT_FINAL_OUTPUT : DEFAULT_DRAFT_OUTPUT),
  };
}

function readArgValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
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
  if (!existsSync(filePath)) {
    return null;
  }

  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function getReadinessStatus() {
  return readJson("parity/m8-readiness.json")?.status ?? "missing";
}

function buildReportModel(mode) {
  const sourceBaseline = readJson("parity/source-baseline.json");
  const targetBaseline = readJson("parity/target-baseline.json");
  const sourceFreeze = readJson("parity/frozen/source/freeze-summary.json");
  const targetFreeze = readJson("parity/frozen/target-current/freeze-summary.json");
  const freezeComparison = readJson("parity/freeze-comparison.json");
  const contractDiff = readJson("parity/snapshots/contract-diff.json");
  const ledger = readJson("parity/parity-ledger.json");
  const ledgerValidation = readJson("parity/parity-ledger-validation.json");
  const targetDiffIndex = readJson("parity/target-diff-index.json");
  const m0Validation = readJson("parity/m0-validation.json");
  const m8Readiness = readJson("parity/m8-readiness.json");
  const pipeline = readJson("parity/m0-pipeline.json");

  return {
    generatedAt: new Date().toISOString(),
    mode,
    sourceBaseline,
    targetBaseline,
    sourceFreeze,
    targetFreeze,
    freezeComparison,
    contractDiff,
    ledger,
    ledgerValidation,
    targetDiffIndex,
    m0Validation,
    m8Readiness,
    pipeline,
    artifactSummary: buildArtifactSummary(),
    hashes: {
      sourceBaseline: sha256File("parity/source-baseline.json"),
      targetBaseline: sha256File("parity/target-baseline.json"),
      fileMatrix: sha256File("parity/file-matrix.json"),
      freezeComparison: sha256File("parity/freeze-comparison.json"),
      contractDiff: sha256File("parity/snapshots/contract-diff.json"),
      ledger: sha256File("parity/parity-ledger.json"),
      m0Validation: sha256File("parity/m0-validation.json"),
      m8Readiness: sha256File("parity/m8-readiness.json"),
    },
  };
}

function buildArtifactSummary() {
  return REQUIRED_LEDGER_IDS.map((id) => {
    const sourcePath = path.join("parity", "artifacts", id, "source.json");
    const targetPath = path.join("parity", "artifacts", id, "target.json");
    const source = readJson(sourcePath);
    const target = readJson(targetPath);

    return {
      id,
      sourcePath,
      targetPath,
      sourceExists: Boolean(source),
      targetExists: Boolean(target),
      sourceComplete: Boolean(source?.completeness?.complete),
      targetComplete: Boolean(target?.completeness?.complete),
      targetFiles: target?.targetDiffContext?.entries?.length ?? null,
    };
  });
}

function renderReport(model) {
  return `# Harnss Parity Final Report ${model.mode === "final" ? "" : "Draft"}

Generated: ${model.generatedAt}

Mode: \`${model.mode}\`

Status: \`${model.m8Readiness?.status ?? "missing"}\`

${renderDraftWarning(model)}

## Baselines

| Side | Status | Branch | HEAD | Package | Status entries | Manifest entries |
|---|---|---|---|---|---:|---:|
| Source | ${model.sourceBaseline?.status ?? "missing"} | ${model.sourceFreeze?.branch ?? ""} | ${model.sourceFreeze?.head ?? ""} | ${model.sourceFreeze?.packageVersion ?? ""} | ${model.sourceFreeze?.statusCount ?? ""} | ${model.sourceFreeze?.manifestCount ?? ""} |
| Target | ${model.targetBaseline ? "available" : "missing"} | ${model.targetBaseline?.branch ?? ""} | ${model.targetBaseline?.head ?? ""} | ${model.targetBaseline?.packageVersion ?? ""} | ${model.targetBaseline?.statusPorcelain?.length ?? ""} | ${model.targetBaseline?.manifest?.length ?? ""} |

## Freeze Artifacts

| Side | Available | HEAD archive | Binary diff | Manifest | Codex patch |
|---|---|---|---|---|---|
| Source | ${model.sourceFreeze ? "yes" : "no"} | ${model.sourceFreeze?.artifacts?.headArchive?.sha256 ?? ""} | ${model.sourceFreeze?.artifacts?.binaryDiff?.sha256 ?? ""} | ${model.sourceFreeze?.artifacts?.manifest?.sha256 ?? ""} | ${model.sourceFreeze?.artifacts?.codexSessionsPatch?.sha256 ?? ""} |
| Target | ${model.targetFreeze ? "yes" : "no"} | ${model.targetFreeze?.artifacts?.headArchive?.sha256 ?? ""} | ${model.targetFreeze?.artifacts?.binaryDiff?.sha256 ?? ""} | ${model.targetFreeze?.artifacts?.manifest?.sha256 ?? ""} | ${model.targetFreeze?.artifacts?.codexSessionsPatch?.sha256 ?? ""} |

## Gate Status

| Gate | Status | Detail |
|---|---|---|
| M0 validation | ${model.m0Validation?.status ?? "missing"} | ${model.m0Validation ? `${model.m0Validation.passedCount} pass, ${model.m0Validation.failedCount} fail` : ""} |
| M8 readiness | ${model.m8Readiness?.status ?? "missing"} | ${model.m8Readiness ? `${model.m8Readiness.passedCount} pass, ${model.m8Readiness.failedCount} fail` : ""} |
| Freeze comparison | ${model.freezeComparison?.status ?? "missing"} | runtime open: ${model.freezeComparison?.summary?.runtimeOpen ?? ""} |
| Contract snapshots | ${model.contractDiff?.status ?? "missing"} | compared files: ${model.contractDiff?.results?.length ?? ""} |
| Ledger validation | ${model.ledgerValidation?.status ?? "missing"} | ${model.ledgerValidation?.summary ? `${model.ledgerValidation.summary.open} open, ${model.ledgerValidation.summary.closed} closed` : ""} |
| Target diff index | ${model.targetDiffIndex ? "available" : "missing"} | ${model.targetDiffIndex?.summary ? `${model.targetDiffIndex.summary.total} files, ${model.targetDiffIndex.summary.unmappedContractReview} unmapped` : ""} |

## Ledger

${renderLedgerTable(model)}

## Artifacts

${renderArtifactTable(model)}

## Pipeline Commands

${renderPipelineTable(model)}

## Report Hashes

| Artifact | SHA-256 |
|---|---|
${Object.entries(model.hashes).map(([name, hash]) => `| ${name} | ${hash ?? ""} |`).join("\n")}

## Open Blockers

${renderOpenBlockers(model)}

## Approved Deviations

${renderApprovedDeviations(model)}

## Signoff

Owner signoff: ${renderOwnerSignoff(model)}
`;
}

function renderDraftWarning(model) {
  if (model.mode === "final") {
    return "";
  }

  return "> Draft only. This file is not the formal final report and cannot close parity.\n";
}

function renderLedgerTable(model) {
  const items = model.ledger?.items ?? [];
  if (items.length === 0) {
    return "_No ledger data._";
  }

  const rows = items.map((item) => (
    `| ${item.id} | ${item.status} | ${item.functionContract} | ${item.sourceEvidence?.status ?? ""} | ${item.implementation?.targetCommit ?? ""} | ${item.ownerSignoff ?? ""} |`
  ));

  return `| ID | Status | Contract | Source evidence | Target commit | Signoff |
|---|---|---|---|---|---|
${rows.join("\n")}`;
}

function renderArtifactTable(model) {
  const rows = model.artifactSummary.map((artifact) => (
    `| ${artifact.id} | ${artifact.sourceExists ? "yes" : "no"} | ${artifact.sourceComplete ? "yes" : "no"} | ${artifact.targetExists ? "yes" : "no"} | ${artifact.targetComplete ? "yes" : "no"} | ${artifact.targetFiles ?? ""} |`
  ));

  return `| ID | Source artifact | Source complete | Target artifact | Target complete | Target files |
|---|---|---|---|---|---:|
${rows.join("\n")}`;
}

function renderPipelineTable(model) {
  const steps = model.pipeline?.steps ?? [];
  if (steps.length === 0) {
    return "_No pipeline data._";
  }

  const rows = steps.map((step) => (
    `| ${step.status} | ${step.label} | \`${String(step.command ?? step.reason ?? "").replaceAll("|", "\\|")}\` |`
  ));

  return `| Status | Step | Command / Reason |
|---|---|---|
${rows.join("\n")}`;
}

function renderOpenBlockers(model) {
  const checks = model.m8Readiness?.checks ?? [];
  const failed = checks.filter((item) => item.status !== "pass");
  if (failed.length === 0) {
    return "_None recorded._";
  }

  return failed
    .map((item) => `- ${item.name}: \`${JSON.stringify(item.details ?? {}).replaceAll("`", "\\`")}\``)
    .join("\n");
}

function renderApprovedDeviations(model) {
  const deviations = (model.ledger?.items ?? [])
    .flatMap((item) => (item.deviations ?? []).map((deviation) => ({ id: item.id, deviation })));

  if (deviations.length === 0) {
    return "_None recorded._";
  }

  return deviations
    .map(({ id, deviation }) => `- ${id}: ${typeof deviation === "string" ? deviation : JSON.stringify(deviation)}`)
    .join("\n");
}

function renderOwnerSignoff(model) {
  const missing = (model.ledger?.items ?? [])
    .filter((item) => !item.ownerSignoff)
    .map((item) => item.id);

  if (missing.length === 0 && model.ledger?.items?.length > 0) {
    return "all ledger items signed";
  }

  return `missing for ${missing.join(", ") || "all items"}`;
}

function writeReport(outputPath, contents) {
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, contents);
}

const args = parseArgs(process.argv.slice(2));
const readinessStatus = getReadinessStatus();
if (args.final && readinessStatus !== "ready") {
  throw new Error(`Refusing to write ${DEFAULT_FINAL_OUTPUT}: M8 readiness is ${readinessStatus}`);
}

const model = buildReportModel(args.final ? "final" : "draft");
writeReport(args.output, renderReport(model));

console.log(`Wrote ${args.final ? "final" : "draft"} parity report to ${args.output}`);
